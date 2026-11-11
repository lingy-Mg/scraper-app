import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'scraper-settings-io-'))
process.env.SCRAPER_DATA_DIR = dataDir

let loadSettings: typeof import('../server/settings').loadSettings
let saveSettings: typeof import('../server/settings').saveSettings
let defaultSettings: typeof import('../server/settings').defaultSettings
let normalizeTheme: typeof import('../server/settings').normalizeTheme
let normalizeTable: typeof import('../server/settings').normalizeTable
let buildSettingsExport: typeof import('../server/settings-io').buildSettingsExport
let importSettingsPayload: typeof import('../server/settings-io').importSettingsPayload
let mergeSettings: typeof import('../server/settings-io').mergeSettings
type Settings = import('../server/settings').Settings

beforeAll(async () => {
  const settings = await import('../server/settings')
  loadSettings = settings.loadSettings
  saveSettings = settings.saveSettings
  defaultSettings = settings.defaultSettings
  normalizeTheme = settings.normalizeTheme
  normalizeTable = settings.normalizeTable
  const io = await import('../server/settings-io')
  buildSettingsExport = io.buildSettingsExport
  importSettingsPayload = io.importSettingsPayload
  mergeSettings = io.mergeSettings
})

const settingsPath = () => join(dataDir, 'settings.json')

beforeEach(async () => {
  await saveSettings(defaultSettings())
})

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

const withSecrets = (): Settings => {
  const base = defaultSettings()
  return {
    ...base,
    ai: { ...base.ai, apiKey: 'sk-live-secret', model: 'test-model' },
    modes: {
      tmdb: { tmdbApiKey: 'tmdb-secret', lang: 'zh-CN' },
      javdb: { token: 'javdb-secret' }
    }
  }
}

describe('主题与表格设置兼容', () => {
  test('旧设置缺少 theme/table 时按 system 与空表格设置处理', async () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ ai: { ...defaultSettings().ai }, minDur: 12, sources: [] })
    )
    const loaded = await loadSettings()
    expect(loaded.theme).toBe('system')
    expect(loaded.table).toEqual({ widths: {}, hidden: [] })
    expect(loaded.minDur).toBe(12)
  })

  test('非法主题回退 system，合法主题保留', () => {
    expect(normalizeTheme(undefined)).toBe('system')
    expect(normalizeTheme('neon')).toBe('system')
    expect(normalizeTheme(42)).toBe('system')
    expect(normalizeTheme('dark')).toBe('dark')
    expect(normalizeTheme('light')).toBe('light')
  })

  test('表格设置持久化并对非法值做回退/裁剪', async () => {
    await saveSettings({
      ...defaultSettings(),
      table: {
        widths: { file: 300.6, title: 5, unknown: 200 },
        hidden: ['title', 'act', 'select', 'title', 'bogus']
      }
    })
    const loaded = await loadSettings()
    expect(loaded.table?.widths?.file).toBe(301)
    expect(loaded.table?.widths?.title).toBe(40)
    expect(loaded.table?.widths?.unknown).toBeUndefined()
    expect(loaded.table?.hidden).toEqual(['title'])
  })

  test('非法 table 值使用默认空设置', () => {
    expect(normalizeTable('bad')).toEqual({ widths: {}, hidden: [] })
    expect(normalizeTable({ widths: [], hidden: 'title' })).toEqual({
      widths: {},
      hidden: []
    })
  })
})

describe('设置导出脱敏', () => {
  test('默认导出不含 API Key / TMDB Key / JavDB Token', () => {
    const exported = buildSettingsExport(withSecrets(), false, new Date('2026-01-02T03:04:05Z'))
    const text = JSON.stringify(exported)
    expect(exported.includesSecrets).toBe(false)
    expect(text).not.toContain('sk-live-secret')
    expect(text).not.toContain('tmdb-secret')
    expect(text).not.toContain('javdb-secret')
    expect(text).not.toContain('apiKey')
    expect(text).not.toContain('tmdbApiKey')
    expect(text).not.toContain('token')
    const settings = exported.settings as Record<string, unknown>
    expect((settings.ai as Record<string, unknown>).model).toBe('test-model')
    expect((settings.modes as Record<string, unknown>).tmdb).toEqual({ lang: 'zh-CN' })
  })

  test('includeSecrets=true 时保留密钥', () => {
    const exported = buildSettingsExport(withSecrets(), true)
    const settings = exported.settings as Record<string, unknown>
    expect(exported.includesSecrets).toBe(true)
    expect((settings.ai as Record<string, unknown>).apiKey).toBe('sk-live-secret')
    expect((settings.modes as Record<string, unknown>).javdb).toEqual({
      token: 'javdb-secret'
    })
  })
})

describe('设置导入校验与合并', () => {
  test('非法结构返回 400 且不改动现有设置', async () => {
    await saveSettings({
      ...defaultSettings(),
      theme: 'dark',
      minDur: 7,
      blacklist: ['keep-me']
    })
    const before = readFileSync(settingsPath(), 'utf8')

    const invalidPayloads: unknown[] = [
      {},
      { settings: [] },
      { theme: 'neon' },
      { ai: { apiKey: 123 } },
      { table: { widths: { file: 'wide' } } },
      { minDur: -1 }
    ]
    for (const payload of invalidPayloads) {
      await expect(importSettingsPayload(payload)).rejects.toMatchObject({ status: 400 })
    }

    expect(readFileSync(settingsPath(), 'utf8')).toBe(before)
    const loaded = await loadSettings()
    expect(loaded.theme).toBe('dark')
    expect(loaded.minDur).toBe(7)
    expect(loaded.blacklist).toEqual(['keep-me'])
  })

  test('导入合并：AI 保留未提供密钥，表格宽度按键合并，hidden 保留', async () => {
    await saveSettings({
      ...defaultSettings(),
      ai: { ...defaultSettings().ai, apiKey: 'keep-key', model: 'old-model' },
      theme: 'dark',
      minDur: 10,
      table: { widths: { file: 220, title: 260 }, hidden: ['title'] },
      blacklist: ['old']
    })

    const result = await importSettingsPayload({
      app: 'scraper',
      version: 1,
      exportedAt: '2026-01-02T03:04:05Z',
      includesSecrets: false,
      settings: {
        theme: 'light',
        minDur: 5,
        ai: { model: 'new-model' },
        table: { widths: { file: 300 } },
        blacklist: ['new-a', 'new-b']
      }
    })

    expect(result.applied).toEqual(
      expect.arrayContaining(['theme', 'minDur', 'ai', 'table', 'blacklist'])
    )
    expect(result.settings.ai.apiKey).toBe('keep-key')
    expect(result.settings.ai.model).toBe('new-model')
    expect(result.settings.table?.widths).toEqual({ file: 300, title: 260 })
    expect(result.settings.table?.hidden).toEqual(['title'])

    const loaded = await loadSettings()
    expect(loaded.theme).toBe('light')
    expect(loaded.minDur).toBe(5)
    expect(loaded.ai.apiKey).toBe('keep-key')
    expect(loaded.blacklist).toEqual(['new-a', 'new-b'])
  })

  test('纯函数合并保留未导入字段', () => {
    const current: Settings = {
      ...defaultSettings(),
      theme: 'dark',
      table: { widths: { file: 220 }, hidden: ['title'] }
    }
    const result = mergeSettings(current, { theme: 'light', table: { widths: { code: 150 } } })
    expect(result.applied).toEqual(['theme', 'table'])
    expect(result.settings.ai).toEqual(current.ai)
    expect(result.settings.table?.hidden).toEqual(['title'])
    expect(result.settings.table?.widths).toEqual({ file: 220, code: 150 })
  })
})

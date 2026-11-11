import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/**
 * 延迟到 beforeAll 再动态 import，确保 SCRAPER_DATA_DIR 已在
 * 当前测试文件的隔离环境中生效（与 library.test.ts 相同策略）。
 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-sources-data-'))
const rootDir = mkdtempSync(join(tmpdir(), 'scraper-sources-root-'))
process.env.SCRAPER_DATA_DIR = dataDir

let addSource: typeof import('../server/sources').addSource
let listSources: typeof import('../server/sources').listSources
let removeSource: typeof import('../server/sources').removeSource
let loadSettings: typeof import('../server/settings').loadSettings
let saveSettings: typeof import('../server/settings').saveSettings
let defaultSettings: typeof import('../server/settings').defaultSettings

beforeAll(async () => {
  const sources = await import('../server/sources')
  addSource = sources.addSource
  listSources = sources.listSources
  removeSource = sources.removeSource
  const settings = await import('../server/settings')
  loadSettings = settings.loadSettings
  saveSettings = settings.saveSettings
  defaultSettings = settings.defaultSettings
})

const mediaA = join(rootDir, 'media-a')
const mediaB = join(rootDir, 'media-b')
const mediaFile = join(rootDir, 'not-a-dir.mp4')

beforeAll(() => {
  mkdirSync(mediaA)
  mkdirSync(mediaB)
  writeFileSync(mediaFile, 'video')
})

beforeEach(async () => {
  await saveSettings({ ...defaultSettings(), sources: [] })
})

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  rmSync(rootDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('来源校验', () => {
  test('拒绝相对路径、不存在的目录与普通文件', async () => {
    await expect(addSource('relative/path')).rejects.toThrow('绝对路径')
    await expect(addSource(join(rootDir, 'missing'))).rejects.toThrow('目录不存在')
    await expect(addSource(mediaFile)).rejects.toThrow('不是目录')
    expect(await listSources()).toHaveLength(0)
  })
})

describe('来源 CRUD', () => {
  test('添加目录后持久化，名称默认取目录名', async () => {
    const result = await addSource(mediaA)
    expect(result.added).toBe(true)
    expect(result.source.path).toBe(mediaA)
    expect(result.source.name).toBe(basename(mediaA))
    expect(typeof result.source.addedAt).toBe('number')
    expect(result.source.addedAt).toBeGreaterThan(0)

    const list = await listSources()
    expect(list).toHaveLength(1)
    expect(list[0].path).toBe(mediaA)

    const stored = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))
    expect(stored.sources).toHaveLength(1)
    expect(stored.sources[0].path).toBe(mediaA)
  })

  test('去重（Windows 路径大小写不敏感）且保留自定义名称', async () => {
    const first = await addSource(mediaA, '  我的片库  ')
    expect(first.source.name).toBe('我的片库')

    const duplicate = await addSource(mediaA)
    expect(duplicate.added).toBe(false)
    expect(duplicate.sources).toHaveLength(1)
    expect(duplicate.source.name).toBe('我的片库')

    if (process.platform === 'win32') {
      const upper = await addSource(mediaA.toUpperCase())
      expect(upper.added).toBe(false)
      expect((await listSources()).length).toBe(1)
    }
  })

  test('删除只移除记录，不删除目录', async () => {
    await addSource(mediaA)
    await addSource(mediaB)
    expect(await listSources()).toHaveLength(2)

    const removed = await removeSource(mediaA)
    expect(removed.removed).toBe(true)
    expect(removed.sources.map((source) => source.path)).toEqual([mediaB])
    expect(statSync(mediaA).isDirectory()).toBe(true)
    expect((await listSources()).map((source) => source.path)).toEqual([mediaB])

    const again = await removeSource(mediaA)
    expect(again.removed).toBe(false)
  })

  test('添加来源不会覆盖其它设置字段', async () => {
    await saveSettings({ ...defaultSettings(), lastFolder: 'C:\\keep-me', minDur: 7 })
    await addSource(mediaA)
    const settings = await loadSettings()
    expect(settings.lastFolder).toBe('C:\\keep-me')
    expect(settings.minDur).toBe(7)
    expect(settings.sources).toHaveLength(1)
  })

  test('旧设置缺少 sources 时返回空数组', async () => {
    writeFileSync(
      join(dataDir, 'settings.json'),
      JSON.stringify({ ai: defaultSettings().ai, lastFolder: 'C:\\old' }),
      'utf8'
    )
    const settings = await loadSettings()
    expect(settings.lastFolder).toBe('C:\\old')
    expect(settings.sources).toEqual([])
  })
})

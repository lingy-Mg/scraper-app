import { HttpError } from './fs'
import {
  loadSettings,
  normalizeTable,
  saveSettings,
  type AIConfig,
  type MediaSource,
  type Settings,
  type TableSettings,
  type ThemePreference
} from './settings'

/** 导出文件外层结构；`settings` 为脱敏（或显式包含密钥）后的快照。 */
export interface SettingsExport {
  app: 'scraper'
  version: 1
  exportedAt: string
  includesSecrets: boolean
  settings: Record<string, unknown>
}

export interface SettingsImportResult {
  settings: Settings
  applied: string[]
}

/**
 * 密钥字段名（大小写不敏感）。JavDB 令牌通常保存在插件配置
 * `data/config.json`，不在设置导出范围内；这里同时兜底 settings.modes
 * 中可能的同类字段。
 */
const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'tmdbapikey',
  'tmdb_api_key',
  'bangumitoken',
  'bangumi_token',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'password',
  'secret'
])

const isSecretKey = (key: string): boolean => {
  const lower = key.toLowerCase()
  return SECRET_KEYS.has(lower) || lower.endsWith('apikey') || lower.endsWith('_key')
}

/** 递归移除密钥字段；返回新对象，不修改入参。 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactSecrets(entry))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isSecretKey(key)) continue
    result[key] = redactSecrets(entry)
  }
  return result
}

/** 构造导出内容；默认脱敏，仅在显式 includeSecrets 时包含密钥。 */
export function buildSettingsExport(
  settings: Settings,
  includeSecrets: boolean,
  now: Date = new Date()
): SettingsExport {
  const snapshot = JSON.parse(JSON.stringify(settings)) as Record<string, unknown>
  return {
    app: 'scraper',
    version: 1,
    exportedAt: now.toISOString(),
    includesSecrets: includeSecrets,
    settings: includeSecrets
      ? snapshot
      : (redactSecrets(snapshot) as Record<string, unknown>)
  }
}

function fail(message: string): never {
  throw new HttpError(400, message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const SETTINGS_KEYS = [
  'ai',
  'modes',
  'lastFolder',
  'minDur',
  'compact',
  'hideShorts',
  'logOpen',
  'logHeight',
  'theme',
  'table',
  'blacklist',
  'sources'
] as const

const AI_STRING_FIELDS = ['provider', 'baseUrl', 'apiKey', 'model', 'prompt'] as const
const AI_NUMBER_FIELDS = ['temperature', 'timeout', 'autoPickThreshold'] as const
const AI_BOOLEAN_FIELDS = [
  'enabled',
  'cleanFilename',
  'inferCode',
  'verify',
  'fallback',
  'autoPick'
] as const

function parseAi(value: unknown): Partial<AIConfig> {
  if (!isRecord(value)) fail('ai 必须是对象')
  const ai: Record<string, unknown> = {}
  for (const field of AI_STRING_FIELDS) {
    if (!(field in value)) continue
    if (typeof value[field] !== 'string') fail(`ai.${field} 必须是字符串`)
    ai[field] = value[field]
  }
  for (const field of AI_NUMBER_FIELDS) {
    if (!(field in value)) continue
    if (typeof value[field] !== 'number' || !Number.isFinite(value[field])) {
      fail(`ai.${field} 必须是数字`)
    }
    ai[field] = value[field]
  }
  for (const field of AI_BOOLEAN_FIELDS) {
    if (!(field in value)) continue
    if (typeof value[field] !== 'boolean') fail(`ai.${field} 必须是布尔值`)
    ai[field] = value[field]
  }
  return ai as Partial<AIConfig>
}

function parseModes(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail('modes 必须是对象')
  const modes: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isRecord(entry)) fail(`modes.${key} 必须是对象`)
    modes[key] = entry
  }
  return modes
}

function parseSources(value: unknown): MediaSource[] {
  if (!Array.isArray(value)) fail('sources 必须是数组')
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`sources[${index}] 必须是对象`)
    const path = typeof entry.path === 'string' ? entry.path.trim() : ''
    if (!path) fail(`sources[${index}].path 必须是绝对路径`)
    const name =
      typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined
    const addedAt =
      typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt) ? entry.addedAt : 0
    return { path, ...(name ? { name } : {}), addedAt }
  })
}

function parseTable(value: unknown): TableSettings {
  if (!isRecord(value)) fail('table 必须是对象')
  if (value.widths !== undefined) {
    if (!isRecord(value.widths)) fail('table.widths 必须是对象')
    for (const [key, width] of Object.entries(value.widths)) {
      if (typeof width !== 'number' || !Number.isFinite(width)) {
        fail(`table.widths.${key} 必须是数字`)
      }
    }
  }
  if (value.hidden !== undefined) {
    if (!Array.isArray(value.hidden) || value.hidden.some((key) => typeof key !== 'string')) {
      fail('table.hidden 必须是字符串数组')
    }
  }
  return normalizeTable(value)
}

function parseTheme(value: unknown): ThemePreference {
  if (value !== 'light' && value !== 'dark' && value !== 'system') {
    fail('theme 必须是 light/dark/system 之一')
  }
  return value
}

function parseFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    fail(`${label} 必须是非负数字`)
  }
  return value
}

function parseBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是布尔值`)
  return value
}

function parseBlacklist(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    fail('blacklist 必须是字符串数组')
  }
  return (value as string[]).map((entry) => entry.trim()).filter(Boolean)
}

/**
 * 校验导入 JSON 并提取可识别的设置字段。
 * 支持导出文件外层结构 `{ settings: {...} }`，也兼容直接传入设置对象。
 * 任何结构错误都抛 400，调用方保证不会写入现有设置。
 */
export function parseSettingsImport(payload: unknown): Partial<Settings> {
  if (!isRecord(payload)) fail('导入内容必须是 JSON 对象')
  let source: Record<string, unknown>
  if ('settings' in payload) {
    if (!isRecord(payload.settings)) fail('settings 必须是对象')
    source = payload.settings
  } else {
    source = payload
  }

  const present = SETTINGS_KEYS.filter((key) => key in source)
  if (!present.length) fail('没有可导入的设置字段')

  const result: Partial<Settings> = {}
  for (const key of present) {
    const value = source[key]
    switch (key) {
      case 'ai':
        result.ai = parseAi(value) as AIConfig
        break
      case 'modes':
        result.modes = parseModes(value)
        break
      case 'lastFolder':
        if (typeof value !== 'string') fail('lastFolder 必须是字符串')
        result.lastFolder = value
        break
      case 'minDur':
        result.minDur = parseFiniteNumber(value, 'minDur')
        break
      case 'compact':
        result.compact = parseBoolean(value, 'compact')
        break
      case 'hideShorts':
        result.hideShorts = parseBoolean(value, 'hideShorts')
        break
      case 'logOpen':
        result.logOpen = parseBoolean(value, 'logOpen')
        break
      case 'logHeight':
        result.logHeight = parseFiniteNumber(value, 'logHeight')
        break
      case 'theme':
        result.theme = parseTheme(value)
        break
      case 'table':
        result.table = parseTable(value)
        break
      case 'blacklist':
        result.blacklist = parseBlacklist(value)
        break
      case 'sources':
        result.sources = parseSources(value)
        break
      default:
        break
    }
  }
  return result
}

/**
 * 合并语义：
 * - 标量字段：导入值覆盖当前值；
 * - `ai`：逐字段合并，未提供的字段（如脱敏后的 apiKey）保留现状；
 * - `modes`：按模式 id 合并，同名模式整体覆盖；
 * - `table`：宽度按键合并，hidden 整体替换（未提供时保留现状）；
 * - `sources` / `blacklist`：整体替换。
 */
export function mergeSettings(
  current: Settings,
  incoming: Partial<Settings>
): SettingsImportResult {
  const next: Settings = { ...current }
  const applied: string[] = []

  if (incoming.ai) {
    next.ai = { ...current.ai, ...incoming.ai }
    applied.push('ai')
  }
  if (incoming.modes) {
    next.modes = { ...(current.modes ?? {}), ...incoming.modes }
    applied.push('modes')
  }
  if (incoming.lastFolder !== undefined) {
    next.lastFolder = incoming.lastFolder
    applied.push('lastFolder')
  }
  if (incoming.minDur !== undefined) {
    next.minDur = incoming.minDur
    applied.push('minDur')
  }
  if (incoming.compact !== undefined) {
    next.compact = incoming.compact
    applied.push('compact')
  }
  if (incoming.hideShorts !== undefined) {
    next.hideShorts = incoming.hideShorts
    applied.push('hideShorts')
  }
  if (incoming.logOpen !== undefined) {
    next.logOpen = incoming.logOpen
    applied.push('logOpen')
  }
  if (incoming.logHeight !== undefined) {
    next.logHeight = incoming.logHeight
    applied.push('logHeight')
  }
  if (incoming.theme !== undefined) {
    next.theme = incoming.theme
    applied.push('theme')
  }
  if (incoming.table !== undefined) {
    next.table = {
      widths: { ...(current.table?.widths ?? {}), ...(incoming.table.widths ?? {}) },
      hidden: incoming.table.hidden ?? current.table?.hidden ?? []
    }
    applied.push('table')
  }
  if (incoming.blacklist !== undefined) {
    next.blacklist = incoming.blacklist
    applied.push('blacklist')
  }
  if (incoming.sources !== undefined) {
    next.sources = incoming.sources
    applied.push('sources')
  }

  return { settings: next, applied }
}

/** 校验 → 合并 → 原子写盘。失败时不会触碰现有设置文件。 */
export async function importSettingsPayload(payload: unknown): Promise<SettingsImportResult> {
  const incoming = parseSettingsImport(payload)
  const current = await loadSettings()
  const result = mergeSettings(current, incoming)
  await saveSettings(result.settings)
  return result
}

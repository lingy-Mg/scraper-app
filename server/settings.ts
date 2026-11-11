import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export interface AIConfig {
  enabled: boolean
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  timeout: number
  cleanFilename: boolean
  inferCode: boolean
  verify: boolean
  fallback: boolean
  autoPick: boolean
  autoPickThreshold: number
  prompt: string
}

/** 主题偏好；旧设置缺少该字段时按 `system` 处理。 */
export type ThemePreference = 'light' | 'dark' | 'system'

const THEMES: readonly ThemePreference[] = ['light', 'dark', 'system']

/** 可持久化宽度的列 key（含固定列，宽度可调但不可隐藏）。 */
export const TABLE_WIDTH_KEYS = [
  'status',
  'poster',
  'code',
  'file',
  'title',
  'maker',
  'actors',
  'dur',
  'size',
  'src',
  'progress',
  'act'
] as const

/** 表格列宽持久化；单位像素，读取时裁剪到合理区间。 */
export interface TableSettings {
  widths?: Record<string, number>
}

const MIN_COLUMN_WIDTH = 40
const MAX_COLUMN_WIDTH = 1200

/** 媒体库来源（扫描根目录）；只记录路径，不移动/删除任何文件。 */
export interface MediaSource {
  path: string
  name?: string
  /** 毫秒时间戳。 */
  addedAt: number
}

export interface Settings {
  ai: AIConfig
  modes?: Record<string, unknown>
  lastFolder?: string
  /** 已登记的媒体库来源；旧设置没有该字段时按空数组处理。 */
  sources?: MediaSource[]
  minDur?: number
  compact?: boolean
  /** 默认隐藏短片（疑似广告）。 */
  hideShorts?: boolean
  /** 日志面板是否默认展开。 */
  logOpen?: boolean
  /** 日志面板高度（像素）。 */
  logHeight?: number
  /** 界面主题；非法值回退为 `system`。 */
  theme?: ThemePreference
  /** 表格列宽；非法值会被忽略。 */
  table?: TableSettings
  /** 文件名黑名单：扫描时跳过、列表中隐藏。 */
  blacklist?: string[]
}

/** 与前端 src/data.ts 的 INITIAL_AI 保持一致。 */
export const DEFAULT_AI: AIConfig = {
  enabled: true,
  provider: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.1,
  timeout: 20,
  cleanFilename: true,
  inferCode: true,
  verify: true,
  fallback: true,
  autoPick: true,
  autoPickThreshold: 0.9,
  prompt: `你是影片文件名解析器。从文件名中提取番号和标题。
只返回 JSON，不要解释：
{"code": "番号", "title": "标题", "confidence": 0.0}

文件名：{filename}`
}

/**
 * 运行时数据目录的唯一来源。
 * 默认是项目根目录下的 `data/`，**绝不写入用户目录（APPDATA 等）**；
 * 测试 / 多实例可通过 `SCRAPER_DATA_DIR` 注入隔离目录。
 */
export function resolveDataDir(): string {
  const injected = process.env.SCRAPER_DATA_DIR?.trim()
  return injected ? resolve(injected) : join(import.meta.dir, '..', 'data')
}

export const DATA_DIR = resolveDataDir()
export const SETTINGS_FILE = join(DATA_DIR, 'settings.json')

/**
 * 运行时路径一律通过函数按需解析，而不是在模块加载时固化。
 * Bun 测试文件共享模块缓存但各自隔离 `process.env`，延迟解析才能
 * 让每个测试文件使用自己的临时目录。
 */
function settingsFile(): string {
  return join(resolveDataDir(), 'settings.json')
}

export function defaultSettings(): Settings {
  return {
    ai: { ...DEFAULT_AI },
    lastFolder: '',
    sources: [],
    minDur: 10,
    compact: false,
    hideShorts: true,
    logOpen: true,
    logHeight: 180,
    theme: 'system',
    table: { widths: {} },
    blacklist: []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** 兼容旧设置：缺失/损坏的主题一律回退为 system。 */
export function normalizeTheme(value: unknown): ThemePreference {
  return typeof value === 'string' && THEMES.includes(value as ThemePreference)
    ? (value as ThemePreference)
    : 'system'
}

/** 兼容旧设置：忽略未知列与非法宽度，并把数值限制在 40–1200。 */
export function normalizeTable(
  value: unknown,
  fallback: TableSettings = { widths: {} }
): TableSettings {
  if (!isRecord(value)) return { ...fallback, widths: { ...(fallback.widths ?? {}) } }
  const widths: Record<string, number> = {}
  if (isRecord(value.widths)) {
    for (const key of TABLE_WIDTH_KEYS) {
      const raw = value.widths[key]
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue
      widths[key] = Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(raw)))
    }
  }
  return { ...fallback, widths }
}

/** 兼容旧设置：缺失/损坏的 sources 一律回退为空数组，并去重。 */
function normalizeSources(value: unknown, fallback: MediaSource[]): MediaSource[] {
  if (!Array.isArray(value)) return fallback
  const seen = new Set<string>()
  const result: MediaSource[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const path = typeof entry.path === 'string' ? entry.path.trim() : ''
    if (!path) continue
    const key = process.platform === 'win32' ? path.toLowerCase() : path
    if (seen.has(key)) continue
    seen.add(key)
    const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : undefined
    const addedAt =
      typeof entry.addedAt === 'number' && Number.isFinite(entry.addedAt) ? entry.addedAt : 0
    result.push({ path, ...(name ? { name } : {}), addedAt })
  }
  return result
}

/**
 * 读取设置。文件不存在或内容损坏时返回默认值。
 * 已保存的部分字段会用默认 AI 配置补齐，避免前端缺少字段。
 */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await readFile(settingsFile(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return defaultSettings()

    const defaults = defaultSettings()
    return {
      ...defaults,
      ...parsed,
      theme: normalizeTheme(parsed.theme),
      table: normalizeTable(parsed.table, defaults.table),
      sources: normalizeSources(parsed.sources, defaults.sources ?? []),
      ai: {
        ...defaults.ai,
        ...(isRecord(parsed.ai) ? parsed.ai : {})
      }
    } as Settings
  } catch {
    return defaultSettings()
  }
}

/** 读取某个模式（插件 id）的前端配置快照，供插件自行取用语言/密钥。 */
export async function loadModeConfig(id: string): Promise<Record<string, unknown>> {
  const settings = await loadSettings()
  const modes = settings.modes
  if (!modes || typeof modes !== 'object' || Array.isArray(modes)) return {}
  const value = (modes as Record<string, unknown>)[id]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 整体覆盖写入，临时文件 + rename，保证原子性。 */
export async function saveSettings(settings: Settings): Promise<void> {
  await mkdir(resolveDataDir(), { recursive: true })
  const target = settingsFile()
  const payload = JSON.stringify(settings, null, 2)
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`

  await writeFile(temp, payload, 'utf8')
  try {
    await rename(temp, target)
  } catch {
    // Windows 上目标被占用时 rename 可能失败，退化为先删后改名。
    try {
      await unlink(target)
    } catch {
      // 目标不存在时忽略
    }
    await rename(temp, target)
  }
}

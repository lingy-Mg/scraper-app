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

export interface Settings {
  ai: AIConfig
  modes?: Record<string, unknown>
  lastFolder?: string
  minDur?: number
  compact?: boolean
  /** 默认隐藏短片（疑似广告）。 */
  hideShorts?: boolean
  /** 日志面板是否默认展开。 */
  logOpen?: boolean
  /** 日志面板高度（像素）。 */
  logHeight?: number
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

export function defaultSettings(): Settings {
  return {
    ai: { ...DEFAULT_AI },
    lastFolder: '',
    minDur: 10,
    compact: false,
    hideShorts: true,
    logOpen: true,
    logHeight: 180,
    blacklist: []
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 读取设置。文件不存在或内容损坏时返回默认值。
 * 已保存的部分字段会用默认 AI 配置补齐，避免前端缺少字段。
 */
export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await readFile(SETTINGS_FILE, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return defaultSettings()

    const defaults = defaultSettings()
    return {
      ...defaults,
      ...parsed,
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
  await mkdir(DATA_DIR, { recursive: true })
  const payload = JSON.stringify(settings, null, 2)
  const temp = `${SETTINGS_FILE}.${process.pid}.${Date.now()}.tmp`

  await writeFile(temp, payload, 'utf8')
  try {
    await rename(temp, SETTINGS_FILE)
  } catch {
    // Windows 上目标被占用时 rename 可能失败，退化为先删后改名。
    try {
      await unlink(SETTINGS_FILE)
    } catch {
      // 目标不存在时忽略
    }
    await rename(temp, SETTINGS_FILE)
  }
}

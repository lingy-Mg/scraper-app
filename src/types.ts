export type ModeKey = 'av' | 'movie' | 'tv' | 'anime'

export type RowStatus = 'done' | 'unmatched' | 'running' | 'waiting' | 'error' | 'review'

export type NativeMode = 'http' | 'demo'

export interface MediaFile {
  path: string
  name: string
  size: number
  duration: number | null
  probedBy: 'ffprobe' | 'mp4' | 'none'
  width?: number | null
  height?: number | null
  videoCodec?: string | null
}

export interface ScanRequest {
  path: string
  recursive?: boolean
  /** 扫描时跳过这些文件名（与 Settings.blacklist 同一匹配规则）。 */
  blacklist?: string[]
}

/** 扫描进度：由 HTTP NDJSON 流推送。 */
export interface ScanProgress {
  scanId: string
  /** `walk` = 枚举目录，`probe` = 读取视频信息。 */
  phase: 'walk' | 'probe'
  found: number
  dirs: number
  total: number
  done: number
  current: string
  files?: MediaFile[]
}

/** 前端扫描状态（用于进度条与空表提示）。 */
export interface ScanState {
  active: boolean
  phase: ScanProgress['phase']
  found: number
  dirs: number
  total: number
  done: number
  current: string
  startedAt: number
}

/** 手动裁剪区域，使用源图像素坐标。 */
export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface OrganizeItem {
  source: string
  relativeTarget: string
  /** 可选：写入同名 .nfo 的 XML 内容 */
  nfo?: string
  /** 可选：下载为同名 .jpg 的海报地址 */
  posterUrl?: string
  /** 可选：手动裁剪区域；为空时保存完整封面 */
  posterCrop?: CropRect
}

export interface OrganizeRequest {
  dest: string
  action: 'move' | 'copy'
  conflict: 'skip' | 'overwrite' | 'rename'
  removeEmptyDirs?: boolean
  items: OrganizeItem[]
}

export interface OrganizeResult {
  source: string
  target: string
  ok: boolean
  skipped: boolean
  error?: string
  warning?: string
}

export interface TrashResult {
  removed: number
  failed: { path: string; error: string }[]
}

export interface AppInfo {
  version: string
  platform: string
  ffprobe: boolean
  native: boolean
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
  /**
   * 文件名黑名单：不区分大小写，支持 `*` / `?` 通配符；
   * 不含通配符时按包含匹配。命中的文件扫描时跳过、列表中隐藏。
   */
  blacklist?: string[]
}

/** 与 docs/providers-library-contract.md 保持一致。 */
export interface LibraryItem {
  path: string
  file: string
  mode: string
  code: string
  title: string
  status: string
  year?: string
  maker?: string
  actors?: string
  overview?: string
  src?: string
  score?: number
  dur?: number
  size?: number
  posterUrl?: string
  posterCrop?: CropRect
  detailId?: string
  tags?: string[]
  releaseDate?: string
  director?: string
  series?: string
  updatedAt?: number
}

export interface Candidate {
  id: string
  title: string
  year: string
  code?: string
  source: string
  score: number
  overview: string
  poster: number
  posterUrl?: string
  maker?: string
  actors?: string
  duration?: number
  detailId?: string
  tags?: string[]
  releaseDate?: string
  director?: string
  series?: string
}

export interface AITestResult {
  ok: boolean
  latencyMs: number
  message: string
}

export interface AIIdentifyResult {
  code: string
  title: string
  confidence: number
  ms: number
  fallback: boolean
  raw?: string
}

export interface AIPickResult {
  pick: string
  confidence: number
  reason: string
  ms: number
  fallback: boolean
}

/** OrganizeModal 提交给 App 的表单值。 */
export interface OrganizeOptions {
  dest: string
  tpl: string
  action: 'move' | 'copy'
  conflict: 'skip' | 'overwrite' | 'rename'
  rmEmpty: boolean
}

export interface ModeConfig {
  key: ModeKey
  name: string
  codeLabel: string
  titleLabel: string
  lang: string
  sources: { label: string; on: boolean }[]
  downloads: { label: string; on: boolean }[]
  naming: string
  organize: string
  version?: string
  description?: string
  status?: 'ok' | 'error'
  settingsUrl?: string
  /** 电影 / 电视剧：TMDB v3 Key 或 v4 Token */
  tmdbApiKey?: string
  tmdbLang?: string
  /** 动漫：Bangumi 访问令牌（可选） */
  bangumiToken?: string
}

export interface Row {
  uid: number
  code: string
  title: string
  src: string
  status: RowStatus
  progress: number
  dur: number
  size: number
  poster: number
  maker?: string
  year?: string
  actors?: string
  season?: string
  episode?: string
  file: string
  /** 源文件绝对路径；整理/移动后会更新为实际路径。 */
  path?: string
  ai?: boolean
  aiConfidence?: number
  query?: string
  candidates?: Candidate[]
  /** 刮削得到的扩展元数据，用于海报与 NFO。 */
  posterUrl?: string
  /** 手动裁剪区域；为空表示完整封面。 */
  posterCrop?: CropRect
  /** 本地缓存后的可显示地址（HTTP 封面代理）。 */
  posterSrc?: string
  posterError?: boolean
  overview?: string
  score?: number
  detailId?: string
  tags?: string[]
  releaseDate?: string
  director?: string
  series?: string
  /** 该行所属模式，用于媒体库持久化。 */
  mode?: string
}

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

export interface LogLine {
  time: string
  level: 'info' | 'ok' | 'warn'
  text: string
}

export type FilterKey = 'all' | 'pending' | 'review' | 'done' | 'unmatched'

export type ModeKey = 'av' | 'movie' | 'tv' | 'anime'

/** 主题偏好：跟随系统时由浏览器 `prefers-color-scheme` 决定实际主题。 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 表格列宽与列显隐持久化；键为列 key。 */
export interface TableSettings {
  widths?: Record<string, number>
  /** 被隐藏的数据列 key；「操作」「选择」列不允许出现在这里。 */
  hidden?: string[]
}

export type RowStatus = 'done' | 'unmatched' | 'running' | 'waiting' | 'error' | 'review'

export type NativeMode = 'http'

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

/** 本地字幕匹配结果（GET/POST /api/subtitles/find）。 */
export interface SubtitleInfo {
  path: string
  format: string
  language?: string
}

/** 模式配置里的下载开关；整理请求携带给后端决定字幕/预告片/NFO/封面行为。 */
export interface DownloadOption {
  label: string
  on: boolean
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
  /** 可选：预告片地址；「预告片」开启时写入 NFO <trailer>，不下载视频 */
  trailerUrl?: string
}

export interface OrganizeRequest {
  dest: string
  action: 'move' | 'copy'
  conflict: 'skip' | 'overwrite' | 'rename'
  removeEmptyDirs?: boolean
  /** 当前模式的插件 downloads 配置；省略时后端保持旧行为。 */
  downloads?: DownloadOption[]
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

export interface FsRoot {
  name: string
  path: string
  kind: 'drive' | 'home' | 'common'
}

export interface FsEntry {
  name: string
  path: string
  isDir: true
  hidden: boolean
}

export interface FsListing {
  path: string
  parent: string | null
  entries: FsEntry[]
}

/** 媒体库来源（扫描根目录）。只记录路径，不移动/删除任何文件。 */
export interface MediaSource {
  path: string
  name?: string
  addedAt: number
}

export interface Settings {
  ai: AIConfig
  modes?: Record<string, unknown>
  lastFolder?: string
  /** 已登记的媒体库来源；旧设置没有该字段时为空数组。 */
  sources?: MediaSource[]
  minDur?: number
  compact?: boolean
  /** 默认隐藏短片（疑似广告）。 */
  hideShorts?: boolean
  /** 日志面板是否默认展开。 */
  logOpen?: boolean
  /** 日志面板高度（像素）。 */
  logHeight?: number
  /** 界面主题；旧设置缺少该字段时按 `system` 处理。 */
  theme?: ThemePreference
  /** 表格列宽；旧设置缺省时使用内置默认宽度。 */
  table?: TableSettings
  /**
   * 文件名黑名单：不区分大小写，支持 `*` / `?` 通配符；
   * 不含通配符时按包含匹配。命中的文件扫描时跳过、列表中隐藏。
   */
  blacklist?: string[]
}

/** `GET /api/settings/export` 返回的下载文件结构。 */
export interface SettingsExportFile {
  app: 'scraper'
  version: number
  exportedAt: string
  includesSecrets: boolean
  settings: Partial<Settings> & Record<string, unknown>
}

/** `POST /api/settings/import` 的响应；applied 为实际写入的字段名。 */
export interface SettingsImportResult {
  ok: true
  settings: Settings
  applied: string[]
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

export type LibrarySort = 'updatedAt' | 'title' | 'size' | 'dur' | 'year'
export type LibraryOrder = 'asc' | 'desc'

/** GET /api/library/query 查询条件；空字符串会被后端忽略。 */
export interface LibraryQuery {
  q?: string
  mode?: string
  maker?: string
  actor?: string
  tag?: string
  status?: string
  sort?: LibrarySort
  order?: LibraryOrder
  limit?: number
  offset?: number
}

export interface LibraryQueryResult {
  total: number
  items: LibraryItem[]
}

/** 重复检测分组；一条记录只会出现在一个分组中（番号优先）。 */
export interface DuplicateGroup {
  reason: 'code' | 'size-duration'
  key: string
  items: LibraryItem[]
}

export interface StatCount {
  name: string
  count: number
}

/** GET /api/library/stats。 */
export interface LibraryStats {
  total: number
  totalSize: number
  byMode: Record<string, number>
  byStatus: Record<string, number>
  topMakers: StatCount[]
  topActors: StatCount[]
  topTags: StatCount[]
}

/** JavDB resolve 返回的磁力条目（插件已转为 camelCase）。 */
export interface Magnet {
  name: string
  hash: string
  size?: string
  cnsub?: boolean
  hd?: boolean
  filesCount?: number
  pikpakUrl?: string
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
  /** 详情弹窗的磁力列表（仅展示与复制，不触发下载）。 */
  magnets?: Magnet[]
  magnetsLoading?: boolean
  magnetsError?: string
  /** 插件详情返回的预告片地址；仅保存 URL，不下载视频。 */
  trailerUrl?: string
  trailerSite?: string
  /** 详情弹窗的本地字幕匹配结果。 */
  subtitles?: SubtitleInfo[]
  subtitlesLoading?: boolean
  subtitlesError?: string
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

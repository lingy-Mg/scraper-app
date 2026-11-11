import type { LibraryItem, MediaFile, Row, RowStatus } from './types'

const GB = 1024 ** 3
const MB = 1024 ** 2

export const fmtSize = (bytes: number) =>
  bytes >= GB ? `${(bytes / GB).toFixed(2)} GB` : `${(bytes / MB).toFixed(1)} MB`

export const fmtDur = (seconds: number) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0))
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((n) => String(n).padStart(2, '0'))
    .join(':')
}

/** 时长为 0（未探测到）不算短片，避免误报。 */
export const isShort = (seconds: number, minDur: number) =>
  seconds > 0 && seconds < Math.max(1, minDur) * 60

export function buildPath(tpl: string, row: Row): string {
  const map: Record<string, string> = {
    '{片商}': row.maker || '未知片商',
    '{年份}': row.year || '未知年份',
    '{番号}': row.code || '未知番号',
    '{标题}': row.title || '未命名',
    '{剧名}': row.title || '未命名',
    '{演员}': row.actors || '—',
    '{时长}': fmtDur(row.dur),
    '{季}': row.season || '01',
    '{集}': row.episode || '01'
  }
  let out = tpl
  for (const [token, value] of Object.entries(map)) out = out.split(token).join(value)
  return out
    .split('/')
    .map((segment) => segment.replace(/[\\:*?"<>|]/g, '_'))
    .join('/')
}

export const withExt = (path: string) => (/\.\w+$/.test(path) ? path : `${path}.mp4`)

export const now = () =>
  new Date().toLocaleTimeString('zh-CN', { hour12: false })

export function cleanFilename(name: string): string {
  const match = name.match(/^(.*)(\.[^.]+)$/)
  const base = match ? match[1] : name
  const ext = match ? match[2].toLowerCase() : ''
  const cleaned = base
    .replace(/^.*@/, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned + ext
}

const CODE_DENY = new Set([
  'QQ',
  'IMG',
  'VID',
  'DSC',
  'PXL',
  'MVIMG',
  'DCIM',
  'AUDIO',
  'VIDEO',
  'SCREEN',
  'SCREENSHOT',
  'WECHAT'
])

export function guessCode(name: string): string {
  const base = cleanFilename(name).replace(/\.[^.]+$/, '')
  const match = base.match(/[A-Z]{2,6}[-_]?\d{2,5}(?![A-Z0-9])/i)
  if (!match) return ''
  const prefix = (match[0].match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase()
  if (CODE_DENY.has(prefix)) return ''
  return match[0].toUpperCase().replace(/_/g, '-')
}

/** 识别旧媒体库里明显的假番号（QQ202608、IMG_2026... 等）。 */
export function isSuspiciousCode(code: string): boolean {
  const value = (code || '').trim().toUpperCase()
  const match = value.match(/^([A-Z]{2,10})[-_]?(\d+)$/)
  if (!match) return false
  if (CODE_DENY.has(match[1])) return true
  return match[2].length > 5
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const ROW_STATUS = new Set<RowStatus>([
  'done',
  'unmatched',
  'running',
  'waiting',
  'error',
  'review'
])

/** 媒体库记录 → 表格行。 */
export function rowFromLibrary(item: LibraryItem): Row {
  const status = (ROW_STATUS.has(item.status as RowStatus) ? item.status : 'unmatched') as RowStatus
  return {
    uid: stableUid(item.path),
    path: item.path,
    file: item.file,
    code: item.code || '',
    title: item.title || item.file,
    src: item.src || '',
    status,
    progress: status === 'done' ? 100 : 0,
    dur: item.dur && item.dur > 0 ? item.dur : 0,
    size: item.size && item.size > 0 ? item.size : 0,
    poster: hashString(item.code || item.title || item.path),
    posterUrl: item.posterUrl,
    posterCrop: item.posterCrop,
    maker: item.maker,
    actors: item.actors,
    overview: item.overview,
    year: item.year,
    score: item.score,
    detailId: item.detailId,
    tags: item.tags,
    releaseDate: item.releaseDate,
    director: item.director,
    series: item.series,
    mode: item.mode
  }
}

/** 表格行 → 媒体库记录。 */
export function libraryFromRow(row: Row, fallbackMode: string): LibraryItem {
  return {
    path: row.path || '',
    file: row.file,
    mode: row.mode || '',
    code: row.code || '',
    title: row.title || row.file,
    status: row.status,
    year: row.year,
    maker: row.maker,
    actors: row.actors,
    overview: row.overview,
    src: row.src,
    score: row.score,
    dur: row.dur,
    size: row.size,
    posterUrl: row.posterUrl,
    posterCrop: row.posterCrop,
    detailId: row.detailId,
    tags: row.tags,
    releaseDate: row.releaseDate,
    director: row.director,
    series: row.series,
    updatedAt: Date.now()
  }
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

/** 生成 Emby/Jellyfin/Kodi 兼容的 movie.nfo。 */
export function buildNfo(row: Row, modeName: string): string {
  const actors = (row.actors || '')
    .split(/\s*\/\s*/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => `  <actor>\n    <name>${escapeXml(name)}</name>\n  </actor>`)
    .join('\n')

  const runtime = row.dur > 0 ? Math.round(row.dur / 60) : 0
  const rating = typeof row.score === 'number' && row.score > 0 ? row.score.toFixed(1) : ''
  const tags = (row.tags ?? [])
    .filter(Boolean)
    .map((tag) => `  <tag>${escapeXml(tag)}</tag>`)
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<movie>',
    `  <title>${escapeXml(row.title || row.file)}</title>`,
    `  <originaltitle>${escapeXml(row.title || row.file)}</originaltitle>`,
    `  <sorttitle>${escapeXml(row.code || row.title || row.file)}</sorttitle>`,
    `  <year>${escapeXml(row.year || '')}</year>`,
    row.releaseDate ? `  <premiered>${escapeXml(row.releaseDate)}</premiered>` : '',
    `  <plot>${escapeXml(row.overview || '')}</plot>`,
    `  <studio>${escapeXml(row.maker || '')}</studio>`,
    row.director ? `  <director>${escapeXml(row.director)}</director>` : '',
    row.series ? `  <set>\n    <name>${escapeXml(row.series)}</name>\n  </set>` : '',
    `  <num>${escapeXml(row.code || '')}</num>`,
    actors,
    tags,
    `  <runtime>${runtime}</runtime>`,
    rating ? `  <rating>${rating}</rating>` : '',
    `  <uniqueid type="javdb" default="true">${escapeXml(row.detailId || row.code || '')}</uniqueid>`,
    row.posterUrl ? `  <thumb aspect="poster">${escapeXml(row.posterUrl)}</thumb>` : '',
    `  <genre>${escapeXml(modeName)}</genre>`,
    '</movie>',
    ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

export const baseName = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).pop() || path

export const errText = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const blacklistRegexCache = new Map<string, RegExp>()

function blacklistRegex(pattern: string): RegExp {
  const cached = blacklistRegexCache.get(pattern)
  if (cached) return cached
  // 除 * 和 ? 之外的正则元字符全部转义。
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${source}$`, 'i')
  blacklistRegexCache.set(pattern, regex)
  return regex
}

/**
 * 文件名是否命中黑名单（不区分大小写）。
 * - 含 `*` / `?` 时按通配符整名匹配（`*` 任意长度，`?` 单个字符）；
 * - 不含通配符时按「包含」匹配，输入 `sample` 即可屏蔽 `sample.mp4`、`my-sample.mkv`。
 */
export function isBlacklisted(name: string, patterns: readonly string[]): boolean {
  if (!name || !patterns || !patterns.length) return false
  const target = name.toLowerCase()
  for (const raw of patterns) {
    const pattern = (raw ?? '').trim().toLowerCase()
    if (!pattern) continue
    if (pattern.includes('*') || pattern.includes('?')) {
      if (blacklistRegex(pattern).test(target)) return true
    } else if (target.includes(pattern)) {
      return true
    }
  }
  return false
}

/** 黑名单去空、去重（忽略大小写），保留原始顺序。 */
export function normalizeBlacklist(patterns: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const raw of patterns) {
    const value = (raw ?? '').trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(value)
  }
  return result
}

/** 稳定地由路径生成 0..5 的海报占位序号。 */
export const hashString = (value: string): number => {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 6
}

/**
 * 行/记录的稳定唯一 ID。
 * 不能复用 hashString：它只返回 0..5，会导致多行共用 uid，
 * 单行操作（AI 识别/删除）误伤同组所有行。
 */
const stableUid = (value: string): number => {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return 1_000_000_000 + ((hash >>> 0) % 1_000_000_000)
}

/** 把后端扫描到的 MediaFile 转成表格行。 */
export function rowFromMedia(file: MediaFile): Row {
  return {
    uid: stableUid(file.path || file.name),
    code: '',
    title: cleanFilename(file.name),
    src: '',
    status: 'unmatched',
    progress: 0,
    dur: file.duration ? Math.round(file.duration) : 0,
    size: file.size || 0,
    poster: hashString(file.path || file.name),
    file: file.name,
    path: file.path
  }
}

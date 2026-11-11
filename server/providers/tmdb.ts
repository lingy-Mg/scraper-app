import type { ProviderCandidate, ProviderDetail } from './types'

/**
 * TMDB（电影 / 电视剧）元数据源。
 *
 * 接口约定见 docs/providers-library-contract.md「2.2 TMDB」。
 * 支持 v4 JWT（Bearer）与 v3 api_key 两种鉴权方式；任何情况下都不打印 API Key。
 */

const API_BASE = 'https://api.themoviedb.org/3'
const IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'
const DEFAULT_LANG = 'zh-CN'
const TIMEOUT_MS = 15000
const USER_AGENT = 'scraper-app/0.1 (https://github.com/local/scraper-app)'
const MAX_RESULTS = 8

type MediaType = 'movie' | 'tv'

export interface CleanedFilename {
  /** 去掉年份、集数、发布组与编码信息后的标题。 */
  title: string
  /** 4 位发行年份；没有则为空字符串。 */
  year: string
  /** 标题 + 年份，作为第二次搜索的完整清洗名。 */
  full: string
}

/** 常见发布/编码/音轨词，比较时统一小写。 */
const NOISE_TOKENS = new Set([
  'bluray',
  'blu-ray',
  'bdrip',
  'brrip',
  'bdremux',
  'remux',
  'web-dl',
  'webdl',
  'webrip',
  'web-rip',
  'hdtv',
  'hdrip',
  'dvdrip',
  'dvd',
  'hdcam',
  'camrip',
  'telesync',
  'uhd',
  '4k',
  '8k',
  '2160p',
  '1080p',
  '1080i',
  '720p',
  '576p',
  '480p',
  '360p',
  'x264',
  'x265',
  'h264',
  'h265',
  'hevc',
  'avc',
  'av1',
  'vp9',
  '10bit',
  '8bit',
  'hdr10+',
  'hdr10',
  'hdr',
  'dolby',
  'vision',
  'dts-hd',
  'dts',
  'truehd',
  'atmos',
  'aac',
  'ac3',
  'eac3',
  'flac',
  'proper',
  'repack',
  'rerip',
  'extended',
  'remastered',
  'uncut',
  'imax',
  'multi',
  'dual',
  'chs',
  'cht',
  'eng',
  'jpn',
  '中字',
  '中文字幕',
  '简繁',
  '简中',
  '繁中',
  '双语',
  '国语',
  '粤语',
  '日语',
  '内封',
  '内嵌',
  '外挂',
  '高清',
  '蓝光',
  '超清',
  '完整版',
  '未删减'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberValue(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function positiveNumber(value: unknown): number | undefined {
  const n = numberValue(value)
  return n !== undefined && n > 0 ? n : undefined
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function objectAt(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function hashIndex(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

function stripSurroundingPunctuation(value: string): string {
  return value.replace(/^[\s\-–—_.:;,/|()[\]{}【】]+|[\s\-–—_.:;,/|()[\]{}【】]+$/g, '')
}

function isNoiseToken(token: string): boolean {
  const cleaned = stripSurroundingPunctuation(token).toLowerCase()
  if (!cleaned) return true
  if (NOISE_TOKENS.has(cleaned)) return true
  if (/^\d{3,4}[pi]$/.test(cleaned)) return true
  if (/^(?:x|h)26[45]$/.test(cleaned)) return true
  if (/^(?:10|8)bit$/.test(cleaned)) return true
  if (/^[257][.,][01]$/.test(cleaned)) return true
  return false
}

/** 文件名清洗：去扩展名、路径、分组/发布信息、集数与编码词，提取年份。 */
export function cleanFilename(filename: string): CleanedFilename {
  let name = String(filename ?? '').trim()
  name = name.split(/[\\/]/).pop() ?? name
  name = name.replace(/\.(?:mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|m2ts|rmvb|rm|3gp|ogv)$/i, '')

  // `489155.com@ABC-123.mp4` → `ABC-123`
  name = name.replace(/^.*@/, '')

  // 取最后一个合法的 4 位年份（避免把片名里的 1917、2049 当成发行年）。
  let year = ''
  const matches = [...name.matchAll(/(?<![\dXx])((?:19|20)\d{2})(?![\dXxpPiI])/g)]
  const last = matches[matches.length - 1]
  if (last && last.index !== undefined) {
    year = last[1]
    name = `${name.slice(0, last.index)} ${name.slice(last.index + 4)}`
  }

  // 去掉发布组、字幕组、分辨率等方/圆括号内容。
  name = name.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】|\{[^}]*\}/g, ' ')

  // 去掉集数标记。
  name = name
    .replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, ' ')
    .replace(/\bS\d{1,2}\b/gi, ' ')
    .replace(/\bEP?\s*\d{1,3}\b/gi, ' ')
    .replace(/第\s*\d+\s*[集话話期]/g, ' ')
    .replace(/\bSeason\s*\d{1,2}\b/gi, ' ')
    .replace(/\s+[-–—]\s*\d{1,3}\s*$/g, ' ')

  // 音轨通道与带点的编码写法先处理，再统一处理 . 和 _。
  name = name
    .replace(/\b([257])[.,]([01])\b/g, ' ')
    .replace(/\b(?:x|h)\.?26[45]\b/gi, ' ')

  name = name.replace(/[._]+/g, ' ')

  const tokens = name.split(/\s+/).filter((token) => token && !isNoiseToken(token))
  name = tokens.join(' ')

  name = name
    .replace(/[()[\]{}【】]/g, ' ')
    .replace(/^[\s\-–—:;,/|]+|[\s\-–—:;,/|]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    title: name,
    year,
    full: [name, year].filter(Boolean).join(' ').trim()
  }
}

function normalizeMediaType(value: string): MediaType {
  const media = String(value ?? '').toLowerCase()
  if (media === 'movie' || media === 'tv') return media
  throw new Error(`不支持的媒体类型：${value}`)
}

function requireApiKey(apiKey: string): string {
  const key = String(apiKey ?? '').trim()
  if (!key) throw new Error('未配置 TMDB API Key')
  return key
}

function isV4Token(key: string): boolean {
  return key.startsWith('eyJ')
}

function imageUrl(value: unknown): string | undefined {
  const path = text(value)
  if (!path) return undefined
  if (/^https?:\/\//i.test(path)) return path
  return `${IMAGE_BASE}${path.startsWith('/') ? '' : '/'}${path}`
}

function yearOf(data: Record<string, unknown>): string {
  return (text(data.release_date) || text(data.first_air_date)).slice(0, 4)
}

function durationOf(data: Record<string, unknown>, mediaType: MediaType): number | undefined {
  if (mediaType === 'movie') {
    const minutes = positiveNumber(data.runtime)
    return minutes === undefined ? undefined : Math.round(minutes * 60)
  }
  const minutes = positiveNumber(arrayOf(data.episode_run_time)[0])
  return minutes === undefined ? undefined : Math.round(minutes * 60)
}

function namesFrom(value: unknown, key = 'name'): string[] {
  const out: string[] = []
  for (const item of arrayOf(value)) {
    const name = isRecord(item) ? text(item[key]) : text(item)
    if (name) out.push(name)
  }
  return out
}

function toCandidate(data: Record<string, unknown>, mediaType: MediaType): ProviderCandidate {
  const rawId = text(data.id)
  const title =
    text(data.title) ||
    text(data.name) ||
    text(data.original_title) ||
    text(data.original_name) ||
    '未命名'
  const year = yearOf(data)
  const overview = text(data.overview)
  const posterUrl = imageUrl(data.poster_path)
  const maker = namesFrom(data.production_companies)[0]
  const actors = namesFrom(objectAt(data.credits).cast).slice(0, 6).join(' / ')
  const tags = namesFrom(data.genres)
  const duration = durationOf(data, mediaType)

  const candidate: ProviderCandidate = {
    id: `tmdb:${mediaType}:${rawId}`,
    title,
    year,
    source: 'TMDB',
    score: numberValue(data.vote_average) ?? 0,
    overview,
    poster: hashIndex(rawId || `${mediaType}:${title}`),
    detailId: `${mediaType}:${rawId}`
  }
  if (posterUrl) candidate.posterUrl = posterUrl
  if (maker) candidate.maker = maker
  if (actors) candidate.actors = actors
  if (duration !== undefined) candidate.duration = duration
  if (tags.length) candidate.tags = tags
  return candidate
}

interface RequestOptions {
  query?: Record<string, string>
  body?: string
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
}

async function requestJson(path: string, apiKey: string, options: RequestOptions = {}): Promise<unknown> {
  const key = requireApiKey(apiKey)
  const url = new URL(`${API_BASE}${path}`)
  for (const [name, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(name, value)
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': USER_AGENT,
    ...(options.headers ?? {})
  }
  if (isV4Token(key)) {
    headers.authorization = `Bearer ${key}`
  } else {
    url.searchParams.set('api_key', key)
  }

  let response: Response
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timeout|abort/i.test(message)) throw new Error('TMDB 请求超时')
    throw new Error(`TMDB 网络错误：${message}`)
  }

  if (response.status === 401) throw new Error('TMDB API Key 无效')
  if (response.status === 429) throw new Error('TMDB 请求过于频繁')
  if (response.status === 404) throw new Error('TMDB 条目不存在')
  if (!response.ok) throw new Error(`TMDB 请求失败（HTTP ${response.status}）`)

  try {
    return (await response.json()) as unknown
  } catch {
    throw new Error('TMDB 响应格式错误')
  }
}

async function search(
  query: string,
  mediaType: MediaType,
  apiKey: string,
  lang: string
): Promise<unknown[]> {
  const data = await requestJson(`/search/${mediaType}`, apiKey, {
    query: {
      query,
      language: lang,
      include_adult: 'false',
      page: '1'
    }
  })
  if (!isRecord(data)) return []
  return arrayOf(data.results)
}

/**
 * 文件名 → TMDB 候选。
 * 先用去掉年份的标题搜索，无结果时再用完整清洗名（含年份）。
 * 结果按「年份匹配优先、popularity 降序」排序，最多 8 条。
 */
export async function tmdbIdentify(
  filename: string,
  mediaType: 'movie' | 'tv',
  apiKey: string,
  lang?: string
): Promise<ProviderCandidate[]> {
  const media = normalizeMediaType(mediaType)
  const key = requireApiKey(apiKey)
  const language = String(lang ?? '').trim() || DEFAULT_LANG
  const cleaned = cleanFilename(filename)

  if (!cleaned.title && !cleaned.year) return []

  const queries: string[] = []
  if (cleaned.title) queries.push(cleaned.title)
  if (cleaned.full && cleaned.full !== cleaned.title) queries.push(cleaned.full)
  if (!queries.length) return []

  let results: unknown[] = []
  for (const query of queries) {
    results = await search(query, media, key, language)
    if (results.length) break
  }
  if (!results.length) return []

  results.sort((left, right) => {
    const a = objectAt(left)
    const b = objectAt(right)
    const aMatch = cleaned.year && yearOf(a) === cleaned.year ? 1 : 0
    const bMatch = cleaned.year && yearOf(b) === cleaned.year ? 1 : 0
    if (aMatch !== bMatch) return bMatch - aMatch
    return (numberValue(b.popularity) ?? 0) - (numberValue(a.popularity) ?? 0)
  })

  const candidates: ProviderCandidate[] = []
  const seen = new Set<string>()
  for (const item of results) {
    const data = objectAt(item)
    const id = text(data.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    candidates.push(toCandidate(data, media))
    if (candidates.length >= MAX_RESULTS) break
  }
  return candidates
}

function stripDetailPrefix(id: string, mediaType: MediaType): string {
  const value = String(id ?? '').trim()
  return value.replace(new RegExp(`^(?:${mediaType}:)`, 'i'), '')
}

/** 详情：追加 credits，并把时长从分钟换算为秒。 */
export async function tmdbDetail(
  id: string,
  mediaType: 'movie' | 'tv',
  apiKey: string,
  lang?: string
): Promise<ProviderDetail> {
  const media = normalizeMediaType(mediaType)
  const key = requireApiKey(apiKey)
  const language = String(lang ?? '').trim() || DEFAULT_LANG
  const detailId = stripDetailPrefix(id, media)
  if (!detailId) throw new Error('TMDB 条目 ID 不能为空')

  const data = await requestJson(`/${media}/${encodeURIComponent(detailId)}`, key, {
    query: {
      language,
      append_to_response: 'credits'
    }
  })
  if (!isRecord(data) || !text(data.id)) throw new Error('TMDB 条目不存在')

  return {
    ...toCandidate(data, media),
    raw: data
  }
}

import type { ProviderCandidate, ProviderDetail } from '../_shared/types'

/**
 * Bangumi（动漫）元数据源。
 *
 * 接口约定见 docs/providers-library-contract.md「2.3 Bangumi」。
 * 搜索接口要求自定义 User-Agent；token 可选，不打印任何凭据。
 */

const API_BASE = 'https://api.bgm.tv'
const USER_AGENT = 'scraper-app/0.1 (https://github.com/local/scraper-app)'
const TIMEOUT_MS = 15000
const MAX_RESULTS = 10

export interface CleanedFilename {
  title: string
}

/** 动漫发布名里常见的组名 / 编码 / 音轨 / 字幕词。 */
const NOISE_TOKENS = new Set([
  'sub',
  'fansub',
  'raw',
  'rip',
  'bd',
  'bdrip',
  'bdremux',
  'remux',
  'web',
  'web-dl',
  'webdl',
  'webrip',
  'web-rip',
  'hdtv',
  'dvdrip',
  'uhd',
  '4k',
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
  'hdr',
  'hdr10',
  'hdr10+',
  'dolby',
  'vision',
  'dts',
  'dts-hd',
  'truehd',
  'atmos',
  'aac',
  'flac',
  'opus',
  'ac3',
  'eac3',
  'ma10p',
  'chs',
  'cht',
  'sc',
  'tc',
  'gb',
  'big5',
  'jpn',
  'japanese',
  'eng',
  'v2',
  'v3',
  'repack',
  'fin',
  'end',
  'baha',
  'b-global',
  'bglobal',
  'bilibili',
  'netflix',
  'amzn',
  'cr',
  'nf',
  '字幕',
  '字幕组',
  '简繁',
  '简体',
  '繁体',
  '简中',
  '繁中',
  '双语',
  '日语',
  '国语',
  '粤语',
  '内嵌',
  '内封',
  '外挂',
  '无修',
  '合集',
  '全集',
  '高清',
  '蓝光',
  '超清'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function numberValue(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
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

function looksLikeGroup(value: string): boolean {
  return /字幕组|字幕社|fansub|sub\b|raw|rip|baha|b-global|bglobal|bilibili|netflix|amzn|\bnf\b|压制|encode/i.test(
    value
  )
}

/** 从方括号里挑选最可能的标题，兜底 `[组名][标题][01]` 这类命名。 */
function bracketFallback(filename: string): string {
  let best = ''
  for (const match of filename.matchAll(/\[([^\]]+)\]/g)) {
    const value = match[1].trim()
    if (!value || /^\d{1,4}$/.test(value)) continue
    if (/^s\d{1,2}(?:e\d{1,3})?$/i.test(value)) continue
    if (isNoiseToken(value) || looksLikeGroup(value)) continue
    if (value.length > best.length) best = value
  }
  return best
}

/** 文件名清洗：去扩展名、组名、分辨率、SxxExx、第xx话、- 01 等集数。 */
export function cleanFilename(filename: string): CleanedFilename {
  try {
    let name = String(filename ?? '').trim()
    const basename = name.split(/[\\/]/).pop() ?? name
    name = basename.replace(/\.(?:mkv|mp4|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|m2ts|rmvb|rm|3gp|ogv)$/i, '')

    if (name.includes('@')) name = name.split('@').pop() ?? name

    // 去掉方括号里的组名/字幕信息，以及圆括号内容。
    name = name.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】|\{[^}]*\}/g, ' ')

    name = name
      .replace(/\bS\d{1,2}\s*E\d{1,3}\b/gi, ' ')
      .replace(/\bS\d{1,2}\b/gi, ' ')
      .replace(/\bSeason\s*\d{1,2}\b/gi, ' ')
      .replace(/第\s*\d+\s*[集话話期季]/g, ' ')
      .replace(/\bSP\s*\d{0,3}\b/gi, ' ')
      .replace(/\bEP?\s*\d{1,3}\b/gi, ' ')
      .replace(/\s+[-–—]\s*\d{1,3}\s*$/g, ' ')
      .replace(/\s+\d{1,3}\s*$/g, ' ')

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

    return { title: name || bracketFallback(basename) }
  } catch {
    return { title: '' }
  }
}

function normalizeKey(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

function matchRank(title: string, keyword: string): number {
  const a = normalizeKey(title)
  const b = normalizeKey(keyword)
  if (!a || !b) return 0
  if (a === b) return 3
  if (a.startsWith(b) || b.startsWith(a)) return 2
  if (a.includes(b) || b.includes(a)) return 1
  return 0
}

function optionalText(value: unknown): string | undefined {
  const result = text(value)
  return result || undefined
}

function posterUrlOf(data: Record<string, unknown>): string | undefined {
  const images = objectAt(data.images)
  return (
    optionalText(images.large) ||
    optionalText(images.common) ||
    optionalText(images.medium)
  )
}

function tagsOf(data: Record<string, unknown>): string[] {
  const out: string[] = []
  for (const item of arrayOf(data.tags).slice(0, 8)) {
    const name = isRecord(item) ? text(item.name) : text(item)
    if (name) out.push(name)
  }
  return out
}

function toCandidate(data: Record<string, unknown>): ProviderCandidate | null {
  const id = text(data.id)
  const title = text(data.name_cn) || text(data.name)
  if (!id || !title) return null

  const rating = objectAt(data.rating)
  const tags = tagsOf(data)
  const candidate: ProviderCandidate = {
    id: `bangumi:${id}`,
    title,
    year: text(data.date).slice(0, 4),
    source: 'Bangumi',
    score: numberValue(rating.score),
    overview: text(data.summary),
    poster: hashIndex(id),
    detailId: id
  }
  const posterUrl = posterUrlOf(data)
  if (posterUrl) candidate.posterUrl = posterUrl
  if (tags.length) candidate.tags = tags
  return candidate
}

async function requestJson(path: string, token: string | undefined, init: RequestInit): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': USER_AGENT,
    ...(init.headers as Record<string, string> | undefined)
  }
  const trimmed = String(token ?? '').trim()
  if (trimmed) headers.authorization = `Bearer ${trimmed}`

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timeout|abort/i.test(message)) throw new Error('Bangumi 请求超时')
    throw new Error(`Bangumi 网络错误：${message}`)
  }

  if (response.status === 400) throw new Error('Bangumi 请求参数无效')
  if (response.status === 401 || response.status === 403) throw new Error('Bangumi Token 无效或权限不足')
  if (response.status === 404) throw new Error('Bangumi 条目不存在')
  if (response.status === 429) throw new Error('Bangumi 请求过于频繁')
  if (!response.ok) throw new Error(`Bangumi 请求失败（HTTP ${response.status}）`)

  try {
    return (await response.json()) as unknown
  } catch {
    throw new Error('Bangumi 响应格式错误')
  }
}

/**
 * 文件名 → Bangumi 候选。
 * POST /v0/search/subjects?limit=10，body 限定 type=2（动画）。
 * 按标题匹配度、评分降序排序，最多 10 条。
 */
export async function bangumiIdentify(filename: string, token?: string): Promise<ProviderCandidate[]> {
  const keyword = cleanFilename(filename).title
  if (!keyword) throw new Error('无法从文件名识别出番剧标题')

  const data = await requestJson('/v0/search/subjects?limit=10', token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ keyword, filter: { type: [2] } })
  })
  if (!isRecord(data)) throw new Error('Bangumi 响应格式错误')

  const candidates: ProviderCandidate[] = []
  const seen = new Set<string>()
  for (const item of arrayOf(data.data)) {
    const candidate = toCandidate(objectAt(item))
    if (!candidate || seen.has(candidate.id)) continue
    seen.add(candidate.id)
    candidates.push(candidate)
  }

  if (!candidates.length) throw new Error('未找到匹配的 Bangumi 条目')

  candidates.sort((a, b) => {
    const rankDiff = matchRank(b.title, keyword) - matchRank(a.title, keyword)
    if (rankDiff !== 0) return rankDiff
    return b.score - a.score
  })

  return candidates.slice(0, MAX_RESULTS)
}

/** 详情：GET /v0/subjects/{id}。 */
export async function bangumiDetail(id: string, token?: string): Promise<ProviderDetail> {
  const subjectId = String(id ?? '').trim().replace(/^bangumi:/i, '')
  if (!subjectId) throw new Error('Bangumi 条目 ID 不能为空')

  const data = await requestJson(`/v0/subjects/${encodeURIComponent(subjectId)}`, token, {
    method: 'GET'
  })
  if (!isRecord(data)) throw new Error('Bangumi 响应格式错误')

  const candidate = toCandidate(data)
  if (!candidate) throw new Error('Bangumi 条目不存在')

  return {
    ...candidate,
    raw: data
  }
}

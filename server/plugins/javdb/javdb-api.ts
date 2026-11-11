import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * JavDB App API 客户端（协议见 docs/javdb-app-api.md）。
 * 仅抓取元数据：搜索、详情、磁力。
 */

const PREFIX =
  '71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa'
const SUFFIX = 'lpw6vgqzsp'
const USER_AGENT = 'Dart/3.4 (dart:io)'

/** 固定入口；动态域名解密不稳定，失败时按顺序切换。 */
const HOSTS = [
  'https://jdforrepam.com',
  'https://apidd.spthgb.com',
  'https://apidd.czssdgz.com',
  'https://javdb.com'
]

const PUBLIC = {
  app_channel: 'official',
  app_version: '1.9.28',
  app_version_number: '10928',
  platform: 'android',
  system_version: '13',
  device_model: 'Pixel 6',
  device_name: 'Pixel'
}

/**
 * 插件可能被打包到 `server/data/.plugin-cache`，运行时数据目录由宿主注入
 * （与 `server/settings.ts` 的 DATA_DIR 同一来源，见 registry.ts）。
 */
const DATA_DIR = resolve(
  process.env.SCRAPER_DATA_DIR?.trim() || join(import.meta.dir, '..', '..', 'data')
)
const UUID_FILE = join(DATA_DIR, 'javdb-device.txt')

export interface JavdbMovie {
  id: string
  number: string
  title: string
  originTitle?: string
  coverUrl?: string
  thumbUrl?: string
  releaseDate?: string
  duration?: number
  score?: number
  summary?: string
  maker?: string
  director?: string
  series?: string
  actors?: string[]
  tags?: string[]
  magnetsCount?: number
  hasCnsub?: boolean
  previewVideoUrl?: string
  previewImages?: string[]
}

export interface JavdbCandidate {
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

let cachedHost = ''
let uuidCache = ''
let lastRequestAt = 0
let queue: Promise<unknown> = Promise.resolve()

function md5(value: string): string {
  return createHash('md5').update(value).digest('hex')
}

function signature(ts = Math.floor(Date.now() / 1000)): string {
  return `${ts}.${SUFFIX}.${md5(`${ts}${PREFIX}`)}`
}

async function deviceUUID(): Promise<string> {
  if (uuidCache) return uuidCache
  try {
    const value = (await readFile(UUID_FILE, 'utf8')).trim()
    if (value) {
      uuidCache = value
      return value
    }
  } catch {
    // 首次运行
  }
  uuidCache = crypto.randomUUID()
  try {
    await mkdir(DATA_DIR, { recursive: true })
    await writeFile(UUID_FILE, uuidCache, 'utf8')
  } catch {
    // 只读环境下退化为进程内 UUID
  }
  return uuidCache
}

function hashIndex(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0
  return Math.abs(hash)
}

async function waitForSlot(): Promise<void> {
  const now = Date.now()
  const wait = lastRequestAt + 1200 - now
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  lastRequestAt = Date.now()
}

interface Envelope {
  success?: number | boolean | string
  action?: string
  message?: string
  data?: Record<string, unknown>
}

function isSuccess(value: Envelope['success']): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

/** 串行化 + 限速，避免并发轰站。 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

async function requestOnce(
  host: string,
  path: string,
  params: Record<string, string>,
  token?: string
): Promise<Envelope> {
  const query = new URLSearchParams({ ...PUBLIC, device_uuid: await deviceUUID(), ...params })
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    'accept-language': 'zh-CN',
    jdsignature: signature()
  }
  // 上游要求登录时用户可自行提供 JWT；没有令牌时保持匿名请求。
  if (token) headers.authorization = `Bearer ${token}`
  const response = await fetch(`${host}${path}?${query}`, {
    headers,
    signal: AbortSignal.timeout(15000)
  })
  const text = await response.text()
  if (response.status >= 500) throw new Error(`HTTP ${response.status}`)
  let body: Envelope
  try {
    body = JSON.parse(text) as Envelope
  } catch {
    throw new Error(`响应不是 JSON（HTTP ${response.status}）`)
  }
  if (response.status >= 400) {
    throw new Error(body.message || `HTTP ${response.status}`)
  }
  return body
}

/** 上游鉴权失败的典型返回（JWTVerificationError / LoginRequired / 請登錄帳號）。 */
function isAuthFailure(message: string): boolean {
  return /JWTVerificationError|LoginRequired|JWT|請登錄|请登录|未登录|not\s*login/i.test(message)
}

async function request(
  path: string,
  params: Record<string, string> = {},
  token?: string
): Promise<Record<string, unknown>> {
  return enqueue(async () => {
    const ordered = cachedHost
      ? [cachedHost, ...HOSTS.filter((host) => host !== cachedHost)]
      : HOSTS
    const failures: string[] = []

    for (const host of ordered) {
      try {
        await waitForSlot()
        const body = await requestOnce(host, path, params, token)
        if (!isSuccess(body.success)) {
          throw new Error(`${body.action || 'api'}: ${body.message || '请求失败'}`)
        }
        cachedHost = host
        return body.data ?? {}
      } catch (error) {
        failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 不把上游堆栈直接丢给用户：鉴权失败时给出可操作的中文提示。
    if (failures.some(isAuthFailure)) {
      throw new Error(
        token
          ? 'JavDB 登录已失效：请更新 JavDB 插件设置中的访问令牌'
          : 'JavDB 需要登录：请在 JavDB 插件设置中填写访问令牌'
      )
    }
    throw new Error(`JavDB 请求失败：${failures.join('；')}`)
  })
}

function numberKey(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, '').toUpperCase()
}

function cleanName(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '')
  return base
    .replace(/^.*@/, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CODE_DENY = new Set([
  'QQ', 'IMG', 'VID', 'DSC', 'PXL', 'MVIMG', 'DCIM',
  'AUDIO', 'VIDEO', 'SCREEN', 'SCREENSHOT', 'WECHAT'
])

export function extractCode(filename: string): string {
  const cleaned = cleanName(filename)
  const fc2 = cleaned.match(/FC2[\s_-]*(?:PPV[\s_-]*)?(\d{5,})/i)
  if (fc2) return `FC2-PPV-${fc2[1]}`
  const match = cleaned.match(/(?:^|[^A-Z0-9])([A-Z]{2,10})[\s_-]?(\d{2,5})(?![A-Z0-9])/i)
  if (!match) return ''
  if (CODE_DENY.has(match[1].toUpperCase())) return ''
  return `${match[1].toUpperCase()}-${match[2]}`
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function numberValue(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push(item)
    else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>
      const name = stringValue(record.name ?? record.title ?? record.translate_name)
      if (name) out.push(name)
    }
  }
  return out
}

function toMovie(raw: Record<string, unknown>): JavdbMovie {
  const rawDuration = numberValue(raw.duration)
  return {
    id: stringValue(raw.id),
    number: stringValue(raw.number),
    title: stringValue(raw.title) || stringValue(raw.origin_title),
    originTitle: stringValue(raw.origin_title) || undefined,
    coverUrl: stringValue(raw.cover_url) || undefined,
    thumbUrl: stringValue(raw.thumb_url) || undefined,
    releaseDate: stringValue(raw.release_date) || undefined,
    // JavDB 返回的是分钟；兼容未来可能改成秒的接口。
    duration: rawDuration ? (rawDuration <= 1000 ? rawDuration * 60 : rawDuration) : undefined,
    score: numberValue(raw.score),
    summary: stringValue(raw.summary) || undefined,
    maker: stringValue(raw.maker_name) || stringValue(raw.publisher_name) || undefined,
    director: stringValue(raw.director_name) || undefined,
    series: stringValue(raw.series_name) || undefined,
    actors: stringList(raw.actors),
    tags: stringList(raw.tags),
    magnetsCount: numberValue(raw.magnets_count),
    hasCnsub: Boolean(raw.has_cnsub),
    previewVideoUrl: stringValue(raw.preview_video_url) || undefined,
    previewImages: stringList(raw.preview_images)
  }
}

function toCandidate(movie: JavdbMovie): JavdbCandidate {
  const year = movie.releaseDate?.slice(0, 4) ?? ''
  const overviewParts = [
    movie.maker,
    movie.actors?.slice(0, 4).join(' / '),
    movie.summary
  ].filter(Boolean)
  return {
    id: `javdb:${movie.id}`,
    title: movie.title || movie.number || '未命名',
    year,
    code: movie.number || undefined,
    source: 'JavDB',
    score: movie.score ?? 0,
    overview: overviewParts.join(' · '),
    poster: hashIndex(movie.number || movie.id),
    posterUrl: movie.coverUrl || movie.thumbUrl,
    maker: movie.maker,
    actors: movie.actors?.join(' / '),
    duration: movie.duration,
    detailId: movie.id,
    tags: movie.tags,
    releaseDate: movie.releaseDate,
    director: movie.director,
    series: movie.series
  }
}

const cache = new Map<string, { at: number; value: unknown }>()
const CACHE_TTL = 5 * 60 * 1000

function cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL) return Promise.resolve(hit.value as T)
  return loader().then((value) => {
    cache.set(key, { at: Date.now(), value })
    return value
  })
}

export async function searchMovies(
  keyword: string,
  limit = 10,
  token?: string
): Promise<JavdbMovie[]> {
  const data = await request(
    '/api/v2/search',
    {
      q: keyword,
      page: '1',
      limit: String(Math.min(Math.max(limit, 1), 50))
    },
    token
  )
  const movies = Array.isArray(data.movies) ? (data.movies as Record<string, unknown>[]) : []
  return movies.map(toMovie).filter((movie) => movie.id)
}

export async function movieDetail(id: string, token?: string): Promise<JavdbMovie> {
  return cached(`detail:${id}`, async () => {
    const data = await request(`/api/v4/movies/${encodeURIComponent(id)}`, {}, token)
    const raw = (data.movie ?? data) as Record<string, unknown>
    return toMovie(raw)
  })
}

function toMagnet(raw: Record<string, unknown>) {
  return {
    name: stringValue(raw.name ?? raw.title),
    hash: stringValue(raw.hash),
    size: stringValue(raw.size),
    cnsub: Boolean(raw.cnsub),
    hd: Boolean(raw.hd),
    filesCount: numberValue(raw.files_count) ?? 0,
    pikpakUrl: stringValue(raw.pikpak_url) || undefined
  }
}

export async function movieMagnets(id: string, token?: string) {
  const data = await request(`/api/v1/movies/${encodeURIComponent(id)}/magnets`, {}, token)
  const list = Array.isArray(data.magnets) ? (data.magnets as Record<string, unknown>[]) : []
  return list.map(toMagnet).filter((magnet) => magnet.hash)
}

/**
 * 文件名 → 候选。
 * 有番号时只接受大小写/分隔符等价且唯一的精确匹配，绝不回退到搜索首项；
 * 没有番号时按清洗后的名称搜索，直接返回前 N 条供 AI/用户选择。
 */
export async function javdbIdentify(
  filename: string,
  options: { allowTitle?: boolean; token?: string } = {}
): Promise<JavdbCandidate[]> {
  const allowTitle = Boolean(options.allowTitle)
  const token = options.token?.trim() || undefined
  return cached(`identify:${allowTitle ? 't' : 'c'}:${filename}`, async () => {
    const code = extractCode(filename)
    // AV/JavDB 模式默认只认番号：文件名没有番号时不要用标题去模糊搜索。
    if (!code && !allowTitle) return []
    const keyword = code || cleanName(filename)
    if (!keyword) return []

    const movies = await searchMovies(keyword, code ? 20 : 8, token)

    if (!code) {
      return movies.map(toCandidate)
    }

    const want = numberKey(code)
    const exact = movies.filter((movie) => numberKey(movie.number) === want)
    const unique = new Map<string, JavdbMovie>()
    for (const movie of exact) unique.set(movie.id, movie)
    if (!unique.size) return []

    const candidates: JavdbCandidate[] = []
    for (const movie of [...unique.values()].slice(0, 3)) {
      try {
        const detail = await movieDetail(movie.id, token)
        candidates.push(toCandidate({ ...movie, ...detail }))
      } catch {
        candidates.push(toCandidate(movie))
      }
    }
    return candidates
  })
}

export async function javdbDetail(
  id: string,
  token?: string
): Promise<JavdbMovie & { magnets?: ReturnType<typeof toMagnet>[] }> {
  const movie = await movieDetail(id, token?.trim() || undefined)
  let magnets: ReturnType<typeof toMagnet>[] = []
  try {
    magnets = await movieMagnets(id, token?.trim() || undefined)
  } catch (error) {
    // 磁力失败一般不影响详情；但鉴权失败要让前端显示可操作提示。
    const message = error instanceof Error ? error.message : String(error)
    if (/JavDB (需要登录|登录已失效)/.test(message)) throw error
  }
  return { ...movie, magnets }
}

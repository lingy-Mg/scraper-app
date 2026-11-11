import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  PLUGIN_ROOT,
  getPlugin,
  getPlugins,
  loadAll,
  loadOverrides,
  reload,
  reloadAll,
  setReloadListener,
  updateConfig,
  watchPlugins
} from './registry'
import { findFfprobe, probeFile, scanFolder, scanFolderStream } from './scan'
import {
  loadModeConfig,
  loadSettings,
  saveSettings,
  type AIConfig,
  type Settings
} from './settings'
import { aiIdentify, aiPick, aiTest, type Candidate } from './ai'
import { cacheCover } from './covers'
import {
  clearItems,
  listItems,
  removeItems,
  upsertItems,
  type LibraryItem
} from './library'
import {
  openPath,
  organizeFiles,
  revealPath,
  trashFiles,
  type ConflictPolicy,
  type OrganizeAction,
  type OrganizeItem,
  type OrganizeRequest
} from './files'

const PORT = Number(process.env.PORT ?? 5174)
const HOST = '127.0.0.1'
const VERSION = '0.1.0'
const DIST_DIR = resolve(import.meta.dir, '..', 'dist')
/** 生产启动（scripts/start.mjs）时托管 dist；开发时由 Vite 提供前端。 */
const SERVE_DIST =
  process.env.SCRAPER_SERVE_DIST === '1' || process.env.NODE_ENV === 'production'

await loadOverrides()
await loadAll()

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
      ...corsHeaders
    }
  })
}

const NO_STORE = { 'cache-control': 'no-store' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function methodNotAllowed() {
  return json({ error: 'method not allowed' }, 405)
}

/**
 * 扫描目录并以 NDJSON 流回报进度：
 * `{"type":"progress","progress":ScanProgress}`
 * `{"type":"done","files":MediaFile[]}`
 * `{"type":"error","error":string}`
 */
function scanStream(path: string, recursive: boolean, blacklist: readonly string[] = []): Response {
  const encoder = new TextEncoder()
  const scanId = `scan-${Date.now().toString(36)}`
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          closed = true
        }
      }

      try {
        const files = await scanFolderStream(
          path,
          recursive,
          scanId,
          (progress) => {
            send({ type: 'progress', progress })
          },
          blacklist
        )
        send({ type: 'done', files })
      } catch (error) {
        send({ type: 'error', error: errorMessage(error) })
      } finally {
        closed = true
        try {
          controller.close()
        } catch {
          // 客户端已断开时忽略
        }
      }
    },
    cancel() {
      closed = true
    }
  })

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      ...corsHeaders
    }
  })
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, '请求体不是合法 JSON')
  }
}

function ensureObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} 必须是对象`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, `缺少或无效的 ${label}`)
  }
  return value
}

function optionalBoolean(value: unknown, label: string, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new HttpError(400, `${label} 必须是布尔值`)
  return value
}

function optionalStringArray(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new HttpError(400, `${label} 必须是字符串数组`)
  }
  return (value as string[]).map((item) => item.trim()).filter(Boolean)
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
  fallback: T
): T {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(400, `${label} 必须是 ${allowed.join('/')} 之一`)
  }
  return value as T
}

function serialize(id: string, origin: string) {
  const plugin = getPlugin(id)!
  const m = plugin.manifest
  return {
    id: m.id,
    name: m.name,
    version: m.version,
    order: m.order ?? 100,
    description: m.description ?? '',
    status: plugin.status,
    error: plugin.error ?? '',
    capabilities: plugin.capabilities,
    codeLabel: m.labels.code,
    titleLabel: m.labels.title,
    settingsUrl: `${origin}/plugins/${m.id}/settings/`,
    ...plugin.config
  }
}

function pluginOptions(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {}
  return ensureObject(value, 'options')
}

function requirePlugin(id: string) {
  const plugin = getPlugin(id)
  if (!plugin || plugin.status !== 'ok') throw new Error('插件不可用')
  return plugin
}

/**
 * AI 是通用回退引擎，不是刮削站：作为共享服务注入插件上下文。
 * 插件可通过 `ctx.ai.identify()` / `ctx.ai.pick()` 调用，也可自行覆盖配置。
 */
async function pluginAi() {
  const settings = await loadSettings()
  return {
    identify: (filename: string, overrides?: Record<string, unknown>) =>
      aiIdentify({ ...settings.ai, ...(overrides as Partial<AIConfig> | undefined) }, filename),
    pick: (filename: string, candidates: unknown[], overrides?: Record<string, unknown>) =>
      aiPick(
        { ...settings.ai, ...(overrides as Partial<AIConfig> | undefined) },
        filename,
        candidates as Candidate[]
      )
  }
}

async function identifyPlugin(
  id: string,
  filename: string,
  allowTitle = false,
  options: Record<string, unknown> = {}
) {
  const plugin = requirePlugin(id)
  if (typeof plugin.impl?.identify !== 'function') throw new Error('插件未实现 identify')
  const modeConfig = await loadModeConfig(id)
  const ai = await pluginAi()
  return plugin.impl.identify({
    filename,
    allowTitle,
    config: plugin.config,
    options,
    modeConfig,
    ai
  })
}

async function resolvePlugin(
  id: string,
  candidateId: string,
  options: Record<string, unknown> = {}
) {
  const plugin = requirePlugin(id)
  if (typeof plugin.impl?.resolve !== 'function') throw new Error('插件未实现 resolve')
  const modeConfig = await loadModeConfig(id)
  const ai = await pluginAi()
  return plugin.impl.resolve({ config: plugin.config, options, modeConfig, ai }, candidateId)
}

async function handlePlugins(req: Request, url: URL, parts: string[]) {
  if (parts.length === 2) {
    if (req.method === 'GET') {
      return json(getPlugins().map((p) => serialize(p.manifest.id, url.origin)))
    }
    return methodNotAllowed()
  }

  if (parts[2] === 'reload' && req.method === 'POST') {
    await reloadAll()
    return json({ ok: true, count: getPlugins().length })
  }

  const id = parts[2]
  const action = parts[3]
  const plugin = getPlugin(id)
  if (!plugin) return json({ error: `插件不存在: ${id}` }, 404)

  if (action === 'config') {
    if (req.method === 'GET') return json(plugin.config)
    if (req.method === 'PUT') {
      const body = ensureObject(await readJson(req), 'config')
      const next = await updateConfig(id, body)
      return json(next)
    }
    return methodNotAllowed()
  }

  if (action === 'reload' && req.method === 'POST') {
    const next = await reload(id)
    return json(serialize(id, url.origin))
  }

  if (action === 'identify' && req.method === 'POST') {
    const body = ensureObject(await readJson(req), 'request')
    const filename = requireString(body.filename, 'filename')
    const allowTitle = body.allowTitle === true
    try {
      const candidates = await identifyPlugin(id, filename, allowTitle, pluginOptions(body.options))
      return json({ candidates })
    } catch (error) {
      return json({ error: errorMessage(error) }, 400)
    }
  }

  if (action === 'resolve' && req.method === 'POST') {
    const body = ensureObject(await readJson(req), 'request')
    const candidateId = requireString(body.candidateId, 'candidateId')
    try {
      return json(await resolvePlugin(id, candidateId, pluginOptions(body.options)))
    } catch (error) {
      return json({ error: errorMessage(error) }, 400)
    }
  }

  return json({ error: 'not found' }, 404)
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
  /** 以 `.` 开头的隐藏目录会标记出来，前端可弱化显示。 */
  hidden: boolean
}

interface FsRootsCache {
  at: number
  roots: FsRoot[]
}

const ROOTS_TTL_MS = 60_000
let rootsCache: FsRootsCache | null = null

/** Windows 盘符：PowerShell 一次列出，失败时退回 A–Z 探测。 */
function windowsDriveRoots(): FsRoot[] {
  const roots: FsRoot[] = []
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-PSDrive -PSProvider FileSystem | ForEach-Object { $_.Name + '|' + $_.Root }"
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 5000 }
    )
    if (!result.error && result.status === 0) {
      for (const line of String(result.stdout ?? '').split(/\r?\n/)) {
        const [name, root] = line.split('|')
        const letter = (name ?? '').trim()
        const path = (root ?? '').trim()
        if (!/^[A-Za-z]$/.test(letter) || !path) continue
        roots.push({ name: `${letter.toUpperCase()}:`, path, kind: 'drive' })
      }
    }
  } catch {
    // 忽略，走下面的盘符探测
  }

  if (roots.length) return roots
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code)
    const path = `${letter}:\\`
    if (existsSync(path)) roots.push({ name: `${letter}:`, path, kind: 'drive' })
  }
  return roots
}

function pushRoot(roots: FsRoot[], root: FsRoot): void {
  const key = root.path.toLowerCase()
  if (!root.path || roots.some((item) => item.path.toLowerCase() === key)) return
  roots.push(root)
}

/** 盘符 + 主目录 + 常用目录 + 项目根目录，缓存 60 秒。 */
export function listFsRoots(): FsRoot[] {
  const now = Date.now()
  if (rootsCache && now - rootsCache.at < ROOTS_TTL_MS) return rootsCache.roots

  const roots: FsRoot[] = []
  if (process.platform === 'win32') {
    for (const drive of windowsDriveRoots()) pushRoot(roots, drive)
  } else {
    pushRoot(roots, { name: '/', path: '/', kind: 'drive' })
  }

  const home = homedir()
  if (home && existsSync(home)) pushRoot(roots, { name: '主目录', path: home, kind: 'home' })

  const common: [string, string][] = [
    ['桌面', join(home, 'Desktop')],
    ['下载', join(home, 'Downloads')],
    ['文档', join(home, 'Documents')],
    ['视频', join(home, 'Videos')]
  ]
  for (const [name, path] of common) {
    if (existsSync(path)) pushRoot(roots, { name, path, kind: 'common' })
  }

  const projectRoot = resolve(import.meta.dir, '..')
  if (existsSync(projectRoot)) {
    pushRoot(roots, { name: '项目目录', path: projectRoot, kind: 'common' })
  }

  rootsCache = { at: now, roots }
  return roots
}

export interface FsListing {
  path: string
  parent: string | null
  entries: FsEntry[]
}

/** 只列子目录；路径必须存在、可读且为绝对路径。 */
export async function listFsDirectories(input: string): Promise<FsListing> {
  const raw = (input ?? '').trim()
  if (!raw) throw new HttpError(400, '缺少 path')
  if (!isAbsolute(raw)) throw new HttpError(400, 'path 必须是绝对路径')

  const target = resolve(raw)
  let info
  try {
    info = await stat(target)
  } catch {
    throw new HttpError(400, '目录不存在或无法访问')
  }
  if (!info.isDirectory()) throw new HttpError(400, 'path 不是目录')

  let dirents
  try {
    dirents = await readdir(target, { withFileTypes: true })
  } catch {
    throw new HttpError(403, '没有权限读取此目录')
  }

  const entries: FsEntry[] = dirents
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: join(target, entry.name),
      isDir: true as const,
      hidden: entry.name.startsWith('.')
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))

  const parentPath = dirname(target)
  return {
    path: target,
    parent: parentPath === target ? null : parentPath,
    entries
  }
}

async function handleApi(req: Request, url: URL) {
  const parts = url.pathname.split('/').filter(Boolean) // api / plugins / :id / ...
  const route = parts[1]
  if (!route) return json({ error: 'not found' }, 404)

  if (route === 'plugins') return handlePlugins(req, url, parts)

  if (route === 'info') {
    if (req.method !== 'GET') return methodNotAllowed()
    return json({
      version: VERSION,
      platform: process.platform,
      ffprobe: findFfprobe() != null,
      native: false
    })
  }

  if (route === 'scan') {
    if (req.method !== 'POST') return methodNotAllowed()
    const body = ensureObject(await readJson(req), 'request')
    const path = requireString(body.path, 'path')
    const recursive = optionalBoolean(body.recursive, 'recursive', true)
    const blacklist = optionalStringArray(body.blacklist, 'blacklist')
    // stream=true 时以 NDJSON 逐步推送进度，前端可即时渲染。
    if (body.stream === true) return scanStream(path, recursive, blacklist)
    return json(await scanFolder(path, recursive, blacklist))
  }

  if (route === 'probe') {
    if (req.method !== 'POST') return methodNotAllowed()
    const body = ensureObject(await readJson(req), 'request')
    const path = requireString(body.path, 'path')
    return json(await probeFile(path))
  }

  if (route === 'fs') {
    const action = parts[2]
    if (action === 'roots') {
      if (req.method !== 'GET') return methodNotAllowed()
      return json({ roots: listFsRoots() }, 200, NO_STORE)
    }
    if (action === 'list') {
      if (req.method !== 'GET') return methodNotAllowed()
      return json(await listFsDirectories(url.searchParams.get('path') ?? ''), 200, NO_STORE)
    }
    return json({ error: 'not found' }, 404)
  }

  if (route === 'organize') {
    if (req.method !== 'POST') return methodNotAllowed()
    const body = ensureObject(await readJson(req), 'request')
    const dest = requireString(body.dest, 'dest')
    if (!Array.isArray(body.items)) throw new HttpError(400, 'items 必须是数组')

    const items: OrganizeItem[] = body.items.map((item, index) => {
      const entry = ensureObject(item, `items[${index}]`)
      const cropEntry = entry.posterCrop
      const posterCrop =
        cropEntry && typeof cropEntry === 'object'
          ? {
              x: Number((cropEntry as Record<string, unknown>).x),
              y: Number((cropEntry as Record<string, unknown>).y),
              width: Number((cropEntry as Record<string, unknown>).width),
              height: Number((cropEntry as Record<string, unknown>).height)
            }
          : undefined
      if (
        posterCrop &&
        (!Number.isFinite(posterCrop.x) ||
          !Number.isFinite(posterCrop.y) ||
          !Number.isFinite(posterCrop.width) ||
          !Number.isFinite(posterCrop.height))
      ) {
        throw new HttpError(400, `items[${index}].posterCrop 无效`)
      }
      return {
        source: requireString(entry.source, `items[${index}].source`),
        relativeTarget: requireString(entry.relativeTarget, `items[${index}].relativeTarget`),
        nfo: typeof entry.nfo === 'string' ? entry.nfo : undefined,
        posterUrl: typeof entry.posterUrl === 'string' ? entry.posterUrl : undefined,
        posterCrop
      }
    })

    const request: OrganizeRequest = {
      dest,
      items,
      action: enumValue<OrganizeAction>(
        body.action,
        ['move', 'copy'],
        'action',
        'move'
      ),
      conflict: enumValue<ConflictPolicy>(
        body.conflict,
        ['skip', 'overwrite', 'rename'],
        'conflict',
        'rename'
      ),
      removeEmptyDirs: optionalBoolean(body.removeEmptyDirs, 'removeEmptyDirs', false)
    }

    return json(await organizeFiles(request))
  }

  if (route === 'trash') {
    if (req.method !== 'POST') return methodNotAllowed()
    const body = ensureObject(await readJson(req), 'request')
    if (!Array.isArray(body.paths)) throw new HttpError(400, 'paths 必须是数组')
    const paths = body.paths.map((path, index) => requireString(path, `paths[${index}]`))
    return json(await trashFiles(paths))
  }

  if (route === 'settings') {
    if (req.method === 'GET') return json(await loadSettings())
    if (req.method === 'PUT') {
      const body = ensureObject(await readJson(req), 'settings')
      await saveSettings(body as unknown as Settings)
      return json(body)
    }
    return methodNotAllowed()
  }

  if (route === 'ai') {
    const action = parts[2]

    if (action === 'test') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const config = ensureObject(body.config, 'config') as unknown as AIConfig
      return json(await aiTest(config))
    }

    if (action === 'identify') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const config = ensureObject(body.config, 'config') as unknown as AIConfig
      const filename = requireString(body.filename, 'filename')
      return json(await aiIdentify(config, filename))
    }

    if (action === 'pick') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const config = ensureObject(body.config, 'config') as unknown as AIConfig
      const filename = requireString(body.filename, 'filename')
      if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
        throw new HttpError(400, 'candidates 不能为空')
      }
      const candidates: Candidate[] = body.candidates.map((candidate, index) => {
        const entry = ensureObject(candidate, `candidates[${index}]`)
        requireString(entry.id, `candidates[${index}].id`)
        return entry as unknown as Candidate
      })
      return json(await aiPick(config, filename, candidates))
    }

    return json({ error: 'not found' }, 404)
  }

  if (route === 'library') {
    const action = parts[2]

    if (action === 'list') {
      if (req.method !== 'GET' && req.method !== 'POST') return methodNotAllowed()
      return json({ items: listItems() })
    }

    if (action === 'upsert') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      if (!Array.isArray(body.items)) throw new HttpError(400, 'items 必须是数组')
      const items = body.items.map((item, index) => {
        const entry = ensureObject(item, `items[${index}]`)
        return {
          ...entry,
          path: requireString(entry.path, `items[${index}].path`),
          file: requireString(entry.file, `items[${index}].file`)
        } as unknown as LibraryItem
      })
      return json({ count: upsertItems(items) })
    }

    if (action === 'remove') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      if (!Array.isArray(body.paths)) throw new HttpError(400, 'paths 必须是数组')
      const paths = body.paths.map((path, index) => requireString(path, `paths[${index}]`))
      return json({ count: removeItems(paths) })
    }

    if (action === 'clear') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const mode = typeof body.mode === 'string' && body.mode ? body.mode : undefined
      return json({ count: clearItems(mode) })
    }

    return json({ error: 'not found' }, 404)
  }

  if (route === 'cover') {
    if (req.method !== 'GET') return methodNotAllowed()
    const urlParam = url.searchParams.get('url')
    if (!urlParam) throw new HttpError(400, '缺少 url')
    try {
      const cropParam = ['x', 'y', 'width', 'height'].map((key) => url.searchParams.get(key))
      const crop =
        cropParam.every((value) => value !== null && value !== '')
          ? {
              x: Number(cropParam[0]),
              y: Number(cropParam[1]),
              width: Number(cropParam[2]),
              height: Number(cropParam[3])
            }
          : undefined
      if (
        crop &&
        (!Number.isFinite(crop.x) ||
          !Number.isFinite(crop.y) ||
          !Number.isFinite(crop.width) ||
          !Number.isFinite(crop.height))
      ) {
        throw new HttpError(400, '裁剪参数无效')
      }
      const cover = await cacheCover(urlParam, crop)
      return new Response(Bun.file(cover.path), {
        headers: {
          'content-type': cover.type,
          'cache-control': 'public, max-age=86400',
          ...corsHeaders
        }
      })
    } catch (error) {
      return json({ error: errorMessage(error) }, 502)
    }
  }

  if (route === 'open' || route === 'reveal') {
    if (req.method !== 'POST') return methodNotAllowed()
    const body = ensureObject(await readJson(req), 'request')
    const path = requireString(body.path, 'path')
    if (route === 'open') await openPath(path)
    else await revealPath(path)
    return json({ ok: true })
  }

  return json({ error: 'not found' }, 404)
}

async function servePluginAsset(url: URL) {
  let rel = decodeURIComponent(url.pathname.replace(/^\/plugins\//, ''))
  if (rel.endsWith('/')) rel += 'index.html'
  const full = normalize(join(PLUGIN_ROOT, rel))
  if (full !== PLUGIN_ROOT && !full.startsWith(PLUGIN_ROOT + sep)) {
    return new Response('forbidden', { status: 403 })
  }

  let file = Bun.file(full)
  if (!(await file.exists()) && rel.endsWith('/settings/index.html')) {
    // 插件未自带设置页时使用共享模板
    file = Bun.file(join(PLUGIN_ROOT, '_shared', 'settings.html'))
  }
  if (!(await file.exists())) return new Response('not found', { status: 404 })
  return new Response(file, { headers: { 'cache-control': 'no-store' } })
}

/** 托管 dist：静态文件优先，未知路径回退 index.html（SPA）。 */
async function serveStatic(url: URL): Promise<Response> {
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return new Response('bad request', { status: 400 })
  }

  const rel = pathname.replace(/^\/+/, '')
  const full = resolve(DIST_DIR, rel)
  if (full !== DIST_DIR && !full.startsWith(DIST_DIR + sep)) {
    return new Response('forbidden', { status: 403 })
  }

  if (rel) {
    const file = Bun.file(full)
    if (await file.exists()) {
      return new Response(file, {
        headers: {
          'cache-control': rel.startsWith('assets/')
            ? 'public, max-age=31536000, immutable'
            : 'no-store'
        }
      })
    }
  }

  const index = Bun.file(join(DIST_DIR, 'index.html'))
  if (await index.exists()) {
    return new Response(index, { headers: { 'cache-control': 'no-store' } })
  }
  return new Response('前端尚未构建，请先运行 npm run build', { status: 404 })
}

export const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  async fetch(req, srv) {
    const url = new URL(req.url)
    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

    try {
      if (url.pathname === '/ws') {
        if (srv.upgrade(req)) return
        return new Response('expected websocket', { status: 400 })
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, url)
      if (url.pathname.startsWith('/plugins/')) return await servePluginAsset(url)
      if (SERVE_DIST && (req.method === 'GET' || req.method === 'HEAD')) {
        return await serveStatic(url)
      }
      return json({
        ok: true,
        service: 'scraper-plugin-host',
        plugins: getPlugins().length
      })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      console.error('[scraper] request failed:', errorMessage(error))
      return json({ error: errorMessage(error) }, status)
    }
  },
  websocket: {
    open(ws) {
      ws.subscribe('events')
      ws.send(JSON.stringify({ type: 'hello', time: Date.now() }))
    },
    message() {
      // 预留：前端可通过 WS 发送命令
    }
  }
})

setReloadListener((id) => {
  server.publish('events', JSON.stringify({ type: 'plugin:reloaded', id }))
})

watchPlugins()

console.log(`[scraper] plugin host  http://${HOST}:${server.port}`)
console.log(`[scraper] plugins       ${getPlugins().length}`)

import { join, normalize, sep } from 'node:path'
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
import { loadSettings, saveSettings, type AIConfig, type Settings } from './settings'
import { aiIdentify, aiPick, aiTest, type Candidate } from './ai'
import { javdbDetail, javdbIdentify, searchMovies } from './javdb'
import { cacheCover } from './covers'
import {
  clearItems,
  listItems,
  removeItems,
  upsertItems,
  type LibraryItem
} from './library'
import { tmdbDetail, tmdbIdentify } from './providers/tmdb'
import { bangumiDetail, bangumiIdentify } from './providers/bangumi'
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

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders }
  })
}

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
    codeLabel: m.labels.code,
    titleLabel: m.labels.title,
    settingsUrl: `${origin}/plugins/${m.id}/settings/`,
    ...plugin.config
  }
}

async function identifyPlugin(id: string, filename: string, allowTitle = false) {
  const plugin = getPlugin(id)
  if (!plugin || plugin.status !== 'ok') throw new Error('插件不可用')
  if (typeof plugin.impl?.identify !== 'function') throw new Error('插件未实现 identify')
  return plugin.impl.identify({ filename, allowTitle, config: plugin.config })
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
      return json({ candidates: await identifyPlugin(id, filename, allowTitle) })
    } catch (error) {
      return json({ error: errorMessage(error) }, 400)
    }
  }

  return json({ error: 'not found' }, 404)
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

  if (route === 'pick-folder') {
    if (req.method !== 'POST') return methodNotAllowed()
    return json({ error: '非 Tauri 环境无法弹出文件夹选择器' }, 400)
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

  if (route === 'javdb') {
    const action = parts[2]

    if (action === 'identify') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const filename = requireString(body.filename, 'filename')
      return json({ candidates: await javdbIdentify(filename, { allowTitle: body.allowTitle === true }) })
    }

    if (action === 'detail') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const id = requireString(body.id, 'id')
      return json(await javdbDetail(id))
    }

    if (action === 'search') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const keyword = requireString(body.keyword, 'keyword')
      const limit = Number(body.limit ?? 10)
      return json({ movies: await searchMovies(keyword, Number.isFinite(limit) ? limit : 10) })
    }

    return json({ error: 'not found' }, 404)
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

  if (route === 'tmdb') {
    const action = parts[2]

    if (action === 'identify') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const filename = requireString(body.filename, 'filename')
      const apiKey = requireString(body.apiKey, 'apiKey')
      const mediaType = enumValue<'movie' | 'tv'>(body.mediaType, ['movie', 'tv'], 'mediaType', 'movie')
      const lang = typeof body.lang === 'string' && body.lang ? body.lang : undefined
      return json({ candidates: await tmdbIdentify(filename, mediaType, apiKey, lang) })
    }

    if (action === 'detail') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const id = requireString(body.id, 'id')
      const apiKey = requireString(body.apiKey, 'apiKey')
      const mediaType = enumValue<'movie' | 'tv'>(body.mediaType, ['movie', 'tv'], 'mediaType', 'movie')
      const lang = typeof body.lang === 'string' && body.lang ? body.lang : undefined
      return json(await tmdbDetail(id, mediaType, apiKey, lang))
    }

    return json({ error: 'not found' }, 404)
  }

  if (route === 'bangumi') {
    const action = parts[2]

    if (action === 'identify') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const filename = requireString(body.filename, 'filename')
      const token = typeof body.token === 'string' && body.token ? body.token : undefined
      return json({ candidates: await bangumiIdentify(filename, token) })
    }

    if (action === 'detail') {
      if (req.method !== 'POST') return methodNotAllowed()
      const body = ensureObject(await readJson(req), 'request')
      const id = requireString(body.id, 'id')
      const token = typeof body.token === 'string' && body.token ? body.token : undefined
      return json(await bangumiDetail(id, token))
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

const server = Bun.serve({
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

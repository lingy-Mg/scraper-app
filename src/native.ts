import type {
  AIConfig,
  AIIdentifyResult,
  AIPickResult,
  AITestResult,
  AppInfo,
  Candidate,
  CropRect,
  LibraryItem,
  MediaFile,
  NativeMode,
  OrganizeRequest,
  OrganizeResult,
  ScanProgress,
  Settings,
  TrashResult
} from './types'
import { INITIAL_AI } from './data'

const isTauri =
  typeof window !== 'undefined' &&
  Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

let mode: NativeMode = isTauri ? 'tauri' : 'demo'
let detectPromise: Promise<NativeMode> | null = null
let detectedInfo: AppInfo | null = null

const invokeTauri = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  const api = await import('@tauri-apps/api/core')
  return api.invoke<T>(command, args)
}

interface HttpInit {
  method?: string
  body?: unknown
}

async function http<T>(path: string, init?: HttpInit): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  const hasBody = init?.body !== undefined
  if (hasBody) headers['content-type'] = 'application/json'

  const response = await fetch(path, {
    method: init?.method ?? (hasBody ? 'POST' : 'GET'),
    headers,
    body: hasBody ? JSON.stringify(init?.body) : undefined
  })

  const text = await response.text()
  if (!response.ok) {
    let message = `HTTP ${response.status}`
    if (text) {
      try {
        const data = JSON.parse(text) as { error?: string }
        if (data?.error) message = data.error
      } catch {
        message = text
      }
    }
    throw new Error(message)
  }
  return (text ? JSON.parse(text) : undefined) as T
}

async function probeHttp(): Promise<NativeMode> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 800)
  try {
    const response = await fetch('/api/info', {
      signal: controller.signal,
      headers: { accept: 'application/json' }
    })
    if (!response.ok) return 'demo'
    const info = (await response.json()) as AppInfo
    if (!info || typeof info !== 'object') return 'demo'
    detectedInfo = info
    return 'http'
  } catch {
    return 'demo'
  } finally {
    clearTimeout(timer)
  }
}

async function ensureMode(): Promise<NativeMode> {
  if (isTauri) return 'tauri'
  if (!detectPromise) {
    detectPromise = probeHttp().then((next) => {
      mode = next
      return next
    })
  }
  return detectPromise
}

const demoAppInfo = (): AppInfo => ({
  version: '0.1.0',
  platform: typeof navigator === 'undefined' ? 'web' : navigator.platform || 'web',
  ffprobe: false,
  native: false
})

const demoUnavailable = (action: string) =>
  new Error(`演示模式不可用：${action}（未检测到桌面 / HTTP 后端）`)

export interface ScanOptions {
  /** 后端推送进度（枚举目录 / 读取视频信息）时回调。 */
  onProgress?: (progress: ScanProgress) => void
  /** 每探测完一批文件回调，用于增量渲染表格。 */
  onFiles?: (files: MediaFile[]) => void
  /** 文件名黑名单：后端枚举时直接跳过命中文件。 */
  blacklist?: string[]
}

type ScanStreamEvent =
  | { type: 'progress'; progress: ScanProgress }
  | { type: 'done'; files: MediaFile[] }
  | { type: 'error'; error: string }

/**
 * HTTP 模式：以 NDJSON 流读取扫描进度。
 * 后端不支持流式（返回 JSON 数组）时自动退化。
 */
async function postScanStream(
  path: string,
  recursive: boolean,
  options: ScanOptions
): Promise<MediaFile[]> {
  let response: Response
  try {
    response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
      body: JSON.stringify({
        path,
        recursive,
        stream: true,
        blacklist: options.blacklist ?? []
      })
    })
  } catch (error) {
    throw new Error(`无法连接扫描服务：${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    const text = await response.text()
    let message = `HTTP ${response.status}`
    if (text) {
      try {
        const data = JSON.parse(text) as { error?: string }
        if (data?.error) message = data.error
      } catch {
        message = text
      }
    }
    throw new Error(message)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!response.body || !contentType.includes('ndjson')) {
    return (await response.json()) as MediaFile[]
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const result: { files: MediaFile[] | null } = { files: null }
  let buffered = ''

  const handleLine = (line: string) => {
    let event: ScanStreamEvent
    try {
      event = JSON.parse(line) as ScanStreamEvent
    } catch {
      return
    }
    if (!event || typeof event !== 'object') return
    if (event.type === 'progress') {
      options.onProgress?.(event.progress)
      if (event.progress.files?.length) options.onFiles?.(event.progress.files)
    } else if (event.type === 'done') {
      result.files = event.files
    } else if (event.type === 'error') {
      throw new Error(event.error || '扫描失败')
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      let index = buffered.indexOf('\n')
      while (index >= 0) {
        const line = buffered.slice(0, index).trim()
        buffered = buffered.slice(index + 1)
        if (line) handleLine(line)
        index = buffered.indexOf('\n')
      }
    }
    const tail = buffered.trim()
    if (tail) handleLine(tail)
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  }

  if (!result.files) throw new Error('扫描连接中断，未收到完整结果')
  return result.files
}

export interface NativeBridge {
  readonly mode: NativeMode
  appInfo(): Promise<AppInfo>
  scanFolder(path: string, recursive?: boolean, options?: ScanOptions): Promise<MediaFile[]>
  probeFile(path: string): Promise<MediaFile>
  pickFolder(): Promise<string | null>
  organize(req: OrganizeRequest): Promise<OrganizeResult[]>
  trash(paths: string[]): Promise<TrashResult>
  loadSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  aiTest(config: AIConfig): Promise<AITestResult>
  aiIdentify(config: AIConfig, filename: string): Promise<AIIdentifyResult>
  aiPick(config: AIConfig, filename: string, candidates: Candidate[]): Promise<AIPickResult>
  javdbIdentify(filename: string, allowTitle?: boolean): Promise<Candidate[]>
  javdbDetail(id: string): Promise<Record<string, unknown>>
  coverSrc(url: string): Promise<string>
  coverCrop(url: string, crop: CropRect): Promise<string>
  libraryList(): Promise<LibraryItem[]>
  libraryUpsert(items: LibraryItem[]): Promise<number>
  libraryRemove(paths: string[]): Promise<number>
  libraryClear(mode?: string): Promise<number>
  tmdbIdentify(
    filename: string,
    mediaType: 'movie' | 'tv',
    apiKey: string,
    lang?: string
  ): Promise<Candidate[]>
  tmdbDetail(
    id: string,
    mediaType: 'movie' | 'tv',
    apiKey: string,
    lang?: string
  ): Promise<Record<string, unknown>>
  bangumiIdentify(filename: string, token?: string): Promise<Candidate[]>
  bangumiDetail(id: string, token?: string): Promise<Record<string, unknown>>
  openPath(path: string): Promise<void>
  revealPath(path: string): Promise<void>
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
}

export const native: NativeBridge = {
  get mode() {
    return mode
  },

  async appInfo() {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<AppInfo>('app_info')
    if (current === 'http') {
      if (detectedInfo) return detectedInfo
      return http<AppInfo>('/api/info')
    }
    return demoAppInfo()
  },

  async scanFolder(path, recursive = true, options = {}) {
    const current = await ensureMode()
    if (current === 'tauri') {
      const scanId = `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      let finished = false
      const events = await import('@tauri-apps/api/event')
      const unlisten = await events.listen<ScanProgress>('scan-progress', (event) => {
        if (finished) return
        const progress = event.payload
        if (!progress || progress.scanId !== scanId) return
        options.onProgress?.(progress)
        if (progress.files?.length) options.onFiles?.(progress.files)
      })
      try {
        const files = await invokeTauri<MediaFile[]>('scan_folder', {
          path,
          recursive,
          scanId,
          blacklist: options.blacklist ?? []
        })
        finished = true
        return files
      } finally {
        finished = true
        unlisten()
      }
    }
    if (current === 'http') return postScanStream(path, recursive, options)
    throw demoUnavailable('扫描目录')
  },

  async probeFile(path) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<MediaFile>('probe_file', { path })
    if (current === 'http') return http<MediaFile>('/api/probe', { body: { path } })
    throw demoUnavailable('读取视频信息')
  },

  async pickFolder() {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<string | null>('pick_folder')
    if (current === 'http') {
      const data = await http<{ path: string | null }>('/api/pick-folder', { method: 'POST' })
      return data.path ?? null
    }
    throw demoUnavailable('选择文件夹')
  },

  async organize(req) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<OrganizeResult[]>('organize_files', { ...req })
    if (current === 'http') return http<OrganizeResult[]>('/api/organize', { body: req })
    throw demoUnavailable('整理文件')
  },

  async trash(paths) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<TrashResult>('trash_files', { paths })
    if (current === 'http') return http<TrashResult>('/api/trash', { body: { paths } })
    throw demoUnavailable('删除文件')
  },

  async loadSettings() {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<Settings>('load_settings')
    if (current === 'http') return http<Settings>('/api/settings')
    return { ai: { ...INITIAL_AI } }
  },

  async saveSettings(settings) {
    const current = await ensureMode()
    if (current === 'tauri') {
      await invokeTauri<void>('save_settings', { settings })
      return
    }
    if (current === 'http') {
      await http<Settings>('/api/settings', { method: 'PUT', body: settings })
      return
    }
    throw demoUnavailable('保存设置')
  },

  async aiTest(config) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<AITestResult>('ai_test', { config })
    if (current === 'http') return http<AITestResult>('/api/ai/test', { body: { config } })
    return { ok: false, latencyMs: 0, message: '演示模式不可用，请启动后端后再测试' }
  },

  async aiIdentify(config, filename) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<AIIdentifyResult>('ai_identify', { config, filename })
    if (current === 'http') {
      return http<AIIdentifyResult>('/api/ai/identify', { body: { config, filename } })
    }
    throw demoUnavailable('AI 识别')
  },

  async aiPick(config, filename, candidates) {
    const current = await ensureMode()
    if (current === 'tauri') {
      return invokeTauri<AIPickResult>('ai_pick', { config, filename, candidates })
    }
    if (current === 'http') {
      return http<AIPickResult>('/api/ai/pick', { body: { config, filename, candidates } })
    }
    throw demoUnavailable('AI 选择')
  },

  async javdbIdentify(filename, allowTitle = false) {
    const current = await ensureMode()
    if (current === 'tauri') {
      return invokeTauri<Candidate[]>('javdb_identify', { filename, allowTitle })
    }
    if (current === 'http') {
      const data = await http<{ candidates: Candidate[] }>('/api/javdb/identify', {
        body: { filename, allowTitle }
      })
      return data.candidates ?? []
    }
    throw demoUnavailable('JavDB 识别')
  },

  async javdbDetail(id) {
    const current = await ensureMode()
    if (current === 'tauri') {
      return invokeTauri<Record<string, unknown>>('javdb_detail', { id })
    }
    if (current === 'http') {
      return http<Record<string, unknown>>('/api/javdb/detail', { body: { id } })
    }
    throw demoUnavailable('JavDB 详情')
  },

  async libraryList() {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<LibraryItem[]>('library_list')
    if (current === 'http') {
      const data = await http<{ items: LibraryItem[] }>('/api/library/list')
      return data.items ?? []
    }
    return []
  },

  async libraryUpsert(items) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<number>('library_upsert', { items })
    if (current === 'http') {
      const data = await http<{ count: number }>('/api/library/upsert', { body: { items } })
      return data.count ?? 0
    }
    return 0
  },

  async libraryRemove(paths) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<number>('library_remove', { paths })
    if (current === 'http') {
      const data = await http<{ count: number }>('/api/library/remove', { body: { paths } })
      return data.count ?? 0
    }
    return 0
  },

  async libraryClear(mode) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<number>('library_clear', { mode })
    if (current === 'http') {
      const data = await http<{ count: number }>('/api/library/clear', { body: { mode } })
      return data.count ?? 0
    }
    return 0
  },

  async tmdbIdentify(filename, mediaType, apiKey, lang) {
    const current = await ensureMode()
    if (current === 'tauri') {
      return invokeTauri<Candidate[]>('tmdb_identify', { filename, mediaType, apiKey, lang })
    }
    if (current === 'http') {
      const data = await http<{ candidates: Candidate[] }>('/api/tmdb/identify', {
        body: { filename, mediaType, apiKey, lang }
      })
      return data.candidates ?? []
    }
    throw demoUnavailable('TMDB 识别')
  },

  async tmdbDetail(id, mediaType, apiKey, lang) {
    const current = await ensureMode()
    if (current === 'tauri') {
      return invokeTauri<Record<string, unknown>>('tmdb_detail', {
        id,
        mediaType,
        apiKey,
        lang
      })
    }
    if (current === 'http') {
      return http<Record<string, unknown>>('/api/tmdb/detail', {
        body: { id, mediaType, apiKey, lang }
      })
    }
    throw demoUnavailable('TMDB 详情')
  },

  async bangumiIdentify(filename, token) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<Candidate[]>('bangumi_identify', { filename })
    if (current === 'http') {
      const data = await http<{ candidates: Candidate[] }>('/api/bangumi/identify', {
        body: { filename, token }
      })
      return data.candidates ?? []
    }
    throw demoUnavailable('Bangumi 识别')
  },

  async bangumiDetail(id, token) {
    const current = await ensureMode()
    if (current === 'tauri') return invokeTauri<Record<string, unknown>>('bangumi_detail', { id })
    if (current === 'http') {
      return http<Record<string, unknown>>('/api/bangumi/detail', { body: { id, token } })
    }
    throw demoUnavailable('Bangumi 详情')
  },

  async coverSrc(url) {
    const current = await ensureMode()
    if (current === 'tauri') {
      return invokeTauri<string>('cover_cache', { url })
    }
    if (current === 'http') return `/api/cover?url=${encodeURIComponent(url)}&v=4`
    return url
  },

  async coverCrop(url, crop) {
    const current = await ensureMode()
    if (current === 'tauri') {
      return invokeTauri<string>('cover_crop', {
        url,
        x: crop.x,
        y: crop.y,
        width: crop.width,
        height: crop.height
      })
    }
    if (current === 'http') {
      const query = new URLSearchParams({
        url,
        x: String(crop.x),
        y: String(crop.y),
        width: String(crop.width),
        height: String(crop.height),
        v: '4'
      })
      return `/api/cover?${query.toString()}`
    }
    return url
  },

  async openPath(path) {
    const current = await ensureMode()
    if (current === 'tauri') {
      await invokeTauri<void>('open_path', { path })
      return
    }
    if (current === 'http') {
      await http<{ ok: true }>('/api/open', { body: { path } })
      return
    }
    throw demoUnavailable('打开文件')
  },

  async revealPath(path) {
    const current = await ensureMode()
    if (current === 'tauri') {
      await invokeTauri<void>('reveal_path', { path })
      return
    }
    if (current === 'http') {
      await http<{ ok: true }>('/api/reveal', { body: { path } })
      return
    }
    throw demoUnavailable('在文件夹中显示')
  },

  async minimize() {
    const current = await ensureMode()
    if (current === 'tauri') {
      await invokeTauri<void>('window_minimize')
      return
    }
    // 浏览器中无法最小化，静默忽略。
  },

  async toggleMaximize() {
    const current = await ensureMode()
    if (current === 'tauri') {
      await invokeTauri<void>('window_toggle_maximize')
      return
    }
  },

  async close() {
    const current = await ensureMode()
    if (current === 'tauri') {
      await invokeTauri<void>('window_close')
      return
    }
    if (current === 'demo') throw demoUnavailable('关闭窗口')
    // HTTP 模式是普通浏览器标签页，不允许脚本关闭。
  }
}

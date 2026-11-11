import type {
  AIConfig,
  AIIdentifyResult,
  AIPickResult,
  AITestResult,
  AppInfo,
  Candidate,
  CropRect,
  DuplicateGroup,
  FsListing,
  FsRoot,
  LibraryItem,
  LibraryQuery,
  LibraryQueryResult,
  LibraryStats,
  MediaFile,
  MediaSource,
  NativeMode,
  OrganizeRequest,
  OrganizeResult,
  ScanProgress,
  Settings,
  SettingsExportFile,
  SettingsImportResult,
  SubtitleInfo,
  TrashResult
} from './types'

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
 * 以 NDJSON 流读取扫描进度。
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

/** 由 App 注册：打开目录选择弹窗，并把用户选择回传给 pickFolder()。 */
export type FolderPickerHandler = (resolve: (path: string | null) => void) => void

let folderPickerHandler: FolderPickerHandler | null = null

export function registerFolderPicker(handler: FolderPickerHandler | null): void {
  folderPickerHandler = handler
}

export interface NativeBridge {
  readonly mode: NativeMode
  appInfo(): Promise<AppInfo>
  scanFolder(path: string, recursive?: boolean, options?: ScanOptions): Promise<MediaFile[]>
  probeFile(path: string): Promise<MediaFile>
  fsRoots(): Promise<FsRoot[]>
  fsList(path: string): Promise<FsListing>
  pickFolder(): Promise<string | null>
  organize(req: OrganizeRequest): Promise<OrganizeResult[]>
  findSubtitles(videoPath: string): Promise<SubtitleInfo[]>
  trash(paths: string[]): Promise<TrashResult>
  loadSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  exportSettings(includeSecrets: boolean): Promise<SettingsExportFile>
  importSettings(payload: unknown): Promise<SettingsImportResult>
  aiTest(config: AIConfig): Promise<AITestResult>
  aiIdentify(config: AIConfig, filename: string): Promise<AIIdentifyResult>
  aiPick(config: AIConfig, filename: string, candidates: Candidate[]): Promise<AIPickResult>
  javdbIdentify(filename: string, allowTitle?: boolean): Promise<Candidate[]>
  javdbDetail(id: string): Promise<Record<string, unknown>>
  coverSrc(url: string): Promise<string>
  coverCrop(url: string, crop: CropRect): Promise<string>
  libraryList(): Promise<LibraryItem[]>
  libraryQuery(options: LibraryQuery): Promise<LibraryQueryResult>
  libraryDuplicates(mode?: string): Promise<DuplicateGroup[]>
  libraryStats(mode?: string): Promise<LibraryStats>
  libraryUpsert(items: LibraryItem[]): Promise<number>
  libraryRemove(paths: string[]): Promise<number>
  libraryClear(mode?: string): Promise<number>
  listSources(): Promise<MediaSource[]>
  addSource(path: string, name?: string): Promise<MediaSource[]>
  removeSource(path: string): Promise<MediaSource[]>
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
}

/**
 * B/S 版本只有一个后端：同源 Bun HTTP 接口。
 * 所有业务组件通过 `native` 调用，不直接 fetch。
 */
export const native: NativeBridge = {
  get mode(): NativeMode {
    return 'http'
  },

  appInfo() {
    return http<AppInfo>('/api/info')
  },

  scanFolder(path, recursive = true, options = {}) {
    return postScanStream(path, recursive, options)
  },

  probeFile(path) {
    return http<MediaFile>('/api/probe', { body: { path } })
  },

  async fsRoots() {
    const data = await http<{ roots: FsRoot[] }>('/api/fs/roots')
    return data.roots ?? []
  },

  fsList(path) {
    return http<FsListing>(`/api/fs/list?path=${encodeURIComponent(path)}`)
  },

  async pickFolder() {
    if (!folderPickerHandler) throw new Error('目录选择器尚未就绪')
    return new Promise<string | null>((resolvePath) => {
      folderPickerHandler?.(resolvePath)
    })
  },

  organize(req) {
    return http<OrganizeResult[]>('/api/organize', { body: req })
  },

  async findSubtitles(videoPath) {
    const data = await http<{ subtitles: SubtitleInfo[] }>('/api/subtitles/find', {
      body: { videoPath }
    })
    return data.subtitles ?? []
  },

  trash(paths) {
    return http<TrashResult>('/api/trash', { body: { paths } })
  },

  loadSettings() {
    return http<Settings>('/api/settings')
  },

  async saveSettings(settings) {
    await http<Settings>('/api/settings', { method: 'PUT', body: settings })
  },

  exportSettings(includeSecrets) {
    return http<SettingsExportFile>(
      `/api/settings/export?includeSecrets=${includeSecrets ? '1' : '0'}`
    )
  },

  importSettings(payload) {
    return http<SettingsImportResult>('/api/settings/import', { body: payload })
  },

  aiTest(config) {
    return http<AITestResult>('/api/ai/test', { body: { config } })
  },

  aiIdentify(config, filename) {
    return http<AIIdentifyResult>('/api/ai/identify', { body: { config, filename } })
  },

  aiPick(config, filename, candidates) {
    return http<AIPickResult>('/api/ai/pick', { body: { config, filename, candidates } })
  },

  async javdbIdentify(filename, allowTitle = false) {
    const data = await http<{ candidates: Candidate[] }>('/api/plugins/javdb/identify', {
      body: { filename, allowTitle }
    })
    return data.candidates ?? []
  },

  javdbDetail(id) {
    return http<Record<string, unknown>>('/api/plugins/javdb/resolve', {
      body: { candidateId: id }
    })
  },

  async libraryList() {
    const data = await http<{ items: LibraryItem[] }>('/api/library/list')
    return data.items ?? []
  },

  libraryQuery(options) {
    const params = new URLSearchParams()
    const fields: (keyof LibraryQuery)[] = [
      'q',
      'mode',
      'maker',
      'actor',
      'tag',
      'status',
      'sort',
      'order'
    ]
    for (const field of fields) {
      const value = options[field]
      if (value !== undefined && value !== '') params.set(field, String(value))
    }
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.offset !== undefined) params.set('offset', String(options.offset))
    const query = params.toString()
    return http<LibraryQueryResult>(`/api/library/query${query ? `?${query}` : ''}`)
  },

  async libraryDuplicates(mode) {
    const query = mode ? `?mode=${encodeURIComponent(mode)}` : ''
    const data = await http<{ groups: DuplicateGroup[] }>(`/api/library/duplicates${query}`)
    return data.groups ?? []
  },

  libraryStats(mode) {
    const query = mode ? `?mode=${encodeURIComponent(mode)}` : ''
    return http<LibraryStats>(`/api/library/stats${query}`)
  },

  async libraryUpsert(items) {
    const data = await http<{ count: number }>('/api/library/upsert', { body: { items } })
    return data.count ?? 0
  },

  async libraryRemove(paths) {
    const data = await http<{ count: number }>('/api/library/remove', { body: { paths } })
    return data.count ?? 0
  },

  async libraryClear(mode) {
    const data = await http<{ count: number }>('/api/library/clear', { body: { mode } })
    return data.count ?? 0
  },

  async listSources() {
    const data = await http<{ sources: MediaSource[] }>('/api/sources')
    return data.sources ?? []
  },

  async addSource(path, name) {
    const data = await http<{ sources: MediaSource[] }>('/api/sources', {
      body: { path, name }
    })
    return data.sources ?? []
  },

  async removeSource(path) {
    const data = await http<{ sources: MediaSource[] }>(
      `/api/sources?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' }
    )
    return data.sources ?? []
  },

  async tmdbIdentify(filename, mediaType, apiKey, lang) {
    const data = await http<{ candidates: Candidate[] }>(`/api/plugins/${mediaType}/identify`, {
      body: { filename, options: { apiKey, lang, mediaType } }
    })
    return data.candidates ?? []
  },

  tmdbDetail(id, mediaType, apiKey, lang) {
    return http<Record<string, unknown>>(`/api/plugins/${mediaType}/resolve`, {
      body: { candidateId: id, options: { apiKey, lang, mediaType } }
    })
  },

  async bangumiIdentify(filename, token) {
    const data = await http<{ candidates: Candidate[] }>('/api/plugins/anime/identify', {
      body: { filename, options: { token } }
    })
    return data.candidates ?? []
  },

  bangumiDetail(id, token) {
    return http<Record<string, unknown>>('/api/plugins/anime/resolve', {
      body: { candidateId: id, options: { token } }
    })
  },

  async coverSrc(url) {
    return `/api/cover?url=${encodeURIComponent(url)}&v=4`
  },

  async coverCrop(url, crop) {
    const query = new URLSearchParams({
      url,
      x: String(crop.x),
      y: String(crop.y),
      width: String(crop.width),
      height: String(crop.height),
      v: '4'
    })
    return `/api/cover?${query.toString()}`
  },

  async openPath(path) {
    await http<{ ok: true }>('/api/open', { body: { path } })
  },

  async revealPath(path) {
    await http<{ ok: true }>('/api/reveal', { body: { path } })
  }
}

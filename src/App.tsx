import { useEffect, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Checkbox, Input, Menu, Modal } from 'antd'
import type { Key } from 'react'
import TitleBar from './components/TitleBar'
import MenuBar from './components/MenuBar'
import Toolbar from './components/Toolbar'
import ModeBar from './components/ModeBar'
import FilterBar from './components/FilterBar'
import FileTable from './components/FileTable'
import StatusBar from './components/StatusBar'
import ScanProgressBar from './components/ScanProgressBar'
import LogPanel from './components/LogPanel'
import OrganizeModal from './components/OrganizeModal'
import ConfigModal from './components/ConfigModal'
import AIConfigModal from './components/AIConfigModal'
import CandidateModal from './components/CandidateModal'
import PluginSettingsModal from './components/PluginSettingsModal'
import PosterModal from './components/PosterModal'
import CoverCropModal from './components/CoverCropModal'
import BlacklistModal from './components/BlacklistModal'
import FolderPickerModal from './components/FolderPickerModal'
import { INITIAL_AI, INITIAL_MODES } from './data'
import {
  fetchPlugins,
  identifyWithPlugin,
  reloadPlugins,
  resolveWithPlugin,
  toModeConfig
} from './api'
import { native, registerFolderPicker } from './native'
import type {
  AIConfig,
  AIIdentifyResult,
  AppInfo,
  Candidate,
  CropRect,
  FilterKey,
  LogLine,
  Magnet,
  MediaFile,
  ModeConfig,
  ModeKey,
  NativeMode,
  OrganizeOptions,
  OrganizeRequest,
  Row,
  RowStatus,
  ScanProgress,
  ScanState,
  Settings
} from './types'
import {
  baseName,
  buildNfo,
  buildPath,
  cleanFilename,
  errText,
  fmtDur,
  fmtSize,
  hashString,
  isBlacklisted,
  isShort,
  isSuspiciousCode,
  libraryFromRow,
  normalizeBlacklist,
  now,
  rowFromLibrary,
  rowFromMedia,
  withExt
} from './utils'

const normalizeCandidate = (raw: unknown, index: number): Candidate => {
  const item = (raw ?? {}) as Record<string, unknown>
  const title =
    typeof item.title === 'string'
      ? item.title
      : typeof item.name === 'string'
        ? item.name
        : '未命名'
  return {
    id: String(item.id ?? `candidate-${index + 1}`),
    title,
    year: item.year === undefined || item.year === null ? '' : String(item.year),
    code: typeof item.code === 'string' && item.code ? item.code : undefined,
    source: typeof item.source === 'string' && item.source ? item.source : '插件',
    score: typeof item.score === 'number' ? item.score : Number(item.score) || 0,
    overview:
      typeof item.overview === 'string'
        ? item.overview
        : typeof item.description === 'string'
          ? item.description
          : '',
    poster:
      typeof item.poster === 'number'
        ? Math.abs(item.poster)
        : hashString(String(item.id ?? title ?? index)),
    posterUrl: typeof item.posterUrl === 'string' && item.posterUrl ? item.posterUrl : undefined,
    maker: typeof item.maker === 'string' && item.maker ? item.maker : undefined,
    actors: typeof item.actors === 'string' && item.actors ? item.actors : undefined,
    duration: typeof item.duration === 'number' && item.duration > 0 ? item.duration : undefined,
    detailId: typeof item.detailId === 'string' && item.detailId ? item.detailId : undefined,
    tags: Array.isArray(item.tags)
      ? item.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined,
    releaseDate:
      typeof item.releaseDate === 'string' && item.releaseDate ? item.releaseDate : undefined,
    director: typeof item.director === 'string' && item.director ? item.director : undefined,
    series: typeof item.series === 'string' && item.series ? item.series : undefined
  }
}

/** 兼容插件返回的 camelCase 与上游原始 snake_case 字段。 */
const normalizeMagnets = (raw: unknown): Magnet[] => {
  if (!Array.isArray(raw)) return []
  const out: Magnet[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const hash = typeof item.hash === 'string' ? item.hash.trim() : ''
    if (!hash) continue
    const files = item.filesCount ?? item.files_count
    const pikpak = item.pikpakUrl ?? item.pikpak_url
    out.push({
      name: typeof item.name === 'string' && item.name ? item.name : hash,
      hash,
      size: typeof item.size === 'string' && item.size ? item.size : undefined,
      cnsub: item.cnsub === true,
      hd: item.hd === true,
      filesCount: typeof files === 'number' ? files : Number(files) || 0,
      pikpakUrl: typeof pikpak === 'string' && pikpak ? pikpak : undefined
    })
  }
  return out
}

const candidateFromAI = (row: Row, result: AIIdentifyResult): Candidate => ({
  id: `ai:${result.code || row.uid}`,
  title: result.title || result.code || row.title,
  year: '',
  code: result.code || undefined,
  source: 'AI',
  score: result.confidence,
  overview: result.fallback ? '本地正则回退结果' : 'AI 模型识别结果',
  poster: row.poster
})

const joinPath = (dir: string, name: string) => {
  const separator = dir.includes('\\') || !dir.includes('/') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${separator}${name}`
}

/** 插件提供元数据，设置文件只覆盖用户可编辑的配置项。 */
const mergeModeConfig = (base: ModeConfig, saved?: ModeConfig): ModeConfig =>
  saved
    ? {
        ...base,
        lang: saved.lang || base.lang,
        sources: saved.sources ?? base.sources,
        downloads: saved.downloads ?? base.downloads,
        naming: saved.naming || base.naming,
        organize: saved.organize || base.organize,
        tmdbApiKey: saved.tmdbApiKey ?? base.tmdbApiKey,
        tmdbLang: saved.tmdbLang || base.tmdbLang,
        bangumiToken: saved.bangumiToken ?? base.bangumiToken
      }
    : base

export default function ScraperApp() {
  const { message, modal } = AntdApp.useApp()

  const [modes, setModes] = useState<Record<string, ModeConfig>>(INITIAL_MODES)
  const [modeKey, setModeKey] = useState<ModeKey>('av')
  const [pluginSettingsOpen, setPluginSettingsOpen] = useState(false)
  const [pluginSource, setPluginSource] = useState<'builtin' | 'bun'>('builtin')
  const [ai, setAi] = useState<AIConfig>(INITIAL_AI)
  const [rows, setRows] = useState<Row[]>([])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [selected, setSelected] = useState<Key[]>([])
  const [minDur, setMinDur] = useState(10)
  const [hideShorts, setHideShorts] = useState(true)
  const [cleanOpen, setCleanOpen] = useState(false)
  const [cleanSelected, setCleanSelected] = useState<Key[]>([])
  const [logs, setLogs] = useState<LogLine[]>([])
  const [logOpen, setLogOpen] = useState(true)
  const [logHeight, setLogHeight] = useState(180)
  const [compact, setCompact] = useState(false)
  const [organizeOpen, setOrganizeOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [aiOpen, setAiOpen] = useState(false)
  const [blacklistOpen, setBlacklistOpen] = useState(false)
  const [blacklist, setBlacklist] = useState<string[]>([])
  const [posterRow, setPosterRow] = useState<Row | null>(null)
  const [cropRow, setCropRow] = useState<Row | null>(null)
  const [reviewRow, setReviewRow] = useState<Row | null>(null)
  const [ctx, setCtx] = useState<{ x: number; y: number; row: Row } | null>(null)
  const [note, setNote] = useState('未选择目录')
  const [tableH, setTableH] = useState(420)

  const [folder, setFolder] = useState('')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [nativeMode, setNativeMode] = useState<NativeMode>(native.mode)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerInitial, setPickerInitial] = useState('')
  const pickerResolveRef = useRef<((path: string | null) => void) | null>(null)
  const [task, setTask] = useState('空闲')
  const [hydrated, setHydrated] = useState(false)
  const [scan, setScan] = useState<ScanState>({
    active: false,
    phase: 'walk',
    found: 0,
    dirs: 0,
    total: 0,
    done: 0,
    current: '',
    startedAt: 0
  })

  const [manualRow, setManualRow] = useState<Row | null>(null)
  const [manualQuery, setManualQuery] = useState('')
  const [manualBusy, setManualBusy] = useState(false)

  const wrapRef = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const skipSaveRef = useRef(true)
  const canSaveRef = useRef(false)
  const minDurRef = useRef(minDur)
  const providerErrorRef = useRef('')
  const libraryPausedRef = useRef(false)
  const resetBusyRef = useRef(false)
  const scanBusyRef = useRef(false)
  const scanRef = useRef<ScanState | null>(null)
  const scanBufferRef = useRef<MediaFile[]>([])
  const scanTimerRef = useRef<number | null>(null)
  const blacklistRef = useRef<string[]>([])
  const mode = modes[modeKey] ?? Object.values(modes)[0]

  useEffect(() => {
    minDurRef.current = minDur
  }, [minDur])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const update = () => setTableH(el.clientHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const pushLog = (level: LogLine['level'], text: string) =>
    setLogs((lines) => [...lines, { time: now(), level, text }])

  const patchRow = (uid: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((row) => (row.uid === uid ? { ...row, ...patch } : row)))

  const filePath = (row: Row) =>
    row.path || (folder ? joinPath(folder, row.file) : '')

  const providerKind = (): 'movie' | 'tv' | 'anime' | null =>
    modeKey === 'movie' || modeKey === 'tv' || modeKey === 'anime' ? modeKey : null

  /** 电影/电视剧走 TMDB，动漫走 Bangumi。 */
  const identifyWithProvider = async (filename: string): Promise<Candidate[]> => {
    const kind = providerKind()
    if (!kind) return []

    if (kind === 'anime') {
      const list = await native.bangumiIdentify(filename, mode.bangumiToken)
      return list.map((raw, index) => normalizeCandidate(raw, index))
    }

    const apiKey = (mode.tmdbApiKey || '').trim()
    if (!apiKey) throw new Error('未配置 TMDB API Key，请打开「配置…」填写后再刮削')
    const list = await native.tmdbIdentify(filename, kind, apiKey, mode.tmdbLang)
    return list.map((raw, index) => normalizeCandidate(raw, index))
  }

  const applyCandidate = (
    row: Row,
    candidate: Candidate,
    viaAI: boolean,
    confidence?: number
  ) => {
    setRows((prev) =>
      prev.map((item) =>
        item.uid === row.uid
          ? {
              ...item,
              status: 'done',
              progress: 100,
              code: candidate.code || candidate.id,
              title: candidate.title,
              src: candidate.source,
              year: candidate.year || item.year,
              ai: viaAI,
              aiConfidence: viaAI ? (confidence ?? candidate.score) : undefined,
              posterUrl: candidate.posterUrl || item.posterUrl,
              posterCrop:
                candidate.posterUrl && candidate.posterUrl !== item.posterUrl
                  ? undefined
                  : item.posterCrop,
              posterSrc:
                candidate.posterUrl && candidate.posterUrl !== item.posterUrl
                  ? undefined
                  : item.posterSrc,
              posterError: false,
              overview: candidate.overview || item.overview,
              score: candidate.score || item.score,
              maker: candidate.maker || item.maker,
              actors: candidate.actors || item.actors,
              dur:
                candidate.duration && candidate.duration > 0
                  ? Math.round(candidate.duration)
                  : item.dur,
              detailId: candidate.detailId || item.detailId,
              tags: candidate.tags ?? item.tags,
              releaseDate: candidate.releaseDate || item.releaseDate,
              director: candidate.director || item.director,
              series: candidate.series || item.series,
              mode: modeKey
            }
          : item
      )
    )
  }

  /** 记录后端扫描进度；提交由 flushScan 节流完成，避免逐文件重渲染。 */
  const applyScanProgress = (progress: ScanProgress) => {
    const state = scanRef.current
    if (!state) return
    scanRef.current = {
      ...state,
      phase: progress.phase,
      found: progress.found,
      dirs: progress.dirs,
      total: progress.total,
      done: progress.done,
      current: progress.current || state.current
    }
  }

  /** 把缓冲的扫描结果批量写入表格，并刷新进度条（约 5 次/秒）。 */
  const flushScan = () => {
    const buffer = scanBufferRef.current
    if (buffer.length) {
      scanBufferRef.current = []
      setRows((prev) => {
        const map = new Map(prev.filter((row) => row.path).map((row) => [row.path as string, row]))
        for (const file of buffer) {
          const existing = map.get(file.path)
          if (existing) {
            map.set(file.path, {
              ...existing,
              file: file.name,
              size: file.size,
              dur: existing.dur || (file.duration ? Math.round(file.duration) : 0)
            })
          } else {
            map.set(file.path, rowFromMedia(file))
          }
        }
        return [...map.values()]
      })
    }
    if (scanRef.current) setScan({ ...scanRef.current })
  }

  const scanFolder = async (target: string, options: { replace?: boolean } = {}) => {
    if (!target) return
    if (scanBusyRef.current) {
      message.info('正在扫描中，请稍候')
      return
    }

    scanBusyRef.current = true
    const replace = Boolean(options.replace)
    const previousRows = rows
    const started = performance.now()

    setTask('扫描中…')
    setNote('正在扫描…')
    setFilter('all')
    setSelected([])
    pushLog('info', `扫描目录 ${target}`)
    if (replace) setRows([])

    scanBufferRef.current = []
    scanRef.current = {
      active: true,
      phase: 'walk',
      found: 0,
      dirs: 0,
      total: 0,
      done: 0,
      current: '',
      startedAt: Date.now()
    }
    setScan({ ...scanRef.current })
    if (scanTimerRef.current != null) window.clearInterval(scanTimerRef.current)
    scanTimerRef.current = window.setInterval(flushScan, 200)

    try {
      const files = await native.scanFolder(target, true, {
        blacklist: blacklistRef.current,
        onProgress: applyScanProgress,
        onFiles: (batch) => {
          scanBufferRef.current.push(...batch)
        }
      })
      flushScan()

      const elapsed = Math.round(performance.now() - started)
      const ffprobe = files.filter((file) => file.probedBy === 'ffprobe').length
      const mp4 = files.filter((file) => file.probedBy === 'mp4').length
      const none = files.filter((file) => file.probedBy === 'none').length
      const bytes = files.reduce((sum, file) => sum + (file.size || 0), 0)

      if (replace) {
        const nextPaths = new Set(files.map((file) => file.path))
        const stalePaths = previousRows
          .filter((row) => row.path && !nextPaths.has(row.path))
          .map((row) => row.path as string)
        if (stalePaths.length) {
          void native
            .libraryRemove(stalePaths)
            .catch((error) => pushLog('warn', `清理旧记录失败：${errText(error)}`))
        }
        setRows(files.map(rowFromMedia))
      } else {
        setRows((prev) => {
          const map = new Map(prev.filter((row) => row.path).map((row) => [row.path as string, row]))
          for (const file of files) {
            const existing = map.get(file.path)
            if (existing) {
              map.set(file.path, {
                ...existing,
                file: file.name,
                size: file.size,
                dur: existing.dur || (file.duration ? Math.round(file.duration) : 0)
              })
            } else {
              map.set(file.path, rowFromMedia(file))
            }
          }
          return [...map.values()]
        })
      }
      setSelected([])
      setFilter('all')
      setNote(`已扫描 ${files.length} 个视频 · ${fmtSize(bytes)}`)
      pushLog('ok', `扫描完成：${files.length} 个视频，用时 ${elapsed} ms`)
      pushLog(
        'info',
        `时长来源：ffprobe ${ffprobe} · 内嵌 mvhd ${mp4} · 无法读取 ${none}`
      )
      if (none) pushLog('warn', `${none} 个文件无法读取时长，将显示 00:00:00`)
      const shorts = files.filter(
        (file) =>
          file.duration !== null &&
          file.duration > 0 &&
          file.duration < minDurRef.current * 60
      )
      if (shorts.length) {
        pushLog('warn', `检测到 ${shorts.length} 个短片（< ${minDurRef.current} 分钟）`)
      }
      message.success(`已扫描 ${files.length} 个视频`)
    } catch (error) {
      setRows([])
      setSelected([])
      setNote('扫描失败')
      pushLog('warn', `扫描失败：${errText(error)}`)
      message.error(`扫描失败：${errText(error)}`)
    } finally {
      if (scanTimerRef.current != null) {
        window.clearInterval(scanTimerRef.current)
        scanTimerRef.current = null
      }
      scanRef.current = null
      scanBufferRef.current = []
      scanBusyRef.current = false
      setScan((prev) => ({ ...prev, active: false }))
      setTask('空闲')
    }
  }

  // 目录选择弹窗由 native.pickFolder() 触发，选择结果通过 Promise 回传。
  useEffect(() => {
    registerFolderPicker((resolve) => {
      pickerResolveRef.current?.(null)
      pickerResolveRef.current = resolve
      setPickerInitial(folder)
      setPickerOpen(true)
    })
    return () => registerFolderPicker(null)
  }, [folder])

  const closeFolderPicker = (path: string | null) => {
    setPickerOpen(false)
    const resolve = pickerResolveRef.current
    pickerResolveRef.current = null
    resolve?.(path)
  }

  // 启动：app_info → load_settings → fetchPlugins → 自动扫描上次目录
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void (async () => {
      try {
        const info = await native.appInfo()
        setAppInfo(info)
        setNativeMode(native.mode)
        pushLog(
          'ok',
          `已连接 HTTP 后端 v${info.version} · ${info.platform} · ffprobe ${info.ffprobe ? '可用' : '不可用'}`
        )
      } catch (error) {
        setNativeMode(native.mode)
        pushLog('warn', `后端信息获取失败：${errText(error)}`)
      }

      let lastFolder = ''
      let savedModes: Record<string, ModeConfig> = {}
      try {
        const settings = await native.loadSettings()
        if (settings.ai) setAi(settings.ai)
        if (settings.modes) {
          const restored: Record<string, ModeConfig> = {}
          for (const [key, value] of Object.entries(settings.modes)) {
            if (!value || typeof value !== 'object') continue
            const config = value as ModeConfig
            if (!config.key || !config.name) continue
            restored[key] = INITIAL_MODES[key]
              ? { ...INITIAL_MODES[key], ...config }
              : config
          }
          savedModes = restored
          if (Object.keys(restored).length) setModes({ ...INITIAL_MODES, ...restored })
        }
        if (settings.lastFolder) {
          lastFolder = settings.lastFolder
          setFolder(lastFolder)
          setNote(`上次目录：${baseName(lastFolder)}`)
        }
        setMinDur(settings.minDur ?? 10)
        setCompact(Boolean(settings.compact))
        setHideShorts(settings.hideShorts ?? true)
        setLogOpen(settings.logOpen ?? true)
        setLogHeight(settings.logHeight ?? 180)
        const savedBlacklist = normalizeBlacklist(settings.blacklist ?? [])
        blacklistRef.current = savedBlacklist
        setBlacklist(savedBlacklist)
        canSaveRef.current = true
        pushLog('ok', '设置已加载')
      } catch (error) {
        pushLog('warn', `读取设置失败：${errText(error)}`)
      }

      let availableModes: Record<string, ModeConfig> = { ...INITIAL_MODES }
      try {
        const list = await fetchPlugins()
        if (list.length) {
          const map: Record<string, ModeConfig> = {}
          for (const plugin of list) {
            map[plugin.id] = mergeModeConfig(toModeConfig(plugin), savedModes[plugin.id])
          }
          availableModes = map
          setModes(map)
          setModeKey(list[0].id as ModeKey)
          setPluginSource('bun')
          pushLog('ok', `插件宿主已连接：${list.length} 个模式插件`)
        }
      } catch {
        setPluginSource('builtin')
        pushLog('warn', '插件宿主未连接，使用内置模式')
      }

      try {
        const stored = await native.libraryList()
        const stale = stored.filter((item) => item.file.toLowerCase().endsWith('.d.ts'))
        let repairedCount = 0
        const items = stored
          .filter((item) => !item.file.toLowerCase().endsWith('.d.ts'))
          .map((item) => {
            const isAv = item.mode === 'av' || item.mode === 'javdb'
            if (isAv && item.status === 'done' && isSuspiciousCode(item.code)) {
              repairedCount += 1
              return {
                ...item,
                status: 'unmatched',
                code: '',
                title: cleanFilename(item.file),
                src: '',
                year: undefined,
                maker: undefined,
                actors: undefined,
                overview: undefined,
                posterUrl: undefined,
                detailId: undefined,
                tags: []
              }
            }
            return item
          })
        if (stale.length) {
          void native
            .libraryRemove(stale.map((item) => item.path))
            .catch((error) => pushLog('warn', `清理旧媒体库记录失败：${errText(error)}`))
          pushLog('info', `已忽略 ${stale.length} 条旧的 .d.ts 媒体库记录`)
        }
        if (repairedCount) {
          void native
            .libraryUpsert(items)
            .catch((error) => pushLog('warn', `修复媒体库记录失败：${errText(error)}`))
          pushLog('warn', `已重置 ${repairedCount} 条可疑番号记录（录屏文件名误判）`)
        }
        if (items.length) {
          setRows((prev) => {
            const map = new Map(prev.filter((row) => row.path).map((row) => [row.path as string, row]))
            for (const item of items) {
              if (!map.has(item.path)) map.set(item.path, rowFromLibrary(item))
            }
            return [...map.values()]
          })
          const counts = new Map<string, number>()
          for (const item of items) counts.set(item.mode, (counts.get(item.mode) ?? 0) + 1)
          const recent = items[0]?.mode
          const dominant =
            recent && availableModes[recent]
              ? recent
              : [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
          if (dominant && availableModes[dominant]) setModeKey(dominant as ModeKey)
          pushLog('ok', `媒体库已加载：${items.length} 条记录`)
        }
      } catch (error) {
        pushLog('warn', `媒体库读取失败：${errText(error)}`)
      }

      setHydrated(true)
      if (lastFolder) void scanFolder(lastFolder)
    })()
  }, [])

  // 配置持久化（500ms 防抖）；演示模式不写设置文件。
  useEffect(() => {
    if (!hydrated || !canSaveRef.current) return
    if (skipSaveRef.current) {
      skipSaveRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      const settings: Settings = {
        ai,
        modes,
        lastFolder: folder || undefined,
        minDur,
        compact,
        hideShorts,
        logOpen,
        logHeight,
        blacklist
      }
      native
        .saveSettings(settings)
        .catch((error) => pushLog('warn', `保存设置失败：${errText(error)}`))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [ai, modes, folder, minDur, compact, hideShorts, logOpen, logHeight, blacklist, hydrated, nativeMode])

  // 媒体库持久化（800ms 防抖）；扫描与重置期间不落库。
  useEffect(() => {
    if (!hydrated || libraryPausedRef.current || scan.active) return
    const timer = window.setTimeout(() => {
      const items = rows
        .filter((row) => row.path && row.status !== 'running' && row.status !== 'waiting')
        .map((row) => libraryFromRow(row, modeKey))
      if (!items.length) return
      native
        .libraryUpsert(items)
        .catch((error) => pushLog('warn', `媒体库保存失败：${errText(error)}`))
    }, 800)
    return () => window.clearTimeout(timer)
  }, [rows, hydrated, nativeMode, modeKey, scan.active])

  // 黑名单命中的文件整行隐藏，不参与计数、刮削与清理。
  const allowedRows = useMemo(
    () => rows.filter((row) => !isBlacklisted(row.file, blacklist)),
    [rows, blacklist]
  )

  const shortRows = useMemo(
    () => allowedRows.filter((row) => isShort(row.dur, minDur)),
    [allowedRows, minDur]
  )

  const displayRows = useMemo(
    () => (hideShorts ? allowedRows.filter((row) => !isShort(row.dur, minDur)) : allowedRows),
    [allowedRows, hideShorts, minDur]
  )

  // 封面通过后端缓存后再显示，避免 WebView 直连图片站失败。
  useEffect(() => {
    if (!hydrated) return
    const pending = rows
      .filter((row) => row.posterUrl && !row.posterSrc && !row.posterError)
      .slice(0, 10)
    if (!pending.length) return

    let cancelled = false
    void Promise.all(
      pending.map(async (row) => {
        try {
          const src = row.posterCrop
            ? await native.coverCrop(row.posterUrl as string, row.posterCrop)
            : await native.coverSrc(row.posterUrl as string)
          if (!cancelled) patchRow(row.uid, { posterSrc: src, posterError: false })
        } catch {
          if (!cancelled) patchRow(row.uid, { posterError: true })
        }
      })
    )
    return () => {
      cancelled = true
    }
  }, [rows, hydrated, nativeMode])

  const counts = useMemo(
    () => ({
      all: displayRows.length,
      pending: displayRows.filter((r) => r.status === 'running' || r.status === 'waiting').length,
      review: displayRows.filter((r) => r.status === 'review').length,
      done: displayRows.filter((r) => r.status === 'done').length,
      unmatched: displayRows.filter((r) => r.status === 'unmatched').length
    }),
    [displayRows]
  )

  const visible = useMemo(
    () =>
      displayRows.filter((row) =>
        filter === 'all'
          ? true
          : filter === 'pending'
            ? row.status === 'running' || row.status === 'waiting'
            : filter === 'review'
              ? row.status === 'review'
              : filter === 'done'
                ? row.status === 'done'
                : row.status === 'unmatched'
      ),
    [displayRows, filter]
  )

  const totalSize = displayRows.reduce((sum, row) => sum + row.size, 0)

  const autoPickOrReview = async (
    row: Row,
    candidates: Candidate[]
  ): Promise<RowStatus> => {
    if (!(ai.enabled && ai.autoPick)) {
      patchRow(row.uid, { status: 'review', progress: 0, candidates })
      pushLog('info', `${row.file} 有 ${candidates.length} 条候选，等待手动选择`)
      return 'review'
    }

    patchRow(row.uid, { status: 'running', progress: 30, candidates })
    pushLog('info', `${row.file} 有 ${candidates.length} 条候选，交给 AI 选择`)
    try {
      const picked = await native.aiPick(ai, row.file, candidates)
      const candidate = candidates.find((item) => item.id === picked.pick)
      if (!candidate) {
        patchRow(row.uid, { status: 'review', progress: 0, candidates })
        pushLog('warn', `AI 返回未知候选「${picked.pick}」，保留待选择`)
        return 'review'
      }
      if (picked.confidence >= ai.autoPickThreshold) {
        applyCandidate(row, candidate, true, picked.confidence)
        pushLog(
          'ok',
          `AI 自动选择：${candidate.title}（${Math.round(picked.confidence * 100)}% · ${picked.ms} ms${picked.fallback ? ' · 回退' : ''}）`
        )
        return 'done'
      }
      patchRow(row.uid, { status: 'review', progress: 0, candidates })
      pushLog(
        'warn',
        `AI 置信度 ${Math.round(picked.confidence * 100)}% 低于阈值 ${Math.round(ai.autoPickThreshold * 100)}%，保留待选择`
      )
      return 'review'
    } catch (error) {
      patchRow(row.uid, { status: 'review', progress: 0, candidates })
      pushLog('warn', `AI 选择失败，保留待选择：${errText(error)}`)
      return 'review'
    }
  }

  const processRow = async (row: Row): Promise<RowStatus> => {
    patchRow(row.uid, { status: 'running', progress: 10 })
    pushLog('info', `开始识别：${row.file}`)
    const started = performance.now()
    let candidates: Candidate[] = []
    let fromPlugin = false
    const kind = providerKind()

    if (kind) {
      try {
        candidates = await identifyWithProvider(row.file)
        if (candidates.length) {
          fromPlugin = true
          pushLog('ok', `${mode.name} 匹配 ${candidates.length} 条：${row.file}`)
        }
      } catch (error) {
        patchRow(row.uid, { status: 'unmatched', progress: 0 })
        providerErrorRef.current = errText(error)
        pushLog('warn', `元数据源识别失败：${errText(error)}`)
        return 'unmatched'
      }
    }

    if (!fromPlugin && !kind && pluginSource === 'bun') {
      try {
        const response = await identifyWithPlugin(String(modeKey), row.file)
        candidates = (response.candidates || []).map((raw, index) =>
          normalizeCandidate(raw, index)
        )
        fromPlugin = candidates.length > 0
        pushLog('info', `插件返回 ${candidates.length} 条候选：${row.file}`)
      } catch (error) {
        pushLog('warn', `插件识别失败，回退 AI：${errText(error)}`)
      }
    }

    if (!fromPlugin && !kind) {
      try {
        const found = await native.javdbIdentify(row.file)
        candidates = found.map((raw, index) => normalizeCandidate(raw, index))
        if (candidates.length) {
          fromPlugin = true
          pushLog('ok', `JavDB 匹配 ${candidates.length} 条：${row.file}`)
        }
      } catch (error) {
        pushLog('warn', `JavDB 识别失败，回退 AI：${errText(error)}`)
      }
    }

    if (!fromPlugin) {
      try {
        const result = await native.aiIdentify(ai, row.file)
        const requireCode = ['av', 'javdb'].includes(modeKey as string)
        const usable = requireCode ? Boolean(result.code) : Boolean(result.code || result.title)
        candidates = usable ? [candidateFromAI(row, result)] : []
        if (requireCode && !result.code) {
          pushLog('warn', `AV 模式只接受番号，未从文件名识别到番号：${row.file}`)
        }
        pushLog(
          result.fallback ? 'info' : 'ok',
          `AI ${result.fallback ? '不可用，使用本地正则' : '识别完成'}：${row.file}（${result.ms} ms）`
        )
      } catch (error) {
        patchRow(row.uid, { status: 'unmatched', progress: 0 })
        pushLog('warn', `识别失败：${row.file} · ${errText(error)}`)
        return 'unmatched'
      }
    }

    const elapsed = Math.round(performance.now() - started)
    if (!candidates.length) {
      patchRow(row.uid, { status: 'unmatched', progress: 0 })
      pushLog('warn', `没有匹配结果：${row.file}（${elapsed} ms）`)
      return 'unmatched'
    }

    if (candidates.length === 1) {
      const candidate = candidates[0]
      applyCandidate(row, candidate, !fromPlugin, candidate.score)
      pushLog(
        'ok',
        `${row.file} → ${candidate.title}${candidate.code ? `（${candidate.code}）` : ''} · ${elapsed} ms`
      )
      return 'done'
    }

    patchRow(row.uid, { status: 'review', progress: 0, candidates, query: row.title })
    return autoPickOrReview(row, candidates)
  }

  const startScrape = async () => {
    if (!folder && !rows.some((row) => row.path)) {
      message.warning('请先选择文件夹')
      return
    }
    if (task !== '空闲') {
      message.info('当前有任务进行中')
      return
    }
    const inMode = (row: Row) => !row.mode || row.mode === modeKey
    const scrapeRows = displayRows
    const pending = scrapeRows.filter((row) => row.status === 'unmatched' && inMode(row))
    const reviews = scrapeRows.filter((row) => row.status === 'review' && inMode(row))
    if (!pending.length && !reviews.length) {
      message.info('没有待处理的文件')
      return
    }

    const total = pending.length + reviews.length
    let index = 0
    let done = 0
    providerErrorRef.current = ''
    setTask(`刮削中 0/${total}`)
    pushLog('info', `开始刮削：${total} 个文件`)
    if (pending.length) {
      setRows((prev) =>
        prev.map((row) =>
          pending.some((item) => item.uid === row.uid)
            ? { ...row, status: 'waiting', progress: 0 }
            : row
        )
      )
    }

    for (const row of pending) {
      const status = await processRow(row)
      if (status === 'done') done += 1
      index += 1
      setTask(`刮削中 ${index}/${total}`)
    }

    for (const row of reviews) {
      if (!row.candidates?.length) {
        patchRow(row.uid, { status: 'unmatched', progress: 0 })
        index += 1
        setTask(`刮削中 ${index}/${total}`)
        continue
      }
      const status = await autoPickOrReview(row, row.candidates)
      if (status === 'done') done += 1
      index += 1
      setTask(`刮削中 ${index}/${total}`)
    }

    setTask('空闲')
    if (done) {
      setNote(`刮削结束：完成 ${done} / 共 ${total}`)
      message.success(`刮削完成：${done} 个文件`)
    } else if (providerErrorRef.current) {
      setNote(providerErrorRef.current)
      message.warning(providerErrorRef.current)
    } else {
      setNote(`刮削结束：完成 0 / 共 ${total}`)
      message.info('刮削结束，没有自动完成的文件')
    }
  }

  const aiIdentifyRow = async (row: Row) => {
    if (task !== '空闲') {
      message.info('当前有任务进行中')
      return
    }
    setTask('AI 识别中…')
    patchRow(row.uid, { status: 'running', progress: 20 })
    pushLog('info', `识别：${row.file}`)
    const kind = providerKind()
    try {
      if (kind) {
        try {
          const found = await identifyWithProvider(row.file)
          if (found.length) {
            const candidate = found[0]
            applyCandidate(row, candidate, false, candidate.score)
            pushLog('ok', `${mode.name} 匹配：${candidate.title}`)
            message.success(`${mode.name} 匹配：${candidate.title}`)
            return
          }
        } catch (error) {
          pushLog('warn', `元数据源识别失败，回退 AI：${errText(error)}`)
        }
      }

      if (!kind) {
        try {
          const found = await native.javdbIdentify(row.file)
          if (found.length) {
            const candidate = normalizeCandidate(found[0], 0)
            applyCandidate(row, candidate, false, candidate.score)
            pushLog('ok', `JavDB 匹配：${candidate.code || candidate.title}（未调用 AI）`)
            message.success(`JavDB 匹配：${candidate.title}`)
            return
          }
        } catch (error) {
          pushLog('warn', `JavDB 识别失败，回退 AI：${errText(error)}`)
        }
      }

      pushLog(
        'info',
        ai.enabled ? 'JavDB 未匹配，调用 AI 模型' : 'JavDB 未匹配，AI 已关闭，使用本地正则'
      )
      const result = await native.aiIdentify(ai, row.file)
      const requireCode = ['av', 'javdb'].includes(modeKey as string)
      const missing = requireCode ? !result.code : !result.code && !result.title
      if (missing) {
        patchRow(row.uid, { status: 'unmatched', progress: 0 })
        pushLog('warn', `AI 未识别到番号：${row.file}`)
        message.warning(
          requireCode ? 'AV 模式只接受番号，未能从文件名识别出番号' : 'AI 未能从文件名识别出番号'
        )
        return
      }
      applyCandidate(row, candidateFromAI(row, result), true, result.confidence)
      if (result.fallback) {
        pushLog(
          'info',
          `本地正则识别（未调用 AI 模型）：${result.code || result.title} · ${result.ms} ms`
        )
        message.success(`本地正则识别：${result.code || result.title}`)
      } else {
        pushLog(
          'ok',
          `AI 模型识别：${result.code || result.title}（${Math.round(result.confidence * 100)}% · ${result.ms} ms）`
        )
        message.success(`AI 模型识别：${result.code || result.title}`)
      }
    } catch (error) {
      patchRow(row.uid, { status: 'unmatched', progress: 0 })
      pushLog('warn', `AI 识别失败：${row.file} · ${errText(error)}`)
      message.error(`AI 识别失败：${errText(error)}`)
    } finally {
      setTask('空闲')
    }
  }

  const saveAI = (config: AIConfig) => {
    setAi(config)
    setAiOpen(false)
    pushLog(
      config.enabled ? 'ok' : 'warn',
      config.enabled ? `AI 已启用：${config.provider} · ${config.model}` : 'AI 已关闭，使用正则解析'
    )
    message.success('AI 设置已保存')
  }

  const confirmCandidate = (
    row: Row,
    candidate: Candidate,
    viaAI: boolean,
    confidence?: number
  ) => {
    applyCandidate(row, candidate, viaAI, confidence)
    setReviewRow(null)
    pushLog(
      'ok',
      `${viaAI ? 'AI 选择' : '手动选择'}：${candidate.title}（${candidate.year}）`
    )
    message.success(`已匹配：${candidate.title}`)
  }

  const trashRows = async (targets: Row[], label: string) => {
    const entries = targets
      .map((row) => ({ row, path: filePath(row) }))
      .filter((entry) => Boolean(entry.path))
    if (!entries.length) {
      message.warning('缺少文件路径，无法删除')
      return
    }
    if (entries.length !== targets.length) {
      pushLog('warn', `${targets.length - entries.length} 个文件缺少路径，已跳过`)
    }

    setTask(`${label}…`)
    try {
      const result = await native.trash(entries.map((entry) => entry.path))
      const failed = new Map(result.failed.map((item) => [item.path, item.error]))
      const removedUids: number[] = []
      const removedPaths: string[] = []

      for (const entry of entries) {
        const reason = failed.get(entry.path)
        if (reason) {
          pushLog('warn', `删除失败 ${entry.row.file}：${reason}`)
        } else {
          removedUids.push(entry.row.uid)
          removedPaths.push(entry.path)
        }
      }

      if (removedUids.length) {
        setRows((prev) => prev.filter((row) => !removedUids.includes(row.uid)))
        setSelected((prev) => prev.filter((key) => !removedUids.includes(Number(key))))
        void native
          .libraryRemove(removedPaths)
          .catch((error) => pushLog('warn', `媒体库同步失败：${errText(error)}`))
        pushLog('warn', `${label}：已将 ${removedUids.length} 个文件移入回收站`)
      }

      if (result.failed.length) {
        setNote(`${label}：成功 ${removedUids.length}，失败 ${result.failed.length}`)
        message.warning(
          `已删除 ${removedUids.length} 个，${result.failed.length} 个失败（详见日志）`
        )
      } else {
        setNote(`${label}：已移入回收站 ${removedUids.length} 个文件`)
        message.success(`已删除 ${removedUids.length} 个文件`)
      }
    } catch (error) {
      pushLog('warn', `${label}失败：${errText(error)}`)
      setNote(`${label}失败`)
      message.error(`${label}失败：${errText(error)}`)
    } finally {
      setTask('空闲')
    }
  }

  const cleanShorts = () => {
    const shorts = shortRows
    if (!shorts.length) {
      message.info('没有符合条件的文件')
      return
    }
    setCleanSelected(shorts.map((row) => row.uid))
    setCleanOpen(true)
  }

  const deleteSelected = () => {
    if (!selected.length) {
      message.info('没有选中文件')
      return
    }
    const targets = allowedRows.filter((row) => selected.includes(row.uid))
    if (!targets.length) {
      message.info('没有选中文件')
      return
    }
    modal.confirm({
      title: '删除所选',
      content: `将把选中的 ${targets.length} 个文件移到回收站。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => trashRows(targets, '删除所选')
    })
  }

  const removeRow = (row: Row) => {
    modal.confirm({
      title: '移除文件',
      content: `将把 ${row.code || row.title} 移到回收站，可从回收站恢复。`,
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => trashRows([row], '移除文件')
    })
  }

  /** 就地更新黑名单（含 ref，保证正在进行的扫描立即使用最新规则）。 */
  const applyBlacklist = (patterns: string[]) => {
    const next = normalizeBlacklist(patterns)
    blacklistRef.current = next
    setBlacklist(next)
    // 取消勾选已被隐藏的行，避免状态栏「已选」与实际可见行不一致。
    setSelected((prev) =>
      prev.filter((key) => {
        const row = rows.find((item) => item.uid === key)
        return !row || !isBlacklisted(row.file, next)
      })
    )
    return next
  }

  const saveBlacklist = (patterns: string[]) => {
    const next = applyBlacklist(patterns)
    setBlacklistOpen(false)
    const hidden = rows.filter((row) => isBlacklisted(row.file, next)).length
    pushLog(
      'info',
      `文件名黑名单已保存：${next.length} 条${hidden ? `，当前隐藏 ${hidden} 个文件` : ''}`
    )
    message.success(
      next.length
        ? `黑名单已保存（${next.length} 条），命中的文件已隐藏`
        : '黑名单已清空'
    )
  }

  /** 右键「拉黑此文件名」：按完整文件名添加规则，只隐藏不删除。 */
  const blacklistRow = (row: Row) => {
    const existed = isBlacklisted(row.file, blacklist)
    const next = applyBlacklist([...blacklist, row.file])
    setSelected((prev) => prev.filter((key) => key !== row.uid))
    if (!existed) pushLog('warn', `拉黑文件名：${row.file}`)
    message.success(
      existed
        ? `「${row.file}」已在黑名单中`
        : `已拉黑「${row.file}」，列表中已隐藏（不会删除文件）`
    )
    return next
  }

  const runOrganize = async (options: OrganizeOptions) => {
    const done = allowedRows.filter((row) => row.status === 'done')
    if (!done.length) {
      message.info('没有可整理的文件')
      return
    }
    if (!options.dest) {
      message.warning('请选择目标目录')
      return
    }

    setModes((prev) => ({
      ...prev,
      [modeKey]: { ...prev[modeKey], organize: options.tpl }
    }))

    const wantNfo = mode.downloads.some((item) => item.on && item.label === 'NFO')
    const wantCover = mode.downloads.some((item) => item.on && item.label === '封面')
    const items = done
      .map((row) => ({
        row,
        source: filePath(row),
        relativeTarget: withExt(buildPath(options.tpl, row)),
        nfo: wantNfo ? buildNfo(row, mode.name) : undefined,
        posterUrl: wantCover ? row.posterUrl : undefined,
        posterCrop: wantCover ? row.posterCrop : undefined
      }))
      .filter((item) => Boolean(item.source))

    if (!items.length) {
      message.warning('缺少源文件路径，无法整理')
      return
    }

    const request: OrganizeRequest = {
      dest: options.dest,
      action: options.action,
      conflict: options.conflict,
      removeEmptyDirs: options.rmEmpty,
      items: items.map((item) => ({
        source: item.source,
        relativeTarget: item.relativeTarget,
        nfo: item.nfo,
        posterUrl: item.posterUrl,
        posterCrop: item.posterCrop
      }))
    }

    setTask('整理中…')
    setNote(`正在整理 ${items.length} 个文件…`)
    pushLog('info', `整理 ${items.length} 个文件 → ${options.dest}`)

    try {
      const results = await native.organize(request)
      const bySource = new Map(items.map((item) => [item.source, item.row]))
      const moved = new Map<string, string>()
      let ok = 0
      let skipped = 0
      let failed = 0

      for (const result of results) {
        const row = bySource.get(result.source)
        const name = row?.file || baseName(result.source)
        if (result.ok && result.skipped) {
          skipped += 1
          pushLog('info', `已存在，跳过：${name}`)
        } else if (result.ok) {
          ok += 1
          moved.set(result.source, result.target)
          pushLog('ok', `${name} → ${result.target}`)
          if (result.warning) pushLog('warn', `${name} 附属文件：${result.warning}`)
        } else {
          failed += 1
          pushLog('warn', `整理失败 ${name}：${result.error || '未知错误'}`)
        }
      }

      if (results.length < items.length) {
        pushLog('warn', `${items.length - results.length} 项没有返回整理结果`)
      }

      if (moved.size && options.action === 'move') {
        setRows((prev) =>
          prev.map((row) => {
            const next = row.path ? moved.get(row.path) : undefined
            return next ? { ...row, path: next } : row
          })
        )
      }

      setNote(`整理完成：成功 ${ok} · 跳过 ${skipped} · 失败 ${failed}`)
      if (failed) {
        message.warning(`整理完成，${failed} 项失败（详见日志）`)
      } else {
        message.success(`已整理 ${ok} 个文件，跳过 ${skipped} 个`)
        setOrganizeOpen(false)
      }
    } catch (error) {
      pushLog('warn', `整理失败：${errText(error)}`)
      setNote('整理失败')
      message.error(`整理失败：${errText(error)}`)
    } finally {
      setTask('空闲')
    }
  }

  const saveConfig = (config: ModeConfig) => {
    setModes((prev) => ({ ...prev, [modeKey]: config }))
    setConfigOpen(false)
    pushLog('ok', `${config.name}配置已保存`)
    message.success(`${config.name}配置已保存`)
  }

  const openModeSettings = () => {
    const usesNativeProvider =
      modeKey === 'movie' || modeKey === 'tv' || modeKey === 'anime'
    if (usesNativeProvider || !mode.settingsUrl) setConfigOpen(true)
    else setPluginSettingsOpen(true)
  }

  const applyPluginConfig = (patch: Partial<ModeConfig>) => {
    setModes((prev) => ({ ...prev, [modeKey]: { ...prev[modeKey], ...patch } }))
    setPluginSettingsOpen(false)
    pushLog('ok', `${mode.name} 插件配置已保存`)
    message.success('插件配置已保存')
  }

  const switchMode = (next: ModeKey) => {
    setModeKey(next)
    const cfg = modes[next]
    pushLog(
      'info',
      `切换模式：${cfg.name}（${cfg.sources
        .filter((source) => source.on)
        .map((source) => source.label)
        .join(', ')}）`
    )
    message.success(`已切换到${cfg.name}模式`)
  }

  const pickFolder = async () => {
    if (task !== '空闲') {
      message.info('当前有任务进行中')
      return
    }
    try {
      const picked = await native.pickFolder()
      if (!picked) return
      setFolder(picked)
      await scanFolder(picked, { replace: true })
    } catch (error) {
      pushLog('warn', `选择文件夹失败：${errText(error)}`)
      message.error(`选择文件夹失败：${errText(error)}`)
    }
  }

  const applyCoverCrop = (row: Row, crop: CropRect, src: string) => {
    patchRow(row.uid, { posterCrop: crop, posterSrc: src, posterError: false })
    setPosterRow((prev) =>
      prev && prev.uid === row.uid
        ? { ...prev, posterCrop: crop, posterSrc: src, posterError: false }
        : prev
    )
    setCropRow(null)
    pushLog('ok', `已手动裁剪封面：${row.code || row.file}`)
  }

  const resetCoverCrop = async (row: Row) => {
    if (!row.posterUrl) return
    try {
      const src = await native.coverSrc(row.posterUrl)
      patchRow(row.uid, { posterCrop: undefined, posterSrc: src, posterError: false })
      setPosterRow((prev) =>
        prev && prev.uid === row.uid
          ? { ...prev, posterCrop: undefined, posterSrc: src, posterError: false }
          : prev
      )
      pushLog('info', `已恢复完整封面：${row.code || row.file}`)
    } catch (error) {
      pushLog('warn', `恢复完整封面失败：${errText(error)}`)
      message.error(`恢复完整封面失败：${errText(error)}`)
    }
  }

  /** 详情弹窗打开时按需拉取磁力；JavDB / AV 之外的插件没有磁力。 */
  const loadMagnets = async (row: Row) => {
    if (!row.detailId) return
    const pluginId = [row.mode, String(modeKey)].find(
      (id) => id === 'av' || id === 'javdb'
    )
    if (!pluginId) return
    const apply = (patch: Partial<Row>) => {
      patchRow(row.uid, patch)
      setPosterRow((prev) => (prev && prev.uid === row.uid ? { ...prev, ...patch } : prev))
    }
    apply({ magnetsLoading: true, magnetsError: undefined })
    try {
      const detail = await resolveWithPlugin(pluginId, `javdb:${row.detailId}`)
      apply({
        magnets: normalizeMagnets(detail.magnets),
        magnetsLoading: false,
        magnetsError: undefined
      })
    } catch (error) {
      apply({ magnetsLoading: false, magnetsError: errText(error) })
    }
  }

  const openPoster = (row: Row) => {
    setPosterRow(row)
    if (!row.magnets && !row.magnetsLoading) void loadMagnets(row)
  }

  const openRow = async (row: Row) => {
    const target = filePath(row)
    if (!target) {
      message.warning('缺少文件路径')
      return
    }
    try {
      await native.openPath(target)
      pushLog('info', `打开文件：${target}`)
    } catch (error) {
      pushLog('warn', `打开失败：${errText(error)}`)
      message.error(`打开失败：${errText(error)}`)
    }
  }

  const revealRow = async (row: Row) => {
    const target = filePath(row)
    if (!target) {
      message.warning('缺少文件路径')
      return
    }
    try {
      await native.revealPath(target)
      pushLog('info', `在文件夹中显示：${target}`)
    } catch (error) {
      pushLog('warn', `显示失败：${errText(error)}`)
      message.error(`显示失败：${errText(error)}`)
    }
  }

  const rescanRow = async (row: Row) => {
    if (task !== '空闲') {
      message.info('当前有任务进行中')
      return
    }
    pushLog('info', `重新刮削：${row.file}`)
    patchRow(row.uid, { status: 'unmatched', progress: 0, candidates: undefined })
    setTask('刮削中 1/1')
    const status = await processRow({ ...row, status: 'unmatched', candidates: undefined })
    setTask('空闲')
    setNote(
      status === 'done'
        ? `重新刮削完成：${row.file}`
        : status === 'review'
          ? `重新刮削：${row.file} 有多个结果待选择`
          : `重新刮削：${row.file} 未匹配`
    )
  }

  const openManualMatch = (row: Row) => {
    setManualRow(row)
    setManualQuery(row.query || row.title || row.file)
  }

  const runManualMatch = async () => {
    const target = manualRow
    const keyword = manualQuery.trim()
    if (!target || !keyword) return
    if (task !== '空闲') {
      message.info('当前有任务进行中')
      return
    }

    setManualBusy(true)
    setTask('重新识别…')
    try {
      let candidates: Candidate[] = []
      let fromPlugin = false
      const kind = providerKind()

      if (kind) {
        try {
          candidates = await identifyWithProvider(keyword)
          fromPlugin = candidates.length > 0
        } catch (error) {
          pushLog('warn', `元数据源识别失败，回退 AI：${errText(error)}`)
        }
      }

      if (!fromPlugin && !kind && pluginSource === 'bun') {
        try {
          const response = await identifyWithPlugin(String(modeKey), keyword, true)
          candidates = (response.candidates || []).map((raw, index) =>
            normalizeCandidate(raw, index)
          )
          fromPlugin = true
        } catch (error) {
          pushLog('warn', `插件识别失败，回退 AI：${errText(error)}`)
        }
      }
      if (!fromPlugin && !kind) {
        try {
          const found = await native.javdbIdentify(keyword, true)
          candidates = found.map((raw, index) => normalizeCandidate(raw, index))
          fromPlugin = candidates.length > 0
        } catch (error) {
          pushLog('warn', `JavDB 识别失败，回退 AI：${errText(error)}`)
        }
      }
      if (!fromPlugin) {
        const result = await native.aiIdentify(ai, keyword)
        candidates = result.code || result.title ? [candidateFromAI(target, result)] : []
      }

      if (!candidates.length) {
        pushLog('warn', `手动匹配无结果：${keyword}`)
        message.warning('没有找到匹配结果')
        return
      }

      const nextRow: Row = {
        ...target,
        status: 'review',
        progress: 0,
        candidates,
        query: keyword
      }
      setRows((prev) => prev.map((row) => (row.uid === target.uid ? nextRow : row)))
      setReviewRow(nextRow)
      setManualRow(null)
      pushLog('ok', `手动匹配「${keyword}」返回 ${candidates.length} 条候选`)
    } catch (error) {
      pushLog('warn', `手动匹配失败：${errText(error)}`)
      message.error(`手动匹配失败：${errText(error)}`)
    } finally {
      setManualBusy(false)
      setTask('空闲')
    }
  }

  const reloadPluginHost = async () => {
    try {
      const result = await reloadPlugins()
      const list = await fetchPlugins()
      const map: Record<string, ModeConfig> = {}
      for (const plugin of list) {
        map[plugin.id] = mergeModeConfig(toModeConfig(plugin), modes[plugin.id])
      }
      if (Object.keys(map).length) {
        setModes(map)
        if (!map[modeKey]) setModeKey(Object.keys(map)[0] as ModeKey)
      }
      setPluginSource('bun')
      pushLog('ok', `插件已重载：${result.count} 个`)
      message.success(`插件已重载（${result.count}）`)
    } catch (error) {
      setPluginSource('builtin')
      pushLog('warn', `插件重载失败：${errText(error)}`)
      message.error('插件宿主未连接')
    }
  }

  const startLogResize = (event: React.MouseEvent) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = logHeight
    const min = 90
    const max = Math.round(window.innerHeight * 0.65)
    const onMove = (move: MouseEvent) => {
      const next = Math.min(max, Math.max(min, startHeight + startY - move.clientY))
      setLogHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
    }
    document.body.style.cursor = 'ns-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const resetLibrary = async (rescan: boolean) => {
    if (resetBusyRef.current) return
    resetBusyRef.current = true
    const target = folder
    libraryPausedRef.current = true
    try {
      await native.libraryClear()
      setRows([])
      setSelected([])
      setFilter('all')
      setNote('媒体库已清空')
      pushLog('warn', '已清空媒体库记录（不会删除任何文件）')
      libraryPausedRef.current = false

      if (rescan) {
        if (!target) {
          message.warning('已清空列表，但没有可重新导入的文件夹')
          return
        }
        await scanFolder(target, { replace: true })
        message.success('已重置并重新导入文件夹')
      } else {
        setFolder('')
        message.success('列表已清空')
      }
    } catch (error) {
      pushLog('warn', `重置媒体库失败：${errText(error)}`)
      message.error(`重置媒体库失败：${errText(error)}`)
    } finally {
      libraryPausedRef.current = false
      resetBusyRef.current = false
    }
  }

  const confirmClearLibrary = () => {
    modal.confirm({
      title: '清空列表',
      content: '将清空媒体库中的全部记录，并取消当前文件夹选择（不会删除任何文件）。',
      okText: '清空',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => resetLibrary(false)
    })
  }

  const confirmReimport = () => {
    if (!folder) {
      message.warning('请先选择文件夹')
      return
    }
    modal.confirm({
      title: '重置并重新导入',
      content: `将清空媒体库记录并重新扫描：${folder}（不会删除任何文件）。`,
      okText: '重置并导入',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => resetLibrary(true)
    })
  }

  const handleMenu = (key: string) => {
    switch (key) {
      case 'pick':
        void pickFolder()
        break
      case 'rescan':
        if (!folder && !rows.some((row) => row.path)) message.warning('请先选择文件夹')
        else if (task !== '空闲') message.info('当前有任务进行中')
        else if (folder) void scanFolder(folder)
        else message.info('媒体库行没有关联目录，请使用「选择文件夹」重新扫描')
        break
      case 'clean':
        cleanShorts()
        break
      case 'organize':
        setOrganizeOpen(true)
        break
      case 'config':
        setConfigOpen(true)
        break
      case 'ai':
        setAiOpen(true)
        break
      case 'blacklist':
        setBlacklistOpen(true)
        break
      case 'reloadPlugins':
        void reloadPluginHost()
        break
      case 'selectAll':
        setSelected(visible.map((row) => row.uid))
        break
      case 'unselect':
        setSelected([])
        break
      case 'delete':
        deleteSelected()
        break
      case 'log':
        setLogOpen((value) => !value)
        break
      case 'compact':
        setCompact((value) => !value)
        break
      case 'quit':
        message.info('当前运行在浏览器中，请直接关闭标签页')
        break
      case 'clearLibrary':
        confirmClearLibrary()
        break
      case 'reimport':
        confirmReimport()
        break
      case 'about':
        message.info(
          `刮削器 ${appInfo?.version ?? '0.1.0'} · HTTP 后端`
        )
        break
      default:
        break
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      const typing = tag === 'INPUT' || tag === 'TEXTAREA'
      if (e.key === 'Escape') {
        setCtx(null)
        setPosterRow(null)
        setReviewRow(null)
        setManualRow(null)
        setOrganizeOpen(false)
        setConfigOpen(false)
        setAiOpen(false)
        setBlacklistOpen(false)
        setPluginSettingsOpen(false)
        return
      }
      if (typing) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSelected(visible.map((row) => row.uid))
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        if (folder) setOrganizeOpen(true)
      }
      if (e.key === 'Delete') deleteSelected()
      if (e.key === 'F5') {
        e.preventDefault()
        if (!folder) message.warning('请先选择文件夹')
        else if (task !== '空闲') message.info('当前有任务进行中')
        else void scanFolder(folder)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="app">
      <TitleBar subtitle={folder ? baseName(folder) : '未选择目录'} />
      <MenuBar onAction={handleMenu} />
      <Toolbar
        path={folder}
        busy={task !== '空闲'}
        onPick={() => void pickFolder()}
        onOrganize={() => setOrganizeOpen(true)}
        onStart={() => void startScrape()}
        onAI={() => setAiOpen(true)}
      />
      <ModeBar
        mode={modeKey}
        modes={Object.values(modes)}
        config={mode}
        pluginSource={pluginSource}
        onChange={switchMode}
        onConfig={openModeSettings}
      />
      <FilterBar
        filter={filter}
        counts={counts}
        minDur={minDur}
        hideShorts={hideShorts}
        hiddenShortCount={shortRows.length}
        onFilter={setFilter}
        onMinDur={setMinDur}
        onHideShorts={setHideShorts}
        onClearLibrary={confirmClearLibrary}
        onReimport={confirmReimport}
        onClean={cleanShorts}
        blacklistCount={blacklist.length}
        onBlacklist={() => setBlacklistOpen(true)}
      />

      <ScanProgressBar scan={scan} path={folder} />

      <div ref={wrapRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FileTable
          rows={visible}
          mode={mode}
          minDur={minDur}
          selected={selected}
          height={tableH}
          compact={compact}
          scanning={scan.active}
          scanFound={scan.found}
          onSelectedChange={setSelected}
          onPoster={openPoster}
          onRemove={removeRow}
          onMatch={(row) => void aiIdentifyRow(row)}
          onReview={setReviewRow}
          onContext={(e, row) => setCtx({ x: e.clientX, y: e.clientY, row })}
        />
      </div>

      {logOpen && (
        <LogPanel
          logs={logs}
          height={logHeight}
          onResizeStart={startLogResize}
          onClose={() => setLogOpen(false)}
          onClear={() => setLogs([])}
        />
      )}

      <StatusBar
        modeName={mode.name}
        count={displayRows.length}
        selected={selected.length}
        size={fmtSize(totalSize)}
        note={note}
        task={task}
        aiEnabled={ai.enabled}
        aiModel={ai.model}
        ffprobe={appInfo?.ffprobe ?? false}
        nativeMode={nativeMode}
      />

      <OrganizeModal
        open={organizeOpen}
        config={mode}
        rows={allowedRows}
        onCancel={() => setOrganizeOpen(false)}
        onRun={runOrganize}
      />
      <ConfigModal
        open={configOpen}
        config={mode}
        onCancel={() => setConfigOpen(false)}
        onSave={saveConfig}
      />
      <AIConfigModal
        open={aiOpen}
        config={ai}
        onCancel={() => setAiOpen(false)}
        onSave={saveAI}
      />
      <BlacklistModal
        open={blacklistOpen}
        patterns={blacklist}
        onCancel={() => setBlacklistOpen(false)}
        onSave={saveBlacklist}
      />
      <PluginSettingsModal
        open={pluginSettingsOpen}
        mode={mode}
        onClose={() => setPluginSettingsOpen(false)}
        onSaved={applyPluginConfig}
      />
      <CandidateModal
        row={reviewRow}
        config={ai}
        onCancel={() => setReviewRow(null)}
        onConfirm={confirmCandidate}
      />
      <PosterModal
        row={posterRow}
        onClose={() => setPosterRow(null)}
        onCrop={(row) => setCropRow(row)}
        onReset={(row) => void resetCoverCrop(row)}
      />
      <CoverCropModal
        row={cropRow}
        onCancel={() => setCropRow(null)}
        onApply={applyCoverCrop}
      />

      <Modal
        open={cleanOpen}
        title={`清理短片（${shortRows.length}）`}
        width={640}
        okText={cleanSelected.length ? `清理 ${cleanSelected.length} 个` : '清理'}
        okButtonProps={{ danger: true, disabled: !cleanSelected.length }}
        cancelText="取消"
        onCancel={() => setCleanOpen(false)}
        onOk={() => {
          const targets = shortRows.filter((row) => cleanSelected.includes(row.uid))
          setCleanOpen(false)
          if (targets.length) void trashRows(targets, '清理短片')
        }}
      >
        <div className="clean-summary">
          时长小于 <b>{minDur}</b> 分钟的短片共 <b>{shortRows.length}</b> 个，合计{' '}
          <b>{fmtSize(shortRows.reduce((sum, row) => sum + row.size, 0))}</b>
          。删除后进入回收站，可恢复。
        </div>
        <div className="clean-toolbar">
          <Checkbox
            checked={shortRows.length > 0 && cleanSelected.length === shortRows.length}
            indeterminate={
              cleanSelected.length > 0 && cleanSelected.length < shortRows.length
            }
            onChange={(event) =>
              setCleanSelected(event.target.checked ? shortRows.map((row) => row.uid) : [])
            }
          >
            全选
          </Checkbox>
          <span className="muted">
            已选 {cleanSelected.length} / {shortRows.length}
          </span>
        </div>
        <div className="clean-list">
          {shortRows.map((row) => (
            <label className="clean-item" key={row.uid}>
              <Checkbox
                checked={cleanSelected.includes(row.uid)}
                onChange={(event) =>
                  setCleanSelected((prev) =>
                    event.target.checked
                      ? [...prev, row.uid]
                      : prev.filter((key) => key !== row.uid)
                  )
                }
              />
              <span className="name" title={row.path || row.file}>
                {row.file}
              </span>
              <span className="meta">{fmtDur(row.dur)}</span>
              <span className="meta">{fmtSize(row.size)}</span>
            </label>
          ))}
        </div>
      </Modal>

      <Modal
        open={!!manualRow}
        title="手动匹配"
        okText="重新识别"
        cancelText="取消"
        confirmLoading={manualBusy}
        okButtonProps={{ disabled: !manualQuery.trim() }}
        onCancel={() => setManualRow(null)}
        onOk={() => void runManualMatch()}
      >
        <div className="field">
          <label>关键词</label>
          <Input
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            placeholder="片名、番号或文件名"
            onPressEnter={() => void runManualMatch()}
            style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
          />
        </div>
        <div className="ai-hint">
          将使用关键词重新调用当前模式的插件 / AI 识别，结果会显示在候选列表中。
        </div>
      </Modal>

      <FolderPickerModal
        open={pickerOpen}
        initialPath={pickerInitial}
        onCancel={() => closeFolderPicker(null)}
        onSelect={(path) => closeFolderPicker(path)}
      />

      {ctx && (
        <>
          <div
            className="ctx-overlay"
            onClick={() => setCtx(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setCtx(null)
            }}
          />
          <div
            className="ctx"
            style={{
              left: Math.min(ctx.x, window.innerWidth - 190),
              top: Math.min(ctx.y, window.innerHeight - 210)
            }}
          >
            <Menu
              selectable={false}
              items={[
                { key: 'open', label: '打开文件' },
                { key: 'reveal', label: '在文件夹中显示' },
                { type: 'divider' },
                { key: 'blacklist', label: '拉黑此文件名' },
                { key: 'rescan', label: '重新刮削' },
                ...(ctx.row.status === 'unmatched'
                  ? [{ key: 'match', label: '手动匹配…' }]
                  : []),
                ...(ctx.row.status === 'review'
                  ? [{ key: 'review', label: '选择结果…' }]
                  : []),
                { type: 'divider' },
                { key: 'delete', label: '删除', danger: true }
              ]}
              onClick={({ key }) => {
                const row = ctx.row
                setCtx(null)
                if (key === 'delete') removeRow(row)
                else if (key === 'blacklist') blacklistRow(row)
                else if (key === 'match') openManualMatch(row)
                else if (key === 'review') setReviewRow(row)
                else if (key === 'rescan') void rescanRow(row)
                else if (key === 'open') void openRow(row)
                else if (key === 'reveal') void revealRow(row)
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}

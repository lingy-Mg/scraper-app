import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const VIDEO_EXT = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.mkv',
  '.avi',
  '.wmv',
  '.ts',
  '.m2ts',
  '.flv',
  '.webm'
])

const MP4_EXT = new Set(['.mp4', '.m4v', '.mov'])

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

/** 兼容旧命名 */
export type ScannedFile = MediaFile

export interface FfprobeInfo {
  duration: number | null
  width: number | null
  height: number | null
  videoCodec: string | null
}

let ffprobeCache: { value: string | null } | null = null

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * ffprobe 查找顺序：PATH → 可执行文件同目录 → src-tauri/binaries/。
 * 结果缓存，避免每次扫描都重复探测。
 */
export function findFfprobe(): string | null {
  if (ffprobeCache) return ffprobeCache.value
  ffprobeCache = { value: locateFfprobe() }
  return ffprobeCache.value
}

function locateFfprobe(): string | null {
  try {
    const bun = (globalThis as { Bun?: { which?: (name: string) => string | null } }).Bun
    if (bun && typeof bun.which === 'function') {
      const hit = bun.which('ffprobe')
      if (hit && isFile(hit)) return hit
    }
  } catch {
    // 非 Bun 环境忽略
  }

  const names = process.platform === 'win32' ? ['ffprobe.exe', 'ffprobe'] : ['ffprobe']
  const bases = [
    dirname(process.execPath),
    resolve(import.meta.dir, '..', 'src-tauri', 'binaries'),
    resolve(process.cwd(), 'src-tauri', 'binaries')
  ]

  for (const base of bases) {
    for (const name of names) {
      const candidate = join(base, name)
      if (isFile(candidate)) return candidate
    }
  }
  return null
}

function toPositiveNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/**
 * 调用 ffprobe 一次取回时长与视频流元数据。
 * 超时 8 秒，Windows 下隐藏控制台窗口。
 */
export function probeWithFfprobe(file: string): FfprobeInfo | null {
  const command = findFfprobe() ?? 'ffprobe'
  try {
    const result = spawnSync(
      command,
      [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_entries',
        'format=duration:stream=width,height,codec_name',
        '-of',
        'json',
        file
      ],
      {
        encoding: 'utf8',
        timeout: 8000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024
      }
    )
    if (result.error || result.status !== 0) return null

    const text = String(result.stdout ?? '').trim()
    if (!text) return null
    const parsed = JSON.parse(text) as {
      format?: { duration?: string | number }
      streams?: Array<{ width?: number; height?: number; codec_name?: string }>
    }

    const stream = parsed.streams?.[0]
    const duration = toPositiveNumber(parsed.format?.duration)
    if (duration == null && !stream) return null

    const width = toPositiveNumber(stream?.width)
    const height = toPositiveNumber(stream?.height)
    const codec =
      typeof stream?.codec_name === 'string' && stream.codec_name.trim()
        ? stream.codec_name.trim()
        : null

    return {
      duration,
      width: width == null ? null : Math.round(width),
      height: height == null ? null : Math.round(height),
      videoCodec: codec
    }
  } catch {
    return null
  }
}

interface Box {
  size: number
  type: string
  headerSize: number
}

function readBox(fd: number, offset: number, end: number): Box | null {
  const header = Buffer.alloc(16)
  const read = readSync(fd, header, 0, 16, offset)
  if (read < 8) return null
  let size = header.readUInt32BE(0)
  const type = header.toString('latin1', 4, 8)
  let headerSize = 8
  if (size === 1) {
    if (read < 16) return null
    const big = header.readBigUInt64BE(8)
    size = big > BigInt(Number.MAX_SAFE_INTEGER) ? -1 : Number(big)
    headerSize = 16
  } else if (size === 0) {
    size = end - offset
  }
  return { size, type, headerSize }
}

function findMvhd(fd: number, start: number, end: number, depth = 0): number | null {
  if (depth > 4) return null
  let position = start
  while (position + 8 <= end) {
    const box = readBox(fd, position, end)
    if (!box || box.size < box.headerSize || position + box.size > end) break

    if (box.type === 'mvhd') {
      const length = Math.min(box.size - box.headerSize, 128)
      if (length < 20) return null
      const data = Buffer.alloc(length)
      readSync(fd, data, 0, length, position + box.headerSize)
      const version = data[0]
      if (version === 1) {
        if (length < 32) return null
        const timescale = data.readUInt32BE(20)
        const duration = Number(data.readBigUInt64BE(24))
        if (timescale > 0) return duration / timescale
      } else {
        const timescale = data.readUInt32BE(12)
        const duration = data.readUInt32BE(16)
        if (timescale > 0) return duration / timescale
      }
      return null
    }

    if (box.type === 'moov' || box.type === 'trak' || box.type === 'mdia') {
      const nested = findMvhd(fd, position + box.headerSize, position + box.size, depth + 1)
      if (nested != null) return nested
    }

    position += box.size
  }
  return null
}

/** 不依赖 ffprobe，直接解析 MP4/MOV 的 moov/mvhd。支持 moov 在文件尾部。 */
function probeMp4(file: string): number | null {
  let fd: number | null = null
  try {
    const size = statSync(file).size
    fd = openSync(file, 'r')
    let position = 0
    while (position + 8 <= size) {
      const box = readBox(fd, position, size)
      if (!box || box.size < box.headerSize) break
      if (box.type === 'moov') {
        const duration = findMvhd(fd, position + box.headerSize, position + box.size)
        if (duration && duration > 0) return duration
        break
      }
      position += box.size
    }
    return null
  } catch {
    return null
  } finally {
    if (fd != null) {
      try {
        closeSync(fd)
      } catch {
        // 忽略关闭失败
      }
    }
  }
}

export function probeDuration(file: string): {
  duration: number | null
  by: MediaFile['probedBy']
} {
  const ext = extname(file).toLowerCase()
  if (MP4_EXT.has(ext)) {
    const mp4 = probeMp4(file)
    if (mp4 && mp4 > 0) return { duration: mp4, by: 'mp4' }
  }
  const ff = probeWithFfprobe(file)
  if (ff?.duration != null) return { duration: ff.duration, by: 'ffprobe' }
  return { duration: null, by: 'none' }
}

export async function probeFile(file: string): Promise<MediaFile> {
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`不是文件: ${file}`)

  const base = {
    path: file,
    name: basename(file),
    size: info.size
  }

  const ext = extname(file).toLowerCase()
  if (MP4_EXT.has(ext)) {
    const mp4 = probeMp4(file)
    if (mp4 && mp4 > 0) {
      return {
        ...base,
        duration: Math.round(mp4),
        probedBy: 'mp4',
        width: null,
        height: null,
        videoCodec: null
      }
    }
  }

  const ff = probeWithFfprobe(file)
  if (ff) {
    return {
      ...base,
      duration: ff.duration == null ? null : Math.round(ff.duration),
      probedBy: ff.duration == null ? 'none' : 'ffprobe',
      width: ff.width,
      height: ff.height,
      videoCodec: ff.videoCodec
    }
  }

  return {
    ...base,
    duration: null,
    probedBy: 'none',
    width: null,
    height: null,
    videoCodec: null
  }
}

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

export type ScanProgressHandler = (progress: ScanProgress) => void

/** 枚举阶段 / 读取阶段的推送间隔（毫秒）。 */
const WALK_EMIT_MS = 150
const PROBE_EMIT_MS = 180
/** 每批最多携带多少个已探测文件。 */
const PROBE_BATCH = 16

interface WalkHooks {
  onVideo?: (file: string, found: number, dirs: number) => void
  onDir?: (dir: string, found: number, dirs: number) => void
}

const blacklistCache = new Map<string, RegExp>()

function blacklistRegex(pattern: string): RegExp {
  const cached = blacklistCache.get(pattern)
  if (cached) return cached
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  const regex = new RegExp(`^${source}$`, 'i')
  blacklistCache.set(pattern, regex)
  return regex
}

/**
 * 文件名黑名单匹配（与 `src/utils.ts`、Rust 侧保持一致）：
 * 不区分大小写；含 `*` / `?` 时通配符整名匹配，否则按包含匹配。
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

/** 先快速枚举视频路径（不读时长），用于确定总数与进度分母。 */
async function collectVideos(
  root: string,
  recursive: boolean,
  hooks: WalkHooks = {},
  blacklist: readonly string[] = []
): Promise<{ paths: string[]; dirs: number }> {
  const paths: string[] = []
  let dirs = 0

  const walk = async (dir: string, isRoot = false): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (isRoot) throw error
      return
    }
    dirs += 1

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!recursive) continue
        if (entry.name.startsWith('.')) continue
        await walk(full)
        continue
      }

      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      // TypeScript 声明文件不要当成 MPEG-TS。
      if (lower.endsWith('.d.ts')) continue
      if (!VIDEO_EXT.has(extname(lower))) continue
      // 黑名单文件直接跳过，不参与计数与探测。
      if (isBlacklisted(entry.name, blacklist)) continue

      paths.push(full)
      hooks.onVideo?.(full, paths.length, dirs)
    }

    hooks.onDir?.(dir, paths.length, dirs)
  }

  await walk(root, true)
  return { paths, dirs }
}

/**
 * 流式扫描：枚举目录 → 逐个探测时长，过程中持续回报进度。
 * 前端据此显示进度条并增量渲染表格行。
 */
export async function scanFolderStream(
  root: string,
  recursive: boolean,
  scanId: string,
  report: ScanProgressHandler,
  blacklist: readonly string[] = []
): Promise<MediaFile[]> {
  let lastWalkEmit = 0
  const walkEmit = (found: number, dirs: number, current: string) => {
    const now = Date.now()
    if (now - lastWalkEmit < WALK_EMIT_MS) return
    lastWalkEmit = now
    report({ scanId, phase: 'walk', found, dirs, total: 0, done: 0, current })
  }

  const { paths, dirs } = await collectVideos(
    root,
    recursive,
    {
      onVideo: (file, found, count) => walkEmit(found, count, basename(file)),
      onDir: (dir, found, count) => walkEmit(found, count, dir)
    },
    blacklist
  )

  // 与最终排序一致，避免扫描过程中表格顺序反复跳动。
  paths.sort((a, b) => basename(a).localeCompare(basename(b)))

  const total = paths.length
  report({ scanId, phase: 'probe', found: total, dirs, total, done: 0, current: '' })

  const files: MediaFile[] = []
  let pending: MediaFile[] = []
  let lastProbeEmit = Date.now()

  for (let index = 0; index < total; index += 1) {
    try {
      const media = await probeFile(paths[index])
      files.push(media)
      pending.push(media)
    } catch {
      // 单个文件读取失败不影响整个目录
    }

    const done = index + 1
    if (done === total || pending.length >= PROBE_BATCH || Date.now() - lastProbeEmit >= PROBE_EMIT_MS) {
      const current = pending.length ? pending[pending.length - 1].name : ''
      const batch = pending
      pending = []
      lastProbeEmit = Date.now()
      report({
        scanId,
        phase: 'probe',
        found: total,
        dirs,
        total,
        done,
        current,
        files: batch
      })
    }
  }

  if (total === 0) {
    report({ scanId, phase: 'probe', found: 0, dirs, total: 0, done: 0, current: '', files: [] })
  }

  return files.sort((a, b) => a.name.localeCompare(b.name))
}

export async function scanFolder(
  root: string,
  recursive = true,
  blacklist: readonly string[] = []
): Promise<MediaFile[]> {
  return scanFolderStream(root, recursive, 'scan', () => {}, blacklist)
}

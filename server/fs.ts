import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

/** HTTP 错误：路由层据此决定状态码，默认 500。 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
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

import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { cropImage, decodeCover } from './image'
import type { CropRect } from './covers'

export type OrganizeAction = 'move' | 'copy'
export type ConflictPolicy = 'skip' | 'overwrite' | 'rename'

export interface OrganizeItem {
  source: string
  relativeTarget: string
  /** 可选：写入同名 .nfo 的 XML 内容 */
  nfo?: string
  /** 可选：下载为同名 .jpg 的海报地址 */
  posterUrl?: string
  /** 可选：手动裁剪区域；为空时保存完整封面 */
  posterCrop?: CropRect
}

export interface OrganizeRequest {
  dest: string
  action?: OrganizeAction
  conflict?: ConflictPolicy
  removeEmptyDirs?: boolean
  items: OrganizeItem[]
}

export interface OrganizeResult {
  source: string
  target: string
  ok: boolean
  skipped: boolean
  error?: string
  warning?: string
}

export interface TrashResult {
  removed: number
  failed: { path: string; error: string }[]
}

const isWindows = process.platform === 'win32'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeForCompare(path: string): string {
  const normalized = resolve(path)
  return isWindows ? normalized.toLowerCase() : normalized
}

function isSamePath(a: string, b: string): boolean {
  return normalizeForCompare(a) === normalizeForCompare(b)
}

/** child 是否严格位于 parent 之内（不包含 parent 本身）。 */
function isInside(parent: string, child: string): boolean {
  const rel = relative(normalizeForCompare(parent), normalizeForCompare(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function uniqueTarget(target: string): Promise<string> {
  const ext = extname(target)
  const base = target.slice(0, target.length - ext.length)
  for (let index = 2; index < 10000; index++) {
    const candidate = `${base} (${index})${ext}`
    if (!(await pathExists(candidate))) return candidate
  }
  throw new Error('无法生成不冲突的文件名')
}

async function moveFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target)
    return
  } catch {
    // 跨卷 rename 会失败：复制 → 校验大小 → 删除源文件。
  }

  await copyFile(source, target)
  try {
    const [sourceInfo, targetInfo] = await Promise.all([stat(source), stat(target)])
    if (sourceInfo.size !== targetInfo.size) throw new Error('复制后大小校验失败')
    await unlink(source)
  } catch (error) {
    try {
      await unlink(target)
    } catch {
      // 清理失败忽略，保留原始错误
    }
    throw error
  }
}

/** 整理结束后，自底向上删除本次源文件所在且已变空的目录。 */
async function removeSourceDirs(dest: string, sources: string[]): Promise<void> {
  const seen = new Set<string>()

  for (const source of sources) {
    let dir = dirname(resolve(source))
    while (true) {
      if (isSamePath(dir, dest)) break
      if (isInside(dir, dest)) break // dir 是 dest 的祖先
      if (isInside(dest, dir)) break // dir 位于 dest 之内，不属于“dest 之外”
      const key = normalizeForCompare(dir)
      if (seen.has(key)) break
      seen.add(key)

      try {
        const entries = await readdir(dir)
        if (entries.length > 0) break
        await rmdir(dir)
      } catch {
        break
      }

      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
}

/** 整理成功后写入 NFO、下载封面；失败只记 warning，不影响主文件结果。 */
async function writeSidecars(target: string, item: OrganizeItem): Promise<string[]> {
  const warnings: string[] = []
  if (!item.nfo && !item.posterUrl) return warnings

  const ext = extname(target)
  const stem = target.slice(0, target.length - ext.length)

  if (item.nfo) {
    try {
      await writeFile(`${stem}.nfo`, item.nfo, 'utf8')
    } catch (error) {
      warnings.push(`写入 NFO 失败：${errorMessage(error)}`)
    }
  }

  if (item.posterUrl) {
    try {
      const response = await fetch(item.posterUrl, {
        headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/*' },
        signal: AbortSignal.timeout(20000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (bytes.byteLength < 100) throw new Error('封面内容为空')
      const raw = Buffer.from(bytes)
      const decoded = item.posterCrop
        ? cropImage(raw, item.posterCrop.x, item.posterCrop.y, item.posterCrop.width, item.posterCrop.height)
        : decodeCover(raw)
      await writeFile(`${stem}.${decoded.format.ext}`, decoded.data)
    } catch (error) {
      warnings.push(`下载封面失败：${errorMessage(error)}`)
    }
  }

  return warnings
}

export async function organizeFiles(request: OrganizeRequest): Promise<OrganizeResult[]> {
  const dest = resolve(request.dest)
  const action: OrganizeAction = request.action === 'copy' ? 'copy' : 'move'
  const conflict: ConflictPolicy =
    request.conflict === 'skip' || request.conflict === 'overwrite'
      ? request.conflict
      : 'rename'

  const results: OrganizeResult[] = []

  for (const item of request.items) {
    const source = resolve(item.source)
    let target = ''

    try {
      const relativeTarget = String(item.relativeTarget ?? '').trim()
      if (!relativeTarget) throw new Error('目标路径为空')

      target = resolve(dest, relativeTarget)
      if (!isInside(dest, target)) throw new Error('目标路径越界')

      if (isSamePath(source, target)) {
        results.push({
          source: item.source,
          target,
          ok: true,
          skipped: true
        })
        continue
      }

      await mkdir(dirname(target), { recursive: true })

      if (await pathExists(target)) {
        if (conflict === 'skip') {
          results.push({
            source: item.source,
            target,
            ok: true,
            skipped: true
          })
          continue
        }

        if (conflict === 'overwrite') {
          const info = await stat(target)
          if (info.isDirectory()) throw new Error('目标路径是目录')
          await unlink(target)
        } else {
          target = await uniqueTarget(target)
        }
      }

      if (action === 'copy') {
        await copyFile(source, target)
      } else {
        await moveFile(source, target)
      }

      const warnings = await writeSidecars(target, item)
      results.push({
        source: item.source,
        target,
        ok: true,
        skipped: false,
        warning: warnings.length ? warnings.join('；') : undefined
      })
    } catch (error) {
      results.push({
        source: item.source,
        target,
        ok: false,
        skipped: false,
        error: errorMessage(error)
      })
    }
  }

  if (request.removeEmptyDirs) {
    await removeSourceDirs(
      dest,
      results.filter((result) => result.ok && !result.skipped).map((result) => result.source)
    )
  }

  return results
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function psArgs(script: string): string[] {
  return [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$OutputEncoding=[System.Text.Encoding]::UTF8; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`
  ]
}

function recycleWindows(file: string): string | null {
  const script = [
    'Add-Type -AssemblyName Microsoft.VisualBasic',
    `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${psQuote(file)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`
  ].join('; ')

  const result = spawnSync('powershell.exe', psArgs(script), {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000
  })

  if (result.error) return `无法调用 PowerShell：${result.error.message}`
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim()
    return detail || `PowerShell 退出码 ${result.status}`
  }
  return null
}

function recyclePosix(file: string): string | null {
  const result = spawnSync('trash-put', [file], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30000
  })

  if (result.error) {
    const code = (result.error as { code?: string }).code
    if (code === 'ENOENT') return 'trash-put 未安装'
    return `无法调用 trash-put：${result.error.message}`
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim()
    return detail || `trash-put 退出码 ${result.status}`
  }
  return null
}

export async function trashFiles(paths: string[]): Promise<TrashResult> {
  let removed = 0
  const failed: { path: string; error: string }[] = []

  for (const item of paths) {
    const file = resolve(item)
    const error = isWindows ? recycleWindows(file) : recyclePosix(file)
    if (error) failed.push({ path: item, error })
    else removed++
  }

  return { removed, failed }
}

function runProcess(command: string, args: string[], ignoreStatus = false): void {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15000
  })

  if (result.error) {
    throw new Error(`无法启动 ${command}：${result.error.message}`)
  }
  if (!ignoreStatus && result.status !== 0) {
    const detail = String(result.stderr ?? '').trim()
    throw new Error(detail || `${command} 退出码 ${result.status}`)
  }
}

export async function openPath(path: string): Promise<void> {
  if (!path) throw new Error('缺少 path')
  const file = resolve(path)

  if (isWindows) {
    runProcess(
      'powershell.exe',
      psArgs(`Start-Process -FilePath ${psQuote(file)} -ErrorAction Stop`)
    )
    return
  }

  if (process.platform === 'darwin') {
    runProcess('open', [file])
  } else {
    runProcess('xdg-open', [file])
  }
}

export async function revealPath(path: string): Promise<void> {
  if (!path) throw new Error('缺少 path')
  const file = resolve(path)

  if (isWindows) {
    runProcess('explorer.exe', [`/select,${file}`], true)
    return
  }

  if (process.platform === 'darwin') {
    runProcess('open', ['-R', file])
  } else {
    runProcess('xdg-open', [dirname(file)])
  }
}

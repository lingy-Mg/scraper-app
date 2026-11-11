import { stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import { loadSettings, saveSettings, type MediaSource } from './settings'

/** 路径比较键：Windows 大小写不敏感；其余平台按原样。 */
function pathKey(path: string): string {
  const resolved = resolve(path)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * 校验来源目录：必须是已存在的绝对目录路径。
 * 返回 resolve 后的路径；失败时抛错（HTTP 层转 400）。
 */
export async function validateSourcePath(path: string): Promise<string> {
  if (typeof path !== 'string' || !path.trim()) throw new Error('缺少或无效的 path')
  const value = path.trim()
  if (!isAbsolute(value)) throw new Error('path 必须是绝对路径')
  const resolved = resolve(value)
  let info
  try {
    info = await stat(resolved)
  } catch {
    throw new Error('目录不存在')
  }
  if (!info.isDirectory()) throw new Error('path 不是目录')
  return resolved
}

/** 设置文件的读改写串行化，避免并发添加/删除互相覆盖。 */
let lock: Promise<unknown> = Promise.resolve()

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const run = lock.then(task, task)
  lock = run.catch(() => undefined)
  return run
}

export async function listSources(): Promise<MediaSource[]> {
  const settings = await loadSettings()
  return [...(settings.sources ?? [])]
}

export interface AddSourceResult {
  source: MediaSource
  sources: MediaSource[]
  /** false 表示路径已存在，未重复写入。 */
  added: boolean
}

/** 添加来源；绝对目录校验通过后按规范化路径去重。 */
export function addSource(path: string, name?: string): Promise<AddSourceResult> {
  return withLock(async () => {
    const resolved = await validateSourcePath(path)
    const settings = await loadSettings()
    const sources = [...(settings.sources ?? [])]
    const key = pathKey(resolved)
    const existing = sources.find((source) => pathKey(source.path) === key)
    if (existing) return { source: existing, sources, added: false }

    const trimmedName = typeof name === 'string' ? name.trim() : ''
    const source: MediaSource = {
      path: resolved,
      name: trimmedName || basename(resolved),
      addedAt: Date.now()
    }
    const next = [...sources, source]
    await saveSettings({ ...settings, sources: next })
    return { source, sources: next, added: true }
  })
}

export interface RemoveSourceResult {
  removed: boolean
  sources: MediaSource[]
}

/**
 * 只删除来源记录，不删除媒体库记录，也不删除任何文件。
 * 路径大小写按平台规则比较，目录已不存在时仍可删除记录。
 */
export function removeSource(path: string): Promise<RemoveSourceResult> {
  return withLock(async () => {
    if (typeof path !== 'string' || !path.trim()) throw new Error('缺少或无效的 path')
    const key = pathKey(path.trim())
    const settings = await loadSettings()
    const sources = settings.sources ?? []
    const next = sources.filter((source) => pathKey(source.path) !== key)
    if (next.length === sources.length) return { removed: false, sources: [...sources] }

    await saveSettings({ ...settings, sources: next })
    return { removed: true, sources: next }
  })
}

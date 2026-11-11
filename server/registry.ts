import { readdir, readFile, stat, writeFile, mkdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { watch } from 'node:fs'
import { resolveDataDir } from './settings'

export const PLUGIN_ROOT = join(import.meta.dir, 'plugins')

/**
 * 运行时路径按需解析，不在模块加载时固化：Bun 测试文件共享模块缓存，
 * 但各自隔离 `process.env`。
 */
export function userPluginRoot(): string {
  return join(resolveDataDir(), 'plugins')
}

function configFile(): string {
  return join(resolveDataDir(), 'config.json')
}

function cacheDir(): string {
  return join(resolveDataDir(), '.plugin-cache')
}

/** 插件在独立打包产物中通过环境变量定位数据目录。 */
function syncPluginDataDir(): void {
  process.env.SCRAPER_DATA_DIR = resolveDataDir()
}

export type PluginSource = 'builtin' | 'user'

export interface SourceOpt {
  label: string
  on: boolean
}

export interface PluginConfig {
  lang: string
  sources: SourceOpt[]
  downloads: SourceOpt[]
  naming: string
  organize: string
  /** JavDB / AV：用户自行提供的 JWT，只在本地保存，不回显。 */
  token?: string
}

/** 回显给前端时脱敏的配置字段。 */
const SECRET_FIELDS = ['token'] as const
export const SECRET_MASK = '••••••••'

export function maskConfig<T extends object>(config: T): T {
  const out = { ...config } as Record<string, unknown>
  for (const key of SECRET_FIELDS) {
    if (typeof out[key] === 'string' && out[key]) out[key] = SECRET_MASK
  }
  return out as T
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  order?: number
  description?: string
  entry?: string
  /** 插件声明的通用能力，缺省为 identify + resolve。 */
  capabilities?: string[]
  labels: { code: string; title: string }
  defaults: PluginConfig
}

export const DEFAULT_CAPABILITIES = ['identify', 'resolve'] as const

export interface LoadedPlugin {
  manifest: PluginManifest
  config: PluginConfig
  impl: any
  capabilities: string[]
  source: PluginSource
  /** 插件实际所在目录（用户插件可能覆盖内置插件）。 */
  dir: string
  status: 'ok' | 'error'
  error?: string
  loadedAt: number
}

const plugins = new Map<string, LoadedPlugin>()
const overrides = new Map<string, Partial<PluginConfig>>()
/** 每个插件当前正在使用的打包产物（id-source → 文件路径），清理时绝不删除。 */
const activeBundles = new Map<string, string>()
/** 每个插件保留的打包产物数量（按修改时间最新优先）。 */
const CACHE_KEEP = 2
let generation = 0
let reloadListener: ((id: string) => void) | null = null

const fallbackDefaults: PluginConfig = {
  lang: '中文',
  sources: [],
  downloads: [],
  naming: '{标题}',
  organize: '{标题}'
}

export function setReloadListener(fn: (id: string) => void) {
  reloadListener = fn
}

export async function loadOverrides() {
  try {
    const raw = await readFile(configFile(), 'utf8')
    const parsed = JSON.parse(raw) as Record<string, Partial<PluginConfig>>
    for (const [id, value] of Object.entries(parsed)) overrides.set(id, value)
  } catch {
    // 首次运行没有配置文件
  }
}

async function persistOverrides() {
  await mkdir(resolveDataDir(), { recursive: true })
  const out: Record<string, Partial<PluginConfig>> = {}
  for (const [id, value] of overrides) out[id] = value
  await writeFile(configFile(), JSON.stringify(out, null, 2), 'utf8')
}

function capabilitiesOf(manifest: PluginManifest): string[] {
  const declared = Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  const list = declared.length ? declared : [...DEFAULT_CAPABILITIES]
  return [...new Set(list.filter((item) => typeof item === 'string' && item.trim()))]
}

/** 递归列出插件目录内的文件（相对路径，已排序）。 */
async function collectFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...(await collectFiles(join(dir, entry.name), rel)))
    else if (entry.isFile()) files.push(rel)
  }
  return files.sort()
}

/**
 * 目录内容指纹：文件名 + mtime + size。任一文件变化都会换新打包产物。
 * 同时覆盖内置与用户插件根目录，`_shared/` 与跨插件引用的改动也能触发重建。
 */
async function pluginHash(): Promise<string> {
  const hash = createHash('sha1')
  for (const [label, root] of [
    ['builtin', PLUGIN_ROOT],
    ['user', userPluginRoot()]
  ] as const) {
    if (!existsSync(root)) continue
    for (const rel of await collectFiles(root)) {
      const info = await stat(join(root, rel))
      hash.update(`${label}/${rel}:${info.mtimeMs}:${info.size}\n`)
    }
  }
  return hash.digest('hex').slice(0, 12)
}

/**
 * 把插件目录打包成单个 ESM 再加载：
 * 入口 import 的本地模块会一起进入产物，改目录内任意 .ts 都能热重载。
 */
async function bundlePlugin(
  id: string,
  source: PluginSource,
  dir: string,
  entry: string
): Promise<string> {
  const hash = await pluginHash()
  // 同名内置/用户插件必须使用不同缓存文件，否则会加载到错误的实现。
  const outDir = cacheDir()
  const base = `${id}-${source}-${hash}`
  const outfile = join(outDir, `${base}.mjs`)
  if (existsSync(outfile)) {
    activeBundles.set(`${id}-${source}`, outfile)
    return outfile
  }

  await mkdir(outDir, { recursive: true })
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: 'bun',
    format: 'esm',
    naming: `${base}.mjs`,
    sourcemap: 'none',
    throw: false
  })

  if (!result.success) {
    const detail = result.logs
      .map((log) => (typeof log === 'object' && log && 'message' in log ? String(log.message) : String(log)))
      .join('; ')
    throw new Error(`插件打包失败：${detail || '未知错误'}`)
  }

  const output = result.outputs[0]
  if (!output) throw new Error('插件打包没有输出文件')
  activeBundles.set(`${id}-${source}`, output.path)
  return output.path
}

/**
 * 每个插件只保留最新 2 个打包产物，避免 `.plugin-cache` 无限增长。
 * 正在使用的产物（activeBundles）无论新旧都不会删除。
 */
async function prunePluginCache(): Promise<void> {
  let entries
  try {
    entries = await readdir(cacheDir(), { withFileTypes: true })
  } catch {
    return
  }

  const groups = new Map<string, { path: string; name: string; mtime: number }[]>()
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.mjs')) continue
    const match = entry.name.match(/^(.*-(?:builtin|user))-[0-9a-f]{12}\.mjs$/)
    if (!match) continue
    const path = join(cacheDir(), entry.name)
    let info
    try {
      info = await stat(path)
    } catch {
      continue
    }
    const list = groups.get(match[1]) ?? []
    list.push({ path, name: entry.name, mtime: info.mtimeMs })
    groups.set(match[1], list)
  }

  for (const [prefix, items] of groups) {
    items.sort((a, b) => b.mtime - a.mtime)
    const keep = new Set(items.slice(0, CACHE_KEEP).map((item) => item.path))
    const active = activeBundles.get(prefix)
    if (active) keep.add(active)
    for (const item of items) {
      if (keep.has(item.path)) continue
      try {
        await unlink(item.path)
        console.log(`[plugin] 清理缓存 ${item.name}`)
      } catch {
        // 文件仍被占用时跳过，下次加载/重载再试
      }
    }
  }
}

/** 用户目录优先；不存在时回退内置目录。 */
function findPluginDir(id: string): { dir: string; source: PluginSource } | null {
  const user = join(userPluginRoot(), id)
  if (existsSync(join(user, 'plugin.json'))) return { dir: user, source: 'user' }
  const builtin = join(PLUGIN_ROOT, id)
  if (existsSync(join(builtin, 'plugin.json'))) return { dir: builtin, source: 'builtin' }
  return null
}

async function loadOne(
  id: string,
  location?: { dir: string; source: PluginSource }
): Promise<LoadedPlugin> {
  // 插件打包产物通过环境变量读取数据目录，加载前同步为当前绝对路径。
  syncPluginDataDir()
  const { dir, source } = location ?? findPluginDir(id) ?? {
    dir: join(PLUGIN_ROOT, id),
    source: 'builtin' as const
  }
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8')) as PluginManifest
    if (manifest.apiVersion !== 1) throw new Error('apiVersion 必须为 1')
    if (!manifest.id) throw new Error('缺少 id')
    if (!manifest.labels?.code || !manifest.labels?.title) throw new Error('缺少 labels')

    const entry = join(dir, manifest.entry ?? 'index.ts')
    const bundled = await bundlePlugin(id, source, dir, entry)
    const mod = await import(`${pathToFileURL(bundled).href}?v=${++generation}`)
    const impl = mod.default ?? mod
    const config: PluginConfig = {
      ...fallbackDefaults,
      ...manifest.defaults,
      ...(overrides.get(id) ?? {})
    }
    const plugin: LoadedPlugin = {
      manifest,
      config,
      impl,
      capabilities: capabilitiesOf(manifest),
      source,
      dir,
      status: 'ok',
      loadedAt: Date.now()
    }
    plugins.set(id, plugin)
    return plugin
  } catch (error) {
    const plugin: LoadedPlugin = {
      manifest: {
        id,
        name: id,
        version: '0.0.0',
        apiVersion: 1,
        labels: { code: '编号', title: '标题' },
        defaults: fallbackDefaults
      },
      config: { ...fallbackDefaults, ...(overrides.get(id) ?? {}) },
      impl: null,
      capabilities: [...DEFAULT_CAPABILITIES],
      source,
      dir,
      status: 'error',
      error: String(error),
      loadedAt: Date.now()
    }
    plugins.set(id, plugin)
    return plugin
  }
}

export async function loadAll() {
  plugins.clear()
  // 先内置、后用户：同 id 由用户目录覆盖。
  for (const [root, source] of [
    [PLUGIN_ROOT, 'builtin'],
    [userPluginRoot(), 'user']
  ] as const) {
    if (!existsSync(root)) continue
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('_')) continue
      await loadOne(entry.name, { dir: join(root, entry.name), source })
    }
  }
  await prunePluginCache()
}

export function getPlugins() {
  return [...plugins.values()]
    .sort((a, b) => (a.manifest.order ?? 100) - (b.manifest.order ?? 100))
}

export function getPlugin(id: string) {
  return plugins.get(id)
}

export async function updateConfig(id: string, patch: Partial<PluginConfig>) {
  const plugin = plugins.get(id)
  if (!plugin) throw new Error(`插件不存在: ${id}`)
  const next = { ...plugin.config, ...patch }
  plugin.config = next
  overrides.set(id, { ...(overrides.get(id) ?? {}), ...patch })
  await persistOverrides()
  return next
}

export async function reload(id: string) {
  const plugin = await loadOne(id, findPluginDir(id) ?? undefined)
  await prunePluginCache()
  reloadListener?.(id)
  return plugin
}

export async function reloadAll() {
  await loadAll()
  reloadListener?.('*')
}

let watchTimer: ReturnType<typeof setTimeout> | null = null
export function watchPlugins() {
  for (const root of [PLUGIN_ROOT, userPluginRoot()]) {
    if (!existsSync(root)) continue
    watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const id = String(filename).split(/[\\/]/)[0]
      if (!id) return
      // `_shared` 被多个插件引用：任一变动都重新加载所有插件。
      const shared = id.startsWith('_')
      if (!shared && !findPluginDir(id)) return
      if (watchTimer) clearTimeout(watchTimer)
      watchTimer = setTimeout(async () => {
        if (shared) {
          await reloadAll()
          console.log('[plugin] reloaded all (shared)')
          return
        }
        await loadOne(id, findPluginDir(id) ?? undefined)
        await prunePluginCache()
        reloadListener?.(id)
        console.log(`[plugin] reloaded ${id}`)
      }, 320)
    })
  }
}

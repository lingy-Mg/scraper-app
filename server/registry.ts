import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { watch } from 'node:fs'

export const PLUGIN_ROOT = join(import.meta.dir, 'plugins')
const DATA_DIR = join(import.meta.dir, 'data')
const CONFIG_FILE = join(DATA_DIR, 'config.json')

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
  status: 'ok' | 'error'
  error?: string
  loadedAt: number
}

const plugins = new Map<string, LoadedPlugin>()
const overrides = new Map<string, Partial<PluginConfig>>()
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
    const raw = await readFile(CONFIG_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Record<string, Partial<PluginConfig>>
    for (const [id, value] of Object.entries(parsed)) overrides.set(id, value)
  } catch {
    // 首次运行没有配置文件
  }
}

async function persistOverrides() {
  await mkdir(DATA_DIR, { recursive: true })
  const out: Record<string, Partial<PluginConfig>> = {}
  for (const [id, value] of overrides) out[id] = value
  await writeFile(CONFIG_FILE, JSON.stringify(out, null, 2), 'utf8')
}

function capabilitiesOf(manifest: PluginManifest): string[] {
  const declared = Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  const list = declared.length ? declared : [...DEFAULT_CAPABILITIES]
  return [...new Set(list.filter((item) => typeof item === 'string' && item.trim()))]
}

async function loadOne(id: string): Promise<LoadedPlugin> {
  const dir = join(PLUGIN_ROOT, id)
  try {
    const manifest = JSON.parse(await readFile(join(dir, 'plugin.json'), 'utf8')) as PluginManifest
    if (manifest.apiVersion !== 1) throw new Error('apiVersion 必须为 1')
    if (!manifest.id) throw new Error('缺少 id')
    if (!manifest.labels?.code || !manifest.labels?.title) throw new Error('缺少 labels')

    const entry = join(dir, manifest.entry ?? 'index.ts')
    const mod = await import(`${pathToFileURL(entry).href}?v=${++generation}`)
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
  const entries = await readdir(PLUGIN_ROOT, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (entry.name.startsWith('_')) continue
    await loadOne(entry.name)
  }
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
  const plugin = await loadOne(id)
  reloadListener?.(id)
  return plugin
}

export async function reloadAll() {
  await loadAll()
  reloadListener?.('*')
}

let watchTimer: ReturnType<typeof setTimeout> | null = null
export function watchPlugins() {
  watch(PLUGIN_ROOT, { recursive: true }, (_event, filename) => {
    if (!filename) return
    const id = String(filename).split(/[\\/]/)[0]
    if (!id || id.startsWith('_')) return
    if (watchTimer) clearTimeout(watchTimer)
    watchTimer = setTimeout(async () => {
      await loadOne(id)
      reloadListener?.(id)
      console.log(`[plugin] reloaded ${id}`)
    }, 320)
  })
}

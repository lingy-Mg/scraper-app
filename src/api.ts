export interface PluginMode {
  id: string
  name: string
  version: string
  order: number
  description: string
  status: 'ok' | 'error'
  error?: string
  codeLabel: string
  titleLabel: string
  lang: string
  sources: { label: string; on: boolean }[]
  downloads: { label: string; on: boolean }[]
  naming: string
  organize: string
  settingsUrl: string
}

import type { ModeConfig, ModeKey } from './types'

export function toModeConfig(plugin: PluginMode): ModeConfig {
  return {
    key: plugin.id as ModeKey,
    name: plugin.name,
    codeLabel: plugin.codeLabel,
    titleLabel: plugin.titleLabel,
    lang: plugin.lang,
    sources: plugin.sources,
    downloads: plugin.downloads,
    naming: plugin.naming,
    organize: plugin.organize,
    version: plugin.version,
    description: plugin.description,
    status: plugin.status,
    settingsUrl: plugin.settingsUrl
  }
}

export async function fetchPlugins(): Promise<PluginMode[]> {
  const response = await fetch('/api/plugins')
  if (!response.ok) throw new Error(`插件列表请求失败: ${response.status}`)
  return (await response.json()) as PluginMode[]
}

export async function reloadPlugins(): Promise<{ ok: boolean; count: number }> {
  const response = await fetch('/api/plugins/reload', { method: 'POST' })
  if (!response.ok) throw new Error('重载插件失败')
  return response.json()
}

export async function savePluginConfig(
  id: string,
  patch: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const response = await fetch(`/api/plugins/${id}/config`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!response.ok) throw new Error('保存插件配置失败')
  return response.json()
}

export async function identifyWithPlugin(
  pluginId: string,
  filename: string,
  allowTitle = false
): Promise<{ candidates: unknown[] }> {
  const response = await fetch(`/api/plugins/${pluginId}/identify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filename, allowTitle })
  })
  if (!response.ok) throw new Error('插件识别失败')
  return response.json()
}

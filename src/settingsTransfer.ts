/** 导入确认框展示的设置字段名（与 server/settings-io.ts 的可导入字段一致）。 */
export const IMPORT_FIELD_LABELS: Record<string, string> = {
  ai: 'AI 配置（密钥按文件内容覆盖）',
  modes: '模式 / 插件配置',
  lastFolder: '上次扫描目录',
  sources: '媒体库来源（整体替换）',
  minDur: '短片阈值',
  compact: '紧凑模式',
  hideShorts: '隐藏短片',
  logOpen: '日志面板展开状态',
  logHeight: '日志面板高度',
  theme: '界面主题',
  table: '表格列宽与列显隐',
  blacklist: '文件名黑名单（整体替换）'
}

const SECRET_KEYS = new Set([
  'apikey',
  'api_key',
  'tmdbapikey',
  'tmdb_api_key',
  'bangumitoken',
  'bangumi_token',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'password',
  'secret'
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function hasSecret(value: unknown, depth = 0): boolean {
  if (depth > 20) return false
  if (Array.isArray(value)) return value.some((entry) => hasSecret(entry, depth + 1))
  if (!isRecord(value)) return false
  return Object.entries(value).some(([key, entry]) => {
    const lower = key.toLowerCase()
    if (
      SECRET_KEYS.has(lower) ||
      lower.endsWith('apikey') ||
      lower.endsWith('_key')
    ) {
      return typeof entry === 'string' ? entry.length > 0 : entry != null
    }
    return hasSecret(entry, depth + 1)
  })
}

/** 兼容导出文件的 `{ settings }` 外层结构，以及直接传入设置对象。 */
export function extractImportSettings(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) return null
  if ('settings' in payload) return isRecord(payload.settings) ? payload.settings : null
  return payload
}

export interface ImportSummary {
  fields: string[]
  includesSecrets: boolean
}

export function describeImportPayload(payload: unknown): ImportSummary {
  const settings = extractImportSettings(payload)
  if (!settings) return { fields: [], includesSecrets: false }
  const fields = Object.keys(settings)
    .filter((key) => key in IMPORT_FIELD_LABELS)
    .map((key) => IMPORT_FIELD_LABELS[key])
  return { fields, includesSecrets: hasSecret(settings) }
}

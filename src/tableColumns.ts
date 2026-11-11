/**
 * 表格列元数据：FileTable、列设置弹窗与 App 的持久化逻辑共用。
 * 这里的 key 必须与 FileTable 的 column.key 一致。
 */

/** 双击恢复的默认列宽。 */
export const DEFAULT_COLUMN_WIDTHS: Record<string, number> = {
  status: 88,
  poster: 46,
  code: 118,
  file: 220,
  title: 260,
  maker: 120,
  actors: 140,
  dur: 116,
  size: 94,
  src: 66,
  progress: 104,
  act: 88
}

/** 允许用户隐藏的数据列；「操作」「选择」列永不包含在内。 */
export const HIDEABLE_COLUMN_KEYS = [
  'status',
  'poster',
  'code',
  'file',
  'title',
  'maker',
  'actors',
  'dur',
  'size',
  'src',
  'progress'
] as const

export type HideableColumnKey = (typeof HIDEABLE_COLUMN_KEYS)[number]

/** code / title 两列随模式变化，调用方可覆盖标签。 */
export const COLUMN_LABELS: Record<HideableColumnKey, string> = {
  status: '状态',
  poster: '海报',
  code: '番号',
  file: '文件名',
  title: '标题',
  maker: '片商',
  actors: '演员',
  dur: '时长',
  size: '大小',
  src: '来源',
  progress: '进度'
}

/** 清洗持久化 / 导入的 hidden：只保留可隐藏列并去重。 */
export function normalizeHiddenColumns(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(HIDEABLE_COLUMN_KEYS)
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !allowed.has(entry) || seen.has(entry)) continue
    seen.add(entry)
    result.push(entry)
  }
  return result
}

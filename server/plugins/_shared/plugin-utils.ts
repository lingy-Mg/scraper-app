/** 插件通用小工具：读取请求参数 / 配置 / 语言映射。 */

export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 依次读取多个来源中的第一个非空字符串。 */
export function pickText(...values: unknown[]): string {
  for (const value of values) {
    const result = text(value)
    if (result) return result
  }
  return ''
}

/** `sources` 中显式关闭某数据源时返回 false；未声明时默认开启。 */
export function sourceEnabled(config: Record<string, unknown>, label: string): boolean {
  const list = Array.isArray(config.sources) ? config.sources : []
  const want = label.toLowerCase()
  for (const item of list) {
    const entry = record(item)
    if (text(entry.label).toLowerCase() === want) return entry.on !== false
  }
  return true
}

/** 插件配置里的中文语言名 → TMDB/Bangumi 可用的 locale。 */
export function localeOf(value: unknown): string {
  const lang = text(value)
  if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(lang)) return lang
  const map: Record<string, string> = {
    中文: 'zh-CN',
    简体中文: 'zh-CN',
    繁体中文: 'zh-TW',
    日语: 'ja-JP',
    英语: 'en-US',
    韩语: 'ko-KR'
  }
  return map[lang] ?? 'zh-CN'
}

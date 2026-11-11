/** 元数据源统一类型（Bun 侧）。字段与 docs/providers-library-contract.md 保持一致。 */

export interface ProviderCandidate {
  id: string
  title: string
  year: string
  code?: string
  source: string
  score: number
  overview: string
  poster: number
  posterUrl?: string
  maker?: string
  actors?: string
  duration?: number
  detailId?: string
  tags?: string[]
}

export interface ProviderDetail extends ProviderCandidate {
  tags?: string[]
  raw?: Record<string, unknown>
}

/** 插件运行时上下文：由宿主注入，插件不得直接读全局配置。 */
export interface PluginContext {
  /** identify 时传入的文件名。 */
  filename?: string
  /** 是否允许按标题搜索（AV 插件用，默认 false）。 */
  allowTitle?: boolean
  /** 插件自身配置（`plugin.json` defaults + 用户覆盖）。 */
  config: Record<string, unknown>
  /** 本次请求的可选参数，如 apiKey / token / lang；插件自行决定是否使用。 */
  options: Record<string, unknown>
  /** 前端保存的该模式配置快照（`settings.modes[id]`），含密钥。 */
  modeConfig?: Record<string, unknown>
  /** 共享 AI 服务；AI 不是刮削站，由宿主注入。 */
  ai: {
    identify(filename: string, overrides?: Record<string, unknown>): Promise<unknown>
    pick(filename: string, candidates: unknown[], overrides?: Record<string, unknown>): Promise<unknown>
  }
}

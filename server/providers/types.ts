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

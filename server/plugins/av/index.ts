import { javdbDetail, javdbIdentify } from '../javdb/javdb-api'

interface AvContext {
  filename?: string
  allowTitle?: boolean
  config?: Record<string, unknown>
}

/** AV 模式复用 JavDB，因此共享同一个访问令牌。 */
function tokenOf(ctx: AvContext | undefined): string | undefined {
  const value = ctx?.config?.token
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * AV 模式：直接复用 JavDB App API 客户端。
 * 与 `javdb` 插件的区别只在元数据默认值和界面文案。
 */
export default {
  async identify(ctx: AvContext) {
    return javdbIdentify(ctx.filename ?? '', {
      allowTitle: ctx.allowTitle,
      token: tokenOf(ctx)
    })
  },

  async resolve(ctx: AvContext, candidateId: string) {
    const movieId = String(candidateId).replace(/^javdb:/, '')
    return javdbDetail(movieId, tokenOf(ctx))
  }
}

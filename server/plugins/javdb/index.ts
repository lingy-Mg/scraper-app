import { javdbDetail, javdbIdentify } from './javdb-api'

interface JavdbContext {
  filename?: string
  allowTitle?: boolean
  config?: Record<string, unknown>
}

/** 令牌由用户在插件设置中填写；缺失时保持匿名请求。 */
function tokenOf(ctx: JavdbContext | undefined): string | undefined {
  const value = ctx?.config?.token
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * JavDB 插件：通过官方 App JSON API 刮削。
 * identify() 返回 Candidate[]，resolve() 返回完整详情。
 */
export default {
  async identify(ctx: JavdbContext) {
    return javdbIdentify(ctx.filename ?? '', {
      allowTitle: ctx.allowTitle,
      token: tokenOf(ctx)
    })
  },

  async resolve(ctx: JavdbContext, candidateId: string) {
    const movieId = String(candidateId).replace(/^javdb:/, '')
    return javdbDetail(movieId, tokenOf(ctx))
  }
}

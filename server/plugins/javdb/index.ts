import { javdbDetail, javdbIdentify } from '../../javdb'

/**
 * JavDB 插件：通过官方 App JSON API 刮削。
 * identify() 返回 Candidate[]，resolve() 返回完整详情。
 */
export default {
  async identify(ctx: { filename: string; allowTitle?: boolean }) {
    return javdbIdentify(ctx.filename, { allowTitle: ctx.allowTitle })
  },

  async resolve(_ctx: unknown, candidateId: string) {
    const movieId = String(candidateId).replace(/^javdb:/, '')
    return javdbDetail(movieId)
  }
}

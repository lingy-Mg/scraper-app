import { javdbDetail, javdbIdentify } from '../../javdb'

/**
 * AV 模式：直接复用 JavDB App API 客户端。
 * 与 `javdb` 插件的区别只在元数据默认值和界面文案。
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

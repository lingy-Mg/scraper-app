import { bangumiDetail, bangumiIdentify } from './bangumi'
import { pickText, sourceEnabled } from '../_shared/plugin-utils'
import type { PluginContext } from '../_shared/types'

function tokenOf(ctx: PluginContext): string {
  return pickText(
    ctx.options?.token,
    ctx.modeConfig?.bangumiToken,
    ctx.config?.bangumiToken
  )
}

/** 动漫插件：Bangumi 搜索与详情，token 可选。 */
export default {
  async identify(ctx: PluginContext) {
    if (!sourceEnabled(ctx.config, 'Bangumi')) throw new Error('Bangumi 数据源已关闭')
    return bangumiIdentify(String(ctx.filename ?? ''), tokenOf(ctx) || undefined)
  },

  async resolve(ctx: PluginContext, candidateId: string) {
    return bangumiDetail(candidateId, tokenOf(ctx) || undefined)
  }
}

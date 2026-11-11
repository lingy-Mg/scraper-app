import { tmdbDetail, tmdbIdentify } from './tmdb'
import { localeOf, pickText, sourceEnabled } from './plugin-utils'
import type { PluginContext } from './types'

type MediaType = 'movie' | 'tv'

function settings(ctx: PluginContext) {
  const apiKey = pickText(
    ctx.options?.apiKey,
    ctx.modeConfig?.tmdbApiKey,
    ctx.config?.tmdbApiKey
  )
  if (!apiKey) throw new Error('未配置 TMDB API Key')
  const lang = pickText(
    ctx.options?.lang,
    ctx.modeConfig?.tmdbLang,
    localeOf(ctx.config?.lang)
  )
  return { apiKey, lang }
}

/**
 * 电影 / 电视剧插件共用同一份 TMDB 实现。
 * 每个插件只决定自己的 mediaType，语言与开关从自身 config / modeConfig 读取。
 */
export function makeTmdbPlugin(mediaType: MediaType) {
  return {
    async identify(ctx: PluginContext) {
      if (!sourceEnabled(ctx.config, 'TMDB')) throw new Error('TMDB 数据源已关闭')
      const { apiKey, lang } = settings(ctx)
      return tmdbIdentify(String(ctx.filename ?? ''), mediaType, apiKey, lang)
    },

    async resolve(ctx: PluginContext, candidateId: string) {
      const { apiKey, lang } = settings(ctx)
      return tmdbDetail(candidateId, mediaType, apiKey, lang)
    }
  }
}

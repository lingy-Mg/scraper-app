/** movie / tv / anime 共用的小型插件骨架，真实实现替换 identify 即可。 */
export function makePlugin(kind: 'movie' | 'tv' | 'anime') {
  return {
    async identify(ctx: { filename: string; config: Record<string, unknown> }) {
      const base = ctx.filename
        .replace(/\.[^.]+$/, '')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[._]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      const match = base.match(/[A-Z]{2,6}[-_]?\d{2,6}/i)
      const code = match ? match[0].toUpperCase().replace(/_/g, '-') : ''
      const title =
        base
          .replace(/\([^)]*\)/g, '')
          .replace(/\b(2160p|1080p|720p|bluray|web-dl|x264|x265|hdr)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim() || '未命名'

      return [
        {
          id: `${kind}:1`,
          title,
          year: '2024',
          code: code || `${kind.toUpperCase()}-1`,
          source: kind === 'anime' ? 'Bangumi' : 'TMDB',
          score: 8.2,
          overview: `${kind} 插件返回的候选 1`
        },
        {
          id: `${kind}:2`,
          title: `${title}（另一版本）`,
          year: '2024',
          code: code || `${kind.toUpperCase()}-2`,
          source: 'TMDB',
          score: 7.9,
          overview: `${kind} 插件返回的候选 2`
        }
      ]
    },

    async resolve(_ctx: unknown, candidateId: string) {
      return { id: candidateId }
    }
  }
}

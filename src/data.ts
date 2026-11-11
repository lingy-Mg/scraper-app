import type { AIConfig, ModeConfig, Row } from './types'

export const INITIAL_MODES: Record<string, ModeConfig> = {
  av: {
    key: 'av',
    name: 'AV',
    codeLabel: '番号',
    titleLabel: '标题',
    lang: '日语',
    sources: [
      { label: 'JavDB', on: true },
      { label: 'Minnano', on: true },
      { label: 'FANZA', on: true },
      { label: 'JavBus', on: false }
    ],
    downloads: [
      { label: '封面', on: true },
      { label: '背景图', on: true },
      { label: '预告片', on: true },
      { label: 'NFO', on: true },
      { label: '字幕', on: false }
    ],
    naming: '{片商}/{年份}/{番号} {标题}',
    organize: '{片商}/{年份}/{番号} {标题}'
  },
  movie: {
    key: 'movie',
    name: '电影',
    codeLabel: '文件名',
    titleLabel: '片名',
    lang: '中文',
    sources: [
      { label: 'TMDB', on: true },
      { label: '豆瓣', on: true },
      { label: 'IMDb', on: false }
    ],
    downloads: [
      { label: '封面', on: true },
      { label: '背景图', on: true },
      { label: '预告片', on: false },
      { label: 'NFO', on: true },
      { label: '字幕', on: false }
    ],
    naming: '{标题} ({年份})',
    organize: '电影/{标题} ({年份})',
    tmdbApiKey: '',
    tmdbLang: 'zh-CN'
  },
  tv: {
    key: 'tv',
    name: '电视剧',
    codeLabel: '文件',
    titleLabel: '剧集',
    lang: '中文',
    sources: [
      { label: 'TMDB', on: true },
      { label: 'TVDB', on: true },
      { label: '豆瓣', on: false }
    ],
    downloads: [
      { label: '封面', on: true },
      { label: '剧照', on: true },
      { label: 'NFO', on: true },
      { label: '字幕', on: true }
    ],
    naming: '{剧名}/Season {季}/{剧名} - S{季}E{集}',
    organize: '电视剧/{剧名}/Season {季}',
    tmdbApiKey: '',
    tmdbLang: 'zh-CN'
  },
  anime: {
    key: 'anime',
    name: '动漫',
    codeLabel: '文件',
    titleLabel: '番剧',
    lang: '中文',
    sources: [
      { label: 'Bangumi', on: true },
      { label: 'AniDB', on: true },
      { label: 'TMDB', on: false }
    ],
    downloads: [
      { label: '封面', on: true },
      { label: '剧照', on: true },
      { label: 'NFO', on: true },
      { label: '字幕', on: true }
    ],
    naming: '{剧名}/Season {季}/{剧名} - S{季}E{集}',
    organize: '动漫/{剧名}/Season {季}',
    bangumiToken: ''
  }
}

let uidSeed = 0
const mk = (o: Omit<Row, 'uid'>): Row => ({ uid: ++uidSeed, ...o })

export const INITIAL_AI: AIConfig = {
  enabled: true,
  provider: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.1,
  timeout: 20,
  cleanFilename: true,
  inferCode: true,
  verify: true,
  fallback: true,
  autoPick: true,
  autoPickThreshold: 0.9,
  prompt: `你是影片文件名解析器。从文件名中提取番号和标题。
只返回 JSON，不要解释：
{"code": "番号", "title": "标题", "confidence": 0.0}

文件名：{filename}`
}

export const INITIAL_ROWS: Row[] = [
  mk({
    code: 'IDPC-001',
    title: '影片本体',
    src: 'JavDB',
    status: 'done',
    progress: 100,
    dur: 9229,
    size: 7358845171,
    poster: 0,
    maker: 'IDEA POCKET',
    year: '2026',
    actors: '—',
    file: '489155.com@IDPC-001.mp4',
    ai: true,
    aiConfidence: 0.98
  }),
  mk({
    code: '',
    title: '未识别视频 1',
    src: '',
    status: 'unmatched',
    progress: 0,
    dur: 59,
    size: 13890047,
    poster: 1,
    file: '未识别视频 1.mp4'
  }),
  mk({
    code: '',
    title: '未识别视频 2',
    src: '',
    status: 'unmatched',
    progress: 0,
    dur: 90,
    size: 15089802,
    poster: 2,
    file: '未识别视频 2.mp4'
  }),
  mk({
    code: '',
    title: '黑客帝国',
    src: '',
    status: 'review',
    progress: 0,
    dur: 8160,
    size: 8804687053,
    poster: 3,
    file: '黑客帝国.The.Matrix.1999.2160p.BluRay.mkv',
    query: '黑客帝国 The Matrix 1999',
    candidates: [
      {
        id: 'tmdb-603',
        title: '黑客帝国',
        year: '1999',
        code: 'The Matrix',
        source: 'TMDB',
        score: 8.7,
        overview: '一名黑客发现自己所处的世界只是机器构建的虚拟现实。',
        poster: 3
      },
      {
        id: 'tmdb-604',
        title: '黑客帝国2：重装上阵',
        year: '2003',
        code: 'The Matrix Reloaded',
        source: 'TMDB',
        score: 8.0,
        overview: '尼奥与崔妮蒂继续对抗机器军团，锡安的存亡迫在眉睫。',
        poster: 4
      },
      {
        id: 'tmdb-605',
        title: '黑客帝国3：矩阵革命',
        year: '2003',
        code: 'The Matrix Revolutions',
        source: 'TMDB',
        score: 7.6,
        overview: '人类与机器的最终决战，尼奥走向矩阵的核心。',
        poster: 5
      },
      {
        id: 'tmdb-624860',
        title: '黑客帝国4：矩阵重启',
        year: '2021',
        code: 'The Matrix Resurrections',
        source: 'TMDB',
        score: 6.5,
        overview: '尼奥与崔妮蒂再次回到矩阵，现实与幻觉的边界被打破。',
        poster: 3
      },
      {
        id: 'tmdb-55931',
        title: '黑客帝国动画版',
        year: '2003',
        code: 'The Animatrix',
        source: 'TMDB',
        score: 7.8,
        overview: '九部短片组成的动画合集，补完矩阵世界的前史。',
        poster: 4
      },
      {
        id: 'douban-1291843',
        title: '黑客帝国（国语配音）',
        year: '1999',
        code: 'The Matrix',
        source: '豆瓣',
        score: 9.1,
        overview: '国语配音版本，画质修复。',
        poster: 5
      }
    ]
  })
]

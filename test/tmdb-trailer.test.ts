import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 仅测试解析逻辑；TMDB 请求全部由 mock fetch 返回，不联网。 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-tmdb-'))
process.env.SCRAPER_DATA_DIR = dataDir

type Tmdb = typeof import('../server/plugins/_shared/tmdb')
let tmdbDetail: Tmdb['tmdbDetail']

const realFetch = globalThis.fetch
let calls: string[] = []
let videosResponse: () => Response = () =>
  Response.json({ results: [] })
let failVideos = false

function mockFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input)
  calls.push(url)

  if (url.includes('/videos')) {
    if (failVideos) {
      return Promise.resolve(new Response('boom', { status: 500 }))
    }
    return Promise.resolve(videosResponse())
  }

  return Promise.resolve(
    Response.json({
      id: 603,
      title: '黑客帝国',
      original_title: 'The Matrix',
      release_date: '1999-03-31',
      overview: '测试简介',
      vote_average: 8.7,
      runtime: 136,
      poster_path: '/matrix.jpg',
      production_companies: [{ name: 'Warner Bros.' }],
      genres: [{ name: '科幻' }],
      credits: { cast: [{ name: 'Keanu Reeves' }] }
    })
  )
}

beforeAll(async () => {
  tmdbDetail = (await import('../server/plugins/_shared/tmdb')).tmdbDetail
  globalThis.fetch = mockFetch as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  rmSync(dataDir, { recursive: true, force: true })
})

describe('TMDB 预告片', () => {
  test('优先官方 Trailer，其次 Teaser；返回 YouTube watch URL', async () => {
    calls = []
    failVideos = false
    videosResponse = () =>
      Response.json({
        results: [
          {
            key: 'teaser-official',
            site: 'YouTube',
            type: 'Teaser',
            official: true
          },
          {
            key: 'trailer-unofficial',
            site: 'YouTube',
            type: 'Trailer',
            official: false
          },
          {
            key: 'trailer-official',
            site: 'YouTube',
            type: 'Trailer',
            official: true
          }
        ]
      })

    const detail = await tmdbDetail('movie:603', 'movie', 'test-key', 'zh-CN')

    expect(detail.title).toBe('黑客帝国')
    expect(detail.duration).toBe(136 * 60)
    expect(detail.trailerUrl).toBe(
      'https://www.youtube.com/watch?v=trailer-official'
    )
    expect(detail.trailerSite).toBe('YouTube')
    expect(calls.some((url) => url.includes('/movie/603/videos'))).toBe(true)
  })

  test('没有 YouTube 预告片时字段为空', async () => {
    failVideos = false
    videosResponse = () =>
      Response.json({
        results: [
          { key: 'abc', site: 'Vimeo', type: 'Trailer', official: true },
          { key: 'clip', site: 'YouTube', type: 'Clip', official: true }
        ]
      })

    const detail = await tmdbDetail('tv:1399', 'tv', 'test-key')
    expect(detail.trailerUrl).toBeUndefined()
    expect(detail.trailerSite).toBeUndefined()
  })

  test('预告片请求失败不影响详情主流程', async () => {
    failVideos = true
    const detail = await tmdbDetail('movie:603', 'movie', 'test-key')
    expect(detail.title).toBe('黑客帝国')
    expect(detail.trailerUrl).toBeUndefined()
  })
})

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * JavDB 客户端会在模块加载时解析 DATA_DIR（设备 UUID 落盘）。
 * 延迟到 beforeAll 导入，避免与其他测试文件的顶层环境赋值交错。
 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-javdb-'))
process.env.SCRAPER_DATA_DIR = dataDir

type JavdbApi = typeof import('../server/plugins/javdb/javdb-api')
type Registry = typeof import('../server/registry')

let searchMovies: JavdbApi['searchMovies']
let maskConfig: Registry['maskConfig']

const realFetch = globalThis.fetch
let calls: { url: string; headers: Record<string, string> }[] = []
let responseBody: unknown = { success: 1, data: { movies: [] } }

function mockFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  calls.push({
    url: String(input),
    headers: (init?.headers ?? {}) as Record<string, string>
  })
  return Promise.resolve(
    new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  )
}

beforeAll(async () => {
  const api = await import('../server/plugins/javdb/javdb-api')
  const registry = await import('../server/registry')
  searchMovies = api.searchMovies
  maskConfig = registry.maskConfig
  globalThis.fetch = mockFetch as typeof fetch
})

afterAll(() => {
  globalThis.fetch = realFetch
  rmSync(dataDir, { recursive: true, force: true })
})

describe('JavDB 访问令牌', () => {
  test('有令牌时请求头带 Bearer，无令牌时不带（mock fetch，不联网）', async () => {
    calls = []
    responseBody = {
      success: 1,
      data: {
        movies: [{ id: '1', number: 'SSIS-001', title: '测试影片', duration: 120 }]
      }
    }

    const withToken = await searchMovies('SSIS-001', 5, 'secret-token')
    expect(withToken).toHaveLength(1)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.startsWith('https://')).toBe(true)
    expect(calls[0].headers.authorization).toBe('Bearer secret-token')

    calls = []
    await searchMovies('SSIS-001', 5)
    expect(calls).toHaveLength(1)
    expect(calls[0].headers.authorization).toBeUndefined()
  }, 15000)
})

describe('鉴权错误中文化', () => {
  test('已填写令牌但鉴权失败时提示更新令牌', async () => {
    responseBody = {
      success: 0,
      action: 'api/v2/search',
      message: 'JWTVerificationError: 請登錄帳號'
    }

    const error = await searchMovies('SSIS-001', 5, 'expired-token').catch(
      (reason: unknown) => reason
    )
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('登录已失效')
    expect((error as Error).message).toContain('访问令牌')
  }, 30000)

  test('未填写令牌时提示填写令牌', async () => {
    responseBody = {
      success: 0,
      action: 'api/v2/search',
      message: 'LoginRequired: 請登錄帳號'
    }

    const error = await searchMovies('SSIS-001', 5).catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('需要登录')
    expect((error as Error).message).toContain('访问令牌')
  }, 30000)
})

describe('插件配置脱敏', () => {
  test('token 有值时返回占位符，空值保持为空', () => {
    expect(maskConfig({ token: 'secret', lang: '中文' })).toEqual({
      token: '••••••••',
      lang: '中文'
    })
    expect(maskConfig({ token: '' })).toEqual({ token: '' })
    expect(maskConfig({ lang: '中文' })).toEqual({ lang: '中文' })
  })
})

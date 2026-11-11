import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 见 library.test.ts：DATA_DIR 在模块加载时解析，延迟到 beforeAll
 * 可避开 Bun 并发测试文件之间的顶层环境交错。
 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-plugins-'))
process.env.SCRAPER_DATA_DIR = dataDir

const userRoot = join(dataDir, 'plugins')
const cacheDir = join(dataDir, '.plugin-cache')

let getPlugin: typeof import('../server/registry').getPlugin
let getPlugins: typeof import('../server/registry').getPlugins
let loadAll: typeof import('../server/registry').loadAll
let maskConfig: typeof import('../server/registry').maskConfig
let reload: typeof import('../server/registry').reload

beforeAll(async () => {
  const registry = await import('../server/registry')
  getPlugin = registry.getPlugin
  getPlugins = registry.getPlugins
  loadAll = registry.loadAll
  maskConfig = registry.maskConfig
  reload = registry.reload
})

const BUILTIN_IDS = ['javdb', 'av', 'movie', 'tv', 'anime']

interface PluginOptions {
  name?: string
  capabilities?: string[]
  entrySource?: string
}

function writePlugin(id: string, options: PluginOptions = {}): string {
  const dir = join(userRoot, id)
  mkdirSync(dir, { recursive: true })
  const manifest: Record<string, unknown> = {
    id,
    name: options.name ?? id,
    version: '1.0.0',
    apiVersion: 1,
    labels: { code: '编号', title: '标题' },
    defaults: {
      lang: '中文',
      sources: [],
      downloads: [],
      naming: '{标题}',
      organize: '{标题}'
    }
  }
  if (options.capabilities) manifest.capabilities = options.capabilities
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2), 'utf8')
  writeFileSync(
    join(dir, 'index.ts'),
    options.entrySource ??
      [
        'export default {',
        `  identify() { return [{ id: '${id}:1', title: '${id}', year: '', source: '${id}', score: 1, overview: '', poster: 1 }] },`,
        `  resolve(_ctx: unknown, candidateId: string) { return { id: candidateId, title: '${id}' } }`,
        '}'
      ].join('\n'),
    'utf8'
  )
  return dir
}

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('插件加载', () => {
  test('内置插件全部加载成功', async () => {
    await loadAll()
    const plugins = getPlugins()
    for (const id of BUILTIN_IDS) {
      const plugin = plugins.find((entry) => entry.manifest.id === id)
      expect(plugin).toBeDefined()
      expect(plugin!.status).toBe('ok')
      expect(plugin!.source).toBe('builtin')
    }
  }, 30000)

  test('未声明 capabilities 时默认 identify + resolve', async () => {
    writePlugin('caps-demo', { name: 'Caps Demo' })
    await loadAll()

    const plugin = getPlugin('caps-demo')!
    expect(plugin.status).toBe('ok')
    expect(plugin.capabilities).toEqual(['identify', 'resolve'])
  }, 30000)

  test('用户目录同 id 覆盖内置插件', async () => {
    writePlugin('movie', { name: '用户电影', capabilities: ['identify'] })
    writePlugin('override-demo')
    await loadAll()

    const movie = getPlugins().filter((entry) => entry.manifest.id === 'movie')
    expect(movie).toHaveLength(1)
    expect(movie[0].source).toBe('user')
    expect(movie[0].manifest.name).toBe('用户电影')
    expect(movie[0].capabilities).toEqual(['identify'])

    // 其它用户插件不受影响
    expect(getPlugin('override-demo')!.status).toBe('ok')
  }, 30000)

  test('坏插件只标记 error，不影响其他插件', async () => {
    writePlugin('broken-demo', {
      entrySource: 'export default { identify( ' // 语法错误
    })
    await loadAll()

    const broken = getPlugin('broken-demo')!
    expect(broken.status).toBe('error')
    expect(String(broken.error)).toContain('插件打包失败')

    const javdb = getPlugin('javdb')!
    expect(javdb.status).toBe('ok')
    expect(getPlugins().filter((entry) => entry.status === 'ok').length).toBeGreaterThanOrEqual(
      BUILTIN_IDS.length
    )
  }, 30000)
})

describe('热重载与缓存', () => {
  test('reload 后加载新实现', async () => {
    writePlugin('reload-demo', {
      entrySource: "export default { version() { return 'v1' } }"
    })
    await loadAll()
    expect(getPlugin('reload-demo')!.impl.version()).toBe('v1')

    // 改变文件内容与大小，确保目录指纹哈希变化。
    writePlugin('reload-demo', {
      entrySource: "export default { version() { return 'v2-reloaded' } }"
    })
    await reload('reload-demo')

    const plugin = getPlugin('reload-demo')!
    expect(plugin.status).toBe('ok')
    expect(plugin.impl.version()).toBe('v2-reloaded')
  }, 30000)

  test('打包缓存每个插件只保留最新 2 个产物', async () => {
    mkdirSync(cacheDir, { recursive: true })
    for (let index = 1; index <= 4; index += 1) {
      const path = join(cacheDir, `prunetest-builtin-${String(index).padStart(12, '0')}.mjs`)
      writeFileSync(path, `export const v = ${index}\n`, 'utf8')
      const time = new Date(2026, 0, 1, 0, 0, index)
      utimesSync(path, time, time)
    }

    await loadAll()

    const remaining = readdirSync(cacheDir)
      .filter((name) => name.startsWith('prunetest-builtin-'))
      .sort()
    expect(remaining).toHaveLength(2)
    expect(remaining).toEqual([
      'prunetest-builtin-000000000003.mjs',
      'prunetest-builtin-000000000004.mjs'
    ])
  }, 30000)
})

describe('配置脱敏', () => {
  test('token 有值时脱敏，空值保留', () => {
    expect(maskConfig({ token: 'plain-secret', lang: '中文' })).toEqual({
      token: '••••••••',
      lang: '中文'
    })
    expect(maskConfig({ token: '' }).token).toBe('')
    expect(maskConfig({ lang: '中文' })).toEqual({ lang: '中文' })
  })
})

/**
 * HTTP 端到端冒烟测试。
 *
 * 启动真实 Bun 服务（随机高位端口 + 独立 SCRAPER_DATA_DIR 临时目录），
 * 依次验证扫描 → 探测 → 媒体库 → 整理 → 回收站。
 * 任一步不符立即以退出码 1 结束；finally 杀掉服务并删除临时目录。
 * 绝不触碰项目 data/ 或用户真实文件。
 *
 * 用法：bun scripts/smoke.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

class SmokeError extends Error {}

function assert(condition, message, actual) {
  if (condition) return
  const detail = actual === undefined ? '' : `（实际值：${JSON.stringify(actual)}）`
  throw new SmokeError(`${message}${detail}`)
}

/** 只有 moov/mvhd 的最小 MP4，用于不依赖 ffprobe 验证时长解析。 */
function mp4WithDuration(seconds) {
  const mvhd = Buffer.alloc(28)
  mvhd.writeUInt32BE(28, 0)
  mvhd.write('mvhd', 4, 'latin1')
  mvhd.writeUInt32BE(1000, 20) // timescale
  mvhd.writeUInt32BE(seconds * 1000, 24) // duration

  const moov = Buffer.alloc(8 + mvhd.length)
  moov.writeUInt32BE(moov.length, 0)
  moov.write('moov', 4, 'latin1')
  mvhd.copy(moov, 8)
  return moov
}

async function freePort() {
  const probe = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response('ok')
  })
  const port = probe.port
  probe.stop(true)
  return port
}

function startServer(port, dataDir) {
  const child = Bun.spawn([process.execPath, 'server/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SCRAPER_DATA_DIR: dataDir },
    stdout: 'pipe',
    stderr: 'pipe'
  })

  const logs = { stdout: '', stderr: '' }
  const pump = async (stream, key) => {
    try {
      for await (const chunk of stream) logs[key] += Buffer.from(chunk).toString('utf8')
    } catch {
      // 进程被终止时忽略读取错误
    }
  }
  pump(child.stdout, 'stdout')
  pump(child.stderr, 'stderr')

  return { child, logs }
}

async function waitReady(baseUrl, child, logs) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new SmokeError(
        `服务提前退出（code=${child.exitCode}）：${logs.stderr || logs.stdout || '无输出'}`
      )
    }
    try {
      const response = await fetch(`${baseUrl}/api/info`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return await response.json()
    } catch {
      // 尚未监听，继续轮询
    }
    await sleep(100)
  }
  throw new SmokeError(`服务在 20s 内未就绪：${logs.stderr || logs.stdout || '无输出'}`)
}

async function request(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    signal: AbortSignal.timeout(90000)
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }
  assert(
    response.ok,
    `${options.method ?? 'GET'} ${path} 返回 HTTP ${response.status}`,
    body
  )
  return body
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([child.exited, sleep(5000)])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await Promise.race([child.exited, sleep(2000)])
  }
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), 'scraper-smoke-'))
  const dataDir = join(workDir, 'runtime-data')
  const mediaDir = join(workDir, 'media')
  const trashDir = join(workDir, 'trash')
  const destDir = join(workDir, 'organized')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(join(mediaDir, '.hidden'), { recursive: true })
  mkdirSync(trashDir, { recursive: true })

  const movie = join(mediaDir, 'movie.mp4')
  writeFileSync(movie, mp4WithDuration(125))
  const sourceSubtitle = join(mediaDir, 'movie.zh.srt')
  writeFileSync(sourceSubtitle, 'subtitle-bytes')
  writeFileSync(join(mediaDir, '.hidden', 'secret.mp4'), mp4WithDuration(60))
  writeFileSync(join(mediaDir, 'types.d.ts'), 'export {}')
  writeFileSync(join(mediaDir, 'sample-trailer.mp4'), mp4WithDuration(5))
  writeFileSync(join(mediaDir, 'notes.txt'), 'not a video')
  const victim = join(trashDir, 'victim.mp4')
  writeFileSync(victim, mp4WithDuration(10))

  const port = await freePort()
  const baseUrl = `http://127.0.0.1:${port}`
  let server = null
  const steps = []

  const step = (name, fn) =>
    fn().then(
      (value) => {
        steps.push(name)
        console.log(`  ok  ${name}`)
        return value
      },
      (error) => {
        console.error(`  FAIL ${name}`)
        throw error
      }
    )

  try {
    server = startServer(port, dataDir)
    const info = await step('GET /api/info', () => waitReady(baseUrl, server.child, server.logs))
    assert(typeof info.version === 'string' && info.version.length > 0, 'info.version 缺失', info)
    assert(typeof info.ffprobe === 'boolean', 'info.ffprobe 应为布尔值', info)

    const scan = await step('POST /api/scan（过滤隐藏/.d.ts/黑名单）', () =>
      request(baseUrl, '/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: mediaDir, blacklist: ['sample*'] })
      })
    )
    assert(Array.isArray(scan), 'scan 应返回数组', scan)
    assert(scan.length === 1, 'scan 应只返回 movie.mp4', scan.map((file) => file.name))
    assert(scan[0].name === 'movie.mp4', 'scan 命中了错误文件', scan[0].name)

    await step('POST /api/scan stream=true（NDJSON 进度）', async () => {
      const response = await fetch(`${baseUrl}/api/scan`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: mediaDir, stream: true, blacklist: ['sample*'] }),
        signal: AbortSignal.timeout(60000)
      })
      assert(response.ok, `流式扫描 HTTP ${response.status}`)
      assert(
        String(response.headers.get('content-type') ?? '').includes('ndjson'),
        '流式扫描 content-type 应为 NDJSON',
        response.headers.get('content-type')
      )
      const lines = (await response.text()).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      const progress = lines.filter((event) => event.type === 'progress')
      const done = lines.find((event) => event.type === 'done')
      assert(progress.length > 0, '缺少 progress 事件', lines)
      assert(progress.every((event) => event.progress?.phase), 'progress 缺少 phase', progress)
      assert(done, '缺少 done 事件', lines)
      assert(done.files.length === 1, 'done.files 应只包含 movie.mp4', done.files.map((f) => f.name))
    })

    const probed = await step('POST /api/probe', () =>
      request(baseUrl, '/api/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: movie })
      })
    )
    assert(probed.duration === 125, 'probe 时长应为 125 秒', probed.duration)
    assert(probed.probedBy === 'mp4', 'probe 应走 mp4 解析', probed.probedBy)

    await step('媒体库 upsert/list/clear', async () => {
      const upsert = await request(baseUrl, '/api/library/upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              path: movie,
              file: 'movie.mp4',
              mode: 'av',
              code: 'ABC-123',
              title: '冒烟测试影片',
              status: 'done',
              dur: 125
            }
          ]
        })
      })
      assert(upsert.count === 1, 'upsert 应写入 1 行', upsert)

      const listed = await request(baseUrl, '/api/library/list')
      assert(listed.items.length === 1, '媒体库应有 1 行', listed.items)
      assert(listed.items[0].title === '冒烟测试影片', '媒体库标题不一致', listed.items[0])

      const cleared = await request(baseUrl, '/api/library/clear', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'av' })
      })
      assert(cleared.count === 1, '清空 av 模式应删除 1 行', cleared)
      const empty = await request(baseUrl, '/api/library/list')
      assert(empty.items.length === 0, '清空后媒体库应为空', empty.items)
    })

    await step('媒体库 query / duplicates / stats', async () => {
      const libraryDir = join(workDir, 'library-media')
      mkdirSync(libraryDir, { recursive: true })
      const items = [
        {
          path: join(libraryDir, 'a.mp4'),
          file: 'a.mp4',
          mode: 'av',
          code: 'DUP-001',
          title: 'Alpha',
          status: 'done',
          dur: 600,
          size: 1000,
          maker: 'StudioA',
          actors: 'Maria / John',
          tags: ['高清', '中文字幕'],
          updatedAt: 1000
        },
        {
          path: join(libraryDir, 'b.mp4'),
          file: 'b.mp4',
          mode: 'av',
          code: 'DUP-001',
          title: 'Beta',
          status: 'done',
          dur: 600,
          size: 1000,
          maker: 'StudioA',
          actors: 'Maria',
          tags: ['高清'],
          updatedAt: 2000
        },
        {
          path: join(libraryDir, 'c.mp4'),
          file: 'c.mp4',
          mode: 'movie',
          title: 'Gamma',
          status: 'unmatched',
          dur: 700,
          size: 2000,
          updatedAt: 3000
        }
      ]
      const upsert = await request(baseUrl, '/api/library/upsert', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items })
      })
      assert(upsert.count === 3, '增强测试应写入 3 行', upsert)

      const all = await request(baseUrl, '/api/library/query?limit=5')
      assert(all.total === 3 && all.items.length === 3, 'query 应返回 3 条', all)

      const filtered = await request(
        baseUrl,
        `/api/library/query?q=alpha&mode=av&maker=studio&actor=maria&tag=${encodeURIComponent(
          '高清'
        )}&sort=title&order=asc&limit=1&offset=0`
      )
      assert(filtered.total === 1, '组合筛选应返回 1 条', filtered)
      assert(filtered.items[0]?.title === 'Alpha', '组合筛选命中错误记录', filtered.items[0])

      const page = await request(baseUrl, '/api/library/query?sort=title&order=asc&limit=1&offset=1')
      assert(page.total === 3, '分页 total 应为 3', page)
      assert(page.items.length === 1 && page.items[0].title === 'Beta', '分页 offset 无效', page.items)

      const stats = await request(baseUrl, '/api/library/stats')
      assert(stats.total === 3, 'stats.total 应为 3', stats)
      assert(stats.totalSize === 4000, 'stats.totalSize 应为 4000', stats.totalSize)
      assert(stats.byMode.av === 2 && stats.byMode.movie === 1, 'stats.byMode 不符', stats.byMode)
      assert(
        stats.topMakers[0]?.name === 'StudioA' && stats.topMakers[0]?.count === 2,
        'stats.topMakers 不符',
        stats.topMakers
      )
      assert(
        stats.topActors[0]?.name === 'Maria' && stats.topActors[0]?.count === 2,
        'stats.topActors 不符',
        stats.topActors
      )
      assert(
        stats.topTags.some((tag) => tag.name === '高清' && tag.count === 2),
        'stats.topTags 不符',
        stats.topTags
      )

      const dup = await request(baseUrl, '/api/library/duplicates?mode=av')
      assert(dup.groups.length === 1, '应只有 1 个重复分组', dup.groups)
      assert(dup.groups[0].reason === 'code', '应优先按番号分组', dup.groups[0])
      assert(dup.groups[0].items.length === 2, '番号分组应有 2 条', dup.groups[0])

      const movieStats = await request(baseUrl, '/api/library/stats?mode=movie')
      assert(movieStats.total === 1 && movieStats.byMode.movie === 1, 'mode 过滤统计不符', movieStats)

      for (const path of [
        '/api/library/query?limit=abc',
        '/api/library/query?limit=0',
        '/api/library/query?offset=-1',
        '/api/library/query?sort=bogus',
        '/api/library/query?order=up'
      ]) {
        const response = await fetch(`${baseUrl}${path}`)
        assert(response.status === 400, `${path} 应返回 400`, response.status)
      }
    })

    await step('来源管理（增删/去重/不删文件）', async () => {
      const samePath = (a, b) =>
        a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

      const initial = await request(baseUrl, '/api/sources')
      assert(
        initial.sources.some((source) => samePath(source.path, mediaDir)),
        '扫描成功后应自动登记来源',
        initial.sources
      )

      const extraDir = join(workDir, 'extra-source')
      mkdirSync(extraDir, { recursive: true })
      const added = await request(baseUrl, '/api/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: extraDir, name: '额外来源' })
      })
      assert(added.added === true, '添加来源应成功', added)
      assert(added.source.name === '额外来源', '自定义名称未保存', added.source)
      assert(added.sources.length === 2, '添加后应有 2 个来源', added.sources)

      const duplicate = await request(baseUrl, '/api/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: extraDir })
      })
      assert(duplicate.added === false, '重复添加应去重', duplicate)
      assert(duplicate.sources.length === 2, '重复添加不应增加来源', duplicate.sources)

      const badPath = await fetch(`${baseUrl}/api/sources`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'relative/path' })
      })
      assert(badPath.status === 400, '相对路径添加来源应返回 400', badPath.status)

      const missingPath = await fetch(`${baseUrl}/api/sources`, { method: 'DELETE' })
      assert(missingPath.status === 400, '缺少 path 的删除应返回 400', missingPath.status)

      const removed = await request(
        baseUrl,
        `/api/sources?path=${encodeURIComponent(extraDir)}`,
        { method: 'DELETE' }
      )
      assert(removed.removed === true, '删除来源应成功', removed)
      assert(
        !removed.sources.some((source) => samePath(source.path, extraDir)),
        '删除后来源列表仍包含该项',
        removed.sources
      )
      assert(existsSync(extraDir), '删除来源不应删除目录', extraDir)
      assert(
        removed.sources.some((source) => samePath(source.path, mediaDir)),
        '删除来源不应影响其它来源',
        removed.sources
      )

      const library = await request(baseUrl, '/api/library/query?limit=5')
      assert(library.total === 3, '删除来源不应删除媒体库记录', library.total)
    })

    await step('POST /api/organize（copy + NFO 落盘）', async () => {
      const nfo = '<movie><title>冒烟测试影片</title></movie>'
      const results = await request(baseUrl, '/api/organize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dest: destDir,
          action: 'copy',
          conflict: 'rename',
          items: [{ source: movie, relativeTarget: 'movies/movie.mp4', nfo }]
        })
      })
      assert(Array.isArray(results) && results.length === 1, 'organize 应返回 1 条结果', results)
      assert(results[0].ok === true, 'organize 应成功', results[0])
      const target = results[0].target
      assert(existsSync(target), '整理后的视频不存在', target)
      const nfoPath = target.replace(/\.mp4$/i, '.nfo')
      assert(existsSync(nfoPath), 'NFO 未落盘', nfoPath)
      assert(readFileSync(nfoPath, 'utf8') === nfo, 'NFO 内容不一致', readFileSync(nfoPath, 'utf8'))
      assert(existsSync(movie), 'copy 不应删除源文件', movie)
    })

    await step('POST /api/organize（字幕/预告片开关）', async () => {
      const subsOnDir = join(workDir, 'subs-on')
      const subsOffDir = join(workDir, 'subs-off')
      const nfo = '<movie><title>冒烟测试影片</title></movie>'
      const items = [
        {
          source: movie,
          relativeTarget: 'movies/movie.mp4',
          nfo,
          trailerUrl: 'https://www.youtube.com/watch?v=smoke'
        }
      ]

      const on = await request(baseUrl, '/api/organize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dest: subsOnDir,
          action: 'copy',
          conflict: 'rename',
          downloads: [
            { label: '字幕', on: true },
            { label: 'NFO', on: true },
            { label: '预告片', on: true },
            { label: '封面', on: false }
          ],
          items
        })
      })
      assert(on[0]?.ok === true, '字幕开启时整理应成功', on[0])
      const target = on[0].target
      const subtitleTarget = target.replace(/\.mp4$/i, '.zh.srt')
      assert(existsSync(subtitleTarget), '字幕未复制到目标目录', subtitleTarget)
      assert(
        readFileSync(subtitleTarget, 'utf8') === 'subtitle-bytes',
        '目标字幕内容不一致',
        readFileSync(subtitleTarget, 'utf8')
      )
      assert(existsSync(sourceSubtitle), '字幕源文件不应被删除', sourceSubtitle)
      const nfoTarget = target.replace(/\.mp4$/i, '.nfo')
      assert(
        readFileSync(nfoTarget, 'utf8').includes(
          '<trailer>https://www.youtube.com/watch?v=smoke</trailer>'
        ),
        'NFO 未写入 <trailer>',
        readFileSync(nfoTarget, 'utf8')
      )

      const off = await request(baseUrl, '/api/organize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          dest: subsOffDir,
          action: 'copy',
          conflict: 'rename',
          downloads: [
            { label: '字幕', on: false },
            { label: 'NFO', on: false },
            { label: '预告片', on: true }
          ],
          items
        })
      })
      assert(off[0]?.ok === true, '字幕关闭时整理应成功', off[0])
      assert(
        !existsSync(join(subsOffDir, 'movies', 'movie.zh.srt')),
        '字幕关闭时不应复制字幕'
      )
      assert(!existsSync(join(subsOffDir, 'movies', 'movie.nfo')), 'NFO 关闭时不应写 NFO')
    })

    await step('POST /api/trash（源文件移入回收站）', async () => {
      const result = await request(baseUrl, '/api/trash', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths: [victim] })
      })
      assert(result.removed === 1, 'trash 应删除 1 个文件', result)
      assert(Array.isArray(result.failed) && result.failed.length === 0, 'trash 不应有失败项', result)
      assert(!existsSync(victim), '回收站删除后源文件仍存在', victim)
    })

    console.log(`\nSMOKE OK：${steps.length} 项全部通过（端口 ${port}）`)
    return 0
  } catch (error) {
    console.error(`\nSMOKE FAILED：${error instanceof Error ? error.message : String(error)}`)
    if (server?.logs.stderr) console.error(`--- server stderr ---\n${server.logs.stderr}`)
    return 1
  } finally {
    await stopServer(server?.child)
    rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

process.exit(await main())

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

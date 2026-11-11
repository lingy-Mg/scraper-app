/**
 * 一键自检：tsc → bun build → bun test → npm run build。
 *
 * - 任一步失败立即以非零退出码结束，并打印每步耗时与结果汇总。
 * - TEMP/TMP 指向项目内 `.tmp/`（已 gitignore），规避 Windows 上
 *   esbuild 清理系统临时目录偶发 Access denied。
 * - 结束时删除本次临时目录；`.tmp/` 为空则一并删除。
 *
 * 用法：bun scripts/check.mjs
 */
import { mkdirSync, readdirSync, rmSync, rmdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runId = `${process.pid}-${Date.now().toString(36)}`
const tempRoot = join(root, '.tmp', `check-${runId}`)
const tempDir = join(tempRoot, 'tmp')
mkdirSync(tempDir, { recursive: true })

const env = { ...process.env, TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir }
const bun = process.execPath
const outfile = join(tempDir, 'server-check.js')

const steps = [
  { name: 'npx tsc --noEmit', command: 'npx tsc --noEmit' },
  {
    name: 'bun build server/index.ts',
    command: `"${bun}" build server/index.ts --target=bun --outfile="${outfile}"`
  },
  { name: 'bun test', command: `"${bun}" test` },
  { name: 'npm run build', command: 'npm run build' }
]

const results = []
let failed = false

for (let index = 0; index < steps.length; index += 1) {
  const step = steps[index]
  const label = `[${index + 1}/${steps.length}] ${step.name}`
  process.stdout.write(`${label} ... `)
  const started = performance.now()

  const result = spawnSync(step.command, {
    cwd: root,
    env,
    shell: true,
    stdio: 'inherit'
  })
  const seconds = ((performance.now() - started) / 1000).toFixed(1)
  const ok = !result.error && result.status === 0

  results.push({ name: step.name, ok, seconds, status: result.status, error: result.error })
  console.log(ok ? `ok (${seconds}s)` : `FAILED (${seconds}s)`)

  if (!ok) {
    failed = true
    if (result.error) console.error(`  无法启动：${result.error.message}`)
    break
  }
}

console.log('\n==== 检查汇总 ====')
for (const result of results) {
  const state = result.ok ? 'PASS' : 'FAIL'
  console.log(`${state}  ${result.name}  ${result.seconds}s`)
}
const skipped = steps.length - results.length
if (skipped > 0) console.log(`SKIP  ${skipped} 项（前序步骤失败）`)
console.log(failed ? '\nCHECK FAILED' : `\nCHECK OK（${results.length}/${steps.length}）`)

rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
try {
  if (readdirSync(join(root, '.tmp')).length === 0) rmdirSync(join(root, '.tmp'))
} catch {
  // .tmp 不存在或被其他进程使用，忽略
}

process.exit(failed ? 1 : 0)

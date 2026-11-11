/**
 * Playwright webServer 启动脚本。
 *
 * 1. 清空隔离数据目录（默认 `.tmp/e2e-data`），保证每次运行不读取上次的设置/媒体库；
 * 2. `npm run build` 构建前端；
 * 3. 在当前 Bun 进程内加载 `server/index.ts`，同时托管 dist 与 API。
 *
 * 与 `scripts/start.mjs` 不同，这里不打开浏览器。Playwright 结束时直接终止本进程，
 * 服务随进程退出，不会残留端口。
 */
import { mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = resolve(process.env.SCRAPER_DATA_DIR?.trim() || join(root, '.tmp', 'e2e-data'))
const port = process.env.PORT?.trim() || '5180'

rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
mkdirSync(dataDir, { recursive: true })

console.log(`[e2e] 隔离数据目录：${dataDir}`)
console.log('[e2e] 构建前端 …')
const build = spawnSync('npm run build', {
  cwd: root,
  shell: true,
  stdio: 'inherit'
})
if (build.error) {
  console.error(`[e2e] 无法启动构建：${build.error.message}`)
  process.exit(1)
}
if (build.status !== 0) {
  console.error(`[e2e] 前端构建失败（退出码 ${build.status}）`)
  process.exit(build.status ?? 1)
}

process.env.SCRAPER_SERVE_DIST = '1'
process.env.SCRAPER_DATA_DIR = dataDir
process.env.PORT = port

await import('../server/index.ts')

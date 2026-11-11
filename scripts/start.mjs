/**
 * 单进程生产启动：Bun 同时托管 API、插件资源与 dist 静态文件。
 * 启动完成后用默认浏览器打开 http://127.0.0.1:<port>。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const index = resolve(root, 'dist', 'index.html')

if (!existsSync(index)) {
  console.warn('[scraper] 未找到 dist/index.html，请先运行 npm run build')
}

process.env.SCRAPER_SERVE_DIST = '1'
const { server } = await import('../server/index.ts')
const url = `http://127.0.0.1:${server.port}`

function openBrowser(target) {
  const options = { detached: true, stdio: 'ignore', windowsHide: true }
  let child
  if (process.platform === 'win32') {
    child = spawn('cmd', ['/c', 'start', '', target], options)
  } else if (process.platform === 'darwin') {
    child = spawn('open', [target], options)
  } else {
    child = spawn('xdg-open', [target], options)
  }
  child.on('error', () => {})
  child.unref()
}

setTimeout(() => openBrowser(url), 300)

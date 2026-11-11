import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 全部用例结束后清理项目内临时目录，避免残留测试媒体与构建临时文件。
 * `.tmp/e2e-data` 保留：Playwright 结束时会强制终止 Bun 进程，SQLite 文件仍被
 * 持有（Windows 上删除报 EPERM），因此改由 `scripts/e2e-server.mjs` 在每次
 * 运行前清空，保证各次运行互不影响。
 */
export default function globalTeardown(): void {
  for (const name of ['e2e-media', 'e2e-tmp']) {
    rmSync(resolve(process.cwd(), '.tmp', name), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    })
  }
}

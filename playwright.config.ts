import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'node:path'

/**
 * 浏览器端到端测试配置。
 *
 * - 固定高位端口 5180；`reuseExistingServer: false`，端口被占用时直接失败，
 *   避免误连到开发服务或上一次遗留进程。
 * - `scripts/e2e-server.mjs` 每次启动前清空 `.tmp/e2e-data`，再构建前端并以
 *   `SCRAPER_SERVE_DIST=1` 启动 Bun 单进程（静态文件 + API）。
 * - 失败时保留截图与 trace，产物目录已在 `.gitignore` 中忽略。
 */
const PORT = 5180
const BASE_URL = `http://127.0.0.1:${PORT}`
const DATA_DIR = resolve(process.cwd(), '.tmp', 'e2e-data')

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }]
  ],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'bun scripts/e2e-server.mjs',
    url: `${BASE_URL}/api/info`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      PORT: String(PORT),
      SCRAPER_DATA_DIR: DATA_DIR,
      SCRAPER_SERVE_DIST: '1'
    }
  }
})

import { expect, test, type Page, type Request, type Route } from '@playwright/test'
import { gotoApp, makeMediaDir, pickFolderByPath, waitForScanIdle } from './helpers'

/**
 * 任务队列暂停 / 取消。全程用 `page.route` 拦截识别接口，不联网。
 *
 * 队列并发为 3；每条识别请求延迟返回，便于在途状态可控。
 */
const PAUSE_DIR = makeMediaDir(
  'queue-pause',
  Array.from({ length: 8 }, (_, index) => `QUEUE1-${String(index + 1).padStart(3, '0')}.mp4`)
)
const CANCEL_DIR = makeMediaDir(
  'queue-cancel',
  Array.from({ length: 7 }, (_, index) => `QUEUE2-${String(index + 1).padStart(3, '0')}.mp4`)
)

interface IdentifyState {
  requests: { fulfilled: boolean; aborted: boolean }[]
  failures: string[]
}

function candidateFor(filename: string) {
  const base = filename.replace(/\.[^.]+$/, '')
  return {
    candidates: [
      {
        id: `e2e-${base}`,
        title: `E2E ${base}`,
        code: base,
        source: 'E2E',
        score: 0.99
      }
    ]
  }
}

/** 拦截识别接口；延迟后返回单一候选（单候选直接命中，不再调用 AI）。 */
async function routeIdentify(
  page: Page,
  delayMs: number | ((index: number) => number)
) {
  const state: IdentifyState = { requests: [], failures: [] }
  const pattern = '**/api/plugins/**/identify'
  const onFailed = (request: Request) => {
    if (request.url().includes('/api/plugins/') && request.url().includes('/identify')) {
      state.failures.push(request.failure()?.errorText ?? 'failed')
    }
  }
  page.on('requestfailed', onFailed)

  await page.route(pattern, async (route: Route) => {
    const call = { fulfilled: false, aborted: false }
    const index = state.requests.length
    state.requests.push(call)
    let filename = ''
    try {
      filename = String((route.request().postDataJSON() as { filename?: string })?.filename ?? '')
    } catch {
      filename = ''
    }
    const delay = typeof delayMs === 'function' ? delayMs(index) : delayMs
    await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(candidateFor(filename))
      })
      call.fulfilled = true
    } catch {
      // 请求在途被 AbortController 取消时 fulfill 会抛错。
      call.aborted = true
    }
  })

  return {
    state,
    dispose: async () => {
      await page.unroute(pattern)
      page.off('requestfailed', onFailed)
    }
  }
}

const rowStatus = (page: Page, label: string) =>
  page.locator('.ant-table-tbody tr.ant-table-row .st', { hasText: label })

test.describe('刮削队列暂停与取消', () => {
  test('暂停后不再派发新任务，继续后全部完成', async ({ page }) => {
    const route = await routeIdentify(page, 1500)
    try {
      await gotoApp(page)
      await waitForScanIdle(page, 1500)
      await pickFolderByPath(page, PAUSE_DIR)
      await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(8)
      await waitForScanIdle(page)

      await page.getByRole('button', { name: /开始刮削/ }).click()
      await expect(page.locator('.taskbar')).toBeVisible()
      await expect.poll(() => route.state.requests.length).toBeGreaterThanOrEqual(3)

      // 3 个在途任务开始后立刻暂停：不会再派发第 4 个。
      await page.locator('.taskbar').getByRole('button', { name: /暂\s*停/ }).click()
      await expect(page.locator('.taskbar-paused')).toBeVisible()
      await expect(page.locator('.taskbar')).toContainText(/已完成\s*3\s*\/\s*8/)
      expect(route.state.requests.length).toBe(3)

      await page.waitForTimeout(1800)
      expect(route.state.requests.length, '暂停后仍派发了新任务').toBe(3)
      await expect(page.locator('.taskbar')).toContainText(/已暂停/)

      await page.locator('.taskbar').getByRole('button', { name: /继\s*续/ }).click()
      await expect(page.locator('.taskbar')).toHaveCount(0)
      await expect(rowStatus(page, '已完成')).toHaveCount(8)
      await expect(page.locator('.statusbar')).toContainText(/任务\s*·\s*空闲/)
    } finally {
      await route.dispose()
    }
  })

  test('取消会中断在途请求，已完成行保留、未开始行恢复待处理', async ({ page }) => {
    // 第 1 个请求先完成，让「已完成 1 / 7」有足够时间被观察到；
    // 其余请求保持长延迟，取消时仍在途。
    const route = await routeIdentify(page, (index) => (index === 0 ? 400 : 1600))
    try {
      await gotoApp(page)
      await waitForScanIdle(page, 1500)
      await pickFolderByPath(page, CANCEL_DIR)
      await expect(page.locator('.ant-table-tbody tr.ant-table-row')).toHaveCount(7)
      await waitForScanIdle(page)

      await page.getByRole('button', { name: /开始刮削/ }).click()
      await expect(page.locator('.taskbar')).toBeVisible()
      // 等第一行完成后再取消；此时仍有 3 个在途任务。
      await expect(page.locator('.taskbar')).toContainText(/已完成\s*1\s*\/\s*7/)

      await page.locator('.taskbar').getByRole('button', { name: /取\s*消/ }).click()
      await expect(page.locator('.taskbar-cancelled')).toBeVisible()
      await expect(page.locator('.taskbar')).toContainText(/已取消/)

      // 在途请求确实被中止：Playwright 记录 requestfailed 或 fulfill 抛错。
      await expect
        .poll(
          () =>
            route.state.failures.length +
            route.state.requests.filter((item) => item.aborted).length,
          { timeout: 10_000, message: '取消后没有观察到在途请求被中断' }
        )
        .toBeGreaterThan(0)

      // 有未开始的任务（否则「未开始行恢复待处理」无从验证）。
      expect(route.state.requests.length).toBeLessThan(7)

      await expect(page.locator('.taskbar')).toContainText(/已完成\s*1\s*\/\s*7/)
      await expect(rowStatus(page, '已完成')).toHaveCount(1)
      await expect(rowStatus(page, '无法刮削')).toHaveCount(6)
      await expect(page.locator('.ant-table-tbody tr.ant-table-row .code')).toHaveCount(1)

      // 已完成行保留候选结果；未回滚为待处理。
      const doneRow = page
        .locator('.ant-table-tbody tr.ant-table-row')
        .filter({ has: page.locator('.st', { hasText: '已完成' }) })
      await expect(doneRow).toContainText('E2E ')
      await expect(page.locator('.statusbar')).toContainText(/任务\s*·\s*空闲/)
    } finally {
      await route.dispose()
    }
  })
})

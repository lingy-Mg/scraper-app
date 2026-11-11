import { expect, type Page } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** 测试媒体目录与临时数据都放在项目内 `.tmp/`，不触碰真实 `data/` 与用户目录。 */
export const TMP_ROOT = resolve(process.cwd(), '.tmp')
export const MEDIA_ROOT = resolve(TMP_ROOT, 'e2e-media')

export interface PageIssues {
  consoleErrors: string[]
  pageErrors: string[]
}

/** 必须在 `page.goto` 之前调用，收集控制台 error 与未捕获异常。 */
export function watchPageIssues(page: Page): PageIssues {
  const issues: PageIssues = { consoleErrors: [], pageErrors: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') issues.consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => {
    issues.pageErrors.push(error.message)
  })
  return issues
}

/** 等待启动流程完成：设置、插件宿主都已就绪。 */
export async function waitForApp(page: Page): Promise<void> {
  await expect(page.locator('.app')).toBeVisible()
  await expect(page.locator('.titlebar')).toContainText('刮削器')
  await expect(page.locator('.statusbar')).toContainText('HTTP后端')
  await expect(page.locator('.modebar')).toContainText('插件')
}

export async function gotoApp(page: Page): Promise<void> {
  await page.goto('/')
  await waitForApp(page)
}

/**
 * 顶部菜单是 hover/click 展开的 submenu。用 hover 而不是 click：
 * 点击已展开的一级项会把菜单关掉，导致连续切换主题时失败。
 */
export async function openMenu(page: Page, label: string): Promise<void> {
  const item = page.getByRole('menuitem', { name: label, exact: true })
  await item.hover()
  await expect(page.locator('.ant-menu-submenu-popup:visible').first()).toBeVisible()
}

/** 点击已展开菜单中的项；name 支持正则以匹配动态文案。 */
export async function clickMenuItem(
  page: Page,
  name: string | RegExp
): Promise<void> {
  const popup = page.locator('.ant-menu-submenu-popup:visible').last()
  const item = popup.getByRole('menuitem', { name })
  await expect(item.first()).toBeVisible()
  await item.first().click()
}

/** 展开二级子菜单（例如 视图 → 主题）。 */
export async function hoverSubmenu(
  page: Page,
  name: string | RegExp
): Promise<void> {
  const popup = page.locator('.ant-menu-submenu-popup:visible').last()
  const title = popup.getByRole('menuitem', { name })
  await expect(title.first()).toBeVisible()
  await title.first().hover()
}

export async function switchTheme(
  page: Page,
  label: '浅色' | '深色' | RegExp
): Promise<void> {
  await openMenu(page, '视图')
  await hoverSubmenu(page, '主题')
  await clickMenuItem(
    page,
    typeof label === 'string' ? new RegExp(`^${label}$`) : label
  )
}

/** 等待设置 PUT 落盘（500ms 防抖），用于验证刷新后仍生效。 */
export function waitForSettingsSave(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.url().includes('/api/settings') &&
      response.request().method() === 'PUT' &&
      response.ok()
  )
}

export async function themeColors(page: Page) {
  return page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    background: getComputedStyle(document.body).backgroundColor
  }))
}

/** 打开目录选择弹窗并返回弹窗容器。 */
export async function openFolderPicker(page: Page) {
  await page.getByRole('button', { name: /选择文件夹/ }).click()
  const modal = page.locator('.ant-modal-content', { hasText: '选择扫描目录' })
  await expect(modal).toBeVisible()
  return modal
}

/** 在目录选择器里手动输入绝对路径 → 跳转 → 选择此文件夹。 */
export async function pickFolderByPath(page: Page, path: string): Promise<void> {
  const modal = await openFolderPicker(page)
  await modal.getByPlaceholder(/输入绝对路径/).fill(path)
  await modal.getByRole('button', { name: '跳转' }).click()
  await expect(modal.locator('.fpm-target code')).toHaveText(path)
  await modal.getByRole('button', { name: '选择此文件夹' }).click()
  await expect(modal).toBeHidden()
}

/** 等待扫描进度条消失、任务回到空闲。 */
export async function waitForScanIdle(page: Page): Promise<void> {
  await expect(page.locator('.scanbar')).toHaveCount(0)
  await expect(page.locator('.statusbar')).not.toContainText('扫描中')
}

/** 记录扫描进度条是否曾出现过（扫描很快时避免竞态）。 */
export async function installScanbarObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as { __scanbarSeen?: boolean }
    win.__scanbarSeen = false
    const start = () => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('.scanbar')) win.__scanbarSeen = true
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
      if (document.querySelector('.scanbar')) win.__scanbarSeen = true
    }
    if (document.documentElement) start()
    else document.addEventListener('DOMContentLoaded', start, { once: true })
  })
}

export async function scanbarWasSeen(page: Page): Promise<boolean> {
  return page.evaluate(
    () => Boolean((window as unknown as { __scanbarSeen?: boolean }).__scanbarSeen)
  )
}

/**
 * 构造隔离的测试媒体目录；同名目录先清空，避免上一次运行的残留文件。
 * 文件内容任意，只用于真实扫描链路。
 */
export function makeMediaDir(name: string, files: string[]): string {
  const dir = resolve(MEDIA_ROOT, name)
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  mkdirSync(dir, { recursive: true })
  for (const file of files) {
    writeFileSync(resolve(dir, file), `e2e fixture: ${file}\n`)
  }
  return dir
}

export function removeMediaDir(name: string): void {
  rmSync(resolve(MEDIA_ROOT, name), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

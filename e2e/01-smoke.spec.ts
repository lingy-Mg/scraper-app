import { expect, test } from '@playwright/test'
import {
  clickMenuItem,
  gotoApp,
  makeMediaDir,
  openFolderPicker,
  openMenu,
  switchTheme,
  themeColors,
  waitForSettingsSave,
  watchPageIssues
} from './helpers'

/**
 * 基础冒烟：首页、目录选择、媒体库空态、主题、列设置。
 *
 * 本文件放在最前（01-）以使用启动时清空的隔离数据目录；后续用例会写入
 * 媒体库 / 设置，但不会影响这里的空库断言。
 */
test.describe('基础冒烟', () => {
  test('首页可加载且控制台无 error', async ({ page }) => {
    const issues = watchPageIssues(page)
    await gotoApp(page)

    await expect(page.locator('.titlebar')).toContainText('刮削器')
    await expect(page.locator('.menubar')).toBeVisible()
    await expect(page.locator('.toolbar')).toContainText('选择文件夹')
    await expect(page.locator('.toolbar')).toContainText('开始刮削')
    await expect(page.locator('.modebar')).toContainText('模式')
    await expect(page.locator('.filterbar')).toContainText('全部')
    await expect(page.locator('.ant-table')).toBeVisible()
    await expect(page.locator('.statusbar')).toContainText('就绪')
    await expect(page.locator('.statusbar')).toContainText('HTTP后端')

    expect(issues.pageErrors, '存在未捕获的前端异常').toEqual([])
    expect(issues.consoleErrors, '控制台出现 error').toEqual([])
  })

  test('目录选择器可浏览盘符、手动跳转并取消', async ({ page }) => {
    const target = makeMediaDir('picker-target', [])
    await gotoApp(page)

    const modal = await openFolderPicker(page)
    await expect(modal.locator('.fpm-root')).not.toHaveCount(0)
    await expect(modal.getByText('位置', { exact: true })).toBeVisible()

    await modal.getByPlaceholder(/输入绝对路径/).fill(target)
    await modal.getByRole('button', { name: /跳\s*转/ }).click()
    await expect(modal.locator('.fpm-target code')).toHaveText(target)
    expect(await modal.locator('.fpm-path input').inputValue()).toBe(target)

    await modal.getByRole('button', { name: /取\s*消/ }).click()
    await expect(modal).toBeHidden()
    await expect(page.locator('.toolbar .pathbox')).toContainText('未选择目录')
  })

  test('媒体库四个标签页在空库时显示空态', async ({ page }) => {
    await gotoApp(page)
    await openMenu(page, '文件')
    await clickMenuItem(page, '媒体库…')

    const modal = page.locator('.ant-modal-content', { hasText: '媒体库' }).last()
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('tab', { name: '列表' })).toBeVisible()

    // 列表
    await modal.getByRole('tab', { name: '列表' }).click()
    await expect(modal.getByText('没有匹配的媒体库记录')).toBeVisible()
    await expect(modal.locator('.ant-alert-error')).toHaveCount(0)

    // 重复
    await modal.getByRole('tab', { name: /^重复/ }).click()
    await expect(modal.getByText('未发现重复文件')).toBeVisible()
    await expect(modal.locator('.ant-alert-error')).toHaveCount(0)

    // 统计
    await modal.getByRole('tab', { name: '统计' }).click()
    await expect(modal.getByText('媒体库暂无记录')).toBeVisible()
    await expect(modal.locator('.ant-alert-error')).toHaveCount(0)

    // 来源
    await modal.getByRole('tab', { name: /^来源/ }).click()
    await expect(modal.getByText('还没有登记任何来源')).toBeVisible()
    await expect(modal.locator('.ant-alert-error')).toHaveCount(0)

    await modal.locator('.ant-modal-close').click()
    await expect(modal).toBeHidden()
  })

  test('主题浅色/深色/跟随系统切换并持久化', async ({ page }) => {
    await gotoApp(page)

    const initial = await themeColors(page)
    expect(initial.theme).toBe('light')
    expect(initial.background).toBe('rgb(255, 255, 255)')

    // 浅色 → 深色
    let saved = waitForSettingsSave(page)
    await switchTheme(page, '深色')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect
      .poll(async () => (await themeColors(page)).background)
      .toBe('rgb(20, 20, 20)')
    await saved

    // 深色 → 浅色
    saved = waitForSettingsSave(page)
    await switchTheme(page, '浅色')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect
      .poll(async () => (await themeColors(page)).background)
      .toBe('rgb(255, 255, 255)')
    await saved

    // 再切深色并刷新，验证持久化。
    saved = waitForSettingsSave(page)
    await switchTheme(page, '深色')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await saved

    await gotoApp(page)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect.poll(async () => (await themeColors(page)).background).toBe('rgb(20, 20, 20)')

    // 深色 → 跟随系统（Playwright 固定 colorScheme=light）。
    saved = waitForSettingsSave(page)
    await switchTheme(page, /^跟随系统/)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect.poll(async () => (await themeColors(page)).background).toBe('rgb(255, 255, 255)')
    await saved
  })

  test('列设置隐藏来源列并持久化，操作/选择列不可隐藏', async ({ page }) => {
    await gotoApp(page)

    await expect(page.locator('.ant-table-thead th', { hasText: '来源' })).toBeVisible()
    await expect(page.locator('.ant-table-thead th', { hasText: '操作' })).toBeVisible()

    await openMenu(page, '视图')
    await clickMenuItem(page, '列设置…')
    const modal = page.locator('.ant-modal-content', { hasText: '列设置' }).last()
    await expect(modal).toBeVisible()

    // 11 个可隐藏数据列；「操作」「选择」不在选项中。
    await expect(modal.locator('label.ant-checkbox-wrapper')).toHaveCount(11)
    await expect(modal.locator('label.ant-checkbox-wrapper', { hasText: '操作' })).toHaveCount(0)
    await expect(modal.locator('label.ant-checkbox-wrapper', { hasText: '选择' })).toHaveCount(0)

    const srcLabel = modal.locator('label.ant-checkbox-wrapper', { hasText: '来源' })
    await expect(srcLabel.locator('input[type="checkbox"]')).toBeChecked()
    // Ant Design 的 input 被隐藏，点击 label 才能可靠切换。
    await srcLabel.click()
    await expect(srcLabel.locator('input[type="checkbox"]')).not.toBeChecked()

    const saved = waitForSettingsSave(page)
    await modal.getByRole('button', { name: /保\s*存/ }).click()
    await expect(modal).toBeHidden()
    await saved

    await expect(page.locator('.ant-table-thead th', { hasText: '来源' })).toHaveCount(0)
    await expect(page.locator('.ant-table-thead th', { hasText: '操作' })).toBeVisible()
    await expect(page.locator('.ant-table-thead .ant-table-selection-column').first()).toBeVisible()

    // 刷新后仍隐藏。
    await gotoApp(page)
    await expect(page.locator('.ant-table-thead th', { hasText: '来源' })).toHaveCount(0)
    await expect(page.locator('.ant-table-thead th', { hasText: '操作' })).toBeVisible()
    await expect(page.locator('.ant-table-thead .ant-table-selection-column').first()).toBeVisible()
  })
})

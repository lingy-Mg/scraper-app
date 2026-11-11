import { expect, test } from '@playwright/test'
import {
  gotoApp,
  installScanbarObserver,
  makeMediaDir,
  MEDIA_ROOT,
  pickFolderByPath,
  removeMediaDir,
  scanbarWasSeen,
  waitForScanIdle
} from './helpers'
import { resolve } from 'node:path'

const MEDIA_NAME = 'scan-basic'
const VIDEO_FILES = [
  ...Array.from({ length: 12 }, (_, index) => `E2E-SCAN-${String(index + 1).padStart(3, '0')}.mp4`),
  'sub/E2E-SCAN-013.mp4'
]

let mediaDir = ''

test.describe('目录扫描链路', () => {
  test.beforeAll(() => {
    // 内容随意；非 MP4/无 ffprobe 时时长为空，不影响表格出现。
    mediaDir = makeMediaDir(MEDIA_NAME, [
      ...VIDEO_FILES,
      'notes.txt',
      'types.d.ts',
      '.hidden/SECRET-999.mp4'
    ])
  })

  test.afterAll(() => {
    removeMediaDir(MEDIA_NAME)
  })

  test('手动输入目录后扫描，进度条出现并消失，表格出现视频行', async ({ page }) => {
    await installScanbarObserver(page)
    await gotoApp(page)

    await pickFolderByPath(page, mediaDir)

    const rows = page.locator('.ant-table-tbody tr.ant-table-row')
    await expect(rows).toHaveCount(13)

    const table = page.locator('.ant-table-tbody')
    await expect(table).toContainText('E2E-SCAN-001.mp4')
    await expect(table).toContainText('E2E-SCAN-012.mp4')
    await expect(table).toContainText('E2E-SCAN-013.mp4')
    // 非视频、.d.ts、隐藏目录均不应进入表格。
    await expect(table).not.toContainText('notes.txt')
    await expect(table).not.toContainText('types.d.ts')
    await expect(table).not.toContainText('SECRET-999')

    // 扫描进度条在扫描期间确实出现过，并在完成后从 DOM 移除。
    expect(await scanbarWasSeen(page), '扫描进度条没有出现过').toBe(true)
    await waitForScanIdle(page)
    await expect(page.locator('.scanbar')).toBeHidden()

    await expect(page.locator('.statusbar')).toContainText(/13\s*个视频/)
    await expect(page.locator('.toolbar .pathbox')).toContainText(MEDIA_NAME)
    // 路径来自目录选择器的真实输入。
    expect(mediaDir).toBe(resolve(MEDIA_ROOT, MEDIA_NAME))
  })
})

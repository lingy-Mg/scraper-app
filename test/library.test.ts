import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * DATA_DIR 在模块加载时解析。Bun 测试文件并发执行，顶层 await import
 * 可能与其他测试文件的顶层环境赋值交错，因此延迟到 beforeAll（此时
 * Bun 已为当前测试文件隔离 process.env）。
 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-library-'))
process.env.SCRAPER_DATA_DIR = dataDir

let clearItems: typeof import('../server/library').clearItems
let closeLibrary: typeof import('../server/library').closeLibrary
let listItems: typeof import('../server/library').listItems
let removeItems: typeof import('../server/library').removeItems
let upsertItems: typeof import('../server/library').upsertItems
type LibraryItem = import('../server/library').LibraryItem

beforeAll(async () => {
  const library = await import('../server/library')
  clearItems = library.clearItems
  closeLibrary = library.closeLibrary
  listItems = library.listItems
  removeItems = library.removeItems
  upsertItems = library.upsertItems
})

function item(path: string, mode: string, title: string, extra: Partial<LibraryItem> = {}): LibraryItem {
  return {
    path,
    file: path.split(/[\\/]/).pop() ?? path,
    mode,
    code: '',
    title,
    status: 'done',
    ...extra
  }
}

beforeEach(() => {
  clearItems()
})

afterAll(async () => {
  // Windows 下必须先关闭 SQLite 句柄才能删除数据库文件；
  // WAL/SHM 句柄释放可能有短暂延迟，带重试清理。
  closeLibrary()
  // Bun 1.3 的 SQLite 在用过事务/查询后，OS 句柄要等 GC 才释放；
  // 不 GC 时 Windows 上删除临时目录会报 EBUSY。
  Bun.gc(true)
  await new Promise((resolve) => setTimeout(resolve, 50))
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('媒体库 upsert / list', () => {
  test('批量写入后可读取，字段与 camelCase 一致', () => {
    const count = upsertItems([
      item('C:\\media\\a.mp4', 'av', 'A', {
        code: 'SSIS-001',
        dur: 7200,
        size: 1024,
        score: 8.5,
        tags: ['高清', '中文字幕'],
        posterCrop: { x: 1, y: 2, width: 30, height: 40 },
        releaseDate: '2026-01-02',
        director: '导演',
        series: '系列'
      }),
      item('C:\\media\\b.mp4', 'movie', 'B')
    ])

    expect(count).toBe(2)
    const items = listItems()
    expect(items).toHaveLength(2)

    const first = items.find((entry) => entry.path === 'C:\\media\\a.mp4')!
    expect(first.mode).toBe('av')
    expect(first.title).toBe('A')
    expect(first.dur).toBe(7200)
    expect(first.score).toBe(8.5)
    expect(first.tags).toEqual(['高清', '中文字幕'])
    expect(first.posterCrop).toEqual({ x: 1, y: 2, width: 30, height: 40 })
    expect(first.releaseDate).toBe('2026-01-02')
    expect(first.director).toBe('导演')
    expect(first.series).toBe('系列')
  })

  test('重复 upsert 同一 path 只保留一行并更新内容', () => {
    const path = 'C:\\media\\same.mp4'
    upsertItems([item(path, 'av', '旧标题')])
    upsertItems([item(path, 'av', '新标题', { dur: 3600 })])

    const items = listItems()
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('新标题')
    expect(items[0].dur).toBe(3600)
  })

  test('list 按 updatedAt 倒序', () => {
    upsertItems([
      item('C:\\media\\old.mp4', 'av', 'old', { updatedAt: 1000 }),
      item('C:\\media\\new.mp4', 'av', 'new', { updatedAt: 2000 })
    ])
    expect(listItems().map((entry) => entry.title)).toEqual(['new', 'old'])
  })
})

describe('删除与清空', () => {
  test('removeItems 按路径删除并返回行数', () => {
    upsertItems([item('C:\\media\\a.mp4', 'av', 'A'), item('C:\\media\\b.mp4', 'av', 'B')])
    const removed = removeItems(['C:\\media\\a.mp4', 'C:\\media\\missing.mp4'])

    expect(removed).toBe(1)
    expect(listItems().map((entry) => entry.title)).toEqual(['B'])
  })

  test('clearItems(mode) 只清空指定模式', () => {
    upsertItems([
      item('C:\\media\\av.mp4', 'av', 'AV'),
      item('C:\\media\\movie.mp4', 'movie', 'Movie')
    ])

    expect(clearItems('av')).toBe(1)
    expect(listItems().map((entry) => entry.mode)).toEqual(['movie'])
  })

  test('clearItems() 清空全部', () => {
    upsertItems([item('C:\\media\\av.mp4', 'av', 'AV'), item('C:\\media\\movie.mp4', 'movie', 'M')])
    expect(clearItems()).toBe(2)
    expect(listItems()).toHaveLength(0)
  })
})

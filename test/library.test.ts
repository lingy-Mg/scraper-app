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
let findDuplicates: typeof import('../server/library').findDuplicates
let libraryStats: typeof import('../server/library').libraryStats
let listItems: typeof import('../server/library').listItems
let queryLibrary: typeof import('../server/library').queryLibrary
let removeItems: typeof import('../server/library').removeItems
let upsertItems: typeof import('../server/library').upsertItems
type LibraryItem = import('../server/library').LibraryItem

beforeAll(async () => {
  const library = await import('../server/library')
  clearItems = library.clearItems
  closeLibrary = library.closeLibrary
  findDuplicates = library.findDuplicates
  libraryStats = library.libraryStats
  listItems = library.listItems
  queryLibrary = library.queryLibrary
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

describe('分页查询', () => {
  test('q 模糊匹配 title / code / file / actors / maker / series', () => {
    upsertItems([
      item('C:\\media\\alpha.mp4', 'av', 'Alpha Title', {
        code: 'ABC-001',
        actors: 'Maria / John',
        maker: 'StudioA',
        series: 'SeriesX'
      }),
      item('C:\\media\\beta.mp4', 'av', 'Beta', { code: 'XYZ-999', actors: 'Other' })
    ])

    for (const keyword of ['alpha', 'abc-001', 'alpha.mp4', 'maria', 'studioa', 'seriesx']) {
      const result = queryLibrary({ q: keyword })
      expect(result.total).toBe(1)
      expect(result.items[0].file).toBe('alpha.mp4')
    }
  })

  test('空字符串条件被忽略', () => {
    upsertItems([item('C:\\media\\a.mp4', 'av', 'A'), item('C:\\media\\b.mp4', 'movie', 'B')])
    expect(queryLibrary({ q: '  ', mode: '', maker: '', actor: '', tag: '', status: '' }).total).toBe(2)
  })

  test('按 mode / maker / actor / status 筛选', () => {
    upsertItems([
      item('C:\\media\\a.mp4', 'av', 'A', { maker: 'StudioA', actors: 'Maria / John', status: 'done' }),
      item('C:\\media\\b.mp4', 'av', 'B', { maker: 'StudioB', actors: 'Other', status: 'review' }),
      item('C:\\media\\c.mp4', 'movie', 'C', { maker: 'StudioA', status: 'done' })
    ])

    expect(queryLibrary({ mode: 'av' }).total).toBe(2)
    expect(queryLibrary({ maker: 'studioa' }).total).toBe(2)
    expect(queryLibrary({ actor: 'maria' }).total).toBe(1)
    expect(queryLibrary({ status: 'review' }).total).toBe(1)
    expect(queryLibrary({ mode: 'av', status: 'done' }).total).toBe(1)
  })

  test('标签按 JSON 完整元素匹配，不做子串误命中', () => {
    upsertItems([
      item('C:\\media\\a.mp4', 'av', 'A', { tags: ['高清', '中文字幕'] }),
      item('C:\\media\\b.mp4', 'av', 'B', { tags: ['高清中字'] })
    ])
    const result = queryLibrary({ tag: '高清' })
    expect(result.total).toBe(1)
    expect(result.items[0].title).toBe('A')
  })

  test('排序与分页边界', () => {
    upsertItems([
      item('C:\\media\\b.mp4', 'av', 'B', { size: 100, dur: 60, year: '2020', updatedAt: 1000 }),
      item('C:\\media\\a.mp4', 'av', 'A', { size: 300, dur: 300, year: '2022', updatedAt: 3000 }),
      item('C:\\media\\c.mp4', 'av', 'C', { size: 200, dur: 120, year: '2021', updatedAt: 2000 })
    ])

    expect(queryLibrary({ sort: 'title', order: 'asc' }).items.map((entry) => entry.title)).toEqual([
      'A',
      'B',
      'C'
    ])
    expect(queryLibrary({ sort: 'size', order: 'desc' }).items.map((entry) => entry.size)).toEqual([
      300,
      200,
      100
    ])
    expect(queryLibrary({ sort: 'dur', order: 'asc' }).items.map((entry) => entry.dur)).toEqual([
      60,
      120,
      300
    ])
    expect(queryLibrary({ sort: 'year', order: 'desc' }).items.map((entry) => entry.year)).toEqual([
      '2022',
      '2021',
      '2020'
    ])
    expect(queryLibrary({}).items.map((entry) => entry.title)).toEqual(['A', 'C', 'B'])

    const page = queryLibrary({ sort: 'title', order: 'asc', limit: 2, offset: 1 })
    expect(page.total).toBe(3)
    expect(page.items.map((entry) => entry.title)).toEqual(['B', 'C'])

    expect(queryLibrary({ limit: 999 }).items).toHaveLength(3)
    expect(queryLibrary({ limit: 0 }).items).toHaveLength(3)
    expect(queryLibrary({ offset: 99 }).items).toHaveLength(0)
    expect(queryLibrary({ offset: 99 }).total).toBe(3)
  })
})

describe('重复检测', () => {
  test('同番号优先，同大小+时长次之，一条记录只出现在一个分组', () => {
    upsertItems([
      item('C:\\media\\p1.mp4', 'av', 'P1', { code: 'DUP-001', size: 100, dur: 600 }),
      // p2 同时与 p1 同番号、与 p3 同大小+时长；应只进入番号分组。
      item('C:\\media\\p2.mp4', 'av', 'P2', { code: 'DUP-001', size: 300, dur: 800 }),
      item('C:\\media\\p3.mp4', 'av', 'P3', { size: 300, dur: 800 }),
      item('C:\\media\\p4.mp4', 'av', 'P4', { size: 300, dur: 800 })
    ])

    const groups = findDuplicates()
    expect(groups).toHaveLength(2)
    const codeGroup = groups.find((group) => group.reason === 'code')!
    expect(codeGroup.key).toBe('DUP-001')
    expect(codeGroup.items.map((entry) => entry.file).sort()).toEqual(['p1.mp4', 'p2.mp4'])
    const sizeGroup = groups.find((group) => group.reason === 'size-duration')!
    expect(sizeGroup.key).toBe('300-800')
    expect(sizeGroup.items.map((entry) => entry.file).sort()).toEqual(['p3.mp4', 'p4.mp4'])

    const seen = new Set<string>()
    for (const group of groups) {
      for (const entry of group.items) {
        expect(seen.has(entry.path)).toBe(false)
        seen.add(entry.path)
      }
    }
  })

  test('番号大小写归一，且 size/dur 为 0 不参与', () => {
    upsertItems([
      item('C:\\media\\a.mp4', 'av', 'A', { code: 'abc-1' }),
      item('C:\\media\\b.mp4', 'av', 'B', { code: 'ABC-1' }),
      item('C:\\media\\c.mp4', 'av', 'C', { size: 0, dur: 0 }),
      item('C:\\media\\d.mp4', 'av', 'D', { size: 0, dur: 0 })
    ])
    const groups = findDuplicates()
    expect(groups).toHaveLength(1)
    expect(groups[0].reason).toBe('code')
    expect(groups[0].items).toHaveLength(2)
  })

  test('mode 过滤', () => {
    upsertItems([
      item('C:\\media\\av1.mp4', 'av', 'AV1', { code: 'SAME-1' }),
      item('C:\\media\\av2.mp4', 'av', 'AV2', { code: 'SAME-1' }),
      item('C:\\media\\mv.mp4', 'movie', 'MV', { code: 'SAME-1' })
    ])
    expect(findDuplicates('av')).toHaveLength(1)
    expect(findDuplicates('av')[0].items).toHaveLength(2)
    expect(findDuplicates('movie')).toHaveLength(0)
  })
})

describe('统计', () => {
  test('数量、大小、模式/状态分布与 Top 片商/演员/标签', () => {
    upsertItems([
      item('C:\\media\\a.mp4', 'av', 'A', {
        maker: 'M1',
        actors: 'A / B',
        tags: ['t1', 't2'],
        size: 100,
        status: 'done'
      }),
      item('C:\\media\\b.mp4', 'av', 'B', {
        maker: 'M1',
        actors: 'A',
        tags: ['t1'],
        size: 200,
        status: 'review'
      }),
      item('C:\\media\\c.mp4', 'movie', 'C', {
        maker: 'M2',
        actors: 'C',
        tags: ['t3'],
        size: 0,
        status: 'unmatched'
      })
    ])

    const stats = libraryStats()
    expect(stats.total).toBe(3)
    expect(stats.totalSize).toBe(300)
    expect(stats.byMode).toEqual({ av: 2, movie: 1 })
    expect(stats.byStatus).toEqual({ done: 1, review: 1, unmatched: 1 })
    expect(stats.topMakers[0]).toEqual({ name: 'M1', count: 2 })
    expect(stats.topActors[0]).toEqual({ name: 'A', count: 2 })
    expect(stats.topTags[0]).toEqual({ name: 't1', count: 2 })
  })

  test('mode 过滤只统计指定模式', () => {
    upsertItems([
      item('C:\\media\\a.mp4', 'av', 'A', { size: 100, status: 'done' }),
      item('C:\\media\\b.mp4', 'movie', 'B', { size: 200, status: 'done' })
    ])
    const stats = libraryStats('av')
    expect(stats.total).toBe(1)
    expect(stats.totalSize).toBe(100)
    expect(stats.byMode).toEqual({ av: 1 })
  })
})

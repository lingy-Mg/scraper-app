import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, resolveDataDir } from './settings'

/** 媒体库条目，字段与 docs/providers-library-contract.md 一致。 */
export interface LibraryItem {
  path: string
  file: string
  mode: string
  code: string
  title: string
  status: string
  year?: string
  maker?: string
  actors?: string
  overview?: string
  src?: string
  score?: number
  dur?: number
  size?: number
  posterUrl?: string
  posterCrop?: { x: number; y: number; width: number; height: number }
  detailId?: string
  tags?: string[]
  releaseDate?: string
  director?: string
  series?: string
  updatedAt?: number
}

export const DB_FILE = join(DATA_DIR, 'library.db')

/** 按当前数据目录解析数据库路径（不在模块加载时固化）。 */
function databaseFile(): string {
  return join(resolveDataDir(), 'library.db')
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  path TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  mode TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unmatched',
  year TEXT,
  maker TEXT,
  actors TEXT,
  overview TEXT,
  src TEXT,
  score REAL,
  dur INTEGER,
  size INTEGER,
  poster_url TEXT,
  poster_crop_json TEXT,
  detail_id TEXT,
  tags_json TEXT,
  release_date TEXT,
  director TEXT,
  series TEXT,
  updated_at INTEGER NOT NULL
);`

const UPSERT_SQL = `
INSERT INTO items (
  path, file, mode, code, title, status, year, maker, actors, overview, src,
  score, dur, size, poster_url, poster_crop_json, detail_id, tags_json, release_date, director, series, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(path) DO UPDATE SET
  file = excluded.file,
  mode = excluded.mode,
  code = excluded.code,
  title = excluded.title,
  status = excluded.status,
  year = excluded.year,
  maker = excluded.maker,
  actors = excluded.actors,
  overview = excluded.overview,
  src = excluded.src,
  score = excluded.score,
  dur = excluded.dur,
  size = excluded.size,
  poster_url = excluded.poster_url,
  poster_crop_json = excluded.poster_crop_json,
  detail_id = excluded.detail_id,
  tags_json = excluded.tags_json,
  release_date = excluded.release_date,
  director = excluded.director,
  series = excluded.series,
  updated_at = excluded.updated_at;`

const SELECT_SQL = `
SELECT path, file, mode, code, title, status, year, maker, actors, overview, src,
       score, dur, size, poster_url, poster_crop_json, detail_id, tags_json,
       release_date, director, series, updated_at
FROM items
ORDER BY updated_at DESC, path ASC;`

type ItemRow = {
  path: string
  file: string
  mode: string
  code: string
  title: string
  status: string
  year: string | null
  maker: string | null
  actors: string | null
  overview: string | null
  src: string | null
  score: number | null
  dur: number | null
  size: number | null
  poster_url: string | null
  poster_crop_json: string | null
  detail_id: string | null
  tags_json: string | null
  release_date: string | null
  director: string | null
  series: string | null
  updated_at: number
}

let db: Database | null = null
let dbPath = ''

/**
 * 惰性打开数据库：模块加载时不做任何 IO，首次调用时才创建目录、表并设置 PRAGMA。
 * 初始化失败不会缓存损坏的句柄，下次调用会重试。
 * 数据目录切换（测试注入）时自动重开，避免复用到旧路径的句柄。
 */
function getDb(): Database {
  const target = databaseFile()
  if (db && dbPath === target) return db
  if (db) {
    db.close()
    db = null
  }

  mkdirSync(resolveDataDir(), { recursive: true })
  const conn = new Database(target, { create: true })
  conn.exec('PRAGMA journal_mode = WAL;')
  conn.exec('PRAGMA busy_timeout = 5000;')
  conn.exec(SCHEMA)
  // 旧库迁移：新增列，已存在时忽略错误。
  for (const sql of [
    'ALTER TABLE items ADD COLUMN release_date TEXT;',
    'ALTER TABLE items ADD COLUMN director TEXT;',
    'ALTER TABLE items ADD COLUMN series TEXT;',
    'ALTER TABLE items ADD COLUMN poster_crop_json TEXT;'
  ]) {
    try {
      conn.exec(sql)
    } catch {
      // duplicate column
    }
  }

  db = conn
  dbPath = target
  return db
}

function decodeTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((tag) => String(tag))
  } catch {
    return []
  }
}

function encodeTags(tags: unknown): string | null {
  if (!Array.isArray(tags)) return null
  return JSON.stringify(tags.map((tag) => String(tag)))
}

function decodeCrop(raw: string | null): LibraryItem['posterCrop'] {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const crop = {
      x: Number(parsed.x),
      y: Number(parsed.y),
      width: Number(parsed.width),
      height: Number(parsed.height)
    }
    if (Object.values(crop).every((value) => Number.isFinite(value))) return crop
  } catch {
    // ignore invalid json
  }
  return undefined
}

function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null
  return String(value)
}

function numberOrNull(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null
  const num = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(num) ? num : null
}

function currentMillis(): number {
  return Date.now()
}

function rowToItem(row: ItemRow): LibraryItem {
  const item: LibraryItem = {
    path: row.path,
    file: row.file,
    mode: row.mode,
    code: row.code ?? '',
    title: row.title ?? '',
    status: row.status ?? 'unmatched'
  }

  if (row.year !== null && row.year !== undefined) item.year = row.year
  if (row.maker !== null && row.maker !== undefined) item.maker = row.maker
  if (row.actors !== null && row.actors !== undefined) item.actors = row.actors
  if (row.overview !== null && row.overview !== undefined) item.overview = row.overview
  if (row.src !== null && row.src !== undefined) item.src = row.src
  if (row.score !== null && row.score !== undefined) item.score = Number(row.score)
  if (row.dur !== null && row.dur !== undefined) item.dur = Number(row.dur)
  if (row.size !== null && row.size !== undefined) item.size = Number(row.size)
  if (row.poster_url !== null && row.poster_url !== undefined) item.posterUrl = row.poster_url
  const posterCrop = decodeCrop(row.poster_crop_json)
  if (posterCrop) item.posterCrop = posterCrop
  if (row.detail_id !== null && row.detail_id !== undefined) item.detailId = row.detail_id

  item.tags = decodeTags(row.tags_json)
  if (row.release_date !== null && row.release_date !== undefined)
    item.releaseDate = row.release_date
  if (row.director !== null && row.director !== undefined) item.director = row.director
  if (row.series !== null && row.series !== undefined) item.series = row.series
  item.updatedAt = Number(row.updated_at)

  return item
}

/** 关闭数据库句柄（测试清理临时目录、或需要重置连接时使用）。 */
export function closeLibrary(): void {
  if (!db) return
  db.close()
  db = null
  dbPath = ''
}

/** 读取全部条目，按更新时间倒序。 */
export function listItems(): LibraryItem[] {
  const rows = getDb().query<ItemRow, []>(SELECT_SQL).all()
  return rows.map(rowToItem)
}

/** 批量插入或更新，返回受影响行数。整个批次在同一事务内完成。 */
export function upsertItems(items: LibraryItem[]): number {
  if (!Array.isArray(items) || items.length === 0) return 0

  const database = getDb()
  const run = database.transaction((batch: LibraryItem[]) => {
    const stmt = database.prepare(UPSERT_SQL)
    let count = 0

    for (const item of batch) {
      const updatedAt =
        typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt)
          ? Math.trunc(item.updatedAt)
          : currentMillis()

      const result = stmt.run(
        String(item.path ?? ''),
        String(item.file ?? ''),
        String(item.mode ?? ''),
        String(item.code ?? ''),
        String(item.title ?? ''),
        String(item.status ?? 'unmatched'),
        textOrNull(item.year),
        textOrNull(item.maker),
        textOrNull(item.actors),
        textOrNull(item.overview),
        textOrNull(item.src),
        numberOrNull(item.score),
        numberOrNull(item.dur),
        numberOrNull(item.size),
        textOrNull(item.posterUrl),
        item.posterCrop ? JSON.stringify(item.posterCrop) : null,
        textOrNull(item.detailId),
        encodeTags(item.tags),
        textOrNull(item.releaseDate),
        textOrNull(item.director),
        textOrNull(item.series),
        updatedAt
      )

      count += Number(result.changes)
    }

    return count
  })

  return Number(run(items))
}

/** 按路径批量删除，返回实际删除行数。 */
export function removeItems(paths: string[]): number {
  if (!Array.isArray(paths) || paths.length === 0) return 0

  const database = getDb()
  const run = database.transaction((batch: string[]) => {
    const stmt = database.prepare('DELETE FROM items WHERE path = ?;')
    let count = 0
    for (const path of batch) {
      count += Number(stmt.run(String(path)).changes)
    }
    return count
  })

  return Number(run(paths))
}

/** 清空条目；传入 mode 时只删除该模式，返回删除行数。 */
export function clearItems(mode?: string): number {
  const database = getDb()

  if (typeof mode === 'string' && mode.length > 0) {
    const run = database.transaction((target: string) => {
      return Number(database.prepare('DELETE FROM items WHERE mode = ?;').run(target).changes)
    })
    return Number(run(mode))
  }

  const run = database.transaction(() => {
    return Number(database.prepare('DELETE FROM items;').run().changes)
  })
  return Number(run())
}

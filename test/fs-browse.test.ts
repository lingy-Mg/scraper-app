import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HttpError, listFsDirectories } from '../server/fs'

const root = mkdtempSync(join(tmpdir(), 'scraper-fs-'))

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

async function catchError(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise
    throw new Error('预期抛出 HttpError，但实际成功返回')
  } catch (error) {
    if (error instanceof HttpError) return error
    throw error
  }
}

describe('目录浏览', () => {
  test('相对路径返回 400', async () => {
    const error = await catchError(listFsDirectories('relative/path'))
    expect(error.status).toBe(400)
    expect(error.message).toContain('绝对路径')
  })

  test('不存在的路径返回 400', async () => {
    const error = await catchError(listFsDirectories(join(root, 'does-not-exist')))
    expect(error.status).toBe(400)
    expect(error.message).toContain('不存在')
  })

  test('文件路径返回 400', async () => {
    const file = join(root, 'file.txt')
    writeFileSync(file, 'x')
    const error = await catchError(listFsDirectories(file))
    expect(error.status).toBe(400)
    expect(error.message).toContain('不是目录')
  })

  test('正常列目录：只返回子目录并标记隐藏目录', async () => {
    const dir = join(root, 'browse')
    mkdirSync(join(dir, 'b'), { recursive: true })
    mkdirSync(join(dir, 'a'), { recursive: true })
    mkdirSync(join(dir, '.hidden'), { recursive: true })
    writeFileSync(join(dir, 'notes.txt'), 'ignored')

    const listing = await listFsDirectories(dir)
    expect(listing.path).toBe(dir)
    expect(listing.parent).toBe(root)
    expect(listing.entries.map((entry) => entry.name).sort()).toEqual(['.hidden', 'a', 'b'])
    expect(listing.entries.every((entry) => entry.isDir)).toBe(true)

    const hidden = listing.entries.find((entry) => entry.name === '.hidden')!
    expect(hidden.hidden).toBe(true)
    expect(hidden.path).toBe(join(dir, '.hidden'))

    const visible = listing.entries.find((entry) => entry.name === 'a')!
    expect(visible.hidden).toBe(false)
  })

  test('多级路径返回正确的父目录', async () => {
    const dir = join(root, 'parent', 'child')
    mkdirSync(dir, { recursive: true })
    const listing = await listFsDirectories(dir)
    expect(listing.path).toBe(dir)
    expect(listing.parent).toBe(join(root, 'parent'))
    expect(listing.entries).toEqual([])
  })
})

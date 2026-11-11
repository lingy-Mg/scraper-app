import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { organizeFiles } from '../server/files'

/** 整理逻辑不读写运行时数据，但源/目标目录全部位于独立临时目录。 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-organize-'))
process.env.SCRAPER_DATA_DIR = dataDir

let caseIndex = 0
/** 每个用例独立的源/目标目录，互不干扰。 */
function caseDir(): { root: string; src: string; dest: string } {
  caseIndex += 1
  const root = join(dataDir, `case-${caseIndex}`)
  const src = join(root, 'src')
  const dest = join(root, 'dest')
  mkdirSync(src, { recursive: true })
  mkdirSync(dest, { recursive: true })
  return { root, src, dest }
}

function makeSource(dir: string, name = 'movie.mp4', content = 'video-bytes'): string {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('目标路径安全', () => {
  test('拒绝 ../ 越界', async () => {
    const { root, src, dest } = caseDir()
    const source = makeSource(src)
    const results = await organizeFiles({
      dest,
      action: 'copy',
      items: [{ source, relativeTarget: '../escape.mp4' }]
    })

    expect(results).toHaveLength(1)
    expect(results[0].ok).toBe(false)
    expect(results[0].error).toContain('目标路径越界')
    expect(existsSync(join(root, 'escape.mp4'))).toBe(false)
  })

  test('拒绝绝对路径目标', async () => {
    const { root, src, dest } = caseDir()
    const source = makeSource(src)
    const outside = join(root, 'outside.mp4')
    const results = await organizeFiles({
      dest,
      action: 'copy',
      items: [{ source, relativeTarget: outside }]
    })

    expect(results[0].ok).toBe(false)
    expect(results[0].error).toContain('目标路径越界')
    expect(existsSync(outside)).toBe(false)
  })

  test('混乱的分隔符最终仍须落在 dest 内', async () => {
    const { root, src, dest } = caseDir()
    const source = makeSource(src)
    const results = await organizeFiles({
      dest,
      action: 'copy',
      items: [{ source, relativeTarget: 'a/../../escape.mp4' }]
    })
    expect(results[0].ok).toBe(false)
    expect(existsSync(join(root, 'escape.mp4'))).toBe(false)
  })
})

describe('冲突策略', () => {
  test('rename 追加 (2) 且保留原文件', async () => {
    const { src, dest } = caseDir()
    const source = makeSource(src, 'movie.mp4', 'new-content')
    mkdirSync(join(dest, 'movies'), { recursive: true })
    writeFileSync(join(dest, 'movies', 'movie.mp4'), 'old-content')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      conflict: 'rename',
      items: [{ source, relativeTarget: 'movies/movie.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(results[0].skipped).toBe(false)
    expect(results[0].target.endsWith('movie (2).mp4')).toBe(true)
    expect(readFileSync(join(dest, 'movies', 'movie.mp4'), 'utf8')).toBe('old-content')
    expect(readFileSync(results[0].target, 'utf8')).toBe('new-content')
  })

  test('skip 保留既有目标且不写源内容', async () => {
    const { src, dest } = caseDir()
    const source = makeSource(src, 'movie.mp4', 'new-content')
    writeFileSync(join(dest, 'movie.mp4'), 'old-content')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      conflict: 'skip',
      items: [{ source, relativeTarget: 'movie.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(results[0].skipped).toBe(true)
    expect(readFileSync(join(dest, 'movie.mp4'), 'utf8')).toBe('old-content')
    expect(existsSync(source)).toBe(true)
  })

  test('overwrite 覆盖既有目标', async () => {
    const { src, dest } = caseDir()
    const source = makeSource(src, 'movie.mp4', 'new-content')
    writeFileSync(join(dest, 'movie.mp4'), 'old-content')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      conflict: 'overwrite',
      items: [{ source, relativeTarget: 'movie.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(results[0].skipped).toBe(false)
    expect(readFileSync(join(dest, 'movie.mp4'), 'utf8')).toBe('new-content')
    expect(existsSync(join(dest, 'movie (2).mp4'))).toBe(false)
  })
})

describe('移动与复制', () => {
  test('copy 保留源文件', async () => {
    const { src, dest } = caseDir()
    const source = makeSource(src, 'movie.mp4', 'copy-me')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      items: [{ source, relativeTarget: 'out/movie.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(existsSync(source)).toBe(true)
    expect(readFileSync(join(dest, 'out', 'movie.mp4'), 'utf8')).toBe('copy-me')
  })

  test('move 删除源文件并写入 NFO', async () => {
    const { src, dest } = caseDir()
    const source = makeSource(src, 'movie.mp4', 'move-me')
    const nfo = '<movie><title>测试</title></movie>'

    const results = await organizeFiles({
      dest,
      action: 'move',
      items: [{ source, relativeTarget: 'out/movie.mp4', nfo }]
    })

    expect(results[0].ok).toBe(true)
    expect(existsSync(source)).toBe(false)
    expect(readFileSync(join(dest, 'out', 'movie.mp4'), 'utf8')).toBe('move-me')
    expect(readFileSync(join(dest, 'out', 'movie.nfo'), 'utf8')).toBe(nfo)
  })

  test('removeEmptyDirs 清理变空的源目录且保留 dest', async () => {
    const { src, dest } = caseDir()
    mkdirSync(join(src, 'season', 'episode'), { recursive: true })
    const source = makeSource(join(src, 'season', 'episode'), 'ep1.mp4')

    const results = await organizeFiles({
      dest,
      action: 'move',
      removeEmptyDirs: true,
      items: [{ source, relativeTarget: 'show/ep1.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(existsSync(join(src, 'season', 'episode'))).toBe(false)
    expect(existsSync(join(src, 'season'))).toBe(false)
    expect(existsSync(join(src))).toBe(false)
    expect(existsSync(dest)).toBe(true)
  })

  test('单项失败不影响其他项', async () => {
    const { root, src, dest } = caseDir()
    const good = makeSource(src, 'good.mp4', 'ok')
    const bad = makeSource(src, 'bad.mp4', 'bad')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      items: [
        { source: bad, relativeTarget: '../escape.mp4' },
        { source: good, relativeTarget: 'good.mp4' }
      ]
    })

    expect(results).toHaveLength(2)
    expect(results[0].ok).toBe(false)
    expect(results[1].ok).toBe(true)
    expect(existsSync(join(dest, 'good.mp4'))).toBe(true)
    expect(existsSync(join(root, 'escape.mp4'))).toBe(false)
  })
})

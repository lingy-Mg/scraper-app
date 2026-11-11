import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { organizeFiles } from '../server/files'

const dataDir = mkdtempSync(join(tmpdir(), 'scraper-sidecars-'))
process.env.SCRAPER_DATA_DIR = dataDir

let caseIndex = 0
function caseDir(): { root: string; src: string; dest: string } {
  caseIndex += 1
  const root = join(dataDir, `case-${caseIndex}`)
  const src = join(root, 'src')
  const dest = join(root, 'dest')
  mkdirSync(src, { recursive: true })
  mkdirSync(dest, { recursive: true })
  return { root, src, dest }
}

function makeVideo(dir: string, name = 'movie.mp4'): string {
  const path = join(dir, name)
  writeFileSync(path, 'video-bytes')
  return path
}

function makeSubtitle(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, `subtitle:${name}`)
  return path
}

const downloads = (overrides: Record<string, boolean> = {}) => [
  { label: '封面', on: overrides['封面'] ?? false },
  { label: '背景图', on: overrides['背景图'] ?? false },
  { label: '预告片', on: overrides['预告片'] ?? false },
  { label: 'NFO', on: overrides['NFO'] ?? false },
  { label: '字幕', on: overrides['字幕'] ?? false }
]

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('整理开关：字幕', () => {
  test('字幕开启时复制到目标视频旁，源字幕保留', async () => {
    const { src, dest } = caseDir()
    const video = makeVideo(src)
    const zh = makeSubtitle(src, 'movie.zh.srt')
    const en = makeSubtitle(src, 'movie.en.ass')
    mkdirSync(join(src, 'Subs'), { recursive: true })
    const subDir = makeSubtitle(join(src, 'Subs'), 'movie.cht.ssa')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      conflict: 'rename',
      downloads: downloads({ 字幕: true }),
      items: [{ source: video, relativeTarget: 'out/movie.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(existsSync(join(dest, 'out', 'movie.zh.srt'))).toBe(true)
    expect(existsSync(join(dest, 'out', 'movie.en.ass'))).toBe(true)
    expect(existsSync(join(dest, 'out', 'movie.cht.ssa'))).toBe(true)
    expect(readFileSync(join(dest, 'out', 'movie.zh.srt'), 'utf8')).toBe('subtitle:movie.zh.srt')
    expect(existsSync(zh)).toBe(true)
    expect(existsSync(en)).toBe(true)
    expect(existsSync(subDir)).toBe(true)
  })

  test('字幕关闭时不复制任何字幕', async () => {
    const { src, dest } = caseDir()
    const video = makeVideo(src)
    makeSubtitle(src, 'movie.zh.srt')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      downloads: downloads({ 字幕: false }),
      items: [{ source: video, relativeTarget: 'out/movie.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(existsSync(join(dest, 'out', 'movie.zh.srt'))).toBe(false)
  })

  test('目标已存在字幕时按冲突策略 rename', async () => {
    const { src, dest } = caseDir()
    const video = makeVideo(src)
    makeSubtitle(src, 'movie.zh.srt')
    mkdirSync(join(dest, 'out'), { recursive: true })
    writeFileSync(join(dest, 'out', 'movie.zh.srt'), 'old-subtitle')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      conflict: 'rename',
      downloads: downloads({ 字幕: true }),
      items: [{ source: video, relativeTarget: 'out/movie.mp4' }]
    })

    expect(results[0].ok).toBe(true)
    expect(readFileSync(join(dest, 'out', 'movie.zh.srt'), 'utf8')).toBe('old-subtitle')
    expect(readFileSync(join(dest, 'out', 'movie.zh (2).srt'), 'utf8')).toBe(
      'subtitle:movie.zh.srt'
    )
  })
})

describe('整理开关：预告片 / NFO / 背景图', () => {
  test('预告片开启时写入 NFO <trailer>，不产生额外视频文件', async () => {
    const { src, dest } = caseDir()
    const video = makeVideo(src)
    const nfo = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<movie>',
      '  <title>测试</title>',
      '</movie>',
      ''
    ].join('\n')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      downloads: downloads({ NFO: true, 预告片: true }),
      items: [
        {
          source: video,
          relativeTarget: 'out/movie.mp4',
          nfo,
          trailerUrl: 'https://www.youtube.com/watch?v=abc123'
        }
      ]
    })

    expect(results[0].ok).toBe(true)
    const written = readFileSync(join(dest, 'out', 'movie.nfo'), 'utf8')
    expect(written).toContain(
      '<trailer>https://www.youtube.com/watch?v=abc123</trailer>'
    )
    expect(existsSync(join(dest, 'out', 'movie.mp4'))).toBe(true)
    expect(readFileSync(join(dest, 'out', 'movie.mp4'), 'utf8')).toBe('video-bytes')
  })

  test('预告片关闭时不写入 <trailer>', async () => {
    const { src, dest } = caseDir()
    const video = makeVideo(src)
    const nfo = '<movie><title>测试</title></movie>'

    await organizeFiles({
      dest,
      action: 'copy',
      downloads: downloads({ NFO: true, 预告片: false }),
      items: [
        {
          source: video,
          relativeTarget: 'out/movie.mp4',
          nfo,
          trailerUrl: 'https://www.youtube.com/watch?v=abc123'
        }
      ]
    })

    const written = readFileSync(join(dest, 'out', 'movie.nfo'), 'utf8')
    expect(written).not.toContain('<trailer>')
  })

  test('NFO 关闭时不写 NFO；背景图只写一条 warning 且不产生文件', async () => {
    const { src, dest } = caseDir()
    const first = makeVideo(src, 'one.mp4')
    const second = makeVideo(src, 'two.mp4')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      downloads: downloads({ NFO: false, 背景图: true }),
      items: [
        {
          source: first,
          relativeTarget: 'out/one.mp4',
          nfo: '<movie><title>一</title></movie>'
        },
        {
          source: second,
          relativeTarget: 'out/two.mp4',
          nfo: '<movie><title>二</title></movie>'
        }
      ]
    })

    expect(results.map((result) => result.ok)).toEqual([true, true])
    expect(existsSync(join(dest, 'out', 'one.nfo'))).toBe(false)
    expect(existsSync(join(dest, 'out', 'two.nfo'))).toBe(false)
    expect(results[0].warning).toContain('背景图暂不支持')
    expect(results[1].warning ?? '').not.toContain('背景图暂不支持')
  })

  test('字幕目标仍在 dest 内（不复制到越界位置）', async () => {
    const { root, src, dest } = caseDir()
    const video = makeVideo(src)
    makeSubtitle(src, 'movie.zh.srt')

    const results = await organizeFiles({
      dest,
      action: 'copy',
      downloads: downloads({ 字幕: true }),
      items: [{ source: video, relativeTarget: '../escape.mp4' }]
    })

    expect(results[0].ok).toBe(false)
    expect(existsSync(join(root, 'escape.mp4'))).toBe(false)
    expect(existsSync(join(root, 'escape.zh.srt'))).toBe(false)
  })
})

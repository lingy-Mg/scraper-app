import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 字幕匹配只读临时目录，不接触项目 data/。 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-subtitles-'))
process.env.SCRAPER_DATA_DIR = dataDir

type Subtitles = typeof import('../server/subtitles')
let findSubtitles: Subtitles['findSubtitles']

let caseIndex = 0
function caseDir(): { root: string; video: string; videoDir: string } {
  caseIndex += 1
  const root = join(dataDir, `case-${caseIndex}`)
  const videoDir = join(root, 'media')
  mkdirSync(videoDir, { recursive: true })
  const video = join(videoDir, '影片.mp4')
  writeFileSync(video, 'video-bytes')
  return { root, video, videoDir }
}

function write(dir: string, name: string): string {
  const path = join(dir, name)
  writeFileSync(path, `subtitle:${name}`)
  return path
}

// 延迟导入，避免与其他测试文件的 SCRAPER_DATA_DIR 顶层赋值交错。
beforeAll(async () => {
  findSubtitles = (await import('../server/subtitles')).findSubtitles
})

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
})

describe('本地字幕匹配', () => {
  test('同名字幕与语言后缀，提取 language 与 format', async () => {
    const { video, videoDir } = caseDir()
    const plain = write(videoDir, '影片.srt')
    const zh = write(videoDir, '影片.zh.srt')
    const chs = write(videoDir, '影片.chs.ass')
    const en = write(videoDir, '影片.en.vtt')
    write(videoDir, 'other.zh.srt')
    write(videoDir, '影片.txt')

    const found = await findSubtitles(video)
    expect(found.map((item) => item.path).sort()).toEqual([plain, zh, chs, en].sort())

    const byPath = new Map(found.map((item) => [item.path, item]))
    expect(byPath.get(plain)!.language).toBeUndefined()
    expect(byPath.get(zh)).toMatchObject({ format: 'srt', language: 'zh' })
    expect(byPath.get(chs)).toMatchObject({ format: 'ass', language: 'chs' })
    expect(byPath.get(en)).toMatchObject({ format: 'vtt', language: 'en' })
  })

  test('扫描一层 Subs / 字幕 子目录，不递归更深层', async () => {
    const { video, videoDir } = caseDir()
    // Windows 文件系统大小写不敏感，Subs 与 subs 是同一目录；
    // 匹配逻辑本身对两者都做了小写归一。
    mkdirSync(join(videoDir, 'Subs'), { recursive: true })
    mkdirSync(join(videoDir, '字幕'), { recursive: true })
    mkdirSync(join(videoDir, 'Subs', 'deeper'), { recursive: true })

    const upper = write(join(videoDir, 'Subs'), '影片.zh.srt')
    const chinese = write(join(videoDir, '字幕'), '影片.cht.ssa')
    const deeper = write(join(videoDir, 'Subs', 'deeper'), '影片.fr.srt')

    const found = await findSubtitles(video)
    expect(found.map((item) => item.path).sort()).toEqual([upper, chinese].sort())
    expect(found.some((item) => item.path === deeper)).toBe(false)
  })

  test('无匹配返回空数组', async () => {
    const { video, videoDir } = caseDir()
    write(videoDir, '另一部影片.zh.srt')
    write(videoDir, '影片.Behind.The.Scenes.srt')
    await expect(findSubtitles(video)).resolves.toEqual([])
  })

  test('拒绝相对路径', async () => {
    const { videoDir } = caseDir()
    write(videoDir, '影片.zh.srt')
    const error = await findSubtitles('media/影片.mp4').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect((error as { status?: number }).status).toBe(400)
    expect((error as Error).message).toContain('绝对路径')
  })

  test('视频不存在或不是文件时返回 400', async () => {
    const { root } = caseDir()
    const missing = await findSubtitles(join(root, 'missing.mp4')).catch(
      (reason: unknown) => reason
    )
    expect((missing as { status?: number }).status).toBe(400)
    expect((missing as Error).message).toContain('不存在')

    const directory = await findSubtitles(root).catch((reason: unknown) => reason)
    expect((directory as { status?: number }).status).toBe(400)
    expect((directory as Error).message).toContain('不是文件')
  })
})

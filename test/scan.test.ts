import { afterAll, describe, expect, test } from 'bun:test'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isBlacklisted, probeFile, scanFolder } from '../server/scan'
import { isShort } from '../src/utils'

/**
 * 隔离目录；scan.ts 不读写运行时数据，静态导入也不会碰真实 data/。
 * 仍设置 SCRAPER_DATA_DIR，避免未来扫描探测逻辑扩展时落回项目目录。
 */
const dataDir = mkdtempSync(join(tmpdir(), 'scraper-scan-'))
process.env.SCRAPER_DATA_DIR = dataDir

/** 构造只有 moov/mvhd 的最小 MP4，用于不依赖 ffprobe 的时长解析。 */
function mp4WithDuration(seconds: number): Buffer {
  const mvhd = Buffer.alloc(28)
  mvhd.writeUInt32BE(28, 0)
  mvhd.write('mvhd', 4, 'latin1')
  // 8 字节 box 头之后：version/flags(4) + creation(4) + modification(4) 均为 0
  mvhd.writeUInt32BE(1000, 20) // timescale
  mvhd.writeUInt32BE(seconds * 1000, 24) // duration

  const moov = Buffer.alloc(8 + mvhd.length)
  moov.writeUInt32BE(moov.length, 0)
  moov.write('moov', 4, 'latin1')
  mvhd.copy(moov, 8)
  return moov
}

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

describe('文件名黑名单', () => {
  test('无通配符按包含匹配且不区分大小写', () => {
    expect(isBlacklisted('sample.mp4', ['sample'])).toBe(true)
    expect(isBlacklisted('my-SAMPLE-file.mkv', ['sample'])).toBe(true)
    expect(isBlacklisted('movie.mp4', ['sample'])).toBe(false)
  })

  test('含 * / ? 时通配符整名匹配', () => {
    expect(isBlacklisted('movie.mp4', ['*.mp4'])).toBe(true)
    expect(isBlacklisted('movie1.mp4', ['movie?.mp4'])).toBe(true)
    expect(isBlacklisted('movie10.mp4', ['movie?.mp4'])).toBe(false)
    expect(isBlacklisted('A.TMP.MP4', ['*.tmp.mp4'])).toBe(true)
    expect(isBlacklisted('sample.mp4', ['*.tmp.mp4'])).toBe(false)
  })

  test('通配符里的正则特殊字符按字面量处理', () => {
    expect(isBlacklisted('[x]1.mp4', ['[x]*'])).toBe(true)
    expect(isBlacklisted('x1.mp4', ['[x]*'])).toBe(false)
  })

  test('空规则与空白规则不命中', () => {
    expect(isBlacklisted('sample.mp4', [])).toBe(false)
    expect(isBlacklisted('sample.mp4', ['', '   '])).toBe(false)
    expect(isBlacklisted('', ['sample'])).toBe(false)
  })
})

describe('扫描过滤', () => {
  test('跳过隐藏目录、符号链接、非视频与 .d.ts，并按黑名单过滤', async () => {
    const root = join(dataDir, 'walk')
    const external = join(dataDir, 'external')
    mkdirSync(join(root, '.hidden'), { recursive: true })
    mkdirSync(join(root, 'sub'), { recursive: true })
    mkdirSync(external, { recursive: true })

    writeFileSync(join(root, 'movie.mp4'), mp4WithDuration(90))
    writeFileSync(join(root, '.hidden', 'inside.mp4'), mp4WithDuration(30))
    writeFileSync(join(root, 'sub', 'nested.mp4'), mp4WithDuration(60))
    writeFileSync(join(root, 'types.d.ts'), 'export {}')
    writeFileSync(join(root, 'notes.txt'), 'text')
    writeFileSync(join(root, 'sample-trailer.mp4'), mp4WithDuration(5))
    writeFileSync(join(external, 'linked.mp4'), mp4WithDuration(10))
    symlinkSync(external, join(root, 'linked'), 'junction')

    const files = await scanFolder(root, true, ['sample*'])
    expect(files.map((file) => file.name).sort()).toEqual(['movie.mp4', 'nested.mp4'])
    expect(files.some((file) => file.name.endsWith('.d.ts'))).toBe(false)
    expect(files.some((file) => file.name === 'inside.mp4')).toBe(false)
    expect(files.some((file) => file.name === 'linked.mp4')).toBe(false)
  })

  test('recursive=false 只扫描根目录', async () => {
    const root = join(dataDir, 'flat')
    mkdirSync(join(root, 'sub'), { recursive: true })
    writeFileSync(join(root, 'top.mp4'), mp4WithDuration(12))
    writeFileSync(join(root, 'sub', 'deep.mp4'), mp4WithDuration(12))

    const files = await scanFolder(root, false)
    expect(files.map((file) => file.name)).toEqual(['top.mp4'])
  })

  test('MP4 moov/mvhd 时长解析不依赖 ffprobe', async () => {
    const file = join(dataDir, 'duration.mp4')
    writeFileSync(file, mp4WithDuration(125))

    const media = await probeFile(file)
    expect(media.probedBy).toBe('mp4')
    expect(media.duration).toBe(125)
    expect(media.size).toBeGreaterThan(0)
  })
})

describe('短片判定', () => {
  test('dur=0（未探测到）不算短片', () => {
    expect(isShort(0, 10)).toBe(false)
  })

  test('正数时长按分钟阈值比较', () => {
    expect(isShort(1, 10)).toBe(true)
    expect(isShort(599, 10)).toBe(true)
    expect(isShort(600, 10)).toBe(false)
    expect(isShort(120, 5)).toBe(true)
    expect(isShort(300, 5)).toBe(false)
  })

  test('阈值下限至少 1 分钟', () => {
    expect(isShort(30, 0)).toBe(true)
    expect(isShort(60, 0)).toBe(false)
  })
})

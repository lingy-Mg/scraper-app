import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve } from 'node:path'
import { HttpError } from './fs'

/** 字幕文件格式（小写扩展名）。 */
const SUBTITLE_FORMATS = new Set(['.srt', '.ass', '.ssa', '.vtt'])

/** 同目录下允许查找的一层字幕子目录（不区分大小写）。 */
const SUBTITLE_DIRS = new Set(['subs', '字幕'])

/** 常见语言标记；也接受 ISO 639-1/2 形式（zh、en、eng、zh-CN…）。 */
const LANGUAGE_TOKENS = new Set([
  'zh',
  'cn',
  'chi',
  'zho',
  'chs',
  'cht',
  'chinese',
  'en',
  'eng',
  'english',
  'ja',
  'jp',
  'jpn',
  'japanese',
  'ko',
  'kor',
  'korean',
  'fr',
  'fre',
  'fra',
  'de',
  'ger',
  'deu',
  'es',
  'spa',
  'it',
  'ita',
  'pt',
  'por',
  'ru',
  'rus',
  'th',
  'tha',
  'vi',
  'vie',
  '中字',
  '简中',
  '繁中',
  '简体',
  '繁体',
  '双语'
])

export interface SubtitleMatch {
  /** 字幕文件绝对路径。 */
  path: string
  /** 不带点的格式：srt / ass / ssa / vtt。 */
  format: string
  /** 从文件名提取的语言标记（如 zh / chs / en）。 */
  language?: string
}

function isLanguageToken(token: string): boolean {
  const value = token.trim()
  if (!value) return false
  if (LANGUAGE_TOKENS.has(value.toLowerCase())) return true
  // ISO 639-1/2，可带区域后缀：zh-CN、pt-BR、en_US。
  if (/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})?$/i.test(value)) return true
  // 中文字幕组常用标记：中字 / 简中 / 繁中。
  return /^[一-鿿]{1,6}$/.test(value)
}

/**
 * 从「视频名 + 后缀」中提取语言：
 * `movie.zh.srt` → zh；`movie.zh.forced.srt` → zh；
 * `movie.srt` → 无语言；`movie.Behind.The.Scenes.srt` → 不匹配。
 */
function languageOfSuffix(suffix: string): string | null {
  const parts = suffix.split('.').filter(Boolean)
  if (!parts.length) return null
  if (!isLanguageToken(parts[0])) return null
  // 后续片段仅允许作为 forced / default / sdh 之类的标记。
  if (parts.slice(1).some((part) => !/^[a-z0-9_-]{1,24}$/i.test(part))) return null
  return parts[0]
}

function matchSubtitle(filename: string, videoStem: string): { language?: string } | null {
  const ext = extname(filename)
  const stem = filename.slice(0, filename.length - ext.length)
  if (stem === videoStem) return {}
  if (!stem.startsWith(`${videoStem}.`)) return null
  const language = languageOfSuffix(stem.slice(videoStem.length + 1))
  return language ? { language } : null
}

async function subtitleDirs(videoDir: string): Promise<string[]> {
  const dirs = [videoDir]
  try {
    const entries = await readdir(videoDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!SUBTITLE_DIRS.has(entry.name.toLowerCase())) continue
      dirs.push(join(videoDir, entry.name))
    }
  } catch {
    // 目录不可读时只扫描视频所在目录。
  }
  return dirs
}

/**
 * 查找与视频匹配的本地字幕（不递归，最多一层 Subs/字幕 子目录）。
 * - 同目录 / 子目录内与视频同名的字幕；
 * - 带语言后缀的字幕，提取 language；
 * - 只接受绝对路径且必须指向真实文件。
 */
export async function findSubtitles(videoPath: string): Promise<SubtitleMatch[]> {
  const raw = String(videoPath ?? '').trim()
  if (!raw) throw new HttpError(400, '缺少 videoPath')
  if (!isAbsolute(raw)) throw new HttpError(400, 'videoPath 必须是绝对路径')

  const video = resolve(raw)
  let info
  try {
    info = await stat(video)
  } catch {
    throw new HttpError(400, '视频文件不存在')
  }
  if (!info.isFile()) throw new HttpError(400, 'videoPath 不是文件')

  const videoDir = dirname(video)
  const videoStem = basename(video, extname(video))
  const found = new Map<string, SubtitleMatch>()

  for (const dir of await subtitleDirs(videoDir)) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      if (!SUBTITLE_FORMATS.has(ext)) continue
      const matched = matchSubtitle(entry.name, videoStem)
      if (!matched) continue

      const path = resolve(join(dir, entry.name))
      const subtitle: SubtitleMatch = { path, format: ext.slice(1) }
      if (matched.language) subtitle.language = matched.language
      found.set(path, subtitle)
    }
  }

  return [...found.values()].sort((left, right) => left.path.localeCompare(right.path))
}

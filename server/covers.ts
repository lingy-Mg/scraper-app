import { createHash } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cropImage, decodeCover, type ImageFormat } from './image'
import { resolveDataDir } from './settings'

/** 按当前数据目录解析封面缓存位置（不在模块加载时固化）。 */
function coverDir(): string {
  return join(resolveDataDir(), 'covers')
}
const EXTENSIONS = ['jpg', 'png', 'gif', 'webp', 'avif', 'heic'] as const
const MIME: Record<ImageFormat['ext'], string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic'
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface CachedCover {
  path: string
  type: string
}

async function findCached(prefix: string): Promise<CachedCover | null> {
  const dir = coverDir()
  for (const ext of EXTENSIONS) {
    const path = join(dir, `${prefix}.${ext}`)
    try {
      const info = await stat(path)
      if (info.size > 100) return { path, type: MIME[ext] }
    } catch {
      // 继续尝试下一个扩展名
    }
  }
  return null
}

/** 下载并缓存完整封面；同一 URL 只下载一次。 */
export async function cacheCover(rawUrl: string, crop?: CropRect): Promise<CachedCover> {
  if (!/^https?:\/\//i.test(rawUrl)) throw new Error('封面地址必须是 http(s)')

  const hash = createHash('md5').update(rawUrl).digest('hex')
  const prefix = crop
    ? `${hash}-crop-${crop.x}-${crop.y}-${crop.width}-${crop.height}`
    : hash
  const cached = await findCached(prefix)
  if (cached) return cached

  const response = await fetch(rawUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      referer: 'https://javdb.com/',
      accept: 'image/*'
    },
    signal: AbortSignal.timeout(20000)
  })
  if (!response.ok) throw new Error(`封面下载失败：HTTP ${response.status}`)

  const raw = Buffer.from(await response.arrayBuffer())
  if (raw.length < 100) throw new Error('封面内容为空')
  const decoded = crop
    ? cropImage(raw, crop.x, crop.y, crop.width, crop.height)
    : decodeCover(raw)

  const dir = coverDir()
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${prefix}.${decoded.format.ext}`)
  await writeFile(path, decoded.data)
  return { path, type: decoded.format.mime }
}

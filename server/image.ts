/** JavDB 图片 CDN 可能返回 XOR 包装：首字节为 key，其余字节与 key 异或后才是图片。 */

import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js'

export interface ImageFormat {
  ext: 'jpg' | 'png' | 'gif' | 'webp' | 'avif' | 'heic'
  mime: string
}

export function imageFormat(data: Buffer): ImageFormat | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (data.length >= 6) {
    const head = data.subarray(0, 6).toString('latin1')
    if (head === 'GIF87a' || head === 'GIF89a') return { ext: 'gif', mime: 'image/gif' }
  }
  if (
    data.length >= 12 &&
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  if (data.length >= 12 && data.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = data.subarray(8, 12).toString('latin1')
    if (brand === 'avif' || brand === 'avis') return { ext: 'avif', mime: 'image/avif' }
    if (brand === 'heic' || brand === 'heix' || brand === 'mif1')
      return { ext: 'heic', mime: 'image/heic' }
  }
  return null
}

export function decodeImage(raw: Buffer): { data: Buffer; format: ImageFormat } {
  const direct = imageFormat(raw)
  if (direct) return { data: raw, format: direct }
  if (raw.length < 3) throw new Error('图片内容为空')

  const key = raw[0]
  const decoded = Buffer.alloc(raw.length - 1)
  for (let index = 1; index < raw.length; index += 1) {
    decoded[index - 1] = raw[index] ^ key
  }
  const format = imageFormat(decoded)
  if (!format) throw new Error('图片格式无法识别')
  return { data: decoded, format }
}

/** 只做解码，不自动裁剪；裁剪由用户手动选择区域后调用 cropImage。 */
export function decodeCover(raw: Buffer): { data: Buffer; format: ImageFormat } {
  return decodeImage(raw)
}

/** 按源图像素坐标裁剪封面，越界自动收敛到图片范围内。 */
export function cropImage(
  raw: Buffer,
  x: number,
  y: number,
  width: number,
  height: number
): { data: Buffer; format: ImageFormat } {
  const decoded = decodeImage(raw)
  if (decoded.format.ext !== 'jpg') throw new Error('仅支持裁剪 JPG 封面')

  const image = decodeJpeg(decoded.data, { useTArray: true })
  if (!image.width || !image.height) throw new Error('封面尺寸无效')

  const left = Math.min(Math.max(0, Math.floor(x)), image.width - 1)
  const top = Math.min(Math.max(0, Math.floor(y)), image.height - 1)
  const cropWidth = Math.min(Math.max(1, Math.floor(width)), image.width - left)
  const cropHeight = Math.min(Math.max(1, Math.floor(height)), image.height - top)
  const source = Buffer.from(image.data)
  const cropped = Buffer.alloc(cropWidth * cropHeight * 4)

  for (let row = 0; row < cropHeight; row += 1) {
    const from = ((top + row) * image.width + left) * 4
    const to = row * cropWidth * 4
    source.copy(cropped, to, from, from + cropWidth * 4)
  }

  const encoded = encodeJpeg({ data: cropped, width: cropWidth, height: cropHeight }, 92)
  return {
    data: Buffer.from(encoded.data),
    format: { ext: 'jpg', mime: 'image/jpeg' }
  }
}

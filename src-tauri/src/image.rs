//! JavDB image payload decoding.
//!
//! The image CDN may XOR-wrap images: the first byte is the key and every
//! following byte is XORed with it. Plain images are passed through.

pub struct DecodedImage {
    pub bytes: Vec<u8>,
    pub ext: &'static str,
    pub mime: &'static str,
}

fn image_format(data: &[u8]) -> Option<(&'static str, &'static str)> {
    if data.len() >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff {
        return Some(("jpg", "image/jpeg"));
    }
    if data.len() >= 8 && data[..8] == [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] {
        return Some(("png", "image/png"));
    }
    if data.len() >= 6 {
        let head = &data[..6];
        if head == b"GIF87a" || head == b"GIF89a" {
            return Some(("gif", "image/gif"));
        }
    }
    if data.len() >= 12 && &data[..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return Some(("webp", "image/webp"));
    }
    if data.len() >= 12 && &data[4..8] == b"ftyp" {
        match &data[8..12] {
            b"avif" | b"avis" => return Some(("avif", "image/avif")),
            b"heic" | b"heix" | b"mif1" => return Some(("heic", "image/heic")),
            _ => {}
        }
    }
    None
}

pub fn decode_image(raw: &[u8]) -> Result<DecodedImage, String> {
    if let Some((ext, mime)) = image_format(raw) {
        return Ok(DecodedImage {
            bytes: raw.to_vec(),
            ext,
            mime,
        });
    }
    if raw.len() < 3 {
        return Err("图片内容为空".to_string());
    }

    let key = raw[0];
    let mut decoded = Vec::with_capacity(raw.len() - 1);
    for byte in &raw[1..] {
        decoded.push(byte ^ key);
    }
    let Some((ext, mime)) = image_format(&decoded) else {
        return Err("图片格式无法识别".to_string());
    };
    Ok(DecodedImage {
        bytes: decoded,
        ext,
        mime,
    })
}

/// 按源图像素坐标裁剪封面。越界会自动收敛到图片范围内。
pub fn crop_image(
    raw: &[u8],
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<DecodedImage, String> {
    let decoded = decode_image(raw)?;
    if !matches!(decoded.ext, "jpg" | "png") {
        return Err("仅支持裁剪 JPG/PNG 封面".to_string());
    }

    let image = image::load_from_memory(&decoded.bytes)
        .map_err(|error| format!("解析封面图片失败: {error}"))?;
    let image_width = image.width();
    let image_height = image.height();
    if image_width == 0 || image_height == 0 {
        return Err("封面尺寸无效".to_string());
    }

    let x = x.min(image_width.saturating_sub(1));
    let y = y.min(image_height.saturating_sub(1));
    let width = width.max(1).min(image_width - x);
    let height = height.max(1).min(image_height - y);
    let cropped = image.crop_imm(x, y, width, height);

    let mut bytes = Vec::new();
    if decoded.ext == "png" {
        cropped
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .map_err(|error| format!("重新编码封面失败: {error}"))?;
        Ok(DecodedImage {
            bytes,
            ext: "png",
            mime: "image/png",
        })
    } else {
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 92);
        encoder
            .encode_image(&cropped)
            .map_err(|error| format!("重新编码封面失败: {error}"))?;
        Ok(DecodedImage {
            bytes,
            ext: "jpg",
            mime: "image/jpeg",
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_png(width: u32, height: u32) -> Vec<u8> {
        let mut image = image::RgbImage::new(width, height);
        for (x, y, pixel) in image.enumerate_pixels_mut() {
            *pixel = image::Rgb([(x % 256) as u8, (y % 256) as u8, 128]);
        }
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image)
            .write_to(
                &mut std::io::Cursor::new(&mut bytes),
                image::ImageFormat::Png,
            )
            .expect("encode png");
        bytes
    }

    #[test]
    fn crops_requested_region() {
        let png = sample_png(100, 80);
        let cropped = crop_image(&png, 10, 5, 40, 30).expect("crop");
        let image = image::load_from_memory(&cropped.bytes).expect("decode cropped");
        assert_eq!(image.width(), 40);
        assert_eq!(image.height(), 30);
        assert_eq!(cropped.ext, "png");
    }

    #[test]
    fn clamps_crop_region_to_image_bounds() {
        let png = sample_png(50, 40);
        let cropped = crop_image(&png, 45, 35, 100, 100).expect("crop");
        let image = image::load_from_memory(&cropped.bytes).expect("decode cropped");
        assert_eq!(image.width(), 5);
        assert_eq!(image.height(), 5);
    }
}

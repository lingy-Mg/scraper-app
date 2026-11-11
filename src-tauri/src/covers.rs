//! 封面本地缓存：由 Rust 直接下载、解包并缓存，避免 WebView 代理/防盗链问题。
//!
//! 默认缓存完整封面，不再自动裁剪；手动裁剪会生成独立的缓存文件。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use tauri::Manager;

use crate::image::{crop_image, decode_image};

const EXTENSIONS: [&str; 6] = ["jpg", "png", "gif", "webp", "avif", "heic"];

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("jpg")
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "heic" => "image/heic",
        _ => "image/jpeg",
    }
}

fn data_url(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| format!("读取封面缓存失败: {error}"))?;
    Ok(format!(
        "data:{};base64,{}",
        mime_for(path),
        STANDARD.encode(bytes)
    ))
}

#[tauri::command]
pub async fn cover_cache(app: tauri::AppHandle, url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || cache_cover_sync(&app, &url))
        .await
        .map_err(|error| format!("封面缓存任务失败: {error}"))?
}

#[tauri::command]
pub async fn cover_crop(
    app: tauri::AppHandle,
    url: String,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || cache_crop_sync(&app, &url, x, y, width, height))
        .await
        .map_err(|error| format!("封面裁剪任务失败: {error}"))?
}

fn cover_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法读取应用数据目录: {error}"))?
        .join("covers");
    fs::create_dir_all(&dir).map_err(|error| format!("创建封面目录失败: {error}"))?;
    Ok(dir)
}

fn find_cached(dir: &Path, prefix: &str) -> Option<PathBuf> {
    for ext in EXTENSIONS {
        let path = dir.join(format!("{prefix}.{ext}"));
        if let Ok(info) = fs::metadata(&path) {
            if info.len() > 100 {
                return Some(path);
            }
        }
    }
    None
}

fn fetch_image(url: &str) -> Result<Vec<u8>, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("封面地址必须是 http(s)".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .map_err(|error| format!("创建封面下载客户端失败: {error}"))?;

    let response = client
        .get(url)
        .header("referer", "https://javdb.com/")
        .header("accept", "image/*")
        .send()
        .map_err(|error| format!("封面下载失败: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("封面下载失败：HTTP {}", response.status().as_u16()));
    }

    let raw = response
        .bytes()
        .map_err(|error| format!("读取封面失败: {error}"))?;
    if raw.len() < 100 {
        return Err("封面内容为空".to_string());
    }
    Ok(raw.to_vec())
}

fn cache_cover_sync(app: &tauri::AppHandle, url: &str) -> Result<String, String> {
    let dir = cover_dir(app)?;
    let hash = format!("{:x}", md5::compute(url));
    if let Some(path) = find_cached(&dir, &hash) {
        return data_url(&path);
    }

    let raw = fetch_image(url)?;
    let decoded = decode_image(&raw)?;
    let path = dir.join(format!("{hash}.{}", decoded.ext));
    fs::write(&path, &decoded.bytes).map_err(|error| format!("写入封面缓存失败: {error}"))?;
    data_url(&path)
}

fn cache_crop_sync(
    app: &tauri::AppHandle,
    url: &str,
    x: u32,
    y: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    let dir = cover_dir(app)?;
    let hash = format!("{:x}", md5::compute(url));
    let prefix = format!("{hash}-crop-{x}-{y}-{width}-{height}");
    if let Some(path) = find_cached(&dir, &prefix) {
        return data_url(&path);
    }

    let raw = fetch_image(url)?;
    let decoded = crop_image(&raw, x, y, width, height)?;
    let path = dir.join(format!("{prefix}.{}", decoded.ext));
    fs::write(&path, &decoded.bytes).map_err(|error| format!("写入裁剪封面失败: {error}"))?;
    data_url(&path)
}

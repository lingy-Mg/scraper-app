//! File organizing (move / copy with conflict handling).

use std::collections::BTreeSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::image::{crop_image, decode_image};
use crate::models::{CropRect, OrganizeItem, OrganizeRequest, OrganizeResult};

/// `organize_files` accepts either a single `OrganizeRequest` object
/// (`invoke('organize_files', { request })`) or the flattened fields
/// (`invoke('organize_files', { dest, action, ... })`).
#[tauri::command]
pub async fn organize_files(
    dest: Option<String>,
    action: Option<String>,
    conflict: Option<String>,
    remove_empty_dirs: Option<bool>,
    items: Option<Vec<OrganizeItem>>,
    request: Option<OrganizeRequest>,
) -> Result<Vec<OrganizeResult>, String> {
    let request = match request {
        Some(request) => request,
        None => OrganizeRequest {
            dest: dest.ok_or_else(|| "缺少目标目录 dest".to_string())?,
            action: action.unwrap_or_else(|| "move".to_string()),
            conflict: conflict.unwrap_or_else(|| "rename".to_string()),
            remove_empty_dirs: remove_empty_dirs.unwrap_or(false),
            items: items.unwrap_or_default(),
        },
    };

    tauri::async_runtime::spawn_blocking(move || organize_sync(request))
        .await
        .map_err(|e| format!("整理任务失败: {e}"))?
}

fn organize_sync(request: OrganizeRequest) -> Result<Vec<OrganizeResult>, String> {
    if request.items.is_empty() {
        return Ok(Vec::new());
    }

    let dest_raw = PathBuf::from(&request.dest);
    if !dest_raw.exists() {
        fs::create_dir_all(&dest_raw)
            .map_err(|e| format!("无法创建目标目录 {}: {e}", dest_raw.display()))?;
    }
    let dest = fs::canonicalize(&dest_raw)
        .map_err(|e| format!("无法解析目标目录 {}: {e}", dest_raw.display()))?;
    if !dest.is_dir() {
        return Err(format!("目标路径不是目录: {}", dest.display()));
    }

    let action = request.action().to_string();
    let conflict = request.conflict().to_string();
    let mut results = Vec::with_capacity(request.items.len());
    let mut source_dirs: BTreeSet<PathBuf> = BTreeSet::new();

    for item in &request.items {
        if let Ok(canonical) = fs::canonicalize(&item.source) {
            if let Some(parent) = canonical.parent() {
                source_dirs.insert(parent.to_path_buf());
            }
        } else if let Some(parent) = Path::new(&item.source).parent() {
            source_dirs.insert(parent.to_path_buf());
        }

        results.push(organize_one(&dest, item, &action, &conflict));
    }

    if request.remove_empty_dirs {
        cleanup_empty_source_dirs(&dest, &source_dirs);
    }

    Ok(results)
}

fn organize_one(dest: &Path, item: &OrganizeItem, action: &str, conflict: &str) -> OrganizeResult {
    let raw_target = dest.join(item.relative_target.replace('\\', "/"));
    let fallback_target = raw_target.to_string_lossy().into_owned();

    let error = |message: String| OrganizeResult {
        source: item.source.clone(),
        target: fallback_target.clone(),
        ok: false,
        skipped: false,
        error: Some(message),
        warning: None,
    };

    let action = match action {
        "move" => "move",
        "copy" => "copy",
        other => return error(format!("未知操作: {other}")),
    };
    let conflict = match conflict {
        "skip" => "skip",
        "overwrite" => "overwrite",
        "rename" => "rename",
        other => return error(format!("未知冲突策略: {other}")),
    };

    let source = Path::new(&item.source);
    if !source.exists() {
        return error(format!("源文件不存在: {}", source.display()));
    }
    if !source.is_file() {
        return error(format!("源路径不是文件: {}", source.display()));
    }

    let relative = match sanitize_relative(&item.relative_target) {
        Ok(relative) => relative,
        Err(message) => return error(message),
    };

    let target = dest.join(&relative);
    if !target.starts_with(dest) {
        return error("目标路径越界".to_string());
    }

    let Some(parent) = target.parent() else {
        return error("目标路径越界".to_string());
    };
    if let Err(e) = fs::create_dir_all(parent) {
        return error(format!("创建目标目录失败: {e}"));
    }

    // Resolve the (now existing) parent to catch symlink escapes.
    let parent = match fs::canonicalize(parent) {
        Ok(parent) => parent,
        Err(e) => return error(format!("无法解析目标目录: {e}")),
    };
    if !parent.starts_with(dest) {
        return error("目标路径越界".to_string());
    }

    let file_name = match target.file_name() {
        Some(name) => name.to_os_string(),
        None => return error("目标路径越界".to_string()),
    };
    let mut final_target = parent.join(file_name);

    if final_target.exists() {
        match conflict {
            "skip" => {
                return OrganizeResult {
                    source: item.source.clone(),
                    target: final_target.to_string_lossy().into_owned(),
                    ok: true,
                    skipped: true,
                    error: None,
                    warning: None,
                };
            }
            "overwrite" => {
                if final_target.is_dir() {
                    return error(format!("目标已存在且是目录: {}", final_target.display()));
                }
                if let Err(e) = fs::remove_file(&final_target) {
                    return error(format!("覆盖已存在文件失败: {e}"));
                }
            }
            _ => {
                final_target = unique_path(&final_target);
            }
        }
    }

    let transfer = if action == "move" {
        match fs::rename(source, &final_target) {
            Ok(()) => Ok(()),
            Err(rename_error) => {
                // Cross-volume (or locked) rename: copy, verify, then delete source.
                match copy_verified(source, &final_target) {
                    Ok(()) => fs::remove_file(source).map_err(|e| {
                        format!("已复制到目标，但删除源文件失败: {e}（rename: {rename_error}）")
                    }),
                    Err(copy_error) => Err(format!(
                        "移动失败: {rename_error}; 复制回退失败: {copy_error}"
                    )),
                }
            }
        }
    } else {
        copy_verified(source, &final_target)
    };

    match transfer {
        Ok(()) => {
            let warnings = write_sidecars(&final_target, item);
            OrganizeResult {
                source: item.source.clone(),
                target: final_target.to_string_lossy().into_owned(),
                ok: true,
                skipped: false,
                error: None,
                warning: if warnings.is_empty() {
                    None
                } else {
                    Some(warnings.join("；"))
                },
            }
        }
        Err(message) => OrganizeResult {
            source: item.source.clone(),
            target: final_target.to_string_lossy().into_owned(),
            ok: false,
            skipped: false,
            error: Some(message),
            warning: None,
        },
    }
}

/// 主文件整理成功后写入 NFO、下载封面。附属文件失败不影响主文件结果。
fn write_sidecars(target: &Path, item: &OrganizeItem) -> Vec<String> {
    let mut warnings = Vec::new();
    if item.nfo.is_none() && item.poster_url.is_none() {
        return warnings;
    }

    let stem = target.with_extension("");

    if let Some(nfo) = item.nfo.as_deref() {
        if let Err(error) = fs::write(stem.with_extension("nfo"), nfo) {
            warnings.push(format!("写入 NFO 失败: {error}"));
        }
    }

    if let Some(url) = item.poster_url.as_deref() {
        if let Err(error) = download_poster(url, &stem, item.poster_crop) {
            warnings.push(format!("下载封面失败: {error}"));
        }
    }

    warnings
}

fn download_poster(url: &str, stem: &Path, crop: Option<CropRect>) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    let bytes = response.bytes().map_err(|e| format!("读取封面失败: {e}"))?;
    if bytes.len() < 100 {
        return Err("封面内容为空".to_string());
    }
    let decoded = match crop {
        Some(rect) => crop_image(&bytes, rect.x, rect.y, rect.width, rect.height)?,
        None => decode_image(&bytes)?,
    };
    fs::write(stem.with_extension(decoded.ext), &decoded.bytes)
        .map_err(|e| format!("写入封面失败: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_nfo_sidecar() {
        let dir = std::env::temp_dir().join(format!("scraper-nfo-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let target = dir.join("示例 001.mp4");
        fs::write(&target, b"video").unwrap();
        let item = OrganizeItem {
            source: target.to_string_lossy().into_owned(),
            relative_target: "示例 001.mp4".to_string(),
            nfo: Some("<movie><title>t</title></movie>".to_string()),
            poster_url: None,
            poster_crop: None,
        };
        let warnings = write_sidecars(&target, &item);
        assert!(warnings.is_empty(), "warnings: {warnings:?}");
        let nfo = fs::read_to_string(dir.join("示例 001.nfo")).unwrap();
        assert!(nfo.contains("<title>t</title>"));
        fs::remove_dir_all(&dir).ok();
    }
}

/// Reject absolute paths, `..` and other components that could escape `dest`.
fn sanitize_relative(raw: &str) -> Result<PathBuf, String> {
    let normalized = raw.replace('\\', "/");
    if normalized.trim().is_empty() {
        return Err("目标路径越界".to_string());
    }

    let path = Path::new(&normalized);
    if path.is_absolute() {
        return Err("目标路径越界".to_string());
    }

    let mut relative = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            _ => return Err("目标路径越界".to_string()),
        }
    }

    if relative.as_os_str().is_empty() {
        return Err("目标路径越界".to_string());
    }
    Ok(relative)
}

fn unique_path(path: &Path) -> PathBuf {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = path.extension().map(|e| e.to_string_lossy().into_owned());

    for index in 2..=100_000u32 {
        let name = match &extension {
            Some(ext) => format!("{stem} ({index}).{ext}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }

    match &extension {
        Some(ext) => parent.join(format!("{stem} (copy).{ext}")),
        None => parent.join(format!("{stem} (copy)")),
    }
}

fn copy_verified(source: &Path, target: &Path) -> Result<(), String> {
    let source_size = fs::metadata(source)
        .map_err(|e| format!("读取源文件大小失败: {e}"))?
        .len();

    fs::copy(source, target).map_err(|e| format!("复制失败: {e}"))?;

    let target_size = match fs::metadata(target) {
        Ok(metadata) => metadata.len(),
        Err(e) => {
            let _ = fs::remove_file(target);
            return Err(format!("读取目标文件大小失败: {e}"));
        }
    };

    if source_size != target_size {
        let _ = fs::remove_file(target);
        return Err(format!(
            "复制校验失败：源 {source_size} 字节，目标 {target_size} 字节"
        ));
    }

    Ok(())
}

/// Remove source directories left empty by this organize run. Walks upward, but
/// never removes `dest`, its ancestors, or anything inside `dest`.
fn cleanup_empty_source_dirs(dest: &Path, dirs: &BTreeSet<PathBuf>) {
    let mut ordered: Vec<PathBuf> = dirs.iter().cloned().collect();
    ordered.sort_by_key(|path| std::cmp::Reverse(path.components().count()));

    for dir in ordered {
        let mut current = Some(dir);
        while let Some(path) = current {
            if path == dest || dest.starts_with(&path) || path.starts_with(dest) {
                break;
            }
            if fs::remove_dir(&path).is_err() {
                break;
            }
            current = path.parent().map(Path::to_path_buf);
        }
    }
}

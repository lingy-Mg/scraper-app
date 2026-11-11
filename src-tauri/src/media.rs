//! Media scanning / duration probing.

use std::env;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::Emitter;

use crate::models::{AppInfo, MediaFile};

const VIDEO_EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "avi", "wmv", "ts", "m2ts", "flv", "webm",
];

/// `scan-progress` 事件负载；扫描期间分阶段推送，让前端立即看到进度。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanProgress {
    scan_id: String,
    /// `walk` = 枚举目录，`probe` = 读取视频信息。
    phase: &'static str,
    found: usize,
    dirs: usize,
    total: usize,
    done: usize,
    current: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    files: Vec<MediaFile>,
}

/// 限频的事件发送器，避免大目录扫描时产生过多 IPC 事件。
struct ScanReporter<'a> {
    app: &'a tauri::AppHandle,
    scan_id: &'a str,
    last: Instant,
}

impl<'a> ScanReporter<'a> {
    fn new(app: &'a tauri::AppHandle, scan_id: &'a str) -> Self {
        Self {
            app,
            scan_id,
            last: Instant::now(),
        }
    }

    fn ready(&self, min_ms: u64) -> bool {
        self.last.elapsed() >= Duration::from_millis(min_ms)
    }

    #[allow(clippy::too_many_arguments)]
    fn send(
        &mut self,
        phase: &'static str,
        found: usize,
        dirs: usize,
        total: usize,
        done: usize,
        current: &str,
        files: Vec<MediaFile>,
    ) {
        self.last = Instant::now();
        let payload = ScanProgress {
            scan_id: self.scan_id.to_string(),
            phase,
            found,
            dirs,
            total,
            done,
            current: current.to_string(),
            files,
        };
        if let Err(error) = self.app.emit("scan-progress", payload) {
            log::debug!("scan progress emit failed: {error}");
        }
    }
}

/// `probe_file` / `scan_folder` need a path and (for scanning) a recursion flag.
/// `blacklist` 命中文件名的文件会被直接跳过（不探测、不返回）。
#[tauri::command]
pub async fn scan_folder(
    app: tauri::AppHandle,
    path: String,
    recursive: Option<bool>,
    scan_id: Option<String>,
    blacklist: Option<Vec<String>>,
) -> Result<Vec<MediaFile>, String> {
    let recursive = recursive.unwrap_or(true);
    let scan_id = scan_id.unwrap_or_else(|| "scan".to_string());
    let blacklist = blacklist.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        scan_folder_sync(&app, &scan_id, Path::new(&path), recursive, &blacklist)
    })
    .await
    .map_err(|e| format!("扫描任务失败: {e}"))?
}

#[tauri::command]
pub async fn probe_file(path: String) -> Result<MediaFile, String> {
    tauri::async_runtime::spawn_blocking(move || probe_file_sync(Path::new(&path)))
        .await
        .map_err(|e| format!("探测任务失败: {e}"))?
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        match app.dialog().file().blocking_pick_folder() {
            Some(file_path) => file_path
                .into_path()
                .map(|p| Some(p.to_string_lossy().into_owned()))
                .map_err(|e| format!("无法解析所选目录: {e}")),
            None => Ok(None),
        }
    })
    .await
    .map_err(|e| format!("打开目录选择器失败: {e}"))?
}

#[tauri::command]
pub async fn app_info(app: tauri::AppHandle) -> Result<AppInfo, String> {
    let version = app.package_info().version.to_string();
    let platform = std::env::consts::OS.to_string();
    let ffprobe = tauri::async_runtime::spawn_blocking(|| ffprobe_path().is_some())
        .await
        .map_err(|e| format!("检测 ffprobe 失败: {e}"))?;
    Ok(AppInfo {
        version,
        platform,
        ffprobe,
        native: true,
    })
}

fn scan_folder_sync(
    app: &tauri::AppHandle,
    scan_id: &str,
    root: &Path,
    recursive: bool,
    blacklist: &[String],
) -> Result<Vec<MediaFile>, String> {
    let metadata =
        fs::metadata(root).map_err(|e| format!("无法读取目录 {}: {e}", root.display()))?;
    if !metadata.is_dir() {
        return Err(format!("不是目录: {}", root.display()));
    }

    let mut reporter = ScanReporter::new(app, scan_id);
    reporter.send("walk", 0, 0, 0, 0, &root.display().to_string(), Vec::new());

    let mut paths: Vec<PathBuf> = Vec::new();
    let mut dirs = 0usize;
    walk_dir(root, recursive, &mut paths, &mut dirs, &mut reporter, blacklist);

    paths.sort_by(|a, b| file_name_lower(a).cmp(&file_name_lower(b)));

    let total = paths.len();
    reporter.send("probe", total, dirs, total, 0, "", Vec::new());

    let mut files: Vec<MediaFile> = Vec::with_capacity(total);
    let mut pending: Vec<MediaFile> = Vec::new();

    for (index, path) in paths.iter().enumerate() {
        if let Ok(media) = probe_file_sync(path) {
            files.push(media.clone());
            pending.push(media);
        }

        let done = index + 1;
        let force = done == total;
        if force || pending.len() >= 16 || reporter.ready(180) {
            let current = pending.last().map(|m| m.name.clone()).unwrap_or_default();
            let batch = std::mem::take(&mut pending);
            reporter.send("probe", total, dirs, total, done, &current, batch);
        }
    }

    if total == 0 {
        reporter.send("probe", 0, dirs, 0, 0, "", Vec::new());
    }

    files.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(files)
}

fn file_name_lower(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

fn walk_dir(
    dir: &Path,
    recursive: bool,
    out: &mut Vec<PathBuf>,
    dirs: &mut usize,
    reporter: &mut ScanReporter,
    blacklist: &[String],
) {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    *dirs += 1;

    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(t) => t,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }

        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            // Skip hidden directories when recursing.
            if recursive && !name.starts_with('.') {
                walk_dir(&entry.path(), recursive, out, dirs, reporter, blacklist);
            }
        } else if file_type.is_file() && is_video_name(&name) && !is_blacklisted(&name, blacklist) {
            out.push(entry.path());
            if reporter.ready(150) {
                reporter.send("walk", out.len(), *dirs, 0, 0, &name, Vec::new());
            }
        }
    }

    if reporter.ready(150) {
        let current = dir
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| dir.display().to_string());
        reporter.send("walk", out.len(), *dirs, 0, 0, &current, Vec::new());
    }
}

fn is_video_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // TypeScript 声明文件不要当成 MPEG-TS。
    if lower.ends_with(".d.ts") {
        return false;
    }
    match Path::new(name).extension().and_then(|e| e.to_str()) {
        Some(ext) => VIDEO_EXTENSIONS
            .iter()
            .any(|known| ext.eq_ignore_ascii_case(known)),
        None => false,
    }
}

/// 文件名黑名单匹配（与前端 `isBlacklisted`、Bun 实现保持一致）：
/// - 不区分大小写；
/// - 含 `*` / `?` 时按通配符整名匹配；
/// - 不含通配符时按「包含」匹配。
fn is_blacklisted(name: &str, patterns: &[String]) -> bool {
    if patterns.is_empty() {
        return false;
    }

    let target = name.to_lowercase();
    for raw in patterns {
        let pattern = raw.trim().to_lowercase();
        if pattern.is_empty() {
            continue;
        }
        if pattern.contains('*') || pattern.contains('?') {
            let pattern_chars: Vec<char> = pattern.chars().collect();
            let target_chars: Vec<char> = target.chars().collect();
            if glob_match(&pattern_chars, &target_chars) {
                return true;
            }
        } else if target.contains(&pattern) {
            return true;
        }
    }
    false
}

/// 支持 `*`（任意长度）与 `?`（单个字符）的通配符匹配。
fn glob_match(pattern: &[char], text: &[char]) -> bool {
    let (mut p, mut t) = (0usize, 0usize);
    let mut star: Option<usize> = None;
    let mut mark = 0usize;

    while t < text.len() {
        if p < pattern.len() && (pattern[p] == '?' || pattern[p] == text[t]) {
            p += 1;
            t += 1;
        } else if p < pattern.len() && pattern[p] == '*' {
            star = Some(p);
            p += 1;
            mark = t;
        } else if let Some(star_index) = star {
            p = star_index + 1;
            mark += 1;
            t = mark;
        } else {
            return false;
        }
    }

    while p < pattern.len() && pattern[p] == '*' {
        p += 1;
    }
    p == pattern.len()
}

fn is_mp4_name(name: &str) -> bool {
    match Path::new(name).extension().and_then(|e| e.to_str()) {
        Some(ext) => ["mp4", "m4v", "mov"]
            .iter()
            .any(|known| ext.eq_ignore_ascii_case(known)),
        None => false,
    }
}

fn probe_file_sync(path: &Path) -> Result<MediaFile, String> {
    let metadata =
        fs::metadata(path).map_err(|e| format!("无法读取文件 {}: {e}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("不是文件: {}", path.display()));
    }

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default()
        .to_string();

    let mut duration = None;
    let mut probed_by = "none";

    // Native MP4 parsing first, for mp4/m4v/mov.
    if is_mp4_name(&name) {
        if let Some(seconds) = probe_mp4(path) {
            if seconds.is_finite() && seconds > 0.0 {
                duration = Some(round3(seconds));
                probed_by = "mp4";
            }
        }
    }

    let mut width = None;
    let mut height = None;
    let mut video_codec = None;

    // Fall back to ffprobe when the native parser did not produce a duration.
    if duration.is_none() {
        if let Some(meta) = probe_with_ffprobe(path) {
            if let Some(seconds) = meta.duration {
                if seconds.is_finite() && seconds > 0.0 {
                    duration = Some(round3(seconds));
                    probed_by = "ffprobe";
                }
            }
            width = meta.width;
            height = meta.height;
            video_codec = meta.codec;
            if probed_by == "none" && (width.is_some() || height.is_some() || video_codec.is_some())
            {
                probed_by = "ffprobe";
            }
        }
    }

    Ok(MediaFile {
        path: path.to_string_lossy().into_owned(),
        name,
        size: metadata.len(),
        duration,
        probed_by: probed_by.to_string(),
        width,
        height,
        video_codec,
    })
}

fn round3(value: f64) -> f64 {
    (value * 1000.0).round() / 1000.0
}

// ---------------------------------------------------------------------------
// ffprobe discovery and probing
// ---------------------------------------------------------------------------

static FFPROBE_CACHE: OnceLock<Option<PathBuf>> = OnceLock::new();

fn ffprobe_path() -> Option<&'static PathBuf> {
    FFPROBE_CACHE.get_or_init(find_ffprobe).as_ref()
}

fn ffprobe_file_name() -> &'static str {
    if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    }
}

fn find_ffprobe() -> Option<PathBuf> {
    let exe_name = ffprobe_file_name();

    // 1. PATH
    if let Some(paths) = env::var_os("PATH") {
        for dir in env::split_paths(&paths) {
            let candidate = dir.join(exe_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    // 2. Directory of the running executable.
    if let Ok(current_exe) = env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            for candidate in [
                dir.join(exe_name),
                dir.join("binaries").join(exe_name),
                dir.join("src-tauri").join("binaries").join(exe_name),
                dir.join("..")
                    .join("src-tauri")
                    .join("binaries")
                    .join(exe_name),
            ] {
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }

    // 3. src-tauri/binaries (relative to the working directory and the crate).
    let mut bases = Vec::new();
    if let Ok(cwd) = env::current_dir() {
        bases.push(cwd.join("binaries"));
        bases.push(cwd.join("src-tauri").join("binaries"));
    }
    bases.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));

    for base in bases {
        let candidate = base.join(exe_name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    None
}

struct FfprobeMeta {
    duration: Option<f64>,
    width: Option<u32>,
    height: Option<u32>,
    codec: Option<String>,
}

fn probe_with_ffprobe(path: &Path) -> Option<FfprobeMeta> {
    let exe = ffprobe_path()?;
    let mut command = Command::new(exe);
    command
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=width,height,codec_name",
            "-of",
            "json",
        ])
        .arg(path);
    hide_console(&mut command);

    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }

    let value: serde_json::Value = serde_json::from_slice(&output.stdout).ok()?;

    let duration = value
        .get("format")
        .and_then(|format| format.get("duration"))
        .and_then(value_as_f64);

    let mut width = None;
    let mut height = None;
    let mut codec = None;

    if let Some(streams) = value.get("streams").and_then(|v| v.as_array()) {
        let stream = streams
            .iter()
            .find(|stream| stream.get("codec_type").and_then(|v| v.as_str()) == Some("video"))
            .or_else(|| streams.first());

        if let Some(stream) = stream {
            width = stream.get("width").and_then(value_as_u32);
            height = stream.get("height").and_then(value_as_u32);
            codec = stream
                .get("codec_name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
        }
    }

    Some(FfprobeMeta {
        duration,
        width,
        height,
        codec,
    })
}

fn value_as_f64(value: &serde_json::Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
}

fn value_as_u32(value: &serde_json::Value) -> Option<u32> {
    value
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
        .or_else(|| value.as_str().and_then(|s| s.trim().parse::<u32>().ok()))
}

/// Hide the console window when spawning a child process on Windows.
fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

// ---------------------------------------------------------------------------
// MP4 (moov/mvhd) duration parsing
// ---------------------------------------------------------------------------

struct BoxInfo {
    size: u64,
    header: u64,
    kind: [u8; 4],
}

fn read_box(file: &mut File, offset: u64, end: u64) -> io::Result<Option<BoxInfo>> {
    if offset.checked_add(8).map_or(true, |v| v > end) {
        return Ok(None);
    }

    file.seek(SeekFrom::Start(offset))?;
    let mut header = [0u8; 16];
    let read = file.read(&mut header)?;
    if read < 8 {
        return Ok(None);
    }

    let size32 = u32::from_be_bytes([header[0], header[1], header[2], header[3]]);
    let kind = [header[4], header[5], header[6], header[7]];

    let (size, header_size) = if size32 == 1 {
        if read < 16 {
            return Ok(None);
        }
        let size64 = u64::from_be_bytes([
            header[8], header[9], header[10], header[11], header[12], header[13], header[14],
            header[15],
        ]);
        (size64, 16u64)
    } else if size32 == 0 {
        // Box extends to the end of the file.
        (end.saturating_sub(offset), 8u64)
    } else {
        (u64::from(size32), 8u64)
    };

    if size < header_size {
        return Ok(None);
    }
    if offset.checked_add(size).map_or(true, |v| v > end) {
        return Ok(None);
    }

    Ok(Some(BoxInfo {
        size,
        header: header_size,
        kind,
    }))
}

fn probe_mp4(path: &Path) -> Option<f64> {
    let mut file = File::open(path).ok()?;
    let end = file.metadata().ok()?.len();
    let mut position = 0u64;

    while position.checked_add(8)? <= end {
        let Some(info) = read_box(&mut file, position, end).ok().flatten() else {
            break;
        };

        if &info.kind == b"moov" {
            return find_mvhd(&mut file, position + info.header, position + info.size, 0);
        }

        position = position.checked_add(info.size)?;
    }

    None
}

fn find_mvhd(file: &mut File, start: u64, end: u64, depth: u32) -> Option<f64> {
    if depth > 4 {
        return None;
    }

    let mut position = start;
    while position.checked_add(8)? <= end {
        let Some(info) = read_box(file, position, end).ok().flatten() else {
            break;
        };

        if &info.kind == b"mvhd" {
            return read_mvhd(file, position + info.header, info.size - info.header);
        }

        if matches!(&info.kind, b"moov" | b"trak" | b"mdia") {
            if let Some(duration) = find_mvhd(
                file,
                position + info.header,
                position + info.size,
                depth + 1,
            ) {
                return Some(duration);
            }
        }

        position = position.checked_add(info.size)?;
    }

    None
}

fn read_mvhd(file: &mut File, payload_offset: u64, payload_size: u64) -> Option<f64> {
    let length = payload_size.min(128) as usize;
    if length < 20 {
        return None;
    }

    let mut data = vec![0u8; length];
    file.seek(SeekFrom::Start(payload_offset)).ok()?;
    let read = file.read(&mut data).ok()?;
    if read < 20 {
        return None;
    }

    let version = data[0];
    let (timescale, duration) = if version == 1 {
        if read < 32 {
            return None;
        }
        let timescale = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
        let duration = u64::from_be_bytes([
            data[24], data[25], data[26], data[27], data[28], data[29], data[30], data[31],
        ]);
        (timescale, duration as f64)
    } else {
        let timescale = u32::from_be_bytes([data[12], data[13], data[14], data[15]]);
        let duration = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        (timescale, duration as f64)
    };

    if timescale == 0 {
        return None;
    }

    let seconds = duration / timescale as f64;
    if seconds.is_finite() && seconds > 0.0 {
        Some(seconds)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn patterns(items: &[&str]) -> Vec<String> {
        items.iter().map(|item| item.to_string()).collect()
    }

    #[test]
    fn blacklist_matches_substring_and_globs() {
        let list = patterns(&["sample", "*.torrent", "*广告*"]);
        assert!(is_blacklisted("my-sample.mp4", &list));
        assert!(is_blacklisted("SAMPLE.MKV", &list));
        assert!(is_blacklisted("a.torrent", &list));
        assert!(is_blacklisted("广告1.mp4", &list));
        assert!(!is_blacklisted("movie.mp4", &list));
        assert!(!is_blacklisted("movie.mp4", &[]));
    }

    #[test]
    fn blacklist_question_mark_matches_single_char() {
        let list = patterns(&["广告?.mp4"]);
        assert!(is_blacklisted("广告1.mp4", &list));
        assert!(!is_blacklisted("广告12.mp4", &list));
        assert!(!is_blacklisted("广告.mp4", &list));
    }

    #[test]
    fn blacklist_glob_star_matches_any_length() {
        let list = patterns(&["*SAMPLE*"]);
        assert!(is_blacklisted("Sample.mkv", &list));
        assert!(is_blacklisted("the-sample-file.mp4", &list));
        assert!(!is_blacklisted("movie.mkv", &list));

        let prefix = patterns(&["preview-*"]);
        assert!(is_blacklisted("preview-1.mp4", &prefix));
        assert!(!is_blacklisted("my-preview-1.mp4", &prefix));
    }
}

//! System integration: recycle bin, open/reveal, window controls.

use std::process::Command;

use crate::models::{TrashFailure, TrashResult};

#[tauri::command]
pub async fn trash_files(paths: Vec<String>) -> Result<TrashResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut removed = 0usize;
        let mut failed = Vec::new();

        for path in paths {
            match trash::delete(&path) {
                Ok(()) => removed += 1,
                Err(error) => failed.push(TrashFailure {
                    path,
                    error: error.to_string(),
                }),
            }
        }

        TrashResult { removed, failed }
    })
    .await
    .map_err(|e| format!("删除任务失败: {e}"))
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        tauri_plugin_opener::open_path(&path, None::<&str>)
            .map_err(|e| format!("无法打开路径 {}: {e}", path))
    })
    .await
    .map_err(|e| format!("打开任务失败: {e}"))?
}

#[tauri::command]
pub async fn reveal_path(path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || reveal_sync(&path))
        .await
        .map_err(|e| format!("定位任务失败: {e}"))?
}

#[tauri::command]
pub fn window_minimize(window: tauri::WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn window_toggle_maximize(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|e| e.to_string())? {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn window_close(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[cfg(windows)]
fn reveal_sync(path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    // explorer.exe parses its own command line: `/select,"C:\path\file.ext"`
    // must be passed as one raw argument (paths may contain spaces or commas).
    let argument = format!("/select,\"{path}\"");
    let mut command = Command::new("explorer.exe");
    command.raw_arg(argument);
    command.creation_flags(0x0800_0000);
    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法在资源管理器中定位 {path}: {e}"))
}

#[cfg(target_os = "macos")]
fn reveal_sync(path: &str) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法在访达中定位 {path}: {e}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal_sync(path: &str) -> Result<(), String> {
    let path_ref = std::path::Path::new(path);
    let target = if path_ref.is_dir() {
        path_ref
    } else {
        path_ref.parent().unwrap_or(path_ref)
    };
    Command::new("xdg-open")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("无法在文件管理器中定位 {path}: {e}"))
}

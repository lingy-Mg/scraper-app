//! Persistent application settings.

use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

use tauri::Manager;

use crate::models::Settings;

#[tauri::command]
pub async fn load_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    tauri::async_runtime::spawn_blocking(move || load_settings_sync(&app))
        .await
        .map_err(|e| format!("读取设置任务失败: {e}"))?
}

#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_settings_sync(&app, &settings))
        .await
        .map_err(|e| format!("保存设置任务失败: {e}"))?
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("settings.json"))
        .map_err(|e| format!("无法获取应用配置目录: {e}"))
}

fn load_settings_sync(app: &tauri::AppHandle) -> Result<Settings, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Settings::default());
    }

    let bytes = fs::read(&path).map_err(|e| format!("读取设置文件失败: {e}"))?;
    if bytes.is_empty() {
        return Ok(Settings::default());
    }

    serde_json::from_slice::<Settings>(&bytes)
        .map_err(|e| format!("设置文件解析失败 ({}): {e}", path.display()))
}

fn save_settings_sync(app: &tauri::AppHandle, settings: &Settings) -> Result<(), String> {
    let path = settings_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "设置文件路径无效".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建配置目录失败: {e}"))?;

    let json = serde_json::to_vec_pretty(settings).map_err(|e| format!("序列化设置失败: {e}"))?;
    let temp = parent.join(format!("settings.json.{}.tmp", std::process::id()));

    {
        let mut file = File::create(&temp).map_err(|e| format!("创建设置临时文件失败: {e}"))?;
        file.write_all(&json)
            .map_err(|e| format!("写入设置临时文件失败: {e}"))?;
        file.flush()
            .map_err(|e| format!("刷新设置临时文件失败: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("同步设置临时文件失败: {e}"))?;
    }

    // std::fs::rename replaces atomically on Unix, but fails on Windows when the
    // destination exists. Try the rename first, then remove + retry if needed.
    if fs::rename(&temp, &path).is_err() {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| {
                let _ = fs::remove_file(&temp);
                format!("替换旧设置文件失败: {e}")
            })?;
        }
        fs::rename(&temp, &path).map_err(|e| {
            let _ = fs::remove_file(&temp);
            format!("写入设置文件失败: {e}")
        })?;
    }

    Ok(())
}

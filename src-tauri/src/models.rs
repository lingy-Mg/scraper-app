//! Shared data transfer objects for the Tauri ⇄ frontend bridge.
//!
//! Every struct in this module is serialized with camelCase field names so it
//! matches the TypeScript interfaces in `docs/bridge-contract.md`.

use serde::{Deserialize, Serialize};

/// One video file found by `scan_folder` / `probe_file`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFile {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub duration: Option<f64>,
    /// One of `ffprobe`, `mp4`, `none`.
    pub probed_by: String,
    #[serde(default)]
    pub width: Option<u32>,
    #[serde(default)]
    pub height: Option<u32>,
    #[serde(default)]
    pub video_codec: Option<String>,
}

/// Manual cover crop rectangle in source-image pixels.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CropRect {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

/// One source → relative target pair for `organize_files`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeItem {
    pub source: String,
    pub relative_target: String,
    /// 可选：写入同名 .nfo 的 XML 内容。
    #[serde(default)]
    pub nfo: Option<String>,
    /// 可选：下载为同名 .jpg 的海报地址。
    #[serde(default)]
    pub poster_url: Option<String>,
    /// 可选：手动裁剪区域；为空时保存完整封面。
    #[serde(default)]
    pub poster_crop: Option<CropRect>,
}

/// Request body for `organize_files`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeRequest {
    pub dest: String,
    #[serde(default = "default_action")]
    pub action: String,
    #[serde(default = "default_conflict")]
    pub conflict: String,
    #[serde(default)]
    pub remove_empty_dirs: bool,
    #[serde(default)]
    pub items: Vec<OrganizeItem>,
}

fn default_action() -> String {
    "move".to_string()
}

fn default_conflict() -> String {
    "rename".to_string()
}

impl OrganizeRequest {
    pub fn action(&self) -> &str {
        if self.action.is_empty() {
            "move"
        } else {
            &self.action
        }
    }

    pub fn conflict(&self) -> &str {
        if self.conflict.is_empty() {
            "rename"
        } else {
            &self.conflict
        }
    }
}

/// Per-item result of `organize_files`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeResult {
    pub source: String,
    pub target: String,
    pub ok: bool,
    pub skipped: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// 主文件成功但 NFO/封面等附属文件失败时的说明。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashFailure {
    pub path: String,
    pub error: String,
}

/// Result of `trash_files`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashResult {
    pub removed: usize,
    pub failed: Vec<TrashFailure>,
}

/// Result of `app_info`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub platform: String,
    pub ffprobe: bool,
    pub native: bool,
}

/// AI provider settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AIConfig {
    pub enabled: bool,
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub temperature: f64,
    /// Request timeout in seconds.
    pub timeout: u64,
    pub clean_filename: bool,
    pub infer_code: bool,
    pub verify: bool,
    pub fallback: bool,
    pub auto_pick: bool,
    pub auto_pick_threshold: f64,
    pub prompt: String,
}

impl Default for AIConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: "DeepSeek".to_string(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: String::new(),
            model: "deepseek-chat".to_string(),
            temperature: 0.1,
            timeout: 20,
            clean_filename: true,
            infer_code: true,
            verify: true,
            fallback: true,
            auto_pick: true,
            auto_pick_threshold: 0.9,
            prompt: "你是影片文件名解析器。从文件名中提取番号和标题。\n只返回 JSON，不要解释：\n{\"code\": \"番号\", \"title\": \"标题\", \"confidence\": 0.0}\n\n文件名：{filename}".to_string(),
        }
    }
}

/// Persisted application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub ai: AIConfig,
    /// Opaque frontend mode snapshot, stored and returned verbatim.
    pub modes: Option<serde_json::Value>,
    pub last_folder: Option<String>,
    pub min_dur: Option<f64>,
    pub compact: Option<bool>,
    pub hide_shorts: Option<bool>,
    pub log_open: Option<bool>,
    pub log_height: Option<f64>,
    /// 文件名黑名单：扫描时跳过、列表中隐藏。
    pub blacklist: Option<Vec<String>>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            ai: AIConfig::default(),
            modes: None,
            last_folder: None,
            min_dur: None,
            compact: None,
            hide_shorts: None,
            log_open: None,
            log_height: None,
            blacklist: None,
        }
    }
}

/// A candidate returned by the metadata plugins.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub year: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub score: f64,
    #[serde(default)]
    pub overview: String,
    #[serde(default)]
    pub poster: f64,
    #[serde(default)]
    pub poster_url: Option<String>,
    #[serde(default)]
    pub maker: Option<String>,
    #[serde(default)]
    pub actors: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    #[serde(default)]
    pub detail_id: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub release_date: Option<String>,
    #[serde(default)]
    pub director: Option<String>,
    #[serde(default)]
    pub series: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AITestResult {
    pub ok: bool,
    pub latency_ms: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIIdentifyResult {
    pub code: String,
    pub title: String,
    pub confidence: f64,
    pub ms: u64,
    pub fallback: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub raw: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AIPickResult {
    pub pick: String,
    pub confidence: f64,
    pub reason: String,
    pub ms: u64,
    pub fallback: bool,
}

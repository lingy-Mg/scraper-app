//! JavDB App API 客户端（原生实现，供打包后的桌面应用使用）。
//!
//! 协议与 `docs/javdb-app-api.md`、`server/javdb.ts` 保持一致：
//! `jdsignature = "{ts}.{suffix}.{md5(ts + prefix)}"`。

use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::models::Candidate;

const PREFIX: &str = "71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa";
const SUFFIX: &str = "lpw6vgqzsp";
const USER_AGENT: &str = "Dart/3.4 (dart:io)";

const HOSTS: [&str; 4] = [
    "https://jdforrepam.com",
    "https://apidd.spthgb.com",
    "https://apidd.czssdgz.com",
    "https://javdb.com",
];

static HOST_CACHE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
static DEVICE_UUID: OnceLock<String> = OnceLock::new();

fn host_cache() -> &'static Mutex<Option<String>> {
    HOST_CACHE.get_or_init(|| Mutex::new(None))
}

fn signature(ts: i64) -> String {
    let digest = md5::compute(format!("{ts}{PREFIX}"));
    format!("{ts}.{SUFFIX}.{digest:x}")
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn device_uuid() -> String {
    DEVICE_UUID
        .get_or_init(|| {
            let seed = format!(
                "{}-{}-{:?}",
                now_secs(),
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.subsec_nanos())
            );
            let hex = format!("{:x}", md5::compute(seed));
            format!(
                "{}-{}-4{}-{}-{}",
                &hex[0..8],
                &hex[8..12],
                &hex[13..16],
                &hex[16..20],
                &hex[20..32]
            )
        })
        .clone()
}

fn public_params() -> Vec<(&'static str, String)> {
    vec![
        ("app_channel", "official".to_string()),
        ("app_version", "1.9.28".to_string()),
        ("app_version_number", "10928".to_string()),
        ("platform", "android".to_string()),
        ("system_version", "13".to_string()),
        ("device_model", "Pixel 6".to_string()),
        ("device_name", "Pixel".to_string()),
        ("device_uuid", device_uuid()),
    ]
}

fn success_truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        Some(Value::String(s)) => s == "1" || s.eq_ignore_ascii_case("true"),
        Some(Value::Null) | None => false,
        Some(_) => true,
    }
}

async fn request_once(
    client: &reqwest::Client,
    host: &str,
    path: &str,
    params: &[(String, String)],
) -> Result<Value, String> {
    let mut url =
        reqwest::Url::parse(&format!("{host}{path}")).map_err(|e| format!("无效地址: {e}"))?;
    {
        let mut query = url.query_pairs_mut();
        for (key, value) in public_params() {
            query.append_pair(key, &value);
        }
        for (key, value) in params {
            query.append_pair(key, value);
        }
    }

    let response = client
        .get(url)
        .header("user-agent", USER_AGENT)
        .header("accept-language", "zh-CN")
        .header("jdsignature", signature(now_secs()))
        .send()
        .await
        .map_err(|e| format!("网络错误: {e}"))?;

    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取响应失败: {e}"))?;

    if status.as_u16() >= 500 {
        return Err(format!("HTTP {}", status.as_u16()));
    }

    let body: Value = serde_json::from_str(&text)
        .map_err(|_| format!("响应不是 JSON（HTTP {}）", status.as_u16()))?;

    if !success_truthy(body.get("success")) {
        let action = body.get("action").and_then(Value::as_str).unwrap_or("api");
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("请求失败");
        return Err(format!("{action}: {message}"));
    }

    Ok(body
        .get("data")
        .cloned()
        .unwrap_or_else(|| Value::Object(Default::default())))
}

async fn request(
    client: &reqwest::Client,
    path: &str,
    params: &[(String, String)],
) -> Result<Value, String> {
    let cached = host_cache().lock().ok().and_then(|guard| guard.clone());
    let mut ordered: Vec<&str> = Vec::with_capacity(HOSTS.len());
    if let Some(host) = cached.as_deref() {
        if let Some(found) = HOSTS.iter().find(|item| **item == host) {
            ordered.push(*found);
        }
    }
    for host in HOSTS {
        if !ordered.contains(&host) {
            ordered.push(host);
        }
    }

    let mut failures: Vec<String> = Vec::new();
    for host in ordered {
        match request_once(client, host, path, params).await {
            Ok(data) => {
                if let Ok(mut guard) = host_cache().lock() {
                    *guard = Some(host.to_string());
                }
                return Ok(data);
            }
            Err(error) => failures.push(format!("{host}: {error}")),
        }
    }

    Err(format!("JavDB 请求失败：{}", failures.join("；")))
}

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

fn optional_text(value: Option<&Value>) -> Option<String> {
    let value = text(value);
    if value.is_empty() { None } else { Some(value) }
}

fn number_value(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(n)) => n.as_f64().filter(|v| *v > 0.0),
        Some(Value::String(s)) => s.parse::<f64>().ok().filter(|v| *v > 0.0),
        _ => None,
    }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items {
        match item {
            Value::String(s) => out.push(s.clone()),
            Value::Object(map) => {
                for key in ["name", "title", "translate_name"] {
                    if let Some(Value::String(s)) = map.get(key) {
                        if !s.is_empty() {
                            out.push(s.clone());
                            break;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    out
}

fn clean_name(filename: &str) -> String {
    let base = filename
        .rsplit_once('.')
        .map(|(name, _)| name)
        .unwrap_or(filename);
    let mut out = String::new();
    let mut depth_square = 0usize;
    let mut depth_round = 0usize;
    for ch in base.chars() {
        match ch {
            '[' => {
                depth_square += 1;
                out.push(' ');
            }
            ']' => {
                depth_square = depth_square.saturating_sub(1);
                out.push(' ');
            }
            '(' => {
                depth_round += 1;
                out.push(' ');
            }
            ')' => {
                depth_round = depth_round.saturating_sub(1);
                out.push(' ');
            }
            _ if depth_square > 0 || depth_round > 0 => {}
            '.' | '_' => out.push(' '),
            _ => out.push(ch),
        }
    }
    // 去掉 `489155.com@` 这类前缀
    let cleaned = match out.rsplit_once('@') {
        Some((_, rest)) => rest.to_string(),
        None => out,
    };
    cleaned.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 从文件名提取番号（支持 FC2-PPV）。
pub fn extract_code(filename: &str) -> String {
    let cleaned = clean_name(filename);
    let upper = cleaned.to_uppercase();
    let chars: Vec<char> = upper.chars().collect();

    // FC2 / FC2-PPV
    if let Some(pos) = upper.find("FC2") {
        let mut index = pos + 3;
        while index < chars.len() && !chars[index].is_ascii_digit() {
            index += 1;
        }
        let start = index;
        while index < chars.len() && chars[index].is_ascii_digit() {
            index += 1;
        }
        if index - start >= 5 {
            return format!("FC2-PPV-{}", chars[start..index].iter().collect::<String>());
        }
    }

    // 标准番号：字母 2..=10 + 可选分隔 + 数字 2..=7
    let mut index = 0usize;
    while index < chars.len() {
        if !chars[index].is_ascii_alphabetic() {
            index += 1;
            continue;
        }
        let letter_start = index;
        while index < chars.len() && chars[index].is_ascii_alphabetic() {
            index += 1;
        }
        let letters = index - letter_start;
        if letters < 2 || letters > 10 {
            continue;
        }
        let mut cursor = index;
        while cursor < chars.len() && matches!(chars[cursor], '-' | '_' | ' ') {
            cursor += 1;
        }
        let digit_start = cursor;
        while cursor < chars.len() && chars[cursor].is_ascii_digit() {
            cursor += 1;
        }
        let digits = cursor - digit_start;
        if digits < 2 || digits > 5 {
            continue;
        }
        if cursor < chars.len() && chars[cursor].is_alphanumeric() {
            continue;
        }
        let prefix: String = chars[letter_start..index].iter().collect();
        const CODE_DENY: &[&str] = &[
            "QQ",
            "IMG",
            "VID",
            "DSC",
            "PXL",
            "MVIMG",
            "DCIM",
            "AUDIO",
            "VIDEO",
            "SCREEN",
            "SCREENSHOT",
            "WECHAT",
        ];
        if CODE_DENY.contains(&prefix.as_str()) {
            continue;
        }
        let suffix: String = chars[digit_start..cursor].iter().collect();
        return format!("{prefix}-{suffix}");
    }

    String::new()
}

fn number_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

fn hash_index(value: &str) -> f64 {
    let mut hash: i64 = 0;
    for byte in value.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as i64);
    }
    hash.unsigned_abs() as f64
}

fn to_candidate(movie: &Value) -> Candidate {
    let id = text(movie.get("id"));
    let number = text(movie.get("number"));
    let title = {
        let value = text(movie.get("title"));
        if value.is_empty() {
            text(movie.get("origin_title"))
        } else {
            value
        }
    };
    let release_date = text(movie.get("release_date"));
    let maker = optional_text(movie.get("maker_name"))
        .or_else(|| optional_text(movie.get("publisher_name")));
    let actors = string_list(movie.get("actors"));
    let summary = text(movie.get("summary"));
    let mut overview_parts: Vec<String> = Vec::new();
    if let Some(maker) = maker.as_deref() {
        overview_parts.push(maker.to_string());
    }
    if !actors.is_empty() {
        overview_parts.push(
            actors
                .iter()
                .take(4)
                .cloned()
                .collect::<Vec<_>>()
                .join(" / "),
        );
    }
    if !summary.is_empty() {
        overview_parts.push(summary);
    }

    Candidate {
        id: format!("javdb:{id}"),
        title: if title.is_empty() {
            number.clone()
        } else {
            title
        },
        year: release_date.chars().take(4).collect(),
        code: if number.is_empty() {
            None
        } else {
            Some(number.clone())
        },
        source: "JavDB".to_string(),
        score: number_value(movie.get("score")).unwrap_or(0.0),
        overview: overview_parts.join(" · "),
        poster: hash_index(if number.is_empty() { &id } else { &number }),
        poster_url: optional_text(movie.get("cover_url"))
            .or_else(|| optional_text(movie.get("thumb_url"))),
        maker,
        actors: if actors.is_empty() {
            None
        } else {
            Some(actors.join(" / "))
        },
        duration: number_value(movie.get("duration")).map(|minutes| {
            if minutes <= 1000.0 {
                minutes * 60.0
            } else {
                minutes
            }
        }),
        detail_id: if id.is_empty() { None } else { Some(id) },
        tags: {
            let list = string_list(movie.get("tags"));
            if list.is_empty() { None } else { Some(list) }
        },
        release_date: optional_text(movie.get("release_date")),
        director: optional_text(movie.get("director_name")),
        series: optional_text(movie.get("series_name")),
    }
}

async fn search_movies(
    client: &reqwest::Client,
    keyword: &str,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let data = request(
        client,
        "/api/v2/search",
        &[
            ("q".to_string(), keyword.to_string()),
            ("page".to_string(), "1".to_string()),
            ("limit".to_string(), limit.clamp(1, 50).to_string()),
        ],
    )
    .await?;
    Ok(data
        .get("movies")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

async fn detail_movie(client: &reqwest::Client, id: &str) -> Result<Value, String> {
    let data = request(client, &format!("/api/v4/movies/{id}"), &[]).await?;
    Ok(data.get("movie").cloned().unwrap_or(data))
}

/// 文件名 → 候选。有番号时只接受精确匹配，绝不回退到搜索首项。
#[tauri::command]
pub async fn javdb_identify(
    filename: String,
    allow_title: Option<bool>,
) -> Result<Vec<Candidate>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let code = extract_code(&filename);
    let allow_title = allow_title.unwrap_or(false);
    // AV/JavDB 默认只认番号：没有番号时不用标题模糊搜索。
    if code.is_empty() && !allow_title {
        return Ok(Vec::new());
    }
    let keyword = if code.is_empty() {
        clean_name(&filename)
    } else {
        code.clone()
    };
    if keyword.trim().is_empty() {
        return Ok(Vec::new());
    }

    let movies = search_movies(&client, &keyword, if code.is_empty() { 8 } else { 20 }).await?;
    if code.is_empty() {
        return Ok(movies.iter().map(to_candidate).collect());
    }

    let want = number_key(&code);
    let mut seen = std::collections::HashSet::new();
    let exact: Vec<Value> = movies
        .into_iter()
        .filter(|movie| number_key(&text(movie.get("number"))) == want)
        .filter(|movie| seen.insert(text(movie.get("id"))))
        .collect();

    if exact.is_empty() {
        return Ok(Vec::new());
    }

    let mut candidates = Vec::new();
    for movie in exact.into_iter().take(3) {
        let id = text(movie.get("id"));
        let merged = if id.is_empty() {
            movie.clone()
        } else {
            match detail_movie(&client, &id).await {
                Ok(mut detail) => {
                    if let (Some(target), Some(source)) =
                        (detail.as_object_mut(), movie.as_object())
                    {
                        for (key, value) in source {
                            target.entry(key.clone()).or_insert_with(|| value.clone());
                        }
                    }
                    detail
                }
                Err(_) => movie.clone(),
            }
        };
        candidates.push(to_candidate(&merged));
    }

    Ok(candidates)
}

/// 影片详情 + 磁力。
#[tauri::command]
pub async fn javdb_detail(id: String) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let mut movie = detail_movie(&client, &id).await?;
    let magnets = request(&client, &format!("/api/v1/movies/{id}/magnets"), &[]).await;
    if let (Ok(data), Some(object)) = (magnets, movie.as_object_mut()) {
        if let Some(list) = data.get("magnets") {
            object.insert("magnets".to_string(), list.clone());
        }
    }
    Ok(movie)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_standard_and_fc2_codes() {
        assert_eq!(extract_code("489155.com@IDPC-001.mp4"), "IDPC-001");
        assert_eq!(extract_code("SSIS-001.mkv"), "SSIS-001");
        assert_eq!(extract_code("FC2-PPV-1234567.mp4"), "FC2-PPV-1234567");
        assert_eq!(extract_code("movie 2160p.mkv"), "");
        assert_eq!(extract_code("x264 sample.mp4"), "");
    }

    #[test]
    fn signature_has_expected_shape() {
        let value = signature(1_700_000_000);
        assert!(value.starts_with("1700000000.lpw6vgqzsp."));
        assert_eq!(value.rsplit('.').next().unwrap().len(), 32);
    }

    #[test]
    #[ignore = "hits the live JavDB App API"]
    fn live_identify_ssis_001() {
        let candidates =
            tauri::async_runtime::block_on(javdb_identify("SSIS-001.mp4".to_string(), None))
                .expect("identify should succeed");
        assert!(!candidates.is_empty(), "expected at least one candidate");
        assert_eq!(candidates[0].code.as_deref(), Some("SSIS-001"));
        assert!(candidates[0].poster_url.is_some());
    }
}

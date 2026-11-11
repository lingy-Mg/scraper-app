//! TMDB（电影 / 电视剧）元数据源。
//!
//! 与 `server/providers/tmdb.ts`、`docs/providers-library-contract.md` 保持一致。
//! v4 JWT 使用 Bearer，v3 key 使用 `api_key` 查询参数；不会打印或回显 API Key。

use std::cmp::Ordering;

use serde_json::Value;

use crate::models::Candidate;

const API_BASE: &str = "https://api.themoviedb.org/3";
const IMAGE_BASE: &str = "https://image.tmdb.org/t/p/w500";
const DEFAULT_LANG: &str = "zh-CN";
const USER_AGENT: &str = "scraper-app/0.1 (https://github.com/local/scraper-app)";
const MAX_RESULTS: usize = 8;

const VIDEO_EXTENSIONS: [&str; 20] = [
    "mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts", "m2ts", "rmvb",
    "rm", "3gp", "ogv", "srt", "ass", "ssa", "nfo",
];

const NOISE_TOKENS: &[&str] = &[
    "bluray",
    "blu-ray",
    "bdrip",
    "brrip",
    "bdremux",
    "remux",
    "web-dl",
    "webdl",
    "webrip",
    "web-rip",
    "hdtv",
    "hdrip",
    "dvdrip",
    "dvd",
    "hdcam",
    "camrip",
    "telesync",
    "uhd",
    "4k",
    "8k",
    "2160p",
    "1080p",
    "1080i",
    "720p",
    "576p",
    "480p",
    "360p",
    "x264",
    "x265",
    "h264",
    "h265",
    "hevc",
    "avc",
    "av1",
    "vp9",
    "10bit",
    "8bit",
    "hdr10+",
    "hdr10",
    "hdr",
    "dolby",
    "vision",
    "dts-hd",
    "dts",
    "truehd",
    "atmos",
    "aac",
    "ac3",
    "eac3",
    "flac",
    "proper",
    "repack",
    "rerip",
    "extended",
    "remastered",
    "uncut",
    "imax",
    "multi",
    "dual",
    "chs",
    "cht",
    "eng",
    "jpn",
    "中字",
    "中文字幕",
    "简繁",
    "简中",
    "繁中",
    "双语",
    "国语",
    "粤语",
    "日语",
    "内封",
    "内嵌",
    "外挂",
    "高清",
    "蓝光",
    "超清",
    "完整版",
    "未删减",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CleanedFilename {
    pub title: String,
    pub year: String,
}

impl CleanedFilename {
    fn full(&self) -> String {
        match (self.title.is_empty(), self.year.is_empty()) {
            (true, true) => String::new(),
            (true, false) => self.year.clone(),
            (false, true) => self.title.clone(),
            (false, false) => format!("{} {}", self.title, self.year),
        }
    }
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric()
}

fn mask(chars: &mut [char], start: usize, end: usize) {
    for ch in &mut chars[start..end] {
        *ch = ' ';
    }
}

fn strip_extension(name: &str) -> &str {
    if let Some((base, extension)) = name.rsplit_once('.') {
        if VIDEO_EXTENSIONS
            .iter()
            .any(|item| item.eq_ignore_ascii_case(extension))
        {
            return base;
        }
    }
    name
}

fn extract_last_year(name: &str) -> (usize, String) {
    let chars: Vec<(usize, char)> = name.char_indices().collect();
    let mut found: Option<(usize, String)> = None;

    for index in 0..chars.len() {
        let (byte_index, ch) = chars[index];
        if !ch.is_ascii_digit() || index + 3 >= chars.len() {
            continue;
        }
        let digits: String = chars[index..index + 4]
            .iter()
            .map(|(_, value)| *value)
            .collect();
        if !digits.chars().all(|value| value.is_ascii_digit()) {
            continue;
        }
        if let Some(previous) = chars.get(index.wrapping_sub(1)).map(|(_, value)| *value) {
            if index > 0 && (previous.is_ascii_digit() || matches!(previous, 'x' | 'X')) {
                continue;
            }
        }
        if let Some(next) = chars.get(index + 4).map(|(_, value)| *value) {
            if next.is_ascii_digit() || matches!(next, 'x' | 'X' | 'p' | 'P' | 'i' | 'I') {
                continue;
            }
        }
        if let Ok(year) = digits.parse::<u32>() {
            if (1900..=2099).contains(&year) {
                found = Some((byte_index, digits));
            }
        }
    }

    found.unwrap_or((usize::MAX, String::new()))
}

fn strip_brackets(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut square = 0usize;
    let mut round = 0usize;
    let mut cjk = 0usize;
    let mut curly = 0usize;

    for ch in name.chars() {
        match ch {
            '[' => {
                square += 1;
                out.push(' ');
            }
            ']' => {
                square = square.saturating_sub(1);
                out.push(' ');
            }
            '(' => {
                round += 1;
                out.push(' ');
            }
            ')' => {
                round = round.saturating_sub(1);
                out.push(' ');
            }
            '【' => {
                cjk += 1;
                out.push(' ');
            }
            '】' => {
                cjk = cjk.saturating_sub(1);
                out.push(' ');
            }
            '{' => {
                curly += 1;
                out.push(' ');
            }
            '}' => {
                curly = curly.saturating_sub(1);
                out.push(' ');
            }
            _ => {
                if square + round + cjk + curly == 0 {
                    out.push(ch);
                }
            }
        }
    }
    out
}

fn remove_sxxexx(chars: &mut [char]) {
    let length = chars.len();
    let lower: Vec<char> = chars
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect();
    let mut index = 0usize;

    while index < length {
        if lower[index] == 's' && (index == 0 || !is_word_char(chars[index - 1])) {
            let mut cursor = index + 1;
            let digit_start = cursor;
            while cursor < length && lower[cursor].is_ascii_digit() && cursor - digit_start < 2 {
                cursor += 1;
            }
            if cursor > digit_start {
                if cursor < length && lower[cursor] == 'e' {
                    let mut end = cursor + 1;
                    let episode_start = end;
                    while end < length && lower[end].is_ascii_digit() && end - episode_start < 3 {
                        end += 1;
                    }
                    if end > episode_start && (end == length || !is_word_char(chars[end])) {
                        mask(chars, index, end);
                        index = end;
                        continue;
                    }
                }
                if cursor == length || !is_word_char(chars[cursor]) {
                    mask(chars, index, cursor);
                    index = cursor;
                    continue;
                }
            }
        }
        index += 1;
    }
}

fn remove_ep_markers(chars: &mut [char]) {
    let length = chars.len();
    let lower: Vec<char> = chars
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect();
    let mut index = 0usize;

    while index < length {
        if lower[index] == 's'
            && index + 1 < length
            && lower[index + 1] == 'p'
            && (index == 0 || !is_word_char(chars[index - 1]))
        {
            let mut end = index + 2;
            let digit_start = end;
            while end < length && lower[end].is_ascii_digit() && end - digit_start < 3 {
                end += 1;
            }
            if end == digit_start || end == length || !is_word_char(chars[end]) {
                mask(chars, index, end);
                index = end;
                continue;
            }
        }

        if lower[index] == 'e' && (index == 0 || !is_word_char(chars[index - 1])) {
            let mut end = index + 1;
            if end < length && lower[end] == 'p' {
                end += 1;
            }
            let digit_start = end;
            while end < length && lower[end].is_ascii_digit() && end - digit_start < 3 {
                end += 1;
            }
            if end > digit_start && (end == length || !is_word_char(chars[end])) {
                mask(chars, index, end);
                index = end;
                continue;
            }
        }
        index += 1;
    }
}

fn remove_cjk_episode(chars: &mut [char]) {
    let length = chars.len();
    let mut index = 0usize;

    while index < length {
        if chars[index] == '第' {
            let mut cursor = index + 1;
            while cursor < length && chars[cursor].is_whitespace() {
                cursor += 1;
            }
            let digit_start = cursor;
            while cursor < length && chars[cursor].is_ascii_digit() && cursor - digit_start < 4 {
                cursor += 1;
            }
            if cursor > digit_start
                && cursor < length
                && matches!(chars[cursor], '集' | '话' | '話' | '期' | '季')
            {
                mask(chars, index, cursor + 1);
                index = cursor + 1;
                continue;
            }
        }
        index += 1;
    }
}

fn remove_season(chars: &mut [char]) {
    let length = chars.len();
    let lower: Vec<char> = chars
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect();
    let mut index = 0usize;

    while index + 6 <= length {
        if lower[index..index + 6] == ['s', 'e', 'a', 's', 'o', 'n']
            && (index == 0 || !is_word_char(chars[index - 1]))
        {
            let mut cursor = index + 6;
            while cursor < length && chars[cursor].is_whitespace() {
                cursor += 1;
            }
            let digit_start = cursor;
            while cursor < length && lower[cursor].is_ascii_digit() && cursor - digit_start < 2 {
                cursor += 1;
            }
            if cursor > digit_start && (cursor == length || !is_word_char(chars[cursor])) {
                mask(chars, index, cursor);
                index = cursor;
                continue;
            }
        }
        index += 1;
    }
}

fn trim_token(token: &str) -> &str {
    token.trim_matches(|ch: char| {
        ch.is_whitespace()
            || matches!(
                ch,
                '-' | '–'
                    | '—'
                    | '_'
                    | '.'
                    | ':'
                    | ','
                    | ';'
                    | '/'
                    | '|'
                    | '('
                    | ')'
                    | '['
                    | ']'
                    | '{'
                    | '}'
                    | '【'
                    | '】'
                    | '"'
                    | '\''
            )
    })
}

fn is_noise_token(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    if NOISE_TOKENS.contains(&lower.as_str()) {
        return true;
    }
    if (4..=5).contains(&lower.len()) {
        let bytes = lower.as_bytes();
        if matches!(bytes[bytes.len() - 1], b'p' | b'i')
            && bytes[..bytes.len() - 1]
                .iter()
                .all(|value| value.is_ascii_digit())
        {
            return true;
        }
    }
    if let Some(rest) = lower.strip_prefix('x').or_else(|| lower.strip_prefix('h')) {
        if rest == "264" || rest == "265" {
            return true;
        }
    }
    lower == "10bit" || lower == "8bit"
}

fn is_dash_token(token: &str) -> bool {
    !token.is_empty() && token.chars().all(|ch| matches!(ch, '-' | '–' | '—' | '_'))
}

/// 文件名清洗：去扩展名、`[...]`/`(...)`、集数、发布组、分辨率/编码/音轨词，并提取 4 位年份。
pub(crate) fn clean_filename(filename: &str) -> CleanedFilename {
    let mut name = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(filename)
        .trim()
        .to_string();
    name = strip_extension(&name).to_string();
    if let Some((_, rest)) = name.rsplit_once('@') {
        name = rest.to_string();
    }

    let (year_index, year) = extract_last_year(&name);
    if year_index != usize::MAX {
        name.replace_range(year_index..year_index + 4, " ");
    }

    let mut chars: Vec<char> = strip_brackets(&name).chars().collect();
    remove_sxxexx(&mut chars);
    remove_ep_markers(&mut chars);
    remove_cjk_episode(&mut chars);
    remove_season(&mut chars);

    let masked: String = chars.into_iter().collect();
    let masked = masked.replace('.', " ").replace('_', " ");
    let raw_tokens: Vec<&str> = masked.split_whitespace().collect();
    let mut tokens: Vec<String> = Vec::new();
    let mut index = 0usize;

    while index < raw_tokens.len() {
        let raw = raw_tokens[index].trim();

        if is_dash_token(raw) {
            if let Some(next) = raw_tokens.get(index + 1).map(|value| trim_token(value)) {
                if !next.is_empty()
                    && next.len() <= 3
                    && next.chars().all(|value| value.is_ascii_digit())
                {
                    index += 2;
                    continue;
                }
            }
            index += 1;
            continue;
        }

        if let Some(rest) = raw.strip_prefix(|ch: char| matches!(ch, '-' | '–' | '—')) {
            if !rest.is_empty()
                && rest.len() <= 3
                && rest.chars().all(|value| value.is_ascii_digit())
            {
                index += 1;
                continue;
            }
        }

        let cleaned = trim_token(raw);
        if cleaned.is_empty() || is_noise_token(cleaned) {
            index += 1;
            continue;
        }
        tokens.push(cleaned.to_string());
        index += 1;
    }

    let title = tokens.join(" ");
    let title = title
        .trim_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, '-' | '–' | '—' | ':' | ',' | ';' | '/' | '|' | '.')
        })
        .to_string();

    CleanedFilename { title, year }
}

fn is_v4_token(key: &str) -> bool {
    key.starts_with("eyJ")
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .user_agent(USER_AGENT)
        .build()
        .map_err(|error| format!("创建 HTTP 客户端失败：{error}"))
}

async fn send(request: reqwest::RequestBuilder) -> Result<Value, String> {
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            "TMDB 请求超时".to_string()
        } else {
            "TMDB 网络错误，请检查网络连接".to_string()
        }
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::UNAUTHORIZED {
        return Err("TMDB API Key 无效".to_string());
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("TMDB 条目不存在".to_string());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("TMDB 请求过于频繁".to_string());
    }
    if !status.is_success() {
        return Err(format!("TMDB 请求失败（HTTP {}）", status.as_u16()));
    }

    response
        .json::<Value>()
        .await
        .map_err(|_| "TMDB 响应格式错误".to_string())
}

async fn search(
    client: &reqwest::Client,
    media_type: &str,
    query: &str,
    api_key: &str,
    lang: &str,
) -> Result<Vec<Value>, String> {
    let mut url = reqwest::Url::parse(&format!("{API_BASE}/search/{media_type}"))
        .map_err(|error| format!("无效地址：{error}"))?;
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("query", query);
        params.append_pair("language", lang);
        params.append_pair("include_adult", "false");
        params.append_pair("page", "1");
        if !is_v4_token(api_key) {
            params.append_pair("api_key", api_key);
        }
    }

    let mut request = client.get(url).header("accept", "application/json");
    if is_v4_token(api_key) {
        request = request.bearer_auth(api_key);
    }

    let data = send(request).await?;
    Ok(data
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn optional_text(value: Option<&Value>) -> Option<String> {
    let value = text(value);
    if value.is_empty() { None } else { Some(value) }
}

fn number_value(value: Option<&Value>) -> Option<f64> {
    match value {
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => value.trim().parse::<f64>().ok(),
        _ => None,
    }
}

fn positive_number(value: Option<&Value>) -> Option<f64> {
    number_value(value).filter(|value| *value > 0.0)
}

fn names_from(value: Option<&Value>, key: &str) -> Vec<String> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in items {
        let name = match item {
            Value::String(value) => value.trim().to_string(),
            Value::Object(map) => text(map.get(key)),
            _ => String::new(),
        };
        if !name.is_empty() {
            out.push(name);
        }
    }
    out
}

fn hash_index(value: &str) -> u64 {
    let mut hash: i64 = 0;
    for byte in value.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as i64);
    }
    hash.unsigned_abs()
}

fn image_url(value: Option<&Value>) -> Option<String> {
    let path = optional_text(value)?;
    if path.starts_with("http://") || path.starts_with("https://") {
        Some(path)
    } else if path.starts_with('/') {
        Some(format!("{IMAGE_BASE}{path}"))
    } else {
        Some(format!("{IMAGE_BASE}/{path}"))
    }
}

fn year_of(data: &Value) -> String {
    let release = text(data.get("release_date"));
    let first_air = text(data.get("first_air_date"));
    let value = if release.is_empty() {
        first_air
    } else {
        release
    };
    value.chars().take(4).collect()
}

fn duration_seconds(data: &Value, media_type: &str) -> Option<f64> {
    let minutes = if media_type == "movie" {
        positive_number(data.get("runtime"))
    } else {
        data.get("episode_run_time")
            .and_then(Value::as_array)
            .and_then(|items| items.first())
            .and_then(|value| positive_number(Some(value)))
    };
    minutes.map(|value| (value * 60.0).round())
}

fn to_candidate(data: &Value, media_type: &str) -> Option<Candidate> {
    let id = text(data.get("id"));
    if id.is_empty() {
        return None;
    }

    let title = [
        text(data.get("title")),
        text(data.get("name")),
        text(data.get("original_title")),
        text(data.get("original_name")),
    ]
    .into_iter()
    .find(|value| !value.is_empty())
    .unwrap_or_else(|| "未命名".to_string());

    let actors = names_from(
        data.get("credits").and_then(|credits| credits.get("cast")),
        "name",
    );
    let makers = names_from(data.get("production_companies"), "name");
    let tags = names_from(data.get("genres"), "name");

    Some(Candidate {
        id: format!("tmdb:{media_type}:{id}"),
        title,
        year: year_of(data),
        code: None,
        source: "TMDB".to_string(),
        score: number_value(data.get("vote_average")).unwrap_or(0.0),
        overview: text(data.get("overview")),
        poster: hash_index(&id) as f64,
        poster_url: image_url(data.get("poster_path")),
        maker: makers.into_iter().next(),
        actors: if actors.is_empty() {
            None
        } else {
            Some(actors.into_iter().take(6).collect::<Vec<_>>().join(" / "))
        },
        duration: duration_seconds(data, media_type),
        detail_id: Some(format!("{media_type}:{id}")),
        tags: if tags.is_empty() { None } else { Some(tags) },
        release_date: None,
        director: None,
        series: None,
    })
}

fn normalize_media_type(media_type: &str) -> Result<&'static str, String> {
    match media_type.trim().to_ascii_lowercase().as_str() {
        "movie" => Ok("movie"),
        "tv" => Ok("tv"),
        other => Err(format!("不支持的媒体类型：{other}")),
    }
}

fn strip_media_prefix(id: &str, media_type: &str) -> String {
    let prefix = format!("{media_type}:");
    id.trim()
        .strip_prefix(&prefix)
        .unwrap_or(id.trim())
        .to_string()
}

fn language_or_default(lang: Option<String>) -> String {
    lang.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| DEFAULT_LANG.to_string())
}

/// 文件名 → TMDB 候选。返回最多 8 条，年份匹配优先、popularity 降序。
#[tauri::command]
pub async fn tmdb_identify(
    filename: String,
    media_type: String,
    api_key: String,
    lang: Option<String>,
) -> Result<Vec<Candidate>, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("未配置 TMDB API Key".to_string());
    }
    let media = normalize_media_type(&media_type)?;
    let language = language_or_default(lang);
    let cleaned = clean_filename(&filename);

    if cleaned.title.is_empty() && cleaned.year.is_empty() {
        return Ok(Vec::new());
    }

    let mut queries = Vec::new();
    if !cleaned.title.is_empty() {
        queries.push(cleaned.title.clone());
    }
    let full = cleaned.full();
    if !full.is_empty() && full != cleaned.title {
        queries.push(full);
    }

    let client = build_client()?;
    let mut results = Vec::new();
    for query in queries {
        results = search(&client, media, &query, key, &language).await?;
        if !results.is_empty() {
            break;
        }
    }

    results.sort_by(|left, right| {
        let left_match = !cleaned.year.is_empty() && year_of(left) == cleaned.year;
        let right_match = !cleaned.year.is_empty() && year_of(right) == cleaned.year;
        right_match.cmp(&left_match).then_with(|| {
            let left_popularity = number_value(left.get("popularity")).unwrap_or(0.0);
            let right_popularity = number_value(right.get("popularity")).unwrap_or(0.0);
            right_popularity
                .partial_cmp(&left_popularity)
                .unwrap_or(Ordering::Equal)
        })
    });

    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in &results {
        let id = text(item.get("id"));
        if id.is_empty() || !seen.insert(id) {
            continue;
        }
        if let Some(candidate) = to_candidate(item, media) {
            candidates.push(candidate);
        }
        if candidates.len() >= MAX_RESULTS {
            break;
        }
    }

    Ok(candidates)
}

/// 详情：追加 credits，并把时长从分钟换算为秒；返回值额外包含 `raw`。
#[tauri::command]
pub async fn tmdb_detail(
    id: String,
    media_type: String,
    api_key: String,
    lang: Option<String>,
) -> Result<Value, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("未配置 TMDB API Key".to_string());
    }
    let media = normalize_media_type(&media_type)?;
    let language = language_or_default(lang);
    let detail_id = strip_media_prefix(&id, media);
    if detail_id.is_empty() {
        return Err("TMDB 条目 ID 不能为空".to_string());
    }

    let mut url = reqwest::Url::parse(&format!("{API_BASE}/{media}"))
        .map_err(|error| format!("无效地址：{error}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "无效地址".to_string())?;
        segments.push(&detail_id);
    }
    {
        let mut params = url.query_pairs_mut();
        params.append_pair("language", &language);
        params.append_pair("append_to_response", "credits");
        if !is_v4_token(key) {
            params.append_pair("api_key", key);
        }
    }

    let client = build_client()?;
    let mut request = client.get(url).header("accept", "application/json");
    if is_v4_token(key) {
        request = request.bearer_auth(key);
    }

    let data = send(request).await?;
    let candidate = to_candidate(&data, media).ok_or_else(|| "TMDB 条目不存在".to_string())?;

    let mut value =
        serde_json::to_value(&candidate).map_err(|error| format!("序列化详情失败：{error}"))?;
    if let Some(object) = value.as_object_mut() {
        object.insert("raw".to_string(), data);
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn tmdb_clean_group_and_episode_release() {
        let cleaned = clean_filename("[Group] Title - 01 [1080p][x264].mkv");
        assert_eq!(cleaned.title, "Title");
        assert_eq!(cleaned.year, "");
    }

    #[test]
    fn tmdb_clean_dotted_movie_and_year() {
        let cleaned = clean_filename("Movie.Title.2020.2160p.BluRay.x265.mkv");
        assert_eq!(cleaned.title, "Movie Title");
        assert_eq!(cleaned.year, "2020");
        assert_eq!(cleaned.full(), "Movie Title 2020");
    }

    #[test]
    fn tmdb_clean_cjk_series_episode() {
        let cleaned = clean_filename("剧名.S01E03.1080p.WEB-DL.mkv");
        assert_eq!(cleaned.title, "剧名");
        assert_eq!(cleaned.year, "");
    }

    #[test]
    fn tmdb_clean_at_prefix_keeps_code() {
        let cleaned = clean_filename("489155.com@ABC-123.mp4");
        assert_eq!(cleaned.title, "ABC-123");
        assert_eq!(cleaned.year, "");
    }

    #[test]
    fn tmdb_clean_keeps_title_year_before_release_year() {
        let cleaned = clean_filename("Blade.Runner.2049.2017.1080p.BluRay.x265.mkv");
        assert_eq!(cleaned.title, "Blade Runner 2049");
        assert_eq!(cleaned.year, "2017");
    }

    #[test]
    fn tmdb_maps_detail_fields_and_units() {
        let data = json!({
            "id": 2,
            "title": "Movie Title",
            "release_date": "2020-05-01",
            "vote_average": 8.1,
            "overview": "Overview",
            "poster_path": "/poster.jpg",
            "runtime": 120,
            "production_companies": [{ "name": "Studio A" }],
            "credits": {
                "cast": [
                    { "name": "A" }, { "name": "B" }, { "name": "C" },
                    { "name": "D" }, { "name": "E" }, { "name": "F" }, { "name": "G" }
                ]
            },
            "genres": [{ "name": "Drama" }, { "name": "Sci-Fi" }]
        });

        let candidate = to_candidate(&data, "movie").expect("candidate");
        assert_eq!(candidate.id, "tmdb:movie:2");
        assert_eq!(candidate.detail_id.as_deref(), Some("movie:2"));
        assert_eq!(candidate.duration, Some(7200.0));
        assert_eq!(candidate.maker.as_deref(), Some("Studio A"));
        assert_eq!(candidate.actors.as_deref(), Some("A / B / C / D / E / F"));
        assert_eq!(
            candidate.tags,
            Some(vec!["Drama".to_string(), "Sci-Fi".to_string()])
        );
        assert_eq!(
            candidate.poster_url.as_deref(),
            Some("https://image.tmdb.org/t/p/w500/poster.jpg")
        );
    }
}

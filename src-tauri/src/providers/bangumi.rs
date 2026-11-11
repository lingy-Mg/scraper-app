//! Bangumi（动漫）元数据源。
//!
//! 与 `server/providers/bangumi.ts`、`docs/providers-library-contract.md` 保持一致。
//! 所有请求都带约定的 User-Agent；不会打印任何凭据。

use std::cmp::Ordering;

use serde_json::{Value, json};

use crate::models::Candidate;

const API_BASE: &str = "https://api.bgm.tv";
const USER_AGENT: &str = "scraper-app/0.1 (https://github.com/local/scraper-app)";
const MAX_RESULTS: usize = 10;

const VIDEO_EXTENSIONS: [&str; 20] = [
    "mkv", "mp4", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "ts", "m2ts", "rmvb",
    "rm", "3gp", "ogv", "srt", "ass", "ssa", "nfo",
];

const NOISE_TOKENS: &[&str] = &[
    "sub",
    "fansub",
    "raw",
    "rip",
    "bd",
    "bdrip",
    "bdremux",
    "remux",
    "web",
    "web-dl",
    "webdl",
    "webrip",
    "web-rip",
    "hdtv",
    "dvdrip",
    "uhd",
    "4k",
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
    "hdr",
    "hdr10",
    "hdr10+",
    "dolby",
    "vision",
    "dts",
    "dts-hd",
    "truehd",
    "atmos",
    "aac",
    "flac",
    "opus",
    "ac3",
    "eac3",
    "ma10p",
    "chs",
    "cht",
    "sc",
    "tc",
    "gb",
    "big5",
    "jpn",
    "japanese",
    "eng",
    "v2",
    "v3",
    "repack",
    "fin",
    "end",
    "baha",
    "b-global",
    "bglobal",
    "bilibili",
    "netflix",
    "amzn",
    "cr",
    "nf",
    "字幕",
    "字幕组",
    "简繁",
    "简体",
    "繁体",
    "简中",
    "繁中",
    "双语",
    "日语",
    "国语",
    "粤语",
    "内嵌",
    "内封",
    "外挂",
    "无修",
    "合集",
    "全集",
    "高清",
    "蓝光",
    "超清",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CleanedFilename {
    pub title: String,
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

fn looks_like_group(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    [
        "字幕组",
        "字幕社",
        "fansub",
        "sub",
        "raw",
        "rip",
        "baha",
        "b-global",
        "bglobal",
        "bilibili",
        "netflix",
        "amzn",
        "压制",
        "encode",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn bracket_fallback(filename: &str) -> String {
    let mut best = String::new();
    let mut depth = 0usize;
    let mut current = String::new();

    for ch in filename.chars() {
        match ch {
            '[' => {
                depth += 1;
                current.clear();
            }
            ']' => {
                if depth > 0 {
                    depth -= 1;
                    let value = current.trim();
                    let is_episode = !value.is_empty()
                        && value.len() <= 4
                        && value.chars().all(|item| item.is_ascii_digit());
                    let is_season = value.len() >= 2
                        && (value.starts_with('s') || value.starts_with('S'))
                        && value[1..].chars().all(|item| item.is_ascii_digit());
                    if !value.is_empty()
                        && !is_episode
                        && !is_season
                        && !is_noise_token(value)
                        && !looks_like_group(value)
                        && value.len() > best.len()
                    {
                        best = value.to_string();
                    }
                    current.clear();
                }
            }
            _ => {
                if depth > 0 {
                    current.push(ch);
                }
            }
        }
    }
    best
}

/// 文件名清洗：去扩展名、组名、分辨率、`SxxExx`、`第xx话`、`- 01` 等集数，保留标题主体。
pub(crate) fn clean_filename(filename: &str) -> CleanedFilename {
    let mut name = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(filename)
        .trim()
        .to_string();
    let basename = strip_extension(&name).to_string();
    name = basename.clone();

    if let Some((_, rest)) = name.rsplit_once('@') {
        name = rest.to_string();
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

    // 结尾的裸集数（`Title 01`）。
    while tokens.last().is_some_and(|value| {
        !value.is_empty()
            && value.len() <= 3
            && value.chars().all(|item| item.is_ascii_digit())
            && value.as_str() != "86"
    }) {
        tokens.pop();
    }

    let title = tokens.join(" ");
    let title = title
        .trim_matches(|ch: char| {
            ch.is_whitespace() || matches!(ch, '-' | '–' | '—' | ':' | ',' | ';' | '/' | '|' | '.')
        })
        .to_string();

    CleanedFilename {
        title: if title.is_empty() {
            bracket_fallback(&basename)
        } else {
            title
        },
    }
}

fn text(value: Option<&Value>) -> String {
    match value {
        Some(Value::String(value)) => value.trim().to_string(),
        Some(Value::Number(value)) => value.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        _ => String::new(),
    }
}

fn number_value(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(value)) => value.as_f64().unwrap_or(0.0),
        Some(Value::String(value)) => value.trim().parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

fn hash_index(value: &str) -> u64 {
    let mut hash: i64 = 0;
    for byte in value.bytes() {
        hash = hash.wrapping_mul(31).wrapping_add(byte as i64);
    }
    hash.unsigned_abs()
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

fn poster_url_of(data: &Value) -> Option<String> {
    let images = data.get("images")?;
    ["large", "common", "medium"].iter().find_map(|key| {
        let value = text(images.get(*key));
        if value.is_empty() { None } else { Some(value) }
    })
}

fn to_candidate(data: &Value) -> Option<Candidate> {
    let id = text(data.get("id"));
    let title = {
        let name_cn = text(data.get("name_cn"));
        if name_cn.is_empty() {
            text(data.get("name"))
        } else {
            name_cn
        }
    };
    if id.is_empty() || title.is_empty() {
        return None;
    }

    let tags = names_from(data.get("tags"), "name");
    Some(Candidate {
        id: format!("bangumi:{id}"),
        title,
        year: text(data.get("date")).chars().take(4).collect(),
        code: None,
        source: "Bangumi".to_string(),
        score: number_value(data.get("rating").and_then(|rating| rating.get("score"))),
        overview: text(data.get("summary")),
        poster: hash_index(&id) as f64,
        poster_url: poster_url_of(data),
        maker: None,
        actors: None,
        duration: None,
        detail_id: Some(id),
        tags: if tags.is_empty() {
            None
        } else {
            Some(tags.into_iter().take(8).collect())
        },
        release_date: None,
        director: None,
        series: None,
    })
}

fn normalize_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn match_rank(title: &str, keyword: &str) -> u8 {
    let title = normalize_key(title);
    let keyword = normalize_key(keyword);
    if title.is_empty() || keyword.is_empty() {
        return 0;
    }
    if title == keyword {
        3
    } else if title.starts_with(&keyword) || keyword.starts_with(&title) {
        2
    } else if title.contains(&keyword) || keyword.contains(&title) {
        1
    } else {
        0
    }
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
            "Bangumi 请求超时".to_string()
        } else {
            "Bangumi 网络错误，请检查网络连接".to_string()
        }
    })?;

    let status = response.status();
    if status == reqwest::StatusCode::BAD_REQUEST {
        return Err("Bangumi 请求参数无效".to_string());
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err("Bangumi Token 无效或权限不足".to_string());
    }
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("Bangumi 条目不存在".to_string());
    }
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        return Err("Bangumi 请求过于频繁".to_string());
    }
    if !status.is_success() {
        return Err(format!("Bangumi 请求失败（HTTP {}）", status.as_u16()));
    }

    response
        .json::<Value>()
        .await
        .map_err(|_| "Bangumi 响应格式错误".to_string())
}

/// 文件名 → Bangumi 候选。POST 搜索限定 type=2（动画），按匹配度、评分排序。
#[tauri::command]
pub async fn bangumi_identify(filename: String) -> Result<Vec<Candidate>, String> {
    let keyword = clean_filename(&filename).title;
    if keyword.is_empty() {
        return Err("无法从文件名识别出番剧标题".to_string());
    }

    let url = reqwest::Url::parse(&format!("{API_BASE}/v0/search/subjects?limit=10"))
        .map_err(|error| format!("无效地址：{error}"))?;
    let client = build_client()?;
    let request = client
        .post(url)
        .header("accept", "application/json")
        .header("content-type", "application/json")
        .header("user-agent", USER_AGENT)
        .json(&json!({
            "keyword": keyword,
            "filter": { "type": [2] }
        }));

    let data = send(request).await?;
    let items = data
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in &items {
        if let Some(candidate) = to_candidate(item) {
            if seen.insert(candidate.id.clone()) {
                candidates.push(candidate);
            }
        }
    }

    if candidates.is_empty() {
        return Err("未找到匹配的 Bangumi 条目".to_string());
    }

    candidates.sort_by(|left, right| {
        let left_rank = match_rank(&left.title, &keyword);
        let right_rank = match_rank(&right.title, &keyword);
        right_rank.cmp(&left_rank).then_with(|| {
            right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(Ordering::Equal)
        })
    });
    candidates.truncate(MAX_RESULTS);
    Ok(candidates)
}

/// 详情：GET /v0/subjects/{id}；返回值额外包含 `raw`。
#[tauri::command]
pub async fn bangumi_detail(id: String) -> Result<Value, String> {
    let subject_id = id
        .trim()
        .strip_prefix("bangumi:")
        .unwrap_or(id.trim())
        .to_string();
    if subject_id.is_empty() {
        return Err("Bangumi 条目 ID 不能为空".to_string());
    }

    let mut url = reqwest::Url::parse(&format!("{API_BASE}/v0/subjects"))
        .map_err(|error| format!("无效地址：{error}"))?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "无效地址".to_string())?;
        segments.push(&subject_id);
    }

    let client = build_client()?;
    let request = client
        .get(url)
        .header("accept", "application/json")
        .header("user-agent", USER_AGENT);
    let data = send(request).await?;
    let candidate = to_candidate(&data).ok_or_else(|| "Bangumi 条目不存在".to_string())?;

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
    fn bangumi_clean_group_and_episode_release() {
        let cleaned = clean_filename("[Group] Title - 01 [1080p][x264].mkv");
        assert_eq!(cleaned.title, "Title");
    }

    #[test]
    fn bangumi_clean_subtitle_episode_suffix() {
        let cleaned = clean_filename("葬送的芙莉莲 S01E01 1080p.mkv");
        assert_eq!(cleaned.title, "葬送的芙莉莲");
    }

    #[test]
    fn bangumi_clean_chinese_episode_marker() {
        let cleaned = clean_filename("葬送的芙莉莲 第01话 1080p.mkv");
        assert_eq!(cleaned.title, "葬送的芙莉莲");
    }

    #[test]
    fn bangumi_clean_bracket_title_fallback() {
        let cleaned = clean_filename("[VCB-Studio] Sousou no Frieren [01][1080p][x265].mkv");
        assert_eq!(cleaned.title, "Sousou no Frieren");
    }

    #[test]
    fn bangumi_clean_at_prefix_keeps_code() {
        let cleaned = clean_filename("489155.com@ABC-123.mp4");
        assert_eq!(cleaned.title, "ABC-123");
    }

    #[test]
    fn bangumi_maps_subject_fields() {
        let data = json!({
            "id": 1,
            "name": "葬送のフリーレン",
            "name_cn": "葬送的芙莉莲",
            "date": "2023-09-29",
            "summary": "Summary",
            "rating": { "score": 8.5 },
            "images": { "large": "", "common": "https://img/c.jpg", "medium": "https://img/m.jpg" },
            "tags": [
                { "name": "奇幻" }, { "name": "治愈" }, { "name": "公路片" },
                { "name": "MADHouse" }, { "name": "漫画改" }, { "name": "2023年10月" },
                { "name": "旅行" }, { "name": "寿命论" }, { "name": "第九个" }
            ]
        });

        let candidate = to_candidate(&data).expect("candidate");
        assert_eq!(candidate.id, "bangumi:1");
        assert_eq!(candidate.title, "葬送的芙莉莲");
        assert_eq!(candidate.year, "2023");
        assert_eq!(candidate.score, 8.5);
        assert_eq!(candidate.detail_id.as_deref(), Some("1"));
        assert_eq!(candidate.poster_url.as_deref(), Some("https://img/c.jpg"));
        assert_eq!(candidate.tags.as_ref().map(Vec::len), Some(8));
        assert!(candidate.duration.is_none());
        assert!(candidate.maker.is_none());
        assert!(candidate.actors.is_none());
    }
}

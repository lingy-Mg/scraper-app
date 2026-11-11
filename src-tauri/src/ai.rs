//! OpenAI-compatible AI helpers with a local regex fallback.

use std::fs;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{Value, json};

use crate::models::{AIConfig, AIIdentifyResult, AIPickResult, AITestResult, Candidate};

#[tauri::command]
pub async fn ai_test(config: AIConfig) -> Result<AITestResult, String> {
    let started = Instant::now();
    let result = generate(&config, "只回复 OK", 1).await;
    let latency_ms = started.elapsed().as_millis() as u64;

    Ok(match result {
        Ok((content, _)) => AITestResult {
            ok: true,
            latency_ms,
            message: if content.trim().is_empty() {
                "连接成功".to_string()
            } else {
                format!("连接成功: {}", truncate(content.trim(), 120))
            },
        },
        Err(error) => AITestResult {
            ok: false,
            latency_ms,
            message: truncate(&error, 300),
        },
    })
}

#[tauri::command]
pub async fn ai_identify(config: AIConfig, filename: String) -> Result<AIIdentifyResult, String> {
    let started = Instant::now();
    let cleaned = if config.clean_filename {
        clean_filename(&filename)
    } else {
        filename.clone()
    };

    if !config.enabled {
        return if config.fallback {
            Ok(local_identify(&cleaned, &filename, started, None))
        } else {
            Err("AI 已禁用".to_string())
        };
    }

    let prompt = config.prompt.replace("{filename}", &cleaned);
    match generate(&config, &prompt, 512).await {
        Ok((mut content, _)) => {
            let mut parsed = parse_model_json(&content);
            if parsed.is_none() && is_opencode(&config) {
                let retry_prompt =
                    format!("{prompt}\n\n再次强调：只输出 JSON 对象本身，不要输出任何其他字符。");
                if let Ok((retry, _)) = generate(&config, &retry_prompt, 512).await {
                    content = retry;
                    parsed = parse_model_json(&content);
                }
            }

            if parsed.is_none() && is_opencode(&config) {
                let single = content
                    .trim()
                    .trim_matches(|c: char| c == '"' || c == '\'' || c == '`' || c.is_whitespace());
                let code = extract_code(single);
                if !code.is_empty() && !single.contains('\n') {
                    return Ok(AIIdentifyResult {
                        code,
                        title: single.to_string(),
                        confidence: 0.6,
                        ms: started.elapsed().as_millis() as u64,
                        fallback: false,
                        raw: Some(content),
                    });
                }
            }

            if let Some(parsed) = parsed {
                let code = parsed
                    .get("code")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                let title = parsed
                    .get("title")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| cleaned.clone());
                let confidence = parsed
                    .get("confidence")
                    .and_then(value_as_f64)
                    .unwrap_or(0.0)
                    .clamp(0.0, 1.0);

                return Ok(AIIdentifyResult {
                    code,
                    title,
                    confidence,
                    ms: started.elapsed().as_millis() as u64,
                    fallback: false,
                    raw: Some(content),
                });
            }

            if config.fallback {
                Ok(local_identify(&cleaned, &filename, started, Some(content)))
            } else {
                Err("模型输出不是有效 JSON".to_string())
            }
        }
        Err(error) => {
            if config.fallback {
                Ok(local_identify(&cleaned, &filename, started, None))
            } else {
                Err(error)
            }
        }
    }
}

#[tauri::command]
pub async fn ai_pick(
    config: AIConfig,
    filename: String,
    candidates: Vec<Candidate>,
) -> Result<AIPickResult, String> {
    let Some(first) = candidates.first() else {
        return Err("没有候选".to_string());
    };
    let fallback_pick = first.id.clone();
    let started = Instant::now();

    let build_fallback = |ms: u64| AIPickResult {
        pick: fallback_pick.clone(),
        confidence: 0.0,
        reason: "AI 不可用，默认选择第一条".to_string(),
        ms,
        fallback: true,
    };

    if !config.enabled {
        return if config.fallback {
            Ok(build_fallback(started.elapsed().as_millis() as u64))
        } else {
            Err("AI 已禁用".to_string())
        };
    }

    let cleaned = if config.clean_filename {
        clean_filename(&filename)
    } else {
        filename.clone()
    };
    let candidates_json =
        serde_json::to_string_pretty(&candidates).unwrap_or_else(|_| "[]".to_string());
    let prompt = format!(
        "你是影片候选选择器。请根据原始文件名与候选列表，选择最匹配的候选项。\n\
         只返回 JSON，不要解释：\n\
         {{\"pick\":\"<候选 id>\",\"confidence\":0.0,\"reason\":\"...\"}}\n\n\
         原始文件名：{cleaned}\n\
         候选列表：\n{candidates_json}"
    );

    match generate(&config, &prompt, 512).await {
        Ok((mut content, _)) => {
            let mut parsed = parse_model_json(&content);
            if parsed.is_none() && is_opencode(&config) {
                let retry_prompt =
                    format!("{prompt}\n\n再次强调：只输出 JSON 对象本身，不要输出任何其他字符。");
                if let Ok((retry, _)) = generate(&config, &retry_prompt, 512).await {
                    content = retry;
                    parsed = parse_model_json(&content);
                }
            }

            if let Some(parsed) = parsed {
                let pick = parsed
                    .get("pick")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if !pick.is_empty() {
                    let confidence = parsed
                        .get("confidence")
                        .and_then(value_as_f64)
                        .unwrap_or(0.0)
                        .clamp(0.0, 1.0);
                    let reason = parsed
                        .get("reason")
                        .and_then(|v| v.as_str())
                        .unwrap_or_default()
                        .trim()
                        .to_string();
                    return Ok(AIPickResult {
                        pick,
                        confidence,
                        reason,
                        ms: started.elapsed().as_millis() as u64,
                        fallback: false,
                    });
                }
            }

            if config.fallback {
                Ok(build_fallback(started.elapsed().as_millis() as u64))
            } else {
                Err("模型输出不是有效 JSON".to_string())
            }
        }
        Err(error) => {
            if config.fallback {
                Ok(build_fallback(started.elapsed().as_millis() as u64))
            } else {
                Err(error)
            }
        }
    }
}

async fn chat_completion(
    config: &AIConfig,
    prompt: &str,
    max_tokens: u32,
) -> Result<(String, u64), String> {
    let started = Instant::now();
    let timeout = config.timeout.max(1);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {e}"))?;

    let url = format!("{}/chat/completions", config.base_url.trim_end_matches('/'));
    let body = json!({
        "model": config.model,
        "messages": [{ "role": "user", "content": prompt }],
        "temperature": config.temperature,
        "max_tokens": max_tokens,
        "stream": false
    });

    let mut request = client.post(&url).json(&body);

    if is_opencode_api(config) {
        request = request
            .header("x-opencode-session", opencode_api_session())
            .header("user-agent", "scraper-app/0.1");
    }

    // Ollama with no API key: do not send an Authorization header.
    let is_ollama_without_key =
        config.base_url.contains("11434") && config.api_key.trim().is_empty();
    if !is_ollama_without_key {
        request = request.bearer_auth(&config.api_key);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("AI 请求失败: {e}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|e| format!("读取 AI 响应失败: {e}"))?;

    if !status.is_success() {
        return Err(format!(
            "AI 接口返回 HTTP {}: {}",
            status.as_u16(),
            truncate(text.trim(), 300)
        ));
    }

    let value: Value = serde_json::from_str(&text).map_err(|e| format!("AI 响应不是 JSON: {e}"))?;
    let content = extract_message_content(&value)
        .ok_or_else(|| "AI 响应缺少 choices[0].message.content".to_string())?;

    Ok((content, started.elapsed().as_millis() as u64))
}

fn is_opencode(config: &AIConfig) -> bool {
    config.provider.trim().eq_ignore_ascii_case("OpenCode CLI")
}

fn is_opencode_api(config: &AIConfig) -> bool {
    config.provider.trim().eq_ignore_ascii_case("OpenCode API")
}

fn opencode_api_session() -> &'static str {
    static SESSION: OnceLock<String> = OnceLock::new();
    SESSION.get_or_init(|| {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let seed = format!("scraper-app-{}-{nanos}", std::process::id());
        format!("scraper-app-{:x}", md5::compute(seed))
    })
}

const OPENCODE_AGENT: &str = r#"---
description: Return only the requested result
mode: primary
steps: 1
permissions:
  - action: "*"
    resource: "*"
    effect: deny
---

你是一个精确的文本转换器。只输出用户要求的结果本身：
- 不要解释、不要寒暄、不要用引号或 Markdown 包裹。
- 如果用户要求 JSON，只输出 JSON 对象本身。
"#;

fn ensure_opencode_runner() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("scraper-opencode-runner");
    let agents = dir.join(".opencode").join("agents");
    fs::create_dir_all(&agents).map_err(|e| format!("创建 opencode 运行目录失败: {e}"))?;
    fs::write(agents.join("name-only.md"), OPENCODE_AGENT)
        .map_err(|e| format!("写入 opencode agent 失败: {e}"))?;
    fs::write(
        dir.join("opencode.json"),
        r#"{
  "$schema": "https://opencode.ai/config.json",
  "agents": {
    "title": { "disabled": true },
    "summary": { "disabled": true }
  }
}
"#,
    )
    .map_err(|e| format!("写入 opencode 配置失败: {e}"))?;
    Ok(dir)
}

fn strip_ansi(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '\u{1b}' {
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
        } else {
            output.push(character);
        }
    }
    output
}

fn clean_opencode_output(value: &str) -> String {
    strip_ansi(value)
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty() && !line.starts_with("> "))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string()
}

fn opencode_completion(config: &AIConfig, prompt: &str) -> Result<String, String> {
    let dir = ensure_opencode_runner()?;
    fs::write(dir.join("prompt.txt"), prompt)
        .map_err(|e| format!("写入 opencode 提示词失败: {e}"))?;

    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("cmd");
        command.arg("/C").arg("opencode");
        command
    };
    #[cfg(not(windows))]
    let mut command = Command::new("opencode");

    command
        .arg("run")
        .arg("--standalone")
        .arg("--agent")
        .arg("name-only");
    let model = config.model.trim();
    if !model.is_empty() {
        command.arg("--model").arg(model);
    }
    // 提示词通过附件传入，命令行只保留一个单词，避免 Windows shell 转义问题。
    command
        .arg("--file")
        .arg("prompt.txt")
        .arg("go")
        .current_dir(&dir)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 opencode（请确认已安装并在 PATH 中）: {e}"))?;

    let timeout = Duration::from_secs(config.timeout.max(90));
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {}
            Err(error) => return Err(format!("等待 opencode 失败: {error}")),
        }
        if started.elapsed() > timeout {
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill")
                    .args(["/PID", &child.id().to_string(), "/T", "/F"])
                    .creation_flags(0x0800_0000)
                    .output();
            }
            #[cfg(not(windows))]
            {
                let _ = child.kill();
            }
            let _ = child.wait();
            return Err(format!("opencode 超时（{}s）", timeout.as_secs()));
        }
        thread::sleep(Duration::from_millis(100));
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("读取 opencode 输出失败: {e}"))?;
    let stdout = clean_opencode_output(&String::from_utf8_lossy(&output.stdout));
    let stderr = clean_opencode_output(&String::from_utf8_lossy(&output.stderr));

    if !output.status.success() {
        return Err(format!(
            "opencode 退出码 {:?}: {}",
            output.status.code(),
            truncate(&stderr, 300)
        ));
    }
    if stdout.is_empty() {
        return Err("opencode 没有返回内容".to_string());
    }
    Ok(stdout)
}

async fn generate(
    config: &AIConfig,
    prompt: &str,
    max_tokens: u32,
) -> Result<(String, u64), String> {
    if is_opencode(config) {
        let started = Instant::now();
        let config = config.clone();
        let prompt = prompt.to_string();
        let content =
            tauri::async_runtime::spawn_blocking(move || opencode_completion(&config, &prompt))
                .await
                .map_err(|e| format!("opencode 任务失败: {e}"))??;
        Ok((content, started.elapsed().as_millis() as u64))
    } else {
        chat_completion(config, prompt, max_tokens).await
    }
}

fn extract_message_content(value: &Value) -> Option<String> {
    let choice = value.get("choices")?.get(0)?;

    if let Some(message) = choice.get("message") {
        if let Some(content) = message.get("content") {
            if let Some(text) = content.as_str() {
                return Some(text.to_string());
            }
            if let Some(parts) = content.as_array() {
                let joined = parts
                    .iter()
                    .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join("");
                if !joined.is_empty() {
                    return Some(joined);
                }
            }
        }
    }

    choice
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
}

/// Strip Markdown code fences, then take the first `{` through the last `}`.
fn parse_model_json(content: &str) -> Option<Value> {
    let mut text = content.trim();

    if let Some(fence) = text.find("```") {
        let mut after = &text[fence + 3..];
        if let Some(rest) = after.strip_prefix("json") {
            after = rest;
        } else if let Some(rest) = after.strip_prefix("JSON") {
            after = rest;
        }
        after = after.trim_start();
        text = match after.rfind("```") {
            Some(end) => &after[..end],
            None => after,
        };
    }

    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end < start {
        return None;
    }

    serde_json::from_str(&text[start..=end]).ok()
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
}

fn local_identify(
    cleaned: &str,
    original: &str,
    started: Instant,
    raw: Option<String>,
) -> AIIdentifyResult {
    let code = extract_code(cleaned);
    let title = if cleaned.trim().is_empty() {
        original.to_string()
    } else {
        cleaned.to_string()
    };

    AIIdentifyResult {
        code,
        title,
        confidence: 0.0,
        ms: started.elapsed().as_millis() as u64,
        fallback: true,
        raw,
    }
}

/// Local fallback regex `[A-Z]{2,6}[-_]?\d{2,6}` (case-insensitive, `_` → `-`).
fn extract_code(input: &str) -> String {
    let chars: Vec<char> = input.to_uppercase().replace('_', "-").chars().collect();
    let len = chars.len();
    let mut index = 0;

    while index < len {
        if !chars[index].is_ascii_uppercase() {
            index += 1;
            continue;
        }

        let letter_start = index;
        while index < len && chars[index].is_ascii_uppercase() {
            index += 1;
        }
        let letters = index - letter_start;
        if !(2..=6).contains(&letters) {
            continue;
        }

        let mut cursor = index;
        while cursor < len && matches!(chars[cursor], '-' | ' ') {
            cursor += 1;
        }
        let digit_start = cursor;
        while cursor < len && chars[cursor].is_ascii_digit() {
            cursor += 1;
        }
        let digits = cursor - digit_start;
        if !(2..=5).contains(&digits) {
            continue;
        }
        if cursor < len && chars[cursor].is_alphanumeric() {
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

/// Best-effort filename cleanup used before sending the name to the model.
fn clean_filename(filename: &str) -> String {
    let name = filename
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or(filename);
    let stem = match name.rfind('.') {
        Some(index) if index > 0 => &name[..index],
        _ => name,
    };

    let mut output = String::with_capacity(stem.len());
    let mut previous_space = false;
    for character in stem.chars() {
        let character = match character {
            '.' | '_' => ' ',
            other => other,
        };
        if character == ' ' {
            if !previous_space {
                output.push(' ');
            }
            previous_space = true;
        } else {
            output.push(character);
            previous_space = false;
        }
    }

    output.trim().to_string()
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut output: String = text.chars().take(max_chars).collect();
    if text.chars().count() > max_chars {
        output.push('…');
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "spawns the local opencode CLI"]
    fn opencode_cli_identifies_movie_number() {
        let config = AIConfig {
            provider: "OpenCode CLI".to_string(),
            model: "opencode-go/deepseek-v4.1-flash".to_string(),
            timeout: 120,
            enabled: true,
            fallback: false,
            ..AIConfig::default()
        };
        let result =
            tauri::async_runtime::block_on(ai_identify(config, "SSIS-001.mp4".to_string()))
                .expect("opencode identify should succeed");
        assert_eq!(result.code, "SSIS-001");
        assert!(!result.fallback);
    }
}

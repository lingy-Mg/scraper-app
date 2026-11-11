import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR, DEFAULT_AI, type AIConfig } from './settings'

export interface Candidate {
  id: string
  title: string
  year: string
  code?: string
  source: string
  score: number
  overview: string
  poster: number
}

export interface AITestResult {
  ok: boolean
  latencyMs: number
  message: string
}

export interface AIIdentifyResult {
  code: string
  title: string
  confidence: number
  ms: number
  fallback: boolean
  raw?: string
}

export interface AIPickResult {
  pick: string
  confidence: number
  reason: string
  ms: number
  fallback: boolean
}

/** 与前端 src/utils.ts 的 cleanFilename 保持一致。 */
export function cleanFilename(name: string): string {
  const match = name.match(/^(.*)(\.[^.]+)$/)
  const base = match ? match[1] : name
  const ext = match ? match[2].toLowerCase() : ''
  const cleaned = base
    .replace(/^.*@/, '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned + ext
}

const CODE_DENY = new Set([
  'QQ', 'IMG', 'VID', 'DSC', 'PXL', 'MVIMG', 'DCIM',
  'AUDIO', 'VIDEO', 'SCREEN', 'SCREENSHOT', 'WECHAT'
])

/** 与前端 src/utils.ts 的 guessCode 保持一致。 */
export function guessCode(name: string): string {
  const base = cleanFilename(name).replace(/\.[^.]+$/, '')
  const match = base.match(/[A-Z]{2,6}[-_]?\d{2,5}(?![A-Z0-9])/i)
  if (!match) return ''
  const prefix = (match[0].match(/^[A-Z]+/i)?.[0] ?? '').toUpperCase()
  if (CODE_DENY.has(prefix)) return ''
  return match[0].toUpperCase().replace(/_/g, '-')
}

function normalizeConfig(input: Partial<AIConfig> | AIConfig | undefined): AIConfig {
  return {
    ...DEFAULT_AI,
    ...(input && typeof input === 'object' ? input : {})
  }
}

function summarize(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

const OPENCODE_SESSION = crypto.randomUUID()

function isOpencodeApi(config: AIConfig): boolean {
  return config.provider.trim().toLowerCase() === 'opencode api'
}

/** 去掉 ```json 围栏，并截取第一个 { 到最后一个 }。 */
function parseModelJson(text: string): Record<string, unknown> | null {
  let body = text.trim()
  body = body.replace(/```json/gi, '```').replace(/```/g, '').trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function chatEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new Error('缺少 Base URL')
  return base.endsWith('/chat/completions') ? base : `${base}/chat/completions`
}

/** OpenCode CLI 作为本地模型后端：无需 API Key，使用本机已登录的 OpenCode。 */
function isOpencode(config: AIConfig): boolean {
  return config.provider.trim().toLowerCase() === 'opencode cli'
}

const RUNNER_DIR = join(DATA_DIR, 'opencode-runner')

const OPENCODE_AGENT = `---
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
- 如果用户要求 JSON，你的整个回复必须是一个 JSON 对象，不能有任何其他文字或代码块。
`

function ensureOpencodeRunner(): void {
  const agents = join(RUNNER_DIR, '.opencode', 'agents')
  mkdirSync(agents, { recursive: true })
  writeFileSync(join(agents, 'name-only.md'), OPENCODE_AGENT, 'utf8')
  writeFileSync(
    join(RUNNER_DIR, 'opencode.json'),
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        agents: {
          title: { disabled: true },
          summary: { disabled: true }
        }
      },
      null,
      2
    ),
    'utf8'
  )
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
}

function cleanOpencodeOutput(value: string): string {
  return stripAnsi(value)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('> '))
    .join('\n')
    .trim()
}

async function opencodeCompletion(config: AIConfig, prompt: string): Promise<string> {
  ensureOpencodeRunner()
  writeFileSync(join(RUNNER_DIR, 'prompt.txt'), prompt, 'utf8')

  const args = ['run', '--standalone', '--agent', 'name-only']
  const model = (config.model ?? '').trim()
  if (model) args.push('--model', model)
  // 提示词写入附件，命令行只留一个单字消息，避免 Windows shell 转义问题。
  args.push('--file', 'prompt.txt', 'go')

  const timeoutSeconds = Math.max(90, Number(config.timeout) || DEFAULT_AI.timeout)
  const debug = process.env.OPENCODE_DEBUG === '1'
  const trace = (message: string) => {
    if (debug) appendFileSync(join(RUNNER_DIR, 'debug.log'), `${new Date().toISOString()} ${message}\n`)
  }
  trace(`spawn args=${args.join(' ')}`)

  return await new Promise<string>((resolve, reject) => {
    const child = spawn('opencode', args, {
      cwd: RUNNER_DIR,
      windowsHide: true,
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    })
    child.stdin?.end()

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      trace(`timeout pid=${child.pid}`)
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true })
      } else {
        child.kill('SIGKILL')
      }
      reject(new Error(`opencode 超时（${timeoutSeconds}s）`))
    }, timeoutSeconds * 1000)

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
      trace(`stdout ${String(chunk).length}`)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
      trace(`stderr ${String(chunk).length}`)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      trace(`error ${error.message}`)
      reject(new Error(`无法启动 opencode：${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      trace(`close ${code} out=${stdout.length} err=${stderr.length}`)
      if (code !== 0) {
        reject(
          new Error(`opencode 退出码 ${code}：${cleanOpencodeOutput(stderr || stdout).slice(0, 300)}`)
        )
        return
      }
      const output = cleanOpencodeOutput(stdout)
      if (!output) {
        reject(new Error('opencode 没有返回内容'))
        return
      }
      resolve(output)
    })
  })
}

async function generate(
  config: AIConfig,
  prompt: string,
  maxTokens?: number
): Promise<string> {
  if (isOpencode(config)) return opencodeCompletion(config, prompt)
  return chat(config, prompt, maxTokens)
}

/** CLI 模型偶尔不按 JSON 输出：对 OpenCode CLI 再重试一次。 */
async function generateForJson(
  config: AIConfig,
  prompt: string,
  maxTokens?: number
): Promise<{ content: string; parsed: Record<string, unknown> | null }> {
  let content = await generate(config, prompt, maxTokens)
  let parsed = parseModelJson(content)
  if (!parsed && isOpencode(config)) {
    content = await generate(
      config,
      `${prompt}\n\n再次强调：只输出 JSON 对象本身，不要输出任何其他字符。`,
      maxTokens
    )
    parsed = parseModelJson(content)
  }
  return { content, parsed }
}

async function chat(
  config: AIConfig,
  prompt: string,
  maxTokens?: number
): Promise<string> {
  const endpoint = chatEndpoint(config.baseUrl)
  const headers: Record<string, string> = { 'content-type': 'application/json' }

  const apiKey = (config.apiKey ?? '').trim()
  const isOllama = config.baseUrl.includes('11434')
  if (apiKey) headers.authorization = `Bearer ${apiKey}`
  else if (!isOllama) {
    // 非 Ollama 且没有 API Key 时不发送 Authorization，交由服务端返回明确错误。
  }
  if (isOpencodeApi(config)) {
    headers['x-opencode-session'] = OPENCODE_SESSION
    headers['user-agent'] = 'scraper-app/0.1'
  }

  const body: Record<string, unknown> = {
    model: config.model,
    temperature: config.temperature,
    stream: false,
    messages: [{ role: 'user', content: prompt }]
  }
  if (maxTokens != null) body.max_tokens = maxTokens

  const timeoutSeconds = Number(config.timeout)
  const timeoutMs =
    Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
      ? timeoutSeconds * 1000
      : DEFAULT_AI.timeout * 1000

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    throw new Error(`AI 请求失败：${summarize(error)}`)
  }

  if (!response.ok) {
    let detail = ''
    try {
      detail = (await response.text()).slice(0, 300)
    } catch {
      // 忽略读取失败
    }
    throw new Error(`AI 请求失败：HTTP ${response.status}${detail ? ` ${detail}` : ''}`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new Error('AI 返回的不是 JSON')
  }

  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
    ?.choices?.[0]?.message?.content

  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: unknown })?.text === 'string'
            ? String((part as { text: string }).text)
            : ''
      )
      .join('')
  }
  throw new Error('AI 响应缺少内容')
}

export async function aiTest(config: Partial<AIConfig> | AIConfig): Promise<AITestResult> {
  const resolved = normalizeConfig(config)
  const started = Date.now()
  try {
    const content = await generate(resolved, '只回复 OK', 1)
    return {
      ok: true,
      latencyMs: Date.now() - started,
      message: `连接成功${content.trim() ? `：${content.trim().slice(0, 40)}` : ''}`
    }
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      message: `连接失败：${summarize(error)}`
    }
  }
}

function identifyFallback(
  config: AIConfig,
  filename: string,
  started: number
): AIIdentifyResult {
  const cleaned = config.cleanFilename ? cleanFilename(filename) : filename
  const title = cleaned.replace(/\.[^.]+$/, '').trim()
  const code = guessCode(filename)
  return {
    code,
    title: title || code,
    confidence: code ? 0.98 : 0,
    ms: Date.now() - started,
    fallback: true
  }
}

export async function aiIdentify(
  config: Partial<AIConfig> | AIConfig,
  filename: string
): Promise<AIIdentifyResult> {
  const resolved = normalizeConfig(config)
  const started = Date.now()
  const cleaned = resolved.cleanFilename ? cleanFilename(filename) : filename

  const fallback = () => identifyFallback(resolved, filename, started)

  if (!resolved.enabled) {
    if (resolved.fallback) return fallback()
    throw new Error('AI 已关闭且未启用回退')
  }

  const prompt = (resolved.prompt || DEFAULT_AI.prompt)
    .split('{filename}')
    .join(cleaned)
    .split('{source}')
    .join(resolved.provider || '')

  try {
    const { content, parsed } = await generateForJson(resolved, prompt)
    if (!parsed) {
      if (isOpencode(resolved)) {
        const single = content.trim().replace(/^[\s"'`]+|[\s"'`]+$/g, '')
        const code = single.includes('\n') ? '' : guessCode(single)
        if (code) {
          return {
            code,
            title: single,
            confidence: 0.6,
            ms: Date.now() - started,
            fallback: false,
            raw: content
          }
        }
      }
      throw new Error('模型输出无法解析为 JSON')
    }

    const code = typeof parsed.code === 'string' ? parsed.code.trim() : ''
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : ''
    if (!code && !title) throw new Error('模型未返回番号或标题')

    return {
      code,
      title,
      confidence: clamp(Number(parsed.confidence)),
      ms: Date.now() - started,
      fallback: false,
      raw: content
    }
  } catch (error) {
    if (resolved.fallback) return fallback()
    throw error
  }
}

export async function aiPick(
  config: Partial<AIConfig> | AIConfig,
  filename: string,
  candidates: Candidate[]
): Promise<AIPickResult> {
  const resolved = normalizeConfig(config)
  const started = Date.now()

  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('没有候选')
  }

  const fallback = (): AIPickResult => ({
    pick: candidates[0].id,
    confidence: 0,
    reason: 'AI 不可用，默认选择第一条',
    ms: Date.now() - started,
    fallback: true
  })

  if (!resolved.enabled) {
    if (resolved.fallback) return fallback()
    throw new Error('AI 已关闭且未启用回退')
  }

  const list = candidates.map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    year: candidate.year,
    code: candidate.code,
    source: candidate.source,
    overview: candidate.overview,
    score: candidate.score
  }))

  const prompt = `你是影片候选选择器。请从候选列表中选出与文件名最匹配的一条。
只返回 JSON，不要解释：
{"pick": "<candidate id>", "confidence": 0.0, "reason": "..."}
文件名：${filename}
候选：${JSON.stringify(list)}`

  try {
    const { parsed } = await generateForJson(resolved, prompt)
    if (!parsed) throw new Error('模型输出无法解析为 JSON')

    const pick = typeof parsed.pick === 'string' ? parsed.pick.trim() : ''
    if (!pick || !candidates.some((candidate) => candidate.id === pick)) {
      throw new Error('模型返回的候选 id 不存在')
    }

    const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
    return {
      pick,
      confidence: clamp(Number(parsed.confidence)),
      reason,
      ms: Date.now() - started,
      fallback: false
    }
  } catch (error) {
    if (resolved.fallback) return fallback()
    throw error
  }
}

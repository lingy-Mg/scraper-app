# 桥接契约（React ⇄ Bun HTTP）

> 本文件是前端与 Bun 后端共同遵守的接口约定。
> 任何一侧改动接口，必须同步修改本文件。
> 插件目录、`identify`/`resolve` 契约见 [plugin-contract.md](plugin-contract.md)。

## 1. 运行环境与通道

纯 B/S 单端：浏览器加载前端，同源访问 Bun 提供的 `/api`。

- 开发：Vite(5173) 提供前端，把 `/api`、`/plugins`、`/ws` 代理到 Bun(5174)。
- 生产：`npm run start` 由 Bun(5174) 同时托管 `dist/` 与 API，SPA 未知路径回退 `index.html`。
- 服务只监听 `127.0.0.1`。
- 前端统一通过 `src/native.ts` 的 `native.scanFolder()` 等方法调用，业务组件不得直接 `fetch`。
- 所有 JSON 字段使用 **camelCase**。
- 失败时 HTTP 返回 `{ "error": string }` 且状态码 4xx/5xx。
- 路径一律使用**绝对路径**；返回给前端的路径使用当前平台分隔符。

## 2. 共享类型

```ts
export interface MediaFile {
  path: string
  name: string
  size: number
  duration: number | null      // 秒，读取失败为 null
  probedBy: 'ffprobe' | 'mp4' | 'none'
  width?: number | null
  height?: number | null
  videoCodec?: string | null
}

export interface ScanRequest {
  path: string
  recursive?: boolean         // 默认 true
  blacklist?: string[]        // 命中这些文件名的文件直接跳过
  stream?: boolean            // 仅 HTTP：true 时以 NDJSON 流回进度
}

/**
 * 扫描进度。通过 `/api/scan` 的 NDJSON 流推送。
 */
export interface ScanProgress {
  scanId: string              // 前端生成，用于过滤事件
  phase: 'walk' | 'probe'     // 枚举目录 / 读取视频信息
  found: number               // 已发现的视频数
  dirs: number                // 已枚举的目录数
  total: number               // probe 阶段的文件总数（walk 阶段为 0）
  done: number                // probe 阶段已处理数
  current: string             // 当前目录名或文件名
  files?: MediaFile[]         // 本批探测完成的文件（用于增量渲染）
}

export interface OrganizeItem {
  source: string               // 源文件绝对路径
  relativeTarget: string       // 相对目标目录，允许 / 或 \ 分隔，含扩展名
  nfo?: string                 // 可选：写入同名 .nfo 的 XML
  posterUrl?: string           // 可选：下载为同名 .jpg 的海报
  posterCrop?: {               // 可选：手动裁剪区域（源图像素）
    x: number
    y: number
    width: number
    height: number
  }
}

export interface OrganizeRequest {
  dest: string
  action: 'move' | 'copy'      // 默认 move
  conflict: 'skip' | 'overwrite' | 'rename'  // 默认 rename
  removeEmptyDirs?: boolean    // 默认 false
  items: OrganizeItem[]
}

export interface OrganizeResult {
  source: string
  target: string               // 实际写入路径（自动重命名后为最终路径）
  ok: boolean
  skipped: boolean
  error?: string
  warning?: string             // 主文件成功但 NFO/封面失败时的说明
}

export interface TrashResult {
  removed: number
  failed: { path: string; error: string }[]
}

export interface AppInfo {
  version: string
  platform: string
  ffprobe: boolean             // ffprobe 是否可用
  native: boolean              // 保留字段，B/S 版恒为 false
}

export interface Settings {
  ai: AIConfig
  modes?: Record<string, unknown>   // 前端模式配置快照，后端原样保存
  lastFolder?: string
  minDur?: number
  compact?: boolean
  blacklist?: string[]             // 文件名黑名单，见 3.1.2
}

export interface AIConfig {
  enabled: boolean
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  timeout: number              // 秒
  cleanFilename: boolean
  inferCode: boolean
  verify: boolean
  fallback: boolean
  autoPick: boolean
  autoPickThreshold: number
  prompt: string
}

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
  fallback: boolean            // true 表示结果来自本地正则而非模型
  raw?: string
}

export interface AIPickResult {
  pick: string                 // Candidate.id
  confidence: number
  reason: string
  ms: number
  fallback: boolean
}
```

## 3. 后端行为约定

具体 HTTP 路由见第 5 节；`src/native.ts` 的方法与路由一一对应。

### 3.1 扫描规则

- 视频扩展名：`.mp4 .m4v .mov .mkv .avi .wmv .ts .m2ts .flv .webm`。
- `recursive=true` 时递归子目录；跳过隐藏目录（`.` 开头）与符号链接。
- 时长获取顺序：
  1. `.mp4/.m4v/.mov` 直接解析 `moov/mvhd`（不依赖外部程序）。
  2. `ffprobe`：`-v error -show_entries format=duration -of json`，同时取 `stream=width,height,codec_name`。
  3. 都失败 → `duration: null`, `probedBy: "none"`。
- `ffprobe` 查找顺序：`PATH` → 可执行文件同目录 → 项目根目录 `binaries/`。
- 结果按 `name` 排序。
- Windows 下启动子进程必须加 `CREATE_NO_WINDOW`，避免弹黑框。

### 3.1.1 扫描进度

- 扫描分两阶段：`walk`（只枚举视频路径，快）→ `probe`（逐个读时长，慢）。
- `walk` 阶段：`total=0`、`found` 为已发现视频数、`dirs` 为已枚举目录数、`current` 为当前目录/文件名。
- `probe` 阶段：枚举结束后立即推送一次 `done=0` 的初始事件，`total` 为文件总数；之后按批推送。
- `files` 只包含**本批**探测完成的 `MediaFile`，前端据此增量渲染表格；最终结果仍由命令返回值给出。
- 限频：walk ≤ 1 次/150ms；probe 每 16 个文件或 180ms 一次，结束时必发一次。
- 事件名 `scan-progress`；`scanId` 由前端传入并原样回传，前端据此忽略其它扫描的事件。
- 前端收到 `done/total` 后显示百分比进度条；`walk` 阶段显示不确定进度动画与实时计数。
- 扫描期间不写媒体库，结束后统一落库（避免大目录反复 upsert）。

### 3.1.2 文件名黑名单

- 设置项：`Settings.blacklist: string[]`，随设置持久化；扫描请求可带 `blacklist` 覆盖（前端每次扫描都传当前值）。
- 匹配对象是**文件名**（不含目录），不区分大小写：
  - 含 `*` 或 `?` → 通配符整名匹配（`*` 任意长度，`?` 单个字符）；
  - 不含通配符 → 包含匹配（`sample` 命中 `sample.mp4`、`my-sample.mkv`）；
  - 任一条命中即视为黑名单文件。
- 两份实现必须一致：`src/utils.ts`（显示过滤）、`server/scan.ts`（扫描跳过）。
- 黑名单文件在 `walk` 阶段直接跳过：不计数、不探测、不返回，也永远不会写入媒体库。
- 前端隐藏已加载的命中行（不删除文件）；下一次 replace 扫描会因文件不再返回而顺带清理其媒体库记录。
- 右键表格行「拉黑此文件名」按完整文件名添加一条规则；`文件 → 文件名黑名单…` 可增删规则。

### 3.2 整理规则

- 目标路径 = `dest / relativeTarget`；先创建父目录。
- 拒绝越界：规范化后必须仍位于 `dest` 之内，否则该项 `ok=false, error="目标路径越界"`。
- `conflict=skip`：目标存在 → `ok=true, skipped=true`。
- `conflict=overwrite`：删除已存在的目标文件。
- `conflict=rename`：追加 ` (2)`、` (3)`… 直到不冲突。
- `action=move` 优先 `fs::rename`；跨卷失败时复制 → 校验大小 → 删除源文件。
- 单项失败不影响其他项。
- `removeEmptyDirs`：整理结束后自底向上删除 `dest` 之外、且变空的**源目录**（只删除本次源文件所在目录，且不删除 `dest` 本身）。

### 3.3 删除

- 必须进入系统回收站，禁止永久删除。
- Windows：一次 PowerShell 进程优先调用 `SHFileOperation`（`FOF_ALLOWUNDO`，路径列表双重 null 结尾）批量处理；返回码非 0、被中断或仍有残留时，在**同一进程内**回退为逐条 `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(..., SendToRecycleBin)`，并返回失败明细。非 Windows 使用 `trash-put`。

### 3.4 设置持久化

- 存储位置：`server/data/settings.json`，原子写入（写临时文件再 rename）。
- 文件不存在 → 返回默认值（`ai` 使用内置默认配置，`lastFolder` 为空）。
- `save_settings` 整体覆盖，不做深合并。

## 4. AI 行为

请求：OpenAI 兼容 `POST {baseUrl}/chat/completions`，`Authorization: Bearer {apiKey}`。

- `temperature` 使用配置值，`timeout` 秒作用于整个请求。
- `apiKey` 为空且是 Ollama（`baseUrl` 含 `11434`）时不发 Authorization。
- 模型输出必须是 JSON；解析前去掉 ```json 代码围栏，并截取第一个 `{` 到最后一个 `}`。
- `ai_identify` 提示词：使用 `config.prompt`，把 `{filename}` 替换为清洗后的文件名。
- `ai_pick` 提示词：要求返回 `{ "pick": "<candidate id>", "confidence": 0..1, "reason": "..." }`，附原始文件名与候选 JSON。
- `ai_test`：发起一个极小的 chat 请求（`max_tokens: 1`），返回耗时与结果；失败时 `ok=false` 且 `message` 含错误摘要。
- 以下情况回退本地正则（`fallback: true`）：
  - `config.enabled=false`
  - 请求超时 / 网络错误 / 非 2xx
  - 模型输出无法解析出 JSON
  - 且仅当 `config.fallback=true`；若 `fallback=false` 则返回错误。
- 本地番号正则：`[A-Z]{2,6}[-_]?\d{2,6}`（忽略大小写，`_` 归一为 `-`，转大写）。
- `ai_pick` 回退策略：取 `candidates[0].id`，`confidence: 0`，`reason: "AI 不可用，默认选择第一条"`。
- 不得把 API Key 写入日志或返回给前端以外的位置。
- 发送给模型的只有文件名与候选元数据。

## 4.1 JavDB 元数据（javdb 插件）

- 实现：`server/plugins/javdb/javdb-api.ts`；协议细节见 `docs/javdb-app-api.md`。
- 通过 `POST /api/plugins/javdb/identify` / `resolve` 调用，主程序不再提供 `/api/javdb/*` 路由。
- 有番号时只接受大小写/分隔符等价的**唯一精确匹配**，绝不回退搜索首项；无番号时默认返回空（`allowTitle=true` 才按名称搜索）。
- `duration` 在 App API 中是**分钟**，进入 `Candidate`/`Row` 前统一换算为秒（`<= 1000` 视为分钟）。
- 串行 + 1.2s 间隔 + host 失败切换 + 5 分钟缓存。
- `Candidate` 额外字段：`posterUrl`、`maker`、`actors`、`duration`、`detailId`。
- 识别优先级：插件 `identify` → AI/正则。
- 封面必须经 `/api/cover`（可选裁剪参数）解码后显示，禁止直接加载远程图片。
- 上游现在要求登录：用户可在 JavDB / AV 插件设置填写 `token`（JWT），插件从 `ctx.config.token` 读取并附加 `authorization: Bearer <token>`；令牌只存 `server/data/config.json`，接口回显脱敏，不写日志。
- 鉴权失败返回可操作中文提示（未填写 / 已失效），前端不得显示成「暂无数据」。
- `resolve` 的 `magnets[]` 已转 camelCase：`name / hash / size / cnsub / hd / filesCount / pikpakUrl`。详情弹窗按需拉取，只展示与复制，不调用下载接口。

## 5. Bun HTTP 接口

前缀 `/api`，仅监听 `127.0.0.1`。所有字段 camelCase。

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| GET | `/api/info` | — | `AppInfo` |
| POST | `/api/scan` | `ScanRequest`（`stream=true` 时流式） | `MediaFile[]`；流式为 NDJSON |
| POST | `/api/probe` | `{ path }` | `MediaFile` |
| GET | `/api/fs/roots` | — | `{ roots: FsRoot[] }`（`Cache-Control: no-store`） |
| GET | `/api/fs/list?path=<绝对路径>` | query `path` | `FsListing`（`Cache-Control: no-store`） |
| POST | `/api/organize` | `OrganizeRequest` | `OrganizeResult[]` |
| POST | `/api/trash` | `{ paths: string[] }` | `TrashResult` |
| GET | `/api/settings` | — | `Settings` |
| PUT | `/api/settings` | `Settings` | `Settings` |
| POST | `/api/ai/test` | `{ config }` | `AITestResult` |
| POST | `/api/ai/identify` | `{ config, filename }` | `AIIdentifyResult` |
| POST | `/api/ai/pick` | `{ config, filename, candidates }` | `AIPickResult` |
| POST | `/api/open` | `{ path }` | `{ ok: true }` |
| POST | `/api/reveal` | `{ path }` | `{ ok: true }` |

插件接口（刮削源统一入口，详见 `docs/plugin-contract.md`）：

| 方法 | 路径 | 入参 | 返回 |
|---|---|---|---|
| GET | `/api/plugins` | — | 插件清单（含 `capabilities`、`status`、`error`、`source`） |
| POST | `/api/plugins/reload` | — | `{ ok, count }` |
| POST | `/api/plugins/:id/reload` | — | 插件描述 |
| GET/PUT | `/api/plugins/:id/config` | `Partial<PluginConfig>` | `PluginConfig`（`token` 脱敏为 `••••••••`） |
| POST | `/api/plugins/:id/identify` | `{ filename, allowTitle?, options? }` | `{ candidates: Candidate[] }` |
| POST | `/api/plugins/:id/resolve` | `{ candidateId, options? }` | 插件返回的详情对象 |
| GET | `/plugins/:id/settings/` | — | 设置页静态资源 |

内置插件 id：`javdb`、`av`、`movie`、`tv`、`anime`；用户插件可覆盖同名 id。
旧的 `/api/javdb/*`、`/api/tmdb/*`、`/api/bangumi/*` 路由已删除。

### 5.1 扫描流（`POST /api/scan`，`stream: true`）

响应 `content-type: application/x-ndjson`，每行一个 JSON 事件：

```jsonc
{"type":"progress","progress":ScanProgress}
{"type":"done","files":MediaFile[]}
{"type":"error","error":"..."}
```

- `progress` 的 `files` 是本批结果；`done` 携带完整排序结果。
- 前端必须兼容后端不返回 NDJSON 的旧实现（直接按 JSON 数组读取）。
- `blacklist` 在流式与非流式下行为一致：命中的文件在枚举阶段即被跳过。

### 5.2 文件系统浏览（网页内目录选择器）

```ts
export interface FsRoot {
  name: string
  path: string
  kind: 'drive' | 'home' | 'common'
}

export interface FsEntry {
  name: string
  path: string
  isDir: true
  hidden: boolean       // 以 . 开头的隐藏目录
}

export interface FsListing {
  path: string          // resolve 后的绝对路径
  parent: string | null // 根目录为 null
  entries: FsEntry[]    // 仅目录，按名称排序
}
```

- `GET /api/fs/roots`：Windows 盘符（PowerShell `Get-PSDrive -PSProvider FileSystem`，失败回退 A–Z 探测，缓存 60s）+ 主目录 + 桌面/下载/文档/视频 + 项目根目录。
- `GET /api/fs/list`：`path` 必须为绝对路径，`resolve` 后必须存在且是目录，否则 400；无权限返回 403。
- 前端 `FolderPickerModal`：左侧位置列表，中间目录列表（单击选中、双击进入），顶部面包屑 + 上一级 + 手动绝对路径跳转，底部「选择此文件夹」。
- `native.pickFolder()` 不调用系统对话框，而是触发该弹窗并返回选中的绝对路径。

## 6. 前端接入要求

- `src/native.ts` 暴露 `native` 对象与 `native.mode: 'http'`（B/S 单端，始终为 `http`）。
- 刮削调用统一走插件接口，`native` 方法签名保持不变：
  - `javdbIdentify` / `javdbDetail` → `/api/plugins/javdb/{identify,resolve}`；
  - `tmdbIdentify` / `tmdbDetail` → `/api/plugins/{movie|tv}/{identify,resolve}`；
  - `bangumiIdentify` / `bangumiDetail` → `/api/plugins/anime/{identify,resolve}`。
  - 密钥 / token / 语言通过 `options` 透传，插件也可自行读取 `modeConfig`。
- 应用启动顺序：`app_info` → `load_settings` → `fetchPlugins`（失败则内置模式）→ 若 `lastFolder` 存在则自动扫描。
- 「选择文件夹」必须调用 `native.pickFolder()`；未选中时不做任何事。
- 扫描必须订阅进度并在 UI 立即反馈：
  - `walk` 阶段显示不确定进度动画 + 已发现视频数 / 已枚举目录数 / 当前目录；
  - `probe` 阶段显示 `done/total` 百分比、当前文件与预计剩余时间；
  - 表格按批增量渲染（约 200ms 一批），空表时显示扫描提示，禁止「扫描完成后一次性出现」。
- 扫描期间禁用「选择文件夹 / 整理 / 开始刮削」，并暂停媒体库落库；结束后统一保存。
- 黑名单：`Settings.blacklist` 由前端维护并通过设置持久化；每次扫描把当前规则传给后端（`native.scanFolder` 的 `blacklist`）。命中行必须从表格、计数、刮削、整理与清理中全部排除；右键行可「拉黑此文件名」，「文件 → 文件名黑名单…」可管理规则。拉黑只隐藏，不删除文件。
- 「开始刮削」流程：
  1. 对每个 `unmatched` 行调用插件 `identify`（Bun 可用时），得到候选。
  2. 0 条 → `unmatched`；1 条 → `done`；多条 → `review`（带 `candidates`）。
  3. 若 `ai.autoPick`，调用 `native.aiPick`，置信度 ≥ 阈值才自动采用。
  4. 插件不可用时回退 `native.aiIdentify`。
- 「整理」使用真实 `native.organize()`，按返回结果逐行更新日志与状态，失败必须显示原因。
- 「删除 / 清理短片」使用 `native.trash()`，失败项保留在表格并提示。
- 所有配置变更（AI、模式、上次目录）调用 `native.saveSettings()` 持久化（500ms 防抖）。
- 状态栏的 ffprobe 状态、速度、任务数使用真实值，不再写死。
- 浏览器环境没有窗口最小化/最大化/关闭权限，界面不提供桌面窗口按钮。

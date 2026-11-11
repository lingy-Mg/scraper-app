# 刮削器 · 架构设计

> 目标：一个可扩展的本地刮削器。模式（AV / 电影 / 电视剧 / 动漫）不是写死的，
> 而是由 Bun 插件宿主动态注册；每个插件自带设置界面，宿主用 iframe 嵌入。

## 1. 总体架构

```text
浏览器 (Edge / Chrome)
        │  http://127.0.0.1:5174
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Bun 单进程                                                    │
│                                                              │
│  ┌────────────────────────────┐   ┌────────────────────────┐ │
│  │ Host UI（dist/ 静态文件）   │◄─►│ Bun API                │ │
│  │ React 18 + Ant Design 5    │HTTP│ 127.0.0.1:5174         │ │
│  │                            │ WS │                        │ │
│  │  · 文件表格 / 任务 / 日志   │   │  · 插件注册 / 热重载    │ │
│  │  · 模式切换                │   │  · 刮削脚本执行         │ │
│  │  · iframe: 插件设置页       │   │  · AI 代理              │ │
│  └────────────────────────────┘   │  · SQLite / 文件        │ │
│                                   └───────────┬────────────┘ │
│                                               │              │
│                          ┌────────────────────┴───────────┐  │
│                          │ plugins/                       │  │
│                          │  av/{plugin.json,index.ts}     │  │
│                          │  movie/…  tv/…  anime/…        │  │
│                          └────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

职责划分：

| 层 | 负责 | 不负责 |
|---|---|---|
| Host UI | 展示、交互、任务状态、iframe 容器 | 抓取、文件移动、AI 调用 |
| Bun Host | 插件生命周期、刮削执行、AI 代理、HTTP/WS、静态文件 | 浏览器窗口控制 |
| Plugin | 某个模式的识别/解析/整理规则 | 全局状态、权限决策 |

## 2. 进程模型

- **Host UI**：Vite 开发时 `127.0.0.1:5173`；生产由 Bun 直接托管 `dist/`。
- **Bun Host**：`bun server/index.ts`，默认 `127.0.0.1:5174`。只监听回环地址。
- 生产只有一个进程：`npm run start`（`scripts/start.mjs`）启动 Bun 并托管前端。
- 开发时两个进程并行：`npm run dev`（`scripts/dev.mjs` 同时拉起 Bun 与 Vite）。

Vite 代理：

```ts
proxy: {
  '/api': 'http://127.0.0.1:5174',
  '/plugins': 'http://127.0.0.1:5174',
  '/ws': { target: 'ws://127.0.0.1:5174', ws: true }
}
```

## 3. 插件系统

### 3.1 目录

```text
server/plugins/
├─ av/
│  ├─ plugin.json
│  ├─ index.ts            # 刮削脚本（Bun 直接 import）
│  └─ settings/           # 可选：插件自带设置页
│     └─ index.html
├─ movie/…
├─ tv/…
├─ anime/…
└─ _shared/
   ├─ simple.ts           # 示例复用
   └─ settings.html       # 插件未自带设置页时的共享模板
```

插件目录以 `_` 开头会被忽略。

### 3.2 Manifest

```json
{
  "id": "av",
  "name": "AV",
  "version": "1.0.0",
  "apiVersion": 1,
  "order": 10,
  "description": "JavDB / Minnano / FANZA 元数据",
  "entry": "index.ts",
  "labels": { "code": "番号", "title": "标题" },
  "defaults": {
    "lang": "日语",
    "sources": [{ "label": "JavDB", "on": true }],
    "downloads": [{ "label": "封面", "on": true }],
    "naming": "{片商}/{年份}/{番号} {标题}",
    "organize": "{片商}/{年份}/{番号} {标题}"
  }
}
```

- `apiVersion` 不匹配时插件进入 `error` 状态，宿主仍展示但不可用。
- `defaults` 是默认配置，用户修改后写入 `server/data/config.json`，按插件 id 覆盖。

### 3.3 执行模型

插件就是一个 ESM 模块：

```ts
export default {
  async identify(ctx: { filename: string; config: PluginConfig }) {
    return [/* Candidate[] */]
  },
  async resolve(ctx: unknown, candidateId: string) {
    return {/* 完整元数据 */}
  }
}
```

宿主加载方式：

```ts
const mod = await import(`${pathToFileURL(entry).href}?v=${++generation}`)
const impl = mod.default ?? mod
```

- 查询串 `?v=` 规避 ESM 模块缓存，实现热重载。
- `fs.watch(plugins/, { recursive: true })` + 320ms 去抖。
- 修改 `plugin.json`、`index.ts`、`settings/` 都会触发重载，并通过 WS 广播 `plugin:reloaded`。
- 重载失败时保留旧实例不可行（ESM 无卸载），因此失败会标记 `status: "error"` 并展示错误。

> 后续隔离：把每个插件放到 `Bun.Worker` 或子进程，给 3 秒超时与内存上限；
> 当前 MVP 与宿主同进程，插件视为可信代码。

### 3.4 能力与权限（规划）

manifest 增加：

```json
{ "permissions": ["net:fetch", "fs:read:library", "ai:infer"] }
```

宿主注入的 `ctx` 只暴露被授权的能力：

```ts
ctx.http.get(url, opts)      // 走宿主代理/限速/重试
ctx.ai.infer(prompt)         // 走宿主 AI 配置
ctx.fs.read(path)            // 限定在媒体库根目录
ctx.log(level, message)
ctx.signal                   // AbortSignal
```

## 4. 设置 UI 嵌入协议

### 4.1 方案

- 插件设置页由插件自己实现，可以是 React、Vue、Svelte 或纯 HTML。
- Bun 托管在 `/plugins/<id>/settings/`，宿主用 `<iframe>` 嵌入。
- 这样插件升级 UI 不需要重新构建宿主，也不受宿主技术栈约束。

```tsx
<iframe
  src={mode.settingsUrl}
  sandbox="allow-scripts allow-forms allow-same-origin"
/>
```

### 4.2 消息协议

| 方向 | type | payload | 说明 |
|---|---|---|---|
| 插件 → 宿主 | `plugin:ready` | `{pluginId}` | iframe 加载完成 |
| 宿主 → 插件 | `host:init` | `{pluginId, config}` | 下发当前配置/主题/语言 |
| 插件 → 宿主 | `plugin:saved` | `{pluginId, config}` | 保存成功后通知宿主刷新 |
| 插件 → 宿主 | `plugin:close` | `{pluginId}` | 请求关闭 |
| 插件 → 宿主 | `plugin:toast` | `{level, message}` | 可选：统一提示 |

约束：

- 宿主校验 `event.source === iframe.contentWindow` 与 `pluginId`。
- 开发环境允许 `127.0.0.1` 任意端口；生产只允许宿主同源。
- 插件也可以直接 `fetch('/api/plugins/<id>/config')` 自读自写，宿主在 `plugin:saved` 后重新拉取。

### 4.3 降级

插件没有 `settings/index.html` 时：

1. 宿主回退到 `_shared/settings.html`（当前实现）。
2. 后续支持 manifest 里的 `settings.schema`，由宿主用 AntD 表单渲染。

## 5. 宿主 API

### 5.1 REST

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/plugins` | 已注册模式列表（含 `settingsUrl`） |
| POST | `/api/plugins/reload` | 重载全部插件 |
| POST | `/api/plugins/:id/reload` | 重载单个插件 |
| GET | `/api/plugins/:id/config` | 读取配置 |
| PUT | `/api/plugins/:id/config` | 保存配置（持久化） |
| POST | `/api/plugins/:id/identify` | 用插件识别一个文件名 |
| POST | `/api/ai/pick` | 多候选择优（AI 代理） |
| GET | `/plugins/:id/settings/` | 插件设置页静态资源 |
| GET | `/ws` | WebSocket 事件 |

### 5.2 WS 事件

```json
{ "type": "hello", "time": 1730000000000 }
{ "type": "plugin:reloaded", "id": "av" }
```

后续事件：`task:update`、`log`、`candidate:found`、`organize:progress`。

### 5.3 错误格式

```json
{ "error": "插件不可用", "code": "PLUGIN_UNAVAILABLE" }
```

## 6. 刮削流水线

```text
扫描目录
  → ffprobe 读时长/分辨率
  → 文件名清洗（去 489155.com@、[1080p]、(1)）
  → 插件 identify(文件名) → Candidate[]
  → 0 条：无法刮削
  → 1 条：直接 resolve
  → N 条：待选择
       ├─ 用户手动选
       └─ AI 自动选（文件名 + 候选列表 → pick/confidence/reason）
  → resolve 详情 → 下载封面/NFO
  → 入库
  → 整理（按插件 organize 规则移动）
```

多结果策略：

- AI 置信度 ≥ 阈值（默认 0.9）→ 自动采用。
- 低于阈值 → 保留「待选择」，不替用户决定。
- 用户手动选择后记录 `viaAI=false`，便于后续评估模型准确率。

## 7. AI 集成

配置（宿主级，与模式无关）：

```ts
interface AIConfig {
  enabled: boolean
  provider: string       // DeepSeek / OpenAI 兼容 / 通义千问 / Ollama
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  timeout: number
  cleanFilename: boolean
  inferCode: boolean
  verify: boolean
  fallback: boolean
  autoPick: boolean
  autoPickThreshold: number
  prompt: string
}
```

两类调用：

1. **单文件推断**：`{filename}` → `{code, title, confidence}`
2. **多候选选择**：`{filename, candidates[]}` → `{pick, confidence, reason}`

提示词要求模型**只返回 JSON**，宿主做 zod 校验；失败回退正则。

安全：

- API Key 只存本机，前端不回显。
- 生产环境由 Bun 代理请求，不从前端直连模型，避免 CORS 与密钥泄露。
- 发送给模型的只有文件名和候选元数据，不上传视频内容。

## 8. 数据模型

SQLite（WAL）建议：

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  code TEXT,
  title TEXT,
  year TEXT,
  file_path TEXT NOT NULL,
  size INTEGER,
  duration INTEGER,
  status TEXT NOT NULL,        -- done/unmatched/review/error
  metadata_json TEXT,
  ai_confidence REAL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  source TEXT,
  payload_json TEXT,
  picked INTEGER DEFAULT 0
);

CREATE TABLE plugin_config (
  plugin_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at INTEGER
);
```

文件布局：

```text
<library>/
├─ 电影/片名 (年份)/片名 (年份).mkv
├─ 电视剧/剧名/Season 01/剧名 - S01E01.mkv
└─ AV/片商/年份/番号 标题.mp4
```

## 9. 文件与整理

- 时长读取：ffprobe（`format=duration`）。
- 移动文件：优先 `fs.rename`；跨盘时复制 + 校验 + 删除源文件。
- 删除：Windows 回收站（`send2trash` / `SHFileOperation`），不做不可恢复删除。
- 冲突策略：跳过 / 覆盖 / 自动重命名（` (2)`）。
- 整理前必须展示预览（当前 UI 已实现）。

## 10. 打包与运行

开发：

```bash
npm run dev          # Bun + Vite
npm run dev:server   # 只启动插件宿主
npm run dev:ui       # 只启动前端
```

生产：

1. `npm run build` 生成 `dist/`。
2. `npm run start` 启动单个 Bun 进程，静态托管 `dist/`，同时提供 `/api` 与 `/plugins`。
3. 插件目录为 `server/plugins/`，改完自动热重载；不生成 exe/安装包。

## 11. 安全

- Bun 只绑定 `127.0.0.1`，不暴露局域网。
- 服务只监听回环地址；如需额外鉴权，可通过环境变量注入一次性 token。
- 插件设置 iframe 使用 `sandbox`，默认不允许顶层跳转。
- 插件文件访问限定媒体库根目录。
- 不执行来自网络的插件代码；安装插件需要用户显式确认。

## 12. 可观测性

- 日志分级：`info/ok/warn/error`，写文件并按天轮转。
- 每个任务记录：耗时、重试次数、AI 置信度、选中来源。
- 指标：成功率、平均耗时、AI 自动选择占比、手动改选率。

## 13. 路线图

| 阶段 | 内容 |
|---|---|
| P0（当前） | 插件宿主 + 4 个内置插件 + iframe 设置页 + 前端模式动态加载 |
| P1 | 插件 Worker 隔离、权限清单、REST 任务流与 WS 进度 |
| P2 | B/S 单端、ffprobe、文件移动/回收站、SQLite |
| P3 | 真实 AI 代理、候选评估、手动改选反馈 |
| P4 | 插件市场（本地 zip 安装）、自动更新、插件签名 |

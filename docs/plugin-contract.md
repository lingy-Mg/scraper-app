# 插件契约（Bun 插件宿主）

> 刮削源（JavDB / TMDB / Bangumi …）都是自包含插件：运行时注册、可热重载、单个插件故障不影响进程。
> 新增一个刮削站 = 新增一个插件目录，不改主程序。
> 相关：[bridge-contract.md](bridge-contract.md) · [providers-library-contract.md](providers-library-contract.md)

## 1. 目录结构

内置插件：

```
server/plugins/
  _shared/                 # 多插件共享模块（不注册为插件）
    types.ts               # ProviderCandidate / PluginContext
    plugin-utils.ts        # 配置/语言/开关读取
    settings.html          # 设置页兜底模板
    tmdb.ts                # TMDB 客户端（movie / tv 共用）
    tmdb-plugin.ts         # movie / tv 插件骨架
  av/
    plugin.json
    index.ts
  javdb/
    plugin.json
    javdb-api.ts           # JavDB App API 客户端（仅插件使用）
    index.ts
  movie/
    plugin.json
    index.ts
  tv/
    plugin.json
    index.ts
  anime/
    plugin.json
    bangumi.ts             # Bangumi 客户端
    index.ts
```

用户插件（同结构，已 gitignore）：

```
server/data/plugins/
  <id>/
    plugin.json
    index.ts
```

- 同 id 时用户目录**覆盖**内置插件；`GET /api/plugins` 用 `source: "builtin" | "user"` 标注。
- 用户目录不存在时静默跳过；`_` 开头的目录不会被注册。
- 插件设置页地址 `/plugins/<id>/settings/`：先找用户目录，再找内置目录，最后回退 `_shared/settings.html`。

## 2. `plugin.json`

```json
{
  "id": "movie",
  "name": "电影",
  "version": "1.0.0",
  "apiVersion": 1,
  "order": 20,
  "description": "TMDB 电影元数据",
  "entry": "index.ts",
  "capabilities": ["identify", "resolve"],
  "labels": { "code": "文件名", "title": "片名" },
  "defaults": {
    "lang": "中文",
    "sources": [{ "label": "TMDB", "on": true }],
    "downloads": [{ "label": "封面", "on": true }],
    "naming": "{标题} ({年份})",
    "organize": "电影/{标题} ({年份})"
  }
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一标识，同时作为路由中的 `:id` |
| `apiVersion` | 是 | 当前只支持 `1` |
| `name` / `version` | 是 | 展示用 |
| `entry` | 否 | 默认 `index.ts` |
| `capabilities` | 否 | 缺省 `["identify","resolve"]`；会原样出现在 `GET /api/plugins` |
| `labels` | 是 | `code` / `title` 两个列标题 |
| `defaults` | 是 | 插件默认配置，用户覆盖存于 `server/data/config.json` |
| `order` | 否 | 模式栏排序，默认 100 |

### 2.1 配置字段与密钥

`defaults` 与用户覆盖合并后注入 `ctx.config`。除通用的 `lang/sources/downloads/naming/organize` 外，插件可声明自己的字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `token` | `string` | JavDB / AV 访问令牌（JWT，可选）。为空时匿名请求；有值时发送 `authorization: Bearer <token>` |

- `token` 只写入 `server/data/config.json`（已 gitignore），**不写日志、不回显明文**。
- `GET /api/plugins`、`GET /api/plugins/:id/config`、`PUT /api/plugins/:id/config` 返回的 `token` 统一脱敏为 `••••••••`。
- `PUT` 时：省略 `token` 或传脱敏占位符 → 保持原值；传非空字符串 → 覆盖；传空字符串 → 清除。
- 新增密钥类字段时，在 `server/registry.ts` 的 `SECRET_FIELDS` 登记，即可自动脱敏。

### 2.2 设置页与扩展方式

- 默认设置页：`server/plugins/_shared/settings.html`，由 `PluginSettingsModal` 以 iframe 加载；保存走 `PUT /api/plugins/:id/config`。
- 通用设置页会根据配置中是否存在某个键决定是否显示扩展项：
  - `token` 存在时显示「访问令牌」输入框（`type=password`，不回显，留空表示不修改）。
- 需要完全自定义界面时，在插件目录放 `settings.html`；路由 `/plugins/<id>/settings/` 的查找顺序为：用户目录 → 内置插件目录 → `_shared/settings.html`。
- 设置页只合并用户可编辑字段，插件 `defaults` 仍是回退值。

插件入口默认导出对象：

```ts
export default {
  async identify(ctx) { /* 返回 Candidate[] */ },
  async resolve(ctx, candidateId) { /* 返回详情对象 */ }
}
```

## 3. 通用 HTTP 接口

所有接口均返回 JSON、字段 camelCase；失败返回 `{ "error": string }`。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/plugins` | 插件清单：`id/name/version/order/description/status/error/capabilities/source/codeLabel/titleLabel/settingsUrl` + 配置字段 |
| POST | `/api/plugins/reload` | 重新扫描并加载全部插件（含用户目录） |
| POST | `/api/plugins/:id/reload` | 重载单个插件及其目录内所有依赖 |
| GET/PUT | `/api/plugins/:id/config` | 读取 / 合并保存插件配置 |
| POST | `/api/plugins/:id/identify` | 文件名 → 候选 |
| POST | `/api/plugins/:id/resolve` | 候选 ID → 完整详情 |
| GET | `/plugins/:id/settings/` | 插件设置页静态资源 |

### 3.1 identify

```http
POST /api/plugins/javdb/identify
{ "filename": "SSIS-001.mp4", "allowTitle": false, "options": {} }
```

```json
{ "candidates": [ { "id": "javdb:123", "title": "...", "source": "JavDB", "score": 8.7 } ] }
```

- `allowTitle` 仅 AV / JavDB 使用：默认只认番号，`true` 时才允许按标题搜索。
- `options` 为通用透传字段，插件自行解释（如 `apiKey`、`lang`、`mediaType`）；JavDB 令牌从 `ctx.config.token` 读取，不走 `options`。
- 上游 JavDB 现在要求登录；令牌缺失 / 失效时错误信息为可操作中文提示，不会返回英文异常堆栈。

### 3.2 resolve

```http
POST /api/plugins/javdb/resolve
{ "candidateId": "javdb:123", "options": {} }
```

- 直接返回插件的结果对象（JavDB 含 `magnets`，TMDB/Bangumi 含 `raw` 等），不额外包一层。
- `candidateId` 一般来自同一插件 `identify` 返回的 `id` 或 `detailId`。
- JavDB 的 `magnets[]` 字段（插件已转 camelCase）：`name / hash / size / cnsub / hd / filesCount / pikpakUrl`；前端只做展示与复制，不调用下载接口。

## 4. 插件上下文 ctx

```ts
interface PluginContext {
  filename?: string                 // identify 时传入
  allowTitle?: boolean              // identify 时传入
  config: Record<string, unknown>   // plugin.json defaults + 用户覆盖
  options: Record<string, unknown>  // 本次请求的 options
  modeConfig?: Record<string, unknown> // settings.modes[id]，含 tmdbApiKey / bangumiToken 等
  ai: {
    identify(filename: string, overrides?: Record<string, unknown>): Promise<AIIdentifyResult>
    pick(filename: string, candidates: unknown[], overrides?: Record<string, unknown>): Promise<AIPickResult>
  }
}
```

- 语言、`sources` 开关等由插件自行从 `ctx.config` / `ctx.modeConfig` 读取，主程序不解释这些字段。
- 密钥只在本机：插件可读 `modeConfig`/`options`，但不得写入日志或返回给前端以外的地方。
- `resolve` 的 ctx 不含 `filename/allowTitle`。

### 4.1 AI 注入

AI 是**通用回退引擎，不是刮削站**，保持为共享服务 `server/ai.ts`：

- 插件通过 `ctx.ai.identify(filename)` / `ctx.ai.pick(filename, candidates)` 调用，默认使用 `server/data/settings.json` 的 `settings.ai`；
- 可传 `overrides` 临时覆盖 AI 配置；
- `/api/ai/test|identify|pick` 保留，供前端直接测试；
- 插件不应自行实现模型调用，也不要假设 AI 一定可用（需处理抛错与 `fallback`）。

## 5. 加载与热重载

1. 插件目录内所有文件（含 `_shared/`、跨插件相对引用）会被 `Bun.build` 打包成单个 ESM：
   `server/data/.plugin-cache/<id>-<source>-<hash>.mjs`。
2. `hash` 由内置 + 用户插件根目录内文件的 `mtime + size` 汇总；未变化时复用缓存。
3. 打包产物通过 `import(路径 + '?v=<generation>')` 加载，避免命中模块缓存。
   - 每次加载 / 重载后按 `id-source` 只保留最新 **2** 个 `.mjs`；当前正在使用的产物无论新旧都不会被删除。
   - 删除失败（文件被占用）时跳过，下次加载再清理。
4. 修改插件目录内任意 `.ts`（入口或非入口）后：
   - `POST /api/plugins/:id/reload`（或 `/api/plugins/reload`）立即生效；
   - 开发期文件监听会在约 320ms 后自动重载；`_shared/` 变动会重载全部插件。
5. 不允许只对入口文件做失效的“伪热重载”。

## 6. 错误隔离

- 单个插件加载失败：该插件 `status: "error"`、`error` 为原因，其他插件继续加载。
- 单次 `identify` / `resolve` 抛错：只影响该请求，返回 HTTP 400 `{ error }`，进程不退出。
- 打包失败（语法错误、缺依赖）按加载失败处理，错误在 `GET /api/plugins` 可见。

## 7. 用户插件最小示例

`server/data/plugins/demo/plugin.json`：

```json
{
  "id": "demo",
  "name": "Demo",
  "version": "1.0.0",
  "apiVersion": 1,
  "order": 99,
  "labels": { "code": "编号", "title": "标题" },
  "defaults": {
    "lang": "中文",
    "sources": [],
    "downloads": [],
    "naming": "{标题}",
    "organize": "{标题}"
  }
}
```

`server/data/plugins/demo/index.ts`：

```ts
export default {
  async identify(ctx: any) {
    return [
      {
        id: `demo:${ctx.filename}`,
        title: ctx.filename,
        year: '',
        source: 'Demo',
        score: 1,
        overview: '',
        poster: 1
      }
    ]
  },

  async resolve(_ctx: any, candidateId: string) {
    return { id: candidateId, title: 'demo detail' }
  }
}
```

放好后调用 `POST /api/plugins/reload`，即可在 `GET /api/plugins` 看到 `source: "user"` 的 `demo`。

## 8. 不得破坏的约定

- 字段一律 camelCase；时长进入 `Candidate` / `Row` 前必须换算为**秒**。
- JavDB 签名常量、番号正则、封面 URL 行为不得随意更改；封面仍必须经 `/api/cover` 解码。
- 新增数据源只新增插件目录，不在 `server/index.ts` 增加站点路由。
- 插件不得读取/打印密钥；不得把 `server/data/` 提交到仓库。

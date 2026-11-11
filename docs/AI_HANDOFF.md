# AI / 开发者交接文档

> 更新时间：2026-11-11
> 配套阅读：[AGENTS.md](../AGENTS.md) · [ROADMAP.md](ROADMAP.md) · [bridge-contract.md](bridge-contract.md) · [plugin-contract.md](plugin-contract.md) · [providers-library-contract.md](providers-library-contract.md) · [javdb-app-api.md](javdb-app-api.md)

## 1. 产品定位与功能矩阵

本地影片刮削器：扫描目录 → 数据源识别 → 候选确认 → 写入媒体库 → 按规则整理并生成 NFO/封面。

| 能力 | 状态 | 位置 |
|---|---|---|
| 目录扫描 / MP4 时长 / ffprobe 可选 | ✅ | `server/scan.ts` |
| 文件整理（移动/复制/冲突/跨卷/空目录） | ✅ | `server/files.ts` |
| 回收站批量删除 | ✅ | `server/files.ts` |
| JavDB App API（番号/详情/演员/封面/磁力数据） | ✅ | `server/plugins/javdb/javdb-api.ts` |
| TMDB 电影 / 电视剧 | ✅ 需 Key | `server/plugins/_shared/tmdb.ts`（movie/tv 插件） |
| Bangumi 动漫 | ✅ 可匿名 | `server/plugins/anime/bangumi.ts` |
| 插件宿主（打包加载 / 热重载 / 用户目录） | ✅ | `server/registry.ts`、`server/plugins/` |
| AI（OpenAI 兼容 / OpenCode CLI） | ✅ | `server/ai.ts`（经 ctx.ai 注入插件） |
| SQLite 媒体库 | ✅ | `server/library.ts` |
| 媒体库增强（查询/重复/统计/来源） | ✅ | `server/library.ts`、`server/sources.ts`、`src/components/LibraryModal.tsx` |
| 默认隐藏短片 / 清理弹窗列表 | ✅ | `src/App.tsx` |
| 深色主题 / 表格列宽与列显隐 | ✅ | `src/ThemeRoot.tsx`、`src/theme.ts`、`src/tableColumns.ts`、`src/components/FileTable.tsx` |
| 设置导入导出（默认脱敏） | ✅ | `server/settings-io.ts`、`src/components/SettingsExportModal.tsx` |
| 底部日志默认显示 / 拖动高度 | ✅ | `src/components/LogPanel.tsx`、`src/App.tsx` |
| NFO + 封面随整理写入 | ✅ | `server/files.ts`、`src/utils.ts` |
| 网页内目录选择器 | ✅ | `src/components/FolderPickerModal.tsx`、`server/index.ts` |
| 单进程托管前端 + API | ✅ | `server/index.ts`、`scripts/start.mjs` |
| JavDB 访问令牌（可选，脱敏保存） | ✅ | `server/plugins/javdb/`、`registry.ts`、`_shared/settings.html` |
| 磁力面板（详情展示 / 复制） | ✅ | `src/components/MagnetList.tsx`、`PosterModal.tsx` |
| 预告片（TMDB URL / NFO `<trailer>`） | ✅ | `server/plugins/_shared/tmdb.ts`、`src/components/PosterModal.tsx`、`server/files.ts` |
| 本地字幕匹配 / 整理复制 | ✅ 只做本地目录 | `server/subtitles.ts`、`server/files.ts`、`src/components/PosterModal.tsx` |

## 2. 进程与通道

| 环境 | 前端 | 后端 |
|---|---|---|
| `npm run dev` | Vite `127.0.0.1:5173`（热更） | Bun `127.0.0.1:5174`，Vite 代理 `/api`、`/plugins`、`/ws` |
| `npm run start` | Bun 托管 `dist/` | 同一个 Bun `127.0.0.1:5174`，API + 插件 + 静态文件 |

纯 B/S 单端，浏览器访问同一源；`src/native.ts` 的 `native.mode` 恒为 `http`。

## 3. 文件地图

```
src/
  App.tsx                     # 状态、流程、弹窗、媒体库同步、快捷键
  native.ts                   # 同源 HTTP 封装（唯一后端通道）
  utils.ts                    # fmtDur/fmtSize/NFO/行转换/短片判定
  types.ts                    # 全部 DTO 与 Settings
  components/
    TitleBar/MenuBar/Toolbar/ModeBar/FilterBar/FileTable
    StatusBar/LogPanel/OrganizeModal/ConfigModal/AIConfigModal
    CandidateModal/PosterModal/PluginSettingsModal
    MagnetList                # 磁力列表 + 复制 / 手动复制降级
    FolderPickerModal         # 网页内目录选择
    LibraryModal              # 媒体库：列表/重复/统计/来源
server/
  index.ts                    # Bun HTTP + /ws + 插件资源 + dist 静态托管
  registry.ts                 # 插件发现、打包加载、热重载、用户插件覆盖
  scan.ts / files.ts / subtitles.ts / settings.ts / ai.ts / library.ts
  sources.ts                  # 媒体库来源 CRUD（只记录路径，不删文件）
  plugins/
    _shared/{types,plugin-utils,tmdb,tmdb-plugin}.ts
    _shared/settings.html
    av/  javdb/{plugin.json,index.ts,javdb-api.ts}
    movie/  tv/  anime/{plugin.json,index.ts,bangumi.ts}
test/                         # bun:test 单元测试（mkdtemp + SCRAPER_DATA_DIR 隔离）
scripts/
  dev.mjs                     # 开发：Bun watch + Vite
  start.mjs                   # 生产：单进程启动 + 打开浏览器
  smoke.mjs                   # HTTP 端到端冒烟（随机端口 + 临时数据目录）
  check.mjs                   # 一键自检：tsc → bun build → bun test → npm run build
data/                         # 项目根运行时目录（gitignore）
  plugins/                    # 用户插件（可选，同 id 覆盖内置）
  .plugin-cache/              # Bun.build 产物
  library.db / settings.json / config.json / covers/
docs/                         # 契约与协议
AGENTS.md
```

## 4. 后端接口（前端契约必须与 Bun 实现一致）

所有能力都在 Bun HTTP 中实现，前端通过 `src/native.ts` 调用，详见契约文档。

- 基础：`/api/info`、`/api/scan`、`/api/probe`
- 文件系统：`/api/fs/roots`、`/api/fs/list`
- 文件：`/api/organize`（含 `downloads` 开关）、`/api/subtitles/find`、`/api/trash`、`/api/open`、`/api/reveal`
- 设置：`GET/PUT /api/settings`
- AI：`/api/ai/test`、`/api/ai/identify`、`/api/ai/pick`（共享服务，同时经 `ctx.ai` 注入插件）
- 刮削源（统一插件接口）：
  - `GET /api/plugins`、`POST /api/plugins/reload`
  - `POST /api/plugins/:id/{identify,resolve}`、`GET/PUT /api/plugins/:id/config`
  - 内置 id：`javdb`、`av`、`movie`、`tv`、`anime`
  - 旧路由 `/api/javdb/*`、`/api/tmdb/*`、`/api/bangumi/*` 已删除
- 媒体库：`/api/library/{list,query,duplicates,stats,upsert,remove,clear}`
  - `query` 支持 `q/mode/maker/actor/tag/status/sort/order/limit/offset`，返回 `{ total, items }`
  - `duplicates` 返回 `{ groups: [{ reason, key, items }] }`，同番号优先
  - `stats` 返回总数/总大小/按模式/按状态/Top 片商/演员/标签
- 来源：`GET/POST/DELETE /api/sources`（存 `Settings.sources`，扫描成功自动登记；删除只删记录）
- 封面：`/api/cover?url=...&x=&y=&width=&height=`
- 插件资源 / WS：`/plugins/:id/settings/`、`/ws`

目录选择不再弹系统对话框：前端弹窗通过 `/api/fs/*` 浏览真实路径。

## 5. 设置

```ts
interface Settings {
  ai: AIConfig
  modes?: Record<string, ModeConfig>
  lastFolder?: string
  minDur?: number          // 短片阈值，分钟，默认 10
  compact?: boolean
  hideShorts?: boolean     // 默认 true
  logOpen?: boolean        // 默认 true
  logHeight?: number       // 默认 180
  theme?: 'light' | 'dark' | 'system'  // 默认 system（旧设置缺省时按 system）
  table?: {
    widths?: Record<string, number>    // 列 key → 像素宽度（40–1200）
    hidden?: string[]                  // 被隐藏的数据列；操作/选择列不可隐藏
  }
  blacklist?: string[]     // 文件名黑名单（支持 * / ?，无通配符按包含匹配）
  sources?: { path: string; name?: string; addedAt: number }[]  // 媒体库来源
}
```

`PUT /api/settings` 在请求未携带 `sources` 时保留现有来源，避免前端保存其它设置时覆盖来源记录。

设置导入导出：
- `GET /api/settings/export?includeSecrets=0|1` 返回带 `Content-Disposition` 的下载 JSON；默认递归移除 `apiKey` / `*ApiKey` / `*Token` / `token` / `password` / `secret`，仅显式 `includeSecrets=1` 包含明文。
- `POST /api/settings/import` 先严格校验结构，非法返回 400 且不落盘；`ai` 逐字段合并（脱敏文件不会清空本机密钥），`table.widths` 按键合并，`hidden/sources/blacklist` 提供时整体替换。
- 插件配置 `data/config.json`（含 JavDB 令牌）**不参与**导出/导入，不要把它并入 `Settings`。
- 日志只记录操作结果和字段名，禁止回显密钥明文。

`ModeConfig` 额外包含：`tmdbApiKey`、`tmdbLang`、`bangumiToken`（按模式保存）。
插件调用时通过 `ctx.modeConfig` 读取这些值；语言与 `sources` 开关以插件自身 `ctx.config` 为准。

JavDB / AV 访问令牌不走 `Settings.modes`，而是插件配置 `token`：

- 存储于 `data/config.json` 的对应插件配置下，不进 `settings.json`、不进仓库。
- `GET/PUT /api/plugins/:id/config` 与 `GET /api/plugins` 回显时脱敏为 `••••••••`。
- 插件从 `ctx.config.token` 读取；为空时匿名请求，有值时发送 `authorization: Bearer <token>`。

存储位置（开发与生产共用）：

- `data/settings.json`
- `data/library.db`
- `data/covers/`（封面缓存）

## 6. 媒体库表结构

```sql
CREATE TABLE items (
  path TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  mode TEXT NOT NULL,            -- 刮削模式；未刮削时为空字符串
  code TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unmatched',
  year TEXT, maker TEXT, actors TEXT, overview TEXT, src TEXT,
  score REAL, dur INTEGER, size INTEGER,
  poster_url TEXT, poster_crop_json TEXT, detail_id TEXT, tags_json TEXT,
  release_date TEXT, director TEXT, series TEXT,
  updated_at INTEGER NOT NULL
);
-- 幂等索引：mode / code / size / dur / updated_at
```

查询层：`queryLibrary(options)` 返回 `{ total, items }`；`findDuplicates(mode?)`；`libraryStats(mode?)`。
所有查询值参数化，排序字段只取白名单（`updatedAt/title/size/dur/year`），`limit` 默认 50、上限 500。

规则：

- 扫描新增行 `mode=''`，可被任意模式刮削；刮削成功后写入当前模式。
- 启动时按最近一条记录的 `mode` 恢复模式。
- 扫描成功（流式/非流式）后自动把扫描根写入 `Settings.sources` 并去重；来源删除只删记录。
- `hideShorts` 只影响展示与「开始刮削」，不影响「清理短片」。
- `.d.ts` 旧记录在启动时自动删除。

## 7. 数据源细节

### JavDB

- 协议全文：`docs/javdb-app-api.md`
- **上游当前要求登录**：四个镜像可能返回 `JWTVerificationError: 請登錄帳號`。插件支持用户在「插件设置 → 访问令牌」填写自己的 JWT；有值时附加 `authorization: Bearer <token>`，不做任何鉴权绕过。
- 令牌只存 `data/config.json`，接口回显脱敏、不写日志；缺失时提示填写，失效时提示更新。
- 签名：`jdsignature = ts.suffix.md5(ts + prefix)`，常量对应 App 1.9.28
- host：`jdforrepam.com` → `apidd.spthgb.com` → `apidd.czssdgz.com` → `javdb.com`
- `duration` 是**分钟**，入 `Candidate.duration` / `Row.dur` 时 ×60
- 有番号只接受唯一精确匹配；无番号默认返回空（AV/JavDB 只认番号），仅手动匹配传 `allowTitle=true` 才按标题搜索
- Bun 串行限速 1.2s + 5 分钟缓存；host 失败自动切换
- 番号正则：2–6 位字母 + 可选分隔 + 2–5 位数字；排除 `QQ/IMG/VID/DSC/PXL/MVIMG/DCIM/AUDIO/VIDEO/SCREEN/SCREENSHOT/WECHAT`，且完整数字串超过 5 位直接拒绝（避免 `QQ20260818` 这类录屏名）
- **封面**：CDN 响应可能是 XOR 包装（首字节 key，其余异或才是 JPEG/PNG）。前端不得直接加载远程图片；统一走 `/api/cover`（裁剪参数 `x/y/width/height`），由后端解码并返回本地缓存。
- **封面默认不裁剪**：`cover_url` / DMM `pl.jpg` 是封底+封面拼接图，不同片商拼法不固定，因此不再自动裁右半。需要纯正面时，在详情弹窗点「手动裁剪」，拖动选框后应用；裁剪区域保存为 `posterCrop`，并随整理写入封面。
- **纯正面小图**：`thumb_url` / DMM `ps.jpg` 是 147×200 的纯正面；高清源没有公开的纯正面原图。
- **其它图片**：`preview_images` 是剧照（可能为空），`preview_video_url` 是 HLS 预告片，不是封面。
- 候选字段：`tags`、`releaseDate`、`director`、`series`、`publisher`、`magnetsCount`；入库到 SQLite，NFO 写入 `premiered/director/set/tag`。

### TMDB

- v3 Key 走 `api_key`，`eyJ` 开头视为 v4 Bearer
- 电影 `/search/movie`、`/movie/{id}?append_to_response=credits`、`/movie/{id}/videos`
- 剧集 `/search/tv`、`/tv/{id}`、`/tv/{id}/videos`
- `runtime` / `episode_run_time[0]` 为分钟 → ×60
- 预告片只取 YouTube key，返回 `trailerUrl` / `trailerSite`；videos 失败只写 warning，详情仍返回
- 本地字幕匹配见 `server/subtitles.ts`：同目录 + 一层 `Subs`/`字幕`，不联网
- 无 Key 明确报错，前端状态栏显示

### Bangumi

- `POST https://api.bgm.tv/v0/search/subjects?limit=10`，`filter.type=[2]`
- 详情 `/v0/subjects/{id}`
- 必须带自定义 User-Agent；Token 可选
- 无 `duration`，留空

### OpenCode API（Console / Go）

- 服务商选 `OpenCode API`，走 OpenAI Chat Completions 兼容接口
- Base URL：
  - Go 订阅：`https://opencode.ai/inference/go/openai/v1`
  - 余额计费：`https://opencode.ai/inference/openai/v1`
- API Key：在 OpenCode Console 创建，只保存在本机
- 模型 ID：`deepseek-v4.1-flash`、`glm-5.3`、`kimi-k3` 等；完整列表：
  `https://opencode.ai/inference/go/v1/models`
- 请求头附加 `x-opencode-session` 与 `user-agent: scraper-app/0.1`（Go 路由要求）
- 未填 Key 会明确返回 401，不会静默回退

### OpenCode CLI（AI 后端）

- 前端服务商选 `OpenCode CLI`，模型填 `provider/model`，无需 API Key
- 后端生成独立运行目录：`data/opencode-runner/`
  - 内含 `.opencode/agents/name-only.md` + `opencode.json`（禁用 title/summary）
- 调用：`opencode run --standalone --agent name-only --model <model> --file prompt.txt go`
- **stdin 必须 null/ignore**，否则 CLI 等待输入卡死
- 超时默认至少 90s；Windows 超时用 `taskkill /PID <pid> /T /F`
- 输出清洗 ANSI 与 `> ...` 头；解析失败重试一次；仍失败尝试把单行输出当番号

## 8. 前端行为要点

- **短片**：`isShort(dur, minDur)` 要求 `dur > 0`；`displayRows` 根据 `hideShorts` 过滤；计数与状态栏使用 `displayRows`
- **清空 / 重来**：`清空列表` 清空全部媒体库记录并取消文件夹选择；`重新导入` 清空记录后以 replace 模式重扫当前文件夹；选择新文件夹同样 replace，旧行不保留
- 行 `uid`：媒体库行与扫描行都必须使用 `stableUid(path)`；不要用 `hashString`（它只用于海报 0..5）
- **AV 只按番号**：无番号不搜标题；AI 回退只看 code；手动匹配才允许标题搜索
- **清理短片**：自定义 Modal，列出文件名/时长/大小，支持全选与单行勾选
- **日志**：默认 `logOpen=true`；`LogPanel` 顶部 5px 手柄，拖动改 `logHeight`，持久化
- **模式隔离**：`startScrape` 只处理 `row.mode === 当前模式` 或空模式的行
- **识别优先级**：电影/电视剧/动漫 → 原生 provider；AV/JavDB → Bun 插件 → 原生 JavDB → AI
- **NFO/封面**：整理时读取模式 `downloads` 配置；失败只写 warning，不影响主文件
- **扫描进度**：扫描分 `walk`（枚举）→ `probe`（读时长）两阶段；走 `/api/scan` 的 NDJSON 流；`src/components/ScanProgressBar.tsx` 显示进度与当前位置，`App.tsx` 每 200ms 批量把 `files` 合并进表格；扫描期间暂停媒体库落库
- **文件名黑名单**：`Settings.blacklist` 按文件名（不含目录）屏蔽 BT 附带文件；不区分大小写，`*`/`?` 通配符，无通配符按包含匹配。两份实现（`src/utils.ts` 的 `isBlacklisted`、`server/scan.ts`），改动必须同步。扫描时在 `walk` 阶段直接跳过；已加载的命中行从表格/计数/刮削/整理/清理中排除；右键行可拉黑，`BlacklistModal` 可增删规则。只隐藏，不删除文件
- **目录选择**：`native.pickFolder()` 打开 `FolderPickerModal`，通过 `/api/fs/roots` 与 `/api/fs/list` 浏览真实目录，不调用系统文件夹对话框。
- **媒体库面板**：菜单「文件 → 媒体库…」打开 `LibraryModal`，四个标签页：列表（搜索/筛选/排序/分页，点击行复用详情弹窗）、重复（只展示与保留建议，不自动删除）、统计（总数/总大小/分布/Top 列表）、来源（添加复用 `pickFolder()`，删除二次确认且只删记录）。全部请求经 `native.libraryQuery/libraryDuplicates/libraryStats/listSources/addSource/removeSource`，不直接 `fetch`。
- **磁力面板**：打开详情弹窗时，JavDB / AV 行按 `detailId` 调用 `POST /api/plugins/:id/resolve`，取 `magnets[]` 存到行内（不写媒体库）。`MagnetList` 只做展示与复制：名称超长省略 + tooltip，显示大小/中文字幕/高清/文件数；单条与全部复制；剪贴板不可用时弹只读文本框。无数据显示「暂无磁力数据」，鉴权失败显示令牌提示。**不得内置下载器或调用下载接口**。

## 9. 验证与测试

自动化（不联网、不读写项目 `data/`）：

```powershell
bun test          # 82 个用例：扫描/整理/媒体库（查询/重复/统计）/来源/插件/文件浏览/JavDB 令牌/设置兼容与导入导出
bun run smoke     # 12 项 HTTP 端到端：扫描 → 探测 → 媒体库 → 查询/重复/统计 → 来源 → 设置导出脱敏/导入 → 整理+NFO → 回收站
bun run check     # 一键：tsc --noEmit → bun build → bun test → npm run build，任一步失败退出 1
```

测试隔离方式：

- 每个测试文件在 `beforeAll` 用 `mkdtemp(join(tmpdir(), ...))` 建临时目录，设置 `SCRAPER_DATA_DIR` 后再动态 `import` 被测模块；`afterAll` 删除目录。
- 服务端所有数据路径（设置/媒体库/封面/插件配置与缓存/JavDB 设备号）在调用时解析 `SCRAPER_DATA_DIR`，不要改回模块顶层常量，否则并发测试会串目录。
- SQLite 测试结束需 `closeLibrary()` + `Bun.gc(true)`，否则 Windows 上临时目录删除报 EBUSY。
- 冒烟脚本用 `Bun.spawn` 启动 `server/index.ts`，随机高位端口，`finally` 中 `child.kill()`（必要时 SIGKILL）并删临时目录；不得用 shell `kill $!`，避免残留进程。
- JavDB 网络请求全部 mock `globalThis.fetch`，断言 Bearer 头、中文鉴权错误与 `maskConfig` 脱敏。

未覆盖（需手工或后续补齐）：前端 UI 交互（Playwright）、真实 JavDB/TMDB/Bangumi/OpenCode 网络、非 MP4 且无 ffprobe 的时长、真实回收站还原。

手工端到端：

1. 造 2 个 MP4（可用 `moov/mvhd` 伪造时长）+ 一个 `.d.ts` 假文件。
2. `npm run dev`，扫描目录，确认 `.d.ts` 不出现、短片默认隐藏、时长无小数。
3. 清理弹窗必须列出文件。
4. 切 Bangumi 模式刮削动漫名，确认候选与海报。
5. 选 TMDB 模式但不填 Key，确认状态栏提示。
6. AI 设置选 OpenCode CLI，测试连接与识别测试。
7. 整理后检查 `.nfo` + `.jpg`。
8. 重载页面，确认媒体库记录与模式恢复。
9. 选一个大目录（数百个视频）：立刻出现进度条与当前文件，行数持续增长；进度到 100% 后表格排序稳定。
10. 右键任意行「拉黑此文件名」：该行立即隐藏；`文件 → 文件名黑名单…` 里确认规则；重新扫描时该文件不再出现；媒体库记录会在下次 replace 扫描时清理。
11. 打开一个 JavDB / AV 已匹配行的详情：应加载磁力列表；未填令牌时显示「JavDB 需要登录：请在 JavDB 插件设置中填写访问令牌」，而不是「暂无磁力数据」。
12. 在插件设置填写令牌后重启：`GET /api/plugins/javdb/config` 的 `token` 应为 `••••••••`；`data/config.json` 中保存明文（仅本机）。
13. `视图 → 主题` 切换浅色/深色/跟随系统：表格、日志、弹窗、滚动条文字均可读；刷新后保持。
14. 拖动表头边界调宽、双击恢复；`视图 → 列设置…` 隐藏「标题」等列后刷新仍生效；「操作/选择」列始终显示。
15. `文件 → 导出设置…`：默认导出文件不含 `apiKey`/`token`；勾选「包含密钥」出现警告且字段出现。导入非法 JSON 或非法 `theme` 应报错且设置不变；合法导入后页面自动重载。

## 10. 运行与交付（B/S 单端）

```powershell
npm run build   # tsc -b && vite build → dist/
npm run start   # Bun 单进程托管 dist + API，并打开浏览器
```

- 只有一个进程，只监听 `127.0.0.1:5174`；不生成 exe/安装包。
- 开发用 `npm run dev`（Vite 5173 + Bun 5174 热更）。
- opencode CLI 功能需要 `opencode` 在 PATH 中。
- 不提交 `dist/`、`data/`、`node_modules/`。

## 11. 后续接手建议

1. 先读 `docs/ROADMAP.md` 的待办与验收标准。
2. 任何接口改动先改契约文档，再改 Bun/前端。
3. 不要删除 `server/plugins/*`：插件列表决定模式切换；`movie/tv/anime` 虽为占位，但被模式 UI 使用。
4. 不要把测试数据、真实 Key、`data/` 提交到仓库。
5. 提交前跑 `bun run check`（tsc + bun build + bun test + 前端构建）；改后端逻辑时同时跑 `bun run smoke`；UI 改动至少手工验证一次关键路径。

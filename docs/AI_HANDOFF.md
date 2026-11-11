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
| 默认隐藏短片 / 清理弹窗列表 | ✅ | `src/App.tsx` |
| 底部日志默认显示 / 拖动高度 | ✅ | `src/components/LogPanel.tsx`、`src/App.tsx` |
| NFO + 封面随整理写入 | ✅ | `server/files.ts`、`src/utils.ts` |
| 网页内目录选择器 | ✅ | `src/components/FolderPickerModal.tsx`、`server/index.ts` |
| 单进程托管前端 + API | ✅ | `server/index.ts`、`scripts/start.mjs` |
| 磁力链接 UI / 预告片 / 字幕下载 | ❌ | 见 ROADMAP |

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
    FolderPickerModal         # 网页内目录选择
server/
  index.ts                    # Bun HTTP + /ws + 插件资源 + dist 静态托管
  registry.ts                 # 插件发现、打包加载、热重载、用户插件覆盖
  scan.ts / files.ts / settings.ts / ai.ts / library.ts
  plugins/
    _shared/{types,plugin-utils,tmdb,tmdb-plugin}.ts
    _shared/settings.html
    av/  javdb/{plugin.json,index.ts,javdb-api.ts}
    movie/  tv/  anime/{plugin.json,index.ts,bangumi.ts}
  data/                       # 运行时（gitignore）
    plugins/                  # 用户插件（可选，同 id 覆盖内置）
    .plugin-cache/            # Bun.build 产物
scripts/
  dev.mjs                     # 开发：Bun watch + Vite
  start.mjs                   # 生产：单进程启动 + 打开浏览器
docs/                         # 契约与协议
AGENTS.md
```

## 4. 后端接口（前端契约必须与 Bun 实现一致）

所有能力都在 Bun HTTP 中实现，前端通过 `src/native.ts` 调用，详见契约文档。

- 基础：`/api/info`、`/api/scan`、`/api/probe`
- 文件系统：`/api/fs/roots`、`/api/fs/list`
- 文件：`/api/organize`、`/api/trash`、`/api/open`、`/api/reveal`
- 设置：`GET/PUT /api/settings`
- AI：`/api/ai/test`、`/api/ai/identify`、`/api/ai/pick`（共享服务，同时经 `ctx.ai` 注入插件）
- 刮削源（统一插件接口）：
  - `GET /api/plugins`、`POST /api/plugins/reload`
  - `POST /api/plugins/:id/{identify,resolve}`、`GET/PUT /api/plugins/:id/config`
  - 内置 id：`javdb`、`av`、`movie`、`tv`、`anime`
  - 旧路由 `/api/javdb/*`、`/api/tmdb/*`、`/api/bangumi/*` 已删除
- 媒体库：`/api/library/{list,upsert,remove,clear}`
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
  blacklist?: string[]     // 文件名黑名单（支持 * / ?，无通配符按包含匹配）
}
```

`ModeConfig` 额外包含：`tmdbApiKey`、`tmdbLang`、`bangumiToken`（按模式保存）。
插件调用时通过 `ctx.modeConfig` 读取这些值；语言与 `sources` 开关以插件自身 `ctx.config` 为准。

存储位置（开发与生产共用）：

- `server/data/settings.json`
- `server/data/library.db`
- `server/data/covers/`（封面缓存）

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
  poster_url TEXT, detail_id TEXT, tags_json TEXT,
  updated_at INTEGER NOT NULL
);
```

规则：

- 扫描新增行 `mode=''`，可被任意模式刮削；刮削成功后写入当前模式。
- 启动时按最近一条记录的 `mode` 恢复模式。
- `hideShorts` 只影响展示与「开始刮削」，不影响「清理短片」。
- `.d.ts` 旧记录在启动时自动删除。

## 7. 数据源细节

### JavDB

- 协议全文：`docs/javdb-app-api.md`
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
- 电影 `/search/movie`、`/movie/{id}?append_to_response=credits`
- 剧集 `/search/tv`、`/tv/{id}`
- `runtime` / `episode_run_time[0]` 为分钟 → ×60
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
- 后端生成独立运行目录：`server/data/opencode-runner/`
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

## 9. 验证与测试

```powershell
npx tsc --noEmit
bun build server/index.ts --target=bun --outfile="$env:TEMP\server-check.js"
npm run build
```

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

## 10. 运行与交付（B/S 单端）

```powershell
npm run build   # tsc -b && vite build → dist/
npm run start   # Bun 单进程托管 dist + API，并打开浏览器
```

- 只有一个进程，只监听 `127.0.0.1:5174`；不生成 exe/安装包。
- 开发用 `npm run dev`（Vite 5173 + Bun 5174 热更）。
- opencode CLI 功能需要 `opencode` 在 PATH 中。
- 不提交 `dist/`、`server/data/`、`node_modules/`。

## 11. 后续接手建议

1. 先读 `docs/ROADMAP.md` 的待办与验收标准。
2. 任何接口改动先改契约文档，再改 Bun/前端。
3. 不要删除 `server/plugins/*`：插件列表决定模式切换；`movie/tv/anime` 虽为占位，但被模式 UI 使用。
4. 不要把测试数据、真实 Key、`server/data/` 提交到仓库。
5. 提交前跑完整 `npx tsc --noEmit` + `bun build server/index.ts`；UI 改动至少手工验证一次关键路径。

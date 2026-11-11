# AGENTS.md — 刮削器（scraper-app）

本地影片元数据刮削与媒体库管理应用，**纯 B/S 单端**：Bun 一个进程同时提供 API、插件资源和前端静态文件，浏览器访问。
**React 18 + Vite + TypeScript + Ant Design 5 + Bun**。

> 本文件是给后续 AI/开发者的入口。详细交接见 [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md)，待办见 [docs/ROADMAP.md](docs/ROADMAP.md)，接口契约见 [docs/bridge-contract.md](docs/bridge-contract.md)、[docs/plugin-contract.md](docs/plugin-contract.md) 与 [docs/providers-library-contract.md](docs/providers-library-contract.md)。

## 快速命令

```powershell
cd "C:\Users\q3499\Desktop\scraper-app"

npm install
npm run dev            # Bun API(5174) + Vite(5173)，开发热更
npm run build          # tsc -b && vite build → dist/
npm run start          # 单进程生产启动：Bun 托管 dist + API，并打开浏览器

npx tsc --noEmit
bun build server/index.ts --target=bun --outfile="$env:TEMP\server-check.js"

bun test               # 单元测试（test/，临时目录隔离、mock 网络）
bun run smoke          # HTTP 端到端冒烟（随机端口 + 临时数据目录）
bun run check          # 一键自检：tsc → bun build → bun test → npm run build
npm run e2e            # Playwright 浏览器端到端（首次需 npx playwright install chromium）
```

测试约束：单元/冒烟测试必须通过 `SCRAPER_DATA_DIR` 指向 `mkdtemp` 临时目录；e2e 使用项目内
`.tmp/e2e-data`（每次运行前清空）与 `.tmp/e2e-media`。不得读写真实 `data/` 或用户数据；测试不联网
（e2e 用 `page.route` 拦截识别接口）。`npm run e2e` 不并入 `bun run check`。

环境：Windows 10/11 x64；Node 26、Bun 1.3、WebView 浏览器（Edge/Chrome）。
AI 识别可走本机 `opencode` CLI（需在 PATH 中）。服务只监听 `127.0.0.1`。

## 架构

| 层 | 位置 | 职责 |
|---|---|---|
| 前端 | `src/` | 表格、弹窗、设置、任务状态、日志、HTTP 调用 |
| 桥接 | `src/native.ts` | 同源 HTTP 封装，唯一后端通道 |
| Bun 单进程 | `server/` | 扫描、ffprobe、整理、回收站、设置、AI、JavDB、TMDB、Bangumi、SQLite、插件、静态文件 |
| 插件 | `server/plugins/` | `av` / `javdb`（真实）+ `movie` / `tv` / `anime`（占位） |
| 文档 | `docs/` | 契约、JavDB 协议、AI 交接、路线图 |

数据流：`扫描 → 数据源识别（TMDB/Bangumi/JavDB）→ 插件/AI 回退 → 候选选择 → 媒体库 SQLite → 整理 + NFO/封面`。

开发期 `npm run dev`：Vite(5173) 提供前端并把 `/api`、`/plugins`、`/ws` 代理到 Bun(5174)。
生产期 `npm run start`：Bun 单进程在 5174 同时托管 `dist/`（SPA fallback）与 API。

## 硬性约束（不要破坏）

1. **契约一致**：前端通过 `src/native.ts` 调用，每个能力都必须在 Bun HTTP 接口中有同字段实现。改接口必须同步 `docs/bridge-contract.md` 与 `docs/providers-library-contract.md`。
2. **字段 camelCase**：TS/Bun DTO 一律 camelCase。
3. **时长单位**：`Row.dur` / `LibraryItem.dur` 一律为**秒**。JavDB 与 TMDB 原始值是分钟，必须 ×60。
4. **路径安全**：整理必须做 dest 越界校验；删除必须进回收站，禁止永久删除。
5. **密钥只在本机**：AI Key、TMDB Key、Bangumi Token 不写入日志、不提交仓库。
6. **扫描过滤**：跳过隐藏目录、符号链接、非视频扩展名、TypeScript 声明文件 `.d.ts`。
7. **短片判定**：`dur > 0` 才算短片；默认 `hideShorts=true` 隐藏小于 `minDur` 分钟的文件。
8. **Vite watch**：`data/**` 与 `dist/**` 必须忽略，避免运行时数据触发无效重载。
9. **OpenCode CLI 调用**：stdin 必须为 null/ignore，提示词写文件后用 `--file` 传入，否则 CLI 会等待 stdin 卡死；超时要杀进程树（Windows `taskkill /T /F`）。
10. **单进程交付**：构建后用 `npm run start` 启动，只监听 `127.0.0.1`；不生成 exe/安装包，不提交 `dist/`。
11. **数据目录**：所有运行时数据（设置、密钥、媒体库、封面、插件配置、缓存）只写项目根目录 `data/`，**禁止写入 `%APPDATA%` 等用户目录**。测试通过 `SCRAPER_DATA_DIR` 注入临时目录；`server/data/` 是已废弃的旧路径，不得再产生。

## 当前完成状态

- 扫描/ffprobe/媒体库/整理/回收站/设置持久化（Bun HTTP）
- JavDB App API：签名、精确番号匹配、详情、演员、封面、磁力数据
- TMDB：电影/电视剧搜索与详情，v3/v4 Key
- Bangumi：动漫搜索与详情，可选 Token
- AI：OpenAI 兼容 + OpenCode API（Console/Go）+ 本地 OpenCode CLI，JSON 解析、重试、正则回退
- SQLite 媒体库：重启恢复、模式恢复、清空当前模式
- 短片默认隐藏/可切换；清理弹窗列出文件并支持勾选
- 扫描实时进度：`walk`/`probe` 两阶段 + 进度条 + 增量行（`/api/scan` NDJSON 流）
- 文件名黑名单：按文件名屏蔽 BT 附带文件（通配符 `*`/`?`，扫描跳过 + 列表隐藏，只隐藏不删除）
- 日志面板默认展开、可拖动高度、状态持久化
- NFO + 封面随整理写入（封面统一经 `/api/cover` 解码）
- 封面默认完整显示；详情弹窗支持手动裁剪/恢复完整，裁剪区域持久化并随整理写入
- 网页内目录选择器（`/api/fs/roots`、`/api/fs/list`），不调用系统对话框
- Bun 单进程托管前端 + API（`npm run start`）
- 回收站批量删除：单 PowerShell 进程 `SHFileOperation`，失败自动逐条回退

## 已知坑

- `.d.ts` 会被 `.ts` 扩展名误判为 MPEG-TS；扫描与旧媒体库加载都已过滤。
- 扫描必须保持流式：`/api/scan` 支持 `stream=true` NDJSON；不要改回「扫完一次性返回」，否则大目录又变成无感知卡住。进度事件按 `scanId` 过滤，媒体库在扫描期间暂停落库。
- 文件名黑名单匹配有两份实现（`src/utils.ts`、`server/scan.ts`），改规则必须两处同步：不区分大小写，含 `*`/`?` 时通配符整名匹配，否则按包含匹配。扫描请求必须带 `blacklist`，否则后端会重新扫回被拉黑的文件。
- 行 `uid` 必须使用 `stableUid(path)`（`src/utils.ts`）；`hashString` 只返回 0..5，仅用于海报渐变。误用会导致单行操作影响多行。
- AV / JavDB 默认**只认番号**：无番号时不按标题搜索；AI 回退也不接受纯标题。只有「手动匹配」允许按标题搜索（`allowTitle=true`）。
- 番号正则限制为「2–6 位字母 + 可选分隔 + 2–5 位数字」，并排除 `QQ/IMG/VID/DSC/...` 前缀，避免把录屏文件名误判成番号。
- JavDB 图片 CDN 可能返回 XOR 包装（首字节是 key）；**禁止直接 `<img src=远程>`**，必须经 `/api/cover` 解码后显示，否则只会看到破图。
- JavDB / DMM 的高清 `cover_url` / `pl.jpg` 是「封底 + 封面」拼接图，且不同片商拼法不固定；**不再自动裁剪**，默认完整显示。`thumb_url` / `ps.jpg` 是 147×200 的纯正面小图。
- 裁剪是可选的手动操作：详情弹窗「手动裁剪」→ 拖动选框 → 应用；裁剪区域以 `posterCrop` 保存到媒体库，并随整理写入封面。默认无裁剪时 `posterCrop` 为空。
- 封面通过后端下载并缓存到本地；完整封面缓存名是 `{hash}.{ext}`，手动裁剪缓存名是 `{hash}-crop-x-y-w-h.{ext}`。整理时写入封面同样要经过 `decodeCover`，有 `posterCrop` 时再调用 `cropImage`。
- `preview_images` 是剧照（常为空），`preview_video_url` 是 HLS 预告；都不是封面。
- ffprobe 未安装时非 MP4/MOV 时长为空；`0` 不显示为短片。
- JavDB 签名常量对应 App 1.9.28，升级后需更新 `server/javdb.ts`。
- JavDB 动态域名解密不稳定，固定镜像 + host 失败切换。
- OpenCode CLI 每次 `--standalone` 启动私有服务，单次约 3–10s；默认超时最少 90s。
- 测试数据目录：`data/`（开发与生产共用，已 gitignore）；用户插件放 `data/plugins/<id>/`，同 id 覆盖内置。
- 插件热重载必须经 `Bun.build` 打包后再 `import`；只给入口文件加 `?v=` 不会让入口依赖的模块失效。
- 刮削站路由统一为 `/api/plugins/:id/{identify,resolve}`；不要再新增 `/api/javdb/*`、`/api/tmdb/*`、`/api/bangumi/*`，新增站点只加插件目录。
- `esbuild` 清理系统临时目录偶发 `Access is denied`（Windows 环境权限问题）；构建时可把 `TEMP`/`TMP` 指向项目内临时目录绕过。

## 继续开发流程

1. 先读 `docs/AI_HANDOFF.md` 与当前契约文档。
2. 明确改动属于前端 / Bun 哪一层，保持契约一致。
3. 小步修改并立即验证：`bun run check`；改后端逻辑时加跑 `bun run smoke`；只改类型时至少 `npx tsc --noEmit`。
4. 涉及 UI 时用 `npm run dev` 起服务，浏览器验证关键路径。
5. 完成后更新 `docs/ROADMAP.md` 的完成项与 `docs/AI_HANDOFF.md` 的状态。
6. 交付：`npm run build` 后 `npm run start`，浏览器访问 `http://127.0.0.1:5174`。

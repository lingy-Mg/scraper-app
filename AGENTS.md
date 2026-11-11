# AGENTS.md — 刮削器（scraper-app）

本地影片元数据刮削与媒体库管理桌面应用。
**React 18 + Vite + TypeScript + Ant Design 5 + Tauri 2**，开发期附带 Bun 插件宿主。

> 本文件是给后续 AI/开发者的入口。详细交接见 [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md)，待办见 [docs/ROADMAP.md](docs/ROADMAP.md)，接口契约见 [docs/bridge-contract.md](docs/bridge-contract.md) 与 [docs/providers-library-contract.md](docs/providers-library-contract.md)。

## 快速命令

```powershell
cd "C:\Users\q3499\Desktop\scraper-app"

npm install
npm run dev            # Bun 插件宿主 + Vite（HTTP 模式）
npm run dev:tauri      # Tauri 桌面窗口（推荐开发方式）
npm run build          # tsc + vite build
npm run pack:desktop   # release 构建，只把单个 exe 复制到桌面

npx tsc --noEmit
bun build server/index.ts --target=bun --outfile="$env:TEMP\server-check.js"
cd src-tauri; cargo test --lib
cd src-tauri; cargo check
```

环境：Windows 10/11 x64；Node 26、Bun 1.3、Rust 1.97、Tauri 2.x、WebView2。
AI 识别可走本机 `opencode` CLI（需在 PATH 中）。

## 架构

| 层 | 位置 | 职责 |
|---|---|---|
| 前端 | `src/` | 表格、弹窗、设置、任务状态、日志、双通道调用 |
| 桥接 | `src/native.ts` | `tauri` / `http` / `demo` 三种模式自动探测 |
| Tauri 原生 | `src-tauri/src/` | 扫描、ffprobe、整理、回收站、设置、AI、JavDB、TMDB、Bangumi、SQLite |
| Bun 宿主 | `server/` | 插件系统、HTTP 等价接口、开发期 AI 代理、SQLite |
| 插件 | `server/plugins/` | `av` / `javdb`（真实）+ `movie` / `tv` / `anime`（占位，实际走原生 provider） |
| 文档 | `docs/` | 契约、JavDB 协议、AI 交接、路线图 |

数据流：`扫描 → 数据源识别（TMDB/Bangumi/JavDB）→ 插件/AI 回退 → 候选选择 → 媒体库 SQLite → 整理 + NFO/封面`。

## 硬性约束（不要破坏）

1. **双后端一致性**：前端通过 `src/native.ts` 调用；每个能力都必须在 Tauri 命令与 Bun HTTP 接口中存在同名/同字段实现。改接口必须同步 `docs/bridge-contract.md` 与 `docs/providers-library-contract.md`。
2. **字段 camelCase**：Rust DTO 使用 `#[serde(rename_all = "camelCase")]`；Bun/TS 使用 camelCase。
3. **时长单位**：`Row.dur` / `LibraryItem.dur` 一律为**秒**。JavDB 与 TMDB 原始值是分钟，必须 ×60。
4. **路径安全**：整理必须做 dest 越界校验；删除必须进回收站，禁止永久删除。
5. **密钥只在本机**：AI Key、TMDB Key、Bangumi Token 不写入日志、不提交仓库。
6. **扫描过滤**：跳过隐藏目录、符号链接、非视频扩展名、TypeScript 声明文件 `.d.ts`。
7. **短片判定**：`dur > 0` 才算短片；默认 `hideShorts=true` 隐藏小于 `minDur` 分钟的文件。
8. **Vite watch**：`src-tauri/**` 与 `server/data/**` 必须忽略，否则 cargo 编译时 EBUSY 崩溃。
9. **OpenCode CLI 调用**：stdin 必须为 null/ignore，提示词写文件后用 `--file` 传入，否则 CLI 会等待 stdin 卡死；超时要杀进程树（Windows `taskkill /T /F`）。
10. **打包**：桌面只交付单个 exe，使用 `npm run pack:desktop`；不要生成安装包。

## 当前完成状态

- 扫描/ffprobe/媒体库/整理/回收站/窗口控制/设置持久化
- JavDB App API：签名、精确番号匹配、详情、演员、封面、磁力数据
- TMDB：电影/电视剧搜索与详情，v3/v4 Key
- Bangumi：动漫搜索与详情，可选 Token
- AI：OpenAI 兼容 + OpenCode API（Console/Go）+ 本地 OpenCode CLI，JSON 解析、重试、正则回退
- SQLite 媒体库：Bun + Rust 双实现，重启恢复、模式恢复、清空当前模式
- 短片默认隐藏/可切换；清理弹窗列出文件并支持勾选
- 扫描实时进度：`walk`/`probe` 两阶段 + 进度条 + 增量行（Tauri 事件 / HTTP NDJSON 流）
- 文件名黑名单：按文件名屏蔽 BT 附带文件（通配符 `*`/`?`，扫描跳过 + 列表隐藏，只隐藏不删除）
- 日志面板默认展开、可拖动高度、状态持久化
- NFO + 封面随整理写入
- 封面默认完整显示；详情弹窗支持手动裁剪/恢复完整，裁剪区域持久化并随整理写入
- 桌面单 exe 打包脚本

## 已知坑

- `.d.ts` 会被 `.ts` 扩展名误判为 MPEG-TS；扫描与旧媒体库加载都已过滤。
- 扫描必须保持流式：`scan_folder` 发 `scan-progress` 事件、`/api/scan` 支持 `stream=true`；不要改回「扫完一次性返回」，否则大目录又变成无感知卡住。进度事件按 `scanId` 过滤，媒体库在扫描期间暂停落库。
- 文件名黑名单匹配有三份实现（`src/utils.ts`、`server/scan.ts`、`src-tauri/src/media.rs`），改规则必须三处同步：不区分大小写，含 `*`/`?` 时通配符整名匹配，否则按包含匹配。扫描请求必须带 `blacklist`，否则后端会重新扫回被拉黑的文件。
- 行 `uid` 必须使用 `stableUid(path)`（`src/utils.ts`）；`hashString` 只返回 0..5，仅用于海报渐变。误用会导致单行操作影响多行。
- AV / JavDB 默认**只认番号**：无番号时不按标题搜索；AI 回退也不接受纯标题。只有「手动匹配」允许按标题搜索（`allowTitle=true`）。
- 番号正则限制为「2–6 位字母 + 可选分隔 + 2–5 位数字」，并排除 `QQ/IMG/VID/DSC/...` 前缀，避免把录屏文件名误判成番号。
- JavDB 图片 CDN 可能返回 XOR 包装（首字节是 key）；**禁止直接 `<img src=远程>`**，必须经 `cover_cache` / `/api/cover` 解码后显示，否则只会看到破图。
- JavDB / DMM 的高清 `cover_url` / `pl.jpg` 是「封底 + 封面」拼接图，且不同片商拼法不固定；**不再自动裁剪**，默认完整显示。`thumb_url` / `ps.jpg` 是 147×200 的纯正面小图。
- 裁剪是可选的手动操作：详情弹窗「手动裁剪」→ 拖动选框 → 应用；裁剪区域以 `posterCrop` 保存到媒体库，并随整理写入封面。默认无裁剪时 `posterCrop` 为空。
- 封面通过后端下载并缓存到本地；完整封面缓存名是 `{hash}.{ext}`，手动裁剪缓存名是 `{hash}-crop-x-y-w-h.{ext}`。整理时写入封面同样要经过 `decodeCover` / `decode_image`，有 `posterCrop` 时再调用 `cropImage` / `crop_image`。
- `preview_images` 是剧照（常为空），`preview_video_url` 是 HLS 预告；都不是封面。
- ffprobe 未安装时非 MP4/MOV 时长为空；`0` 不显示为短片。
- JavDB 签名常量对应 App 1.9.28，升级后需更新 `server/javdb.ts` 与 `src-tauri/src/javdb.rs`。
- JavDB 动态域名解密不稳定，固定镜像 + host 失败切换。
- OpenCode CLI 每次 `--standalone` 启动私有服务，单次约 3–10s；默认超时最少 90s。
- 打包版不启动 Bun 插件宿主；四个内置模式走 Rust 原生 provider，仍可用。
- 测试数据目录：`server/data/`（开发）与 `%APPDATA%\com.scraper.desktop\`（打包版）。

## 继续开发流程

1. 先读 `docs/AI_HANDOFF.md` 与当前契约文档。
2. 明确改动属于前端 / Bun / Rust 哪几层，保持三端一致。
3. 小步修改并立即验证：`npx tsc --noEmit`、Bun 构建、`cargo test --lib`。
4. 涉及 UI 时用 `npm run dev` 起服务，手工或浏览器验证关键路径。
5. 完成后更新 `docs/ROADMAP.md` 的完成项与 `docs/AI_HANDOFF.md` 的状态。
6. 交付桌面：`npm run pack:desktop`，只复制单个 exe。

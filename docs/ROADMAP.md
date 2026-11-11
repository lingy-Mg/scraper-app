# 路线图与待办

> 状态日期：2026-11-11。完成后请勾选并补充验证方式。

## 已完成

- [x] 目录扫描（递归/隐藏目录/符号链接/`.d.ts` 过滤）
- [x] MP4 `moov/mvhd` 时长解析 + ffprobe 可选
- [x] 整理（移动/复制/冲突策略/跨卷/空目录清理）
- [x] 回收站删除
- [x] JavDB App API（签名、搜索、详情、演员、封面、磁力数据）
- [x] TMDB 电影/电视剧（v3 Key / v4 Token）
- [x] Bangumi 动漫（匿名 / Token）
- [x] AI：OpenAI 兼容 + OpenCode CLI + JSON 重试 + 正则回退
- [x] SQLite 媒体库（Bun），模式恢复
- [x] 短片默认隐藏、阈值可调、清理弹窗文件列表与勾选
- [x] 日志面板默认展开、拖动高度、持久化
- [x] 整理写 NFO + 封面
- [x] 磁力面板（详情弹窗展示 + 复制）；上游 JavDB 需登录，已支持令牌
- [x] AGENTS.md / AI_HANDOFF / 契约文档

## 待办（按优先级）

### P1 磁力面板（已完成）

- [x] 数据来源：`POST /api/plugins/javdb/resolve` 返回 `magnets[]`（插件转 camelCase：`name/hash/size/cnsub/hd/filesCount/pikpakUrl`）
- [x] `PosterModal` 增加「磁力」区块，显示名称/大小/中文字幕/高清/文件数
- [x] 单条复制与「复制全部」，链接格式 `magnet:?xt=urn:btih:<hash>&dn=<encodeURIComponent(name)>`
- [x] 剪贴板不可用时降级为只读文本框手动复制
- [x] 无数据显示「暂无磁力数据」；鉴权失败显示「请填写访问令牌」提示
- [x] 上游 JavDB 需登录，已支持令牌（插件设置 → 访问令牌；详见下方 2026-11-11 记录）
- 注意：只做元数据展示与复制，不内置下载器、不调用下载接口

### P2 预告片与字幕（已完成）

- [x] TMDB resolve 请求 `/movie/{id}/videos` / `/tv/{id}/videos`，只取 YouTube，优先官方 Trailer → Trailer → 官方 Teaser → Teaser；返回 `trailerUrl` / `trailerSite`。请求失败只写 warning，不影响详情。
- [x] Bangumi / JavDB 无统一预告片字段：不返回、不报错。
- [x] 本地字幕匹配 `POST /api/subtitles/find`：同目录 + 一层 `Subs` / `subs` / `字幕`；支持同名与语言后缀（`.zh.srt` / `.chs.ass` / `.en.vtt` 等），拒绝相对路径。
- [x] 详情弹窗：有 `trailerUrl` 时显示「预告片」按钮（新窗口，不内嵌播放器）；显示匹配字幕文件名 + 语言 + 格式；失败只提示。
- [x] 整理按模式 `downloads` 生效：字幕开启时复制到目标视频旁（保留语言后缀、遵守冲突策略、只复制不删除）；字幕关闭不复制。
- [x] NFO/封面开关关闭时不写对应 sidecar；预告片开启且 item 带 `trailerUrl` 时写 NFO `<trailer>`，不下载视频；背景图开启只写一条 warning。
- 验证：`bun test`（57 用例，含字幕匹配与 TMDB 预告片 mock）、`bun run smoke`（8 项，含字幕开关与源文件保留）、`bun run check`。
- 未覆盖 / 后续：OpenSubtitles 等在线字幕源；字幕编码转换/内容校验；多语言字幕优先级选择；背景图真实写入；JavDB `preview_video_url`（HLS）未作为预告片。

### P3 插件宿主增强（B/S 单端）

- 已完成：插件打包加载、目录内任意文件热重载、用户插件目录覆盖、单插件错误隔离
- 计划：插件调用超时与失败重试；`plugin.json` / `defaults` 配置校验；插件依赖版本检查
- 验收：单个插件崩溃不影响 API；错误在模式栏可见
- ~~打包版插件宿主~~ **已废弃**：项目已改为纯 B/S 单端，插件宿主只随 Bun 单进程运行，不再生成 exe/安装包。

### P4 媒体库增强（已完成）

- [x] 多目录来源管理：`Settings.sources` 持久化；`GET/POST/DELETE /api/sources`；扫描成功后自动登记扫描根；删除只删记录，不删媒体库与文件
- [x] 全局搜索与筛选：`GET /api/library/query` 支持 `q`（title/code/file/actors/maker/series）、`mode`、`maker`、`actor`、`tag`、`status`、排序与分页
- [x] 重复文件检测：`GET /api/library/duplicates`，同番号优先，其次同 size + 同 dur；一条记录只进入一个分组
- [x] 统计页：`GET /api/library/stats`，总数/总大小/按模式/按状态/Top 片商/演员/标签
- [x] 前端 `LibraryModal`：列表、重复、统计、来源四个标签页；所有请求经 `src/native.ts`
- 验证：`bun test`（73 用例）、`bun run smoke`（10 项）、`bun run check`；真实库只读查询总数 127 保持不变
- 未覆盖 / 后续：成功率/耗时统计（当前媒体库未记录开始/结束时间与失败原因）；重复项一键清理；来源目录同步扫描状态

### P5 自动化测试（基础部分已完成）

- [x] Bun 单元测试（`test/`，6 个文件 42 个用例，全部用 `mkdtemp` + `SCRAPER_DATA_DIR` 隔离）
  - 扫描：黑名单大小写/`*`/`?`/包含匹配、隐藏目录/符号链接/`.d.ts`/非视频过滤、MP4 时长、短片判定（`dur=0` 不算）
  - 整理：`../` 与绝对路径越界拒绝、rename/skip/overwrite、move/copy、NFO 写入、空源目录清理、单项失败隔离
  - 媒体库：upsert/list 字段往返、重复 upsert 不产生重复行、remove、按模式 clear、全量 clear
  - 插件：内置加载、`capabilities` 默认值、用户同 id 覆盖、坏插件 error 隔离、reload 生效、缓存只保留最新 2 个
  - 文件浏览：相对/不存在/非目录 400、隐藏目录标记、父目录
  - JavDB：有/无令牌的 `authorization: Bearer` 请求头、鉴权错误中文化、配置脱敏（mock fetch，不联网）
- [x] HTTP 端到端冒烟（`scripts/smoke.mjs`）：随机端口 + 临时数据目录，覆盖扫描（含 NDJSON 流）→ 探测 → 媒体库 → 整理 + NFO → 回收站
- [x] 一键自检（`bun run check`）：`tsc --noEmit` → `bun build` → `bun test` → `npm run build`
- [x] 浏览器端到端（`npm run e2e`，Playwright + Chromium，8 个用例）
  - 隔离：固定端口 5180、`SCRAPER_DATA_DIR=.tmp/e2e-data`（每次运行前清空）、测试媒体 `.tmp/e2e-media`；不触碰真实 `data/`
  - 已覆盖：首页无 console/pageerror、目录选择器（盘符/手动跳转/取消）、媒体库四标签空态、主题切换与刷新持久化、
    列显隐持久化（操作/选择列不可隐藏）、扫描链路与进度条（黑名单/非视频/子目录）、刮削队列暂停/继续/取消
    （`page.route` 返回假候选，验证暂停不派发、取消中断在途请求且已完成行保留）
  - 未覆盖：整理弹窗与 NFO/封面写入、候选选择与 AI 回退、磁力面板、设置导入导出、文件名黑名单 UI、列宽拖动
- [ ] 真实网络：JavDB / TMDB / Bangumi / OpenCode CLI（当前全部 mock 或离线）
- 验收：`bun test`、`bun run smoke`、`bun run check`、`npm run e2e` 均退出码 0

### P6 体验

- [x] 深色主题：浅色/深色/跟随系统，`Settings.theme` 持久化；CSS 变量适配日志、表格、弹窗、滚动条
- [x] 表格列宽可调/列显隐：拖动表头调宽、双击恢复默认；`Settings.table.widths/hidden` 持久化，操作/选择列不可隐藏
- [x] 批量刮削 / 整理任务队列：`src/taskQueue.ts` 并发 3（整理逐条、并发 2），支持暂停 / 继续 / 取消；刮削与整理请求携带 `AbortSignal`，取消会真正中断在途 HTTP 请求，已完成结果与媒体库记录不回滚，未开始行恢复待处理
- [x] 任务状态可见：任务控制条显示「已完成/总数（失败 N）」与暂停 / 继续 / 取消；整理弹窗额外展示失败/取消计数
- [x] 设置导入导出：`GET /api/settings/export`（默认脱敏，`includeSecrets=1` 才含密钥）与 `POST /api/settings/import`（严格校验、400 不落盘）；插件 `data/config.json` 不参与
- 验证：`bun test`（92 用例，含任务队列 10 例）、`bun run smoke`（12 项）、`bun run check`（4/4）；真实库只读查询总数 127 保持不变

## 不建议做

- 内置影片下载器 / 磁力下载器（只做元数据与整理）
- 把真实 API Key、Cookie、JavDB Token 写入仓库或日志
- 为通过审核而弱化安全边界（路径校验/回收站/密钥）

## 2026-11-11 封面裁剪调整

- [x] 撤销自动右半裁剪，封面默认完整显示
- [x] 详情弹窗新增「手动裁剪」：拖动/缩放选框后应用
- [x] `posterCrop` 持久化到 SQLite，并随整理写入同名封面
- [x] 支持「恢复完整」清除手动裁剪

## 2026-11-11 扫描进度可见性

- [x] 扫描拆成 `walk`（枚举路径）→ `probe`（读时长）两阶段，边扫边推送
- [x] Bun：`/api/scan` 支持 NDJSON 流
- [x] 前端新增 `ScanProgressBar`：不确定进度动画 + `done/total` 百分比 + 当前文件 + 用时/预计剩余
- [x] 表格按批增量渲染；空表显示扫描动画；扫描期间禁用选择/整理/刮削并暂停媒体库落库
- 验证：`npx tsc --noEmit`、`bun build server/index.ts`；大目录扫描时进度条与行数实时增长

## 2026-11-11 B/S 单端架构改造

- [x] 删除 `src-tauri/`、Tauri 依赖与打包脚本，移除桌面窗口控制
- [x] `src/native.ts` 只保留同源 HTTP 通道（`native.mode === 'http'`）
- [x] 新增 `/api/fs/roots`、`/api/fs/list` 与网页内目录选择弹窗，不再调用系统对话框
- [x] 回收站改为单 PowerShell 进程批量删除（`SHFileOperation` + 逐条回退）
- [x] Bun 单进程托管 `dist/` + API + 插件，新增 `npm run start`
- [x] 契约文档、AGENTS、AI_HANDOFF 同步为 B/S 单端
- 验证：`npx tsc --noEmit`、`bun build server/index.ts`、`npm run build`；20 个文件批量删除 0.69s，`removed=20`

## 2026-11-11 刮削源插件化

- [x] 通用插件接口：`POST /api/plugins/:id/{identify,resolve}`、`GET /api/plugins` 返回 `capabilities/status/error/source`
- [x] `Bun.build` 打包加载：`data/.plugin-cache/<id>-<source>-<hash>.mjs`，改目录内任意 `.ts` 后 reload 生效
- [x] JavDB 实现移入 `server/plugins/javdb/javdb-api.ts`，删除 `/api/javdb/*` 路由
- [x] TMDB / Bangumi 移入 `_shared/tmdb.ts` 与 `anime/bangumi.ts`，删除 `/api/tmdb/*`、`/api/bangumi/*`
- [x] AI 作为共享服务经 `ctx.ai` 注入插件，`/api/ai/*` 保留
- [x] `src/native.ts` 刮削方法统一改走 `/api/plugins/:id/{identify,resolve}`（签名不变）
- [x] 用户插件目录 `data/plugins/`，同 id 覆盖内置，缺失时静默跳过
- [x] 新增 `docs/plugin-contract.md` 并同步接口文档
- 验证：`npx tsc --noEmit`、`bun build server/index.ts`；`GET /api/plugins` 5 个插件；旧路由 404；修改非入口文件后 reload 生效

## 2026-11-11 JavDB 登录与磁力面板

- [x] 上游四个镜像要求登录（`JWTVerificationError: 請登錄帳號`）；不做任何绕过
- [x] JavDB / AV 插件设置新增可选「访问令牌」：有值时发送 `authorization: Bearer <token>`，空值匿名
- [x] 令牌只保存在 `data/config.json`，接口回显脱敏，不写日志
- [x] 鉴权失败返回可操作中文提示（区分「未填写」与「已失效」）
- [x] 详情弹窗磁力列表：名称 tooltip、大小、中文字幕、高清、文件数；单条复制 / 复制全部
- [x] 复制失败降级只读文本框；无数据与鉴权失败状态分开
- [x] `.plugin-cache` 每插件保留最新 2 个打包产物，当前使用中的文件不删除
- 验证：`npx tsc --noEmit`、`bun build server/index.ts`、`npm run build`；mock fetch 验证 Bearer 请求头与提示文案；临时 mock resolve 返回磁力并经组件 SSR 渲染；重启后缓存 36 → 12 个文件

## 2026-11-11 文件名黑名单

- [x] `Settings.blacklist` 持久化；不区分大小写，`*`/`?` 通配符，无通配符按包含匹配
- [x] 扫描时在枚举阶段跳过命中文件（Bun 后端），不探测、不计数、不入库
- [x] 前端对已加载的命中行整行隐藏，并从计数/刮削/整理/清理中排除
- [x] 右键「拉黑此文件名」+ `文件 → 文件名黑名单…` 管理弹窗 + 筛选栏入口
- [x] 只隐藏不删除文件；下次 replace 扫描顺带清理媒体库旧记录

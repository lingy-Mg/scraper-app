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

### P2 预告片与字幕

- TMDB `/movie/{id}/videos`、Bangumi 无预告片
- 字幕需要 OpenSubtitles 或本地字幕目录扫描（先做本地匹配）
- 验收：模式配置里的「预告片/字幕」开关真正生效；失败写 warning

### P3 插件宿主增强（B/S 单端）

- 已完成：插件打包加载、目录内任意文件热重载、用户插件目录覆盖、单插件错误隔离
- 计划：插件调用超时与失败重试；`plugin.json` / `defaults` 配置校验；插件依赖版本检查
- 验收：单个插件崩溃不影响 API；错误在模式栏可见

### P4 媒体库增强

- 多目录来源管理（当前只记录 lastFolder）
- 全局搜索、按演员/片商/标签筛选
- 重复文件检测（同 size + 时长 + 番号）
- 统计页（数量/大小/成功率/耗时）

### P5 自动化测试

- Bun：扫描/整理/媒体库/AI 解析的单元测试
- UI：Playwright 或浏览器脚本覆盖扫描→刮削→整理→重载
- 验收：CI 可跑 `tsc --noEmit` + `bun build server/index.ts` + `vite build`

### P6 体验

- 深色主题
- 表格列宽可调/列显隐
- 任务队列暂停/取消
- 设置导入导出

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
- [x] `Bun.build` 打包加载：`server/data/.plugin-cache/<id>-<source>-<hash>.mjs`，改目录内任意 `.ts` 后 reload 生效
- [x] JavDB 实现移入 `server/plugins/javdb/javdb-api.ts`，删除 `/api/javdb/*` 路由
- [x] TMDB / Bangumi 移入 `_shared/tmdb.ts` 与 `anime/bangumi.ts`，删除 `/api/tmdb/*`、`/api/bangumi/*`
- [x] AI 作为共享服务经 `ctx.ai` 注入插件，`/api/ai/*` 保留
- [x] `src/native.ts` 刮削方法统一改走 `/api/plugins/:id/{identify,resolve}`（签名不变）
- [x] 用户插件目录 `server/data/plugins/`，同 id 覆盖内置，缺失时静默跳过
- [x] 新增 `docs/plugin-contract.md` 并同步接口文档
- 验证：`npx tsc --noEmit`、`bun build server/index.ts`；`GET /api/plugins` 5 个插件；旧路由 404；修改非入口文件后 reload 生效

## 2026-11-11 JavDB 登录与磁力面板

- [x] 上游四个镜像要求登录（`JWTVerificationError: 請登錄帳號`）；不做任何绕过
- [x] JavDB / AV 插件设置新增可选「访问令牌」：有值时发送 `authorization: Bearer <token>`，空值匿名
- [x] 令牌只保存在 `server/data/config.json`，接口回显脱敏，不写日志
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

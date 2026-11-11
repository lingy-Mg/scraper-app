# 路线图与待办

> 状态日期：2026-11-10。完成后请勾选并补充验证方式。

## 已完成

- [x] 目录扫描（递归/隐藏目录/符号链接/`.d.ts` 过滤）
- [x] MP4 `moov/mvhd` 时长解析 + ffprobe 可选
- [x] 整理（移动/复制/冲突策略/跨卷/空目录清理）
- [x] 回收站删除
- [x] JavDB App API（签名、搜索、详情、演员、封面、磁力数据）
- [x] TMDB 电影/电视剧（v3 Key / v4 Token）
- [x] Bangumi 动漫（匿名 / Token）
- [x] AI：OpenAI 兼容 + OpenCode CLI + JSON 重试 + 正则回退
- [x] SQLite 媒体库（Bun + Rust），模式恢复
- [x] 短片默认隐藏、阈值可调、清理弹窗文件列表与勾选
- [x] 日志面板默认展开、拖动高度、持久化
- [x] 整理写 NFO + 封面
- [x] 单 exe 桌面打包（`npm run pack:desktop`）
- [x] AGENTS.md / AI_HANDOFF / 契约文档

## 待办（按优先级）

### P1 磁力面板

- 数据已具备：`javdb_detail` 返回 `magnets[]`（`name/hash/size/cnsub/hd/files_count/pikpak_url`）
- 计划：PosterModal 增加「磁力」区块，显示大小/字幕/高清标记与复制磁力链接
- 验收：打开详情能加载磁力列表；复制按钮可用；失败有提示
- 注意：只做元数据展示与复制，不内置下载器

### P2 预告片与字幕

- TMDB `/movie/{id}/videos`、Bangumi 无预告片
- 字幕需要 OpenSubtitles 或本地字幕目录扫描（先做本地匹配）
- 验收：模式配置里的「预告片/字幕」开关真正生效；失败写 warning

### P3 打包版插件宿主

- 目标：自定义插件在安装后的 exe 中也可用
- 方案：`bun build --compile server/index.ts` → `src-tauri/binaries/`，Tauri sidecar 启动并注入端口/token
- 验收：打包版模式栏显示「插件」；插件热重载可用

### P4 媒体库增强

- 多目录来源管理（当前只记录 lastFolder）
- 全局搜索、按演员/片商/标签筛选
- 重复文件检测（同 size + 时长 + 番号）
- 统计页（数量/大小/成功率/耗时）

### P5 自动化测试

- Bun：扫描/整理/媒体库/AI 解析的单元测试
- Rust：providers/library/javdb 已有单测，补 organize 边界
- UI：Playwright 或浏览器脚本覆盖扫描→刮削→整理→重载
- 验收：CI 可跑 tsc + cargo test + bun build

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
- [x] Tauri：`scan_folder` 推送 `scan-progress` 事件；Bun：`/api/scan` 支持 NDJSON 流
- [x] 前端新增 `ScanProgressBar`：不确定进度动画 + `done/total` 百分比 + 当前文件 + 用时/预计剩余
- [x] 表格按批增量渲染；空表显示扫描动画；扫描期间禁用选择/整理/刮削并暂停媒体库落库
- 验证：`npx tsc --noEmit`、`bun build`、`cargo check`；大目录扫描时进度条与行数实时增长

## 2026-11-11 文件名黑名单

- [x] `Settings.blacklist` 持久化；不区分大小写，`*`/`?` 通配符，无通配符按包含匹配
- [x] 扫描时在枚举阶段跳过命中文件（Tauri/Bun 双后端），不探测、不计数、不入库
- [x] 前端对已加载的命中行整行隐藏，并从计数/刮削/整理/清理中排除
- [x] 右键「拉黑此文件名」+ `文件 → 文件名黑名单…` 管理弹窗 + 筛选栏入口
- [x] 只隐藏不删除文件；下次 replace 扫描顺带清理媒体库旧记录

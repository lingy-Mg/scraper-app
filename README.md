# 刮削器 · Scraper App

> 一个跑在自己电脑上的影片元数据刮削与媒体库管理工具。扫描本地目录，自动识别番号 / 片名，抓取封面、演员、简介，整理成 Emby / Jellyfin / Kodi 能直接识别的结构。

**纯 B/S 单端**：一条命令启动 Bun 进程，它同时提供 API、插件运行时和前端页面，浏览器打开 `http://127.0.0.1:5174` 就能用。不需要安装客户端，不需要打包 exe，数据全部留在本机项目目录里。

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Ant Design](https://img.shields.io/badge/Ant%20Design-5-1677ff?logo=antdesign&logoColor=white)](https://ant.design)
[![Bun](https://img.shields.io/badge/Bun-1.3-fbf0df?logo=bun&logoColor=black)](https://bun.sh)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 它能做什么

| | |
|---|---|
| **扫描** | 递归遍历目录，跳过隐藏目录、符号链接、非视频文件；两阶段进度（遍历 → 探测），大目录也不会看起来卡死 |
| **识别** | JavDB / TMDB / Bangumi 三个内置刮削源，按番号或片名精确匹配；匹配不到时可由 AI 兜底 |
| **选择** | 多候选进入「待选择」，可让 AI 按置信度自动挑选，也可以手动匹配、按标题搜索 |
| **整理** | 移动 / 复制到目标目录，按模板重命名，写入 NFO + 封面，冲突可选跳过 / 覆盖 / 自动重命名 |
| **媒体库** | SQLite 持久化，重启恢复；支持来源管理、重复检测、按模式分别统计与清空 |
| **清理** | 短片（疑似广告）默认隐藏，可一键批量移入系统回收站 —— 只进回收站，永不永久删除 |

## 界面

- 数据表格：列宽 / 列显隐 / 紧凑密度可调，状态、封面、番号、片商、演员、时长、评分一屏可见
- 详情弹窗：完整封面、简介、磁力列表；封面支持手动框选裁剪，裁剪区域会随整理一起写入
- 日志面板：默认展开、可拖动高度，实时显示扫描与整理进度
- 网页内目录选择器：直接在页面里浏览磁盘真实路径，不弹系统对话框
- 深浅色主题跟随系统，可手动切换

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | React 18 · Vite 5 · TypeScript · Ant Design 5 |
| 后端 | Bun（`Bun.serve`、`bun:sqlite`、`Bun.build`），单进程托管 `dist/` 与 API |
| 数据 | SQLite 媒体库 + 项目内 `data/` 目录（设置、封面缓存、插件配置） |
| 测试 | `bun test` 单元测试 · HTTP 冒烟 · Playwright 浏览器端到端 |

选 Ant Design 的理由很实际：这个应用的核心是表格、弹窗、下拉、多选、紧凑密度和状态反馈，AntD 在这几件事上最省事，`ConfigProvider` + `zh_CN` + `compactAlgorithm` 一行就能切中文和紧凑布局。

## 快速开始

环境要求：**Bun 1.3+**、**Node 20+**（仅构建与脚本使用）、Windows 10/11。

```bash
git clone https://github.com/lingy-Mg/scraper-app.git
cd scraper-app

npm install
npm run dev      # 开发：Bun API(5174) + Vite(5173)，改代码热更

npm run build    # 类型检查 + 生产构建 → dist/
npm run start    # 生产：单进程托管 dist + API，并打开浏览器
```

`npm run start` 只监听 `127.0.0.1`，不对外暴露。生产模式不需要 Node 的 dev server，Bun 一个进程就是完整应用。

> 第一次打开是空列表：先点「选择文件夹」添加媒体来源，再执行扫描。

### 常用命令

```bash
npm run dev:server   # 只启动 Bun 服务
npm run dev:ui       # 只启动前端
bun test             # 单元测试（临时目录隔离、不联网）
bun run smoke        # HTTP 端到端冒烟
bun run check        # 一键自检：tsc → bun build → bun test → vite build
npm run e2e          # Playwright 浏览器端到端（首次需 npx playwright install chromium）
```

## 使用流程

```text
选择目录 → 扫描（walk / probe）→ 识别（JavDB / TMDB / Bangumi）
        → 插件或 AI 兜底 → 候选选择 → 写入媒体库
        → 预览整理结果 → 移动 + 重命名 + NFO / 封面
```

1. **添加来源**：网页内目录选择器浏览并添加扫描根目录。
2. **扫描**：实时增量显示文件，边扫描边显示进度。
3. **刮削**：按当前模式（插件）识别；单个文件失败不会中断整批，可单独重试。
4. **核对**：多候选进入待选择，详情弹窗可查看封面、简介、磁力，必要时手动匹配。
5. **整理**：先预览目标路径，确认后执行；每一步都有日志，失败会写明原因。
6. **清理**：短片批量移入回收站。

## 配置

所有设置都在页面里改，落盘到 `data/settings.json`：

- **TMDB**：填 v3 API Key 或 v4 Token（电影 / 电视剧）
- **Bangumi**：Token 可选，只影响限额（动漫）
- **JavDB**：需要用户自己在插件设置里填 Token，程序不内置账号
- **AI**：OpenAI 兼容接口（DeepSeek / OpenAI / 通义千问 / Ollama / OpenCode API），也支持直接调用本机 `opencode` CLI，无需 API Key

密钥只保存在本机 `data/settings.json`，不会写日志、不会进仓库；界面按密码框显示，导出设置时自动脱敏。

## 数据目录

运行时数据**只写项目根目录的 `data/`**，不会写入 `%APPDATA%` 或任何用户目录：

```text
data/
├─ settings.json     # 设置与密钥
├─ library.db        # SQLite 媒体库
├─ covers/           # 封面缓存
├─ plugins/<id>/     # 用户插件（同 id 覆盖内置）
└─ .plugin-cache/    # 插件热重载的打包缓存
```

`data/` 已在 `.gitignore` 中。测试通过 `SCRAPER_DATA_DIR` 注入临时目录，不会碰真实数据。

## 目录结构

```text
scraper-app/
├─ src/                  # 前端：表格、弹窗、任务队列、HTTP 桥接
│  ├─ native.ts          # 唯一后端通道（同源 HTTP）
│  └─ components/
├─ server/               # Bun 单进程后端
│  ├─ index.ts           # HTTP 路由 + 静态托管 + SPA fallback
│  ├─ scan.ts            # 扫描 / ffprobe / 时长解析
│  ├─ files.ts           # 整理 / NFO / 封面 / 回收站
│  ├─ library.ts         # SQLite 媒体库
│  ├─ registry.ts        # 插件发现 / 热重载 / 配置
│  ├─ ai.ts              # AI 识别与回退
│  └─ plugins/
│     ├─ _shared/        # 共享类型与插件骨架
│     ├─ av/ javdb/      # AV 模式（JavDB App API）
│     └─ movie/ tv/ anime/
├─ scripts/              # dev / start / check / smoke
├─ test/  e2e/           # 单元测试 + Playwright
├─ docs/                 # 契约、架构、交接文档
└─ data/                 # 运行时数据（gitignore）
```

## 插件系统

**模式即插件**。新增一个刮削站 = 新增一个插件目录，不改主程序。

```text
server/plugins/<id>/
├─ plugin.json     # manifest：id / name / version / apiVersion / labels / defaults
└─ index.ts        # export default { identify(ctx), resolve(ctx) }
```

```ts
export default {
  async identify({ filename, code, config }) {
    // 返回 Candidate[]：{ id, title, code, posterUrl, ... }
  },
  async resolve({ id, config }) {
    // 返回详情：演员、简介、磁力等
  }
}
```

- 通过 `GET /api/plugins` 动态注册，前端模式切换器完全由插件列表生成
- `fs.watch` 监听目录，改完插件自动热重载（经 `Bun.build` 打包后重新 import，传递依赖同样失效）
- 插件可自带设置页，托管在 `/plugins/<id>/settings/`，宿主用 iframe 嵌入
- 单个插件抛错不影响进程
- 用户插件放 `data/plugins/<id>/`，同 id 覆盖内置版本

完整契约见 [docs/plugin-contract.md](docs/plugin-contract.md)。

## 测试

```bash
bun test          # 92 个单元测试：扫描、整理、媒体库、设置、插件
bun run smoke     # 随机端口 + 临时数据目录，真实 HTTP 链路
npm run e2e       # Playwright：启动 → 扫描 → 队列暂停/取消
```

约束：单元与冒烟测试必须使用 `mkdtemp` 临时目录（`SCRAPER_DATA_DIR`），e2e 使用项目内 `.tmp/`，不联网、不读写真实 `data/`。

## 已知限制

- **回收站删除目前仅 Windows**：走 `SHFileOperation`，单 PowerShell 进程批量处理；扫描 / 整理 / 刮削跨平台可用
- **ffprobe 可选**：未安装时 MP4/MOV 用内置 `moov/mvhd` 解析，其他容器时长为空；把 `ffprobe` 放进 PATH 即可启用
- **JavDB 接口随时可能变化**：内置插件使用对方 App 的公开接口，签名与字段可能随版本调整；需要用户自备 Token，程序不做任何绕过
- **TMDB / Bangumi 需要自备凭据**，未填时会明确提示而非静默失败
- **未实现**：磁力下载、预告片 / 字幕自动下载、跨设备同步

## 免责声明

本项目仅用于整理**你自己合法拥有**的媒体文件的元数据与文件结构。

- 刮削数据（简介、封面、评分等）版权归各来源站点所有，本项目仅做本地缓存与展示
- 请遵守目标站点的服务条款与当地法律法规，不要用于批量抓取、二次分发或任何商业用途
- 作者不对使用本项目造成的任何后果负责

## 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 给 AI / 开发者的入口：命令、架构、硬性约束、已知坑 |
| [docs/architecture.md](docs/architecture.md) | 完整架构设计 |
| [docs/plugin-contract.md](docs/plugin-contract.md) | 插件契约 |
| [docs/bridge-contract.md](docs/bridge-contract.md) | 前端 ↔ Bun 接口契约 |
| [docs/providers-library-contract.md](docs/providers-library-contract.md) | 数据源与媒体库字段契约 |
| [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) | 交接状态 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 路线图与待办 |

## License

[MIT](LICENSE)

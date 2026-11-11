# 刮削器（Scraper App）

本地影片刮削器的桌面化前端原型，使用 **Vite + React 18 + TypeScript + Ant Design 5**。

## 为什么选 Ant Design

这个项目的界面核心是数据表格、弹窗、菜单、下拉、多选、紧凑密度和状态反馈，AntD 在这些方面最成熟：

- `Table` 自带排序、行选择、固定列、虚拟滚动（配合 `scroll.y`）
- `Modal` / `Menu` / `Select` / `InputNumber` / `Checkbox.Group` 开箱即用
- `ConfigProvider` + `zh_CN` + `compactAlgorithm` 一行切换中文和紧凑密度
- 中文文档完善，后续接 Tauri 时不需要换框架

## 启动

```bash
npm install
npm run dev          # Bun 插件宿主 + Vite 前端（HTTP 模式）
npm run dev:tauri    # Tauri 桌面窗口（原生模式，自动拉起 Bun + Vite）
npm run dev:server   # 只启动插件宿主 http://127.0.0.1:5174
npm run dev:ui       # 只启动前端 http://127.0.0.1:5173
npm run build        # 类型检查 + 生产构建
npm run pack:desktop # release 构建并复制单个 exe 到桌面
```

> `npm run dev` 会同时拉起 `bun --watch server/index.ts` 和 Vite。
> 单独启动前端时，插件宿主不可用，会自动回退到内置模式。
> 生产构建的桌面应用直接使用 Tauri 原生命令，不依赖 Bun 进程。

## 目录

```
scraper-app/
├─ src/                     # 前端宿主
│  ├─ App.tsx
│  ├─ api.ts                # 插件宿主 API 客户端
│  ├─ theme.ts
│  ├─ styles.css
│  └─ components/
│     ├─ TitleBar / MenuBar / Toolbar / ModeBar
│     ├─ FilterBar / FileTable / StatusBar / LogPanel
│     ├─ PluginSettingsModal # iframe 嵌入插件设置页
│     └─ OrganizeModal / ConfigModal / AIConfigModal / CandidateModal
├─ server/                  # Bun 插件宿主
│  ├─ index.ts              # HTTP + WS + 静态资源
│  ├─ registry.ts           # 插件发现 / 热重载 / 配置持久化
│  ├─ javdb.ts              # JavDB App API 客户端（签名/搜索/详情/磁力）
│  ├─ library.ts            # SQLite 媒体库
│  ├─ providers/
│  │  ├─ tmdb.ts            # 电影 / 电视剧
│  │  └─ bangumi.ts         # 动漫
│  └─ plugins/
│     ├─ av/{plugin.json,index.ts}
│     ├─ javdb/{plugin.json,index.ts}
│     ├─ movie/…  tv/…  anime/…
│     └─ _shared/{simple.ts,settings.html}
├─ docs/architecture.md     # 完整架构设计
└─ package.json
```

## 插件系统

模式 = 插件。每个插件声明 manifest、提供刮削脚本，并可自带设置页：

```json
{
  "id": "av",
  "name": "AV",
  "version": "1.0.0",
  "apiVersion": 1,
  "labels": { "code": "番号", "title": "标题" },
  "defaults": {
    "sources": [{ "label": "JavDB", "on": true }],
    "naming": "{片商}/{年份}/{番号} {标题}",
    "organize": "{片商}/{年份}/{番号} {标题}"
  }
}
```

```ts
// server/plugins/av/index.ts
export default {
  async identify({ filename }) {
    // 返回 Candidate[]
  }
}
```

- Bun 用 `import(...?v=timestamp)` 加载，`fs.watch` 监听目录，改完脚本自动重载
- 设置页由插件提供，Bun 托管在 `/plugins/<id>/settings/`，宿主用 iframe 嵌入
- 插件没有设置页时回退到 `_shared/settings.html`
- 前端通过 `GET /api/plugins` 动态生成模式切换器，不再写死 AV/电影/电视剧/动漫

设置页与宿主通过 `postMessage` 通信：

```text
plugin:ready  →  host:init(config)
plugin:saved  →  宿主刷新配置
plugin:close  →  关闭弹窗
```

完整设计见 [docs/architecture.md](docs/architecture.md)。

## 已实现（真实后端）

### 原生能力（Tauri / Rust）

- 目录扫描：递归、跳过隐藏目录、视频扩展名过滤、单文件探测
- 时长读取：MP4/MOV 直接解析 `moov/mvhd`（不依赖外部程序），其余交给 ffprobe；找不到 ffprobe 时自动降级
- 视频元数据：ffprobe 同时读取宽高与编码
- 文件整理：移动 / 复制、目标越界校验、`跳过 / 覆盖 / 自动重命名` 冲突策略、跨卷复制校验、清理空源目录
- 删除：系统回收站（`trash`），失败逐项返回原因
- 打开文件 / 在资源管理器中定位
- 窗口：自定义标题栏（拖动、双击最大化、最小化、最大化、关闭）
- 设置持久化：`%APPDATA%/com.scraper.desktop/settings.json`，原子写入
- AI 代理：`reqwest` 直连 OpenAI 兼容接口，Key 只在本机，不经浏览器

### 刮削流程

- **JavDB App API**：真实番号搜索、详情、演员、片商、评分、封面、时长、磁力；AV / JavDB 两个模式共用同一客户端（`server/javdb.ts`）
- **AV 只按番号识别**：文件名没有番号时不做标题模糊搜索；手动匹配才允许标题搜索
- **TMDB**：电影 / 电视剧搜索、详情、演员、片商、类型、时长、评分、封面；支持 v3 Key 与 v4 Token
- **Bangumi**：动漫搜索、详情、评分、标签、封面；支持可选 Token
- **SQLite 媒体库**：扫描/刮削结果自动入库，重启后恢复记录与模式，支持清空当前模式记录
- 精确匹配策略：番号大小写/分隔符等价且唯一才采用，绝不回退到搜索首项
- 扫描 → 数据源（TMDB / Bangumi / JavDB）→ 插件 / AI 回退 → 单结果直接采用 → 多结果进入「待选择」→ AI 自动选择（阈值可调）→ 手动确认
- **短片默认隐藏**：小于「清理时长」阈值的视频默认不显示（疑似广告），筛选栏可一键显示/隐藏；时长为 0 的文件不会被误判为短片
- **清空列表 / 重新导入**：清空列表会清空全部媒体库记录并取消文件夹选择（不删文件）；重新导入会清空记录后重扫当前文件夹；重新选择文件夹会替换当前列表
- **扫描过滤**：跳过隐藏目录、符号链接、非视频文件与 TypeScript 声明文件（`.d.ts`）
- 海报：列表缩略图、候选列表、详情弹窗都显示真实封面，加载失败回退渐变占位
- NFO：整理时按 Emby/Jellyfin/Kodi 兼容格式写入同名 `.nfo`，封面写入同名图片（自动解 XOR；默认保存完整封面，需要时可在详情弹窗手动裁剪）
- 「无法刮削」独立筛选，行内「AI 识别」、右键「重新刮削 / 手动匹配」
- 短片检测与批量清理（回收站语义）；清理弹窗会列出文件、时长与大小，可全选或单选后清理
- 日志面板默认展开，可拖动上边缘调整高度，展开状态与高度会持久化
- 整理前预览、整理后逐项日志与失败原因
- 状态栏显示真实任务状态、视频数、大小、ffprobe 可用性

### AI

- DeepSeek / OpenAI 兼容 / 通义千问 / Ollama 本地 / **OpenCode API** / **OpenCode CLI** / 自定义
- **OpenCode API**：OpenCode Console / Go 的 OpenAI 兼容接口；Base URL 填 `https://opencode.ai/inference/go/openai/v1`（Go）或 `https://opencode.ai/inference/openai/v1`（余额），API Key 在 Console 创建
- **OpenCode CLI**：直接调用本机 `opencode run`，无需 API Key；模型填 `provider/model`（如 `opencode-go/deepseek-v4.1-flash`），使用本机已登录账号
- 测试连接走真实请求并显示延迟
- 识别测试显示真实耗时与「模型 / 本地正则回退」来源
- 模型返回 JSON 解析失败、超时、非 2xx 时按配置回退本地正则
- 多候选择优返回 `{pick, confidence, reason}`，低于阈值不替用户决定

### 双通道与降级

| 环境 | 走法 | 说明 |
|---|---|---|
| Tauri 桌面 | `invoke` 原生命令 | 全功能 |
| `npm run dev` 网页 | Bun `/api/*` | 除「选择文件夹」外全功能（浏览器无法弹原生目录框） |
| 纯静态打开 | 演示模式 | 显式横幅提示，原生操作不可用，不写设置 |

### 快捷键

`Ctrl+A` 全选、`Ctrl+M` 整理、`Delete` 删除、`F5` 重新扫描、`Esc` 关闭弹层。

## 已知边界

- **ffprobe 为可选依赖**：未安装时 MP4/MOV 用内置解析，其他容器时长为空。把 `ffprobe.exe` 放到 `src-tauri/binaries/` 或 PATH 即可启用。
- **TMDB 需要 API Key**：在「配置…」中填写 v3 Key 或 v4 Token；未填写时电影/电视剧会明确提示，不会静默失败。
- **Bangumi 可匿名**：Token 可选，只影响限额。
- **打包后不启动 Bun 插件宿主**：安装包使用「内置模式 + 原生 TMDB / Bangumi / JavDB + 原生 AI」，四个内置模式都能刮削；自定义插件模式请在 `npm run dev` 下使用，或后续把 Bun 编译为 sidecar 打进安装包。
- **JavDB 签名随 App 版本变化**：常量对应 App 1.9.28，失效时更新 `server/javdb.ts` 与 `src-tauri/src/javdb.rs` 即可。
- **未实现**：磁力链接下载、预告片/字幕下载、媒体库跨设备同步。
- **AI Key 仅本机**：保存在设置文件中，不会上传；界面上按密码框显示。

## 打包（单 exe）

```powershell
npm run pack:desktop
```

- 执行 `tauri build --no-bundle`，不生成 MSI/NSIS 安装包
- 只把 `src-tauri/target/release/app.exe` 复制为桌面的 `刮削器.exe`
- 需要 WebView2 Runtime（Win10 需安装，Win11 自带）
- OpenCode CLI 功能要求 `opencode` 在 PATH 中

## 接口契约

前端、Tauri、Bun 三方的字段与命令约定见 [docs/bridge-contract.md](docs/bridge-contract.md)，媒体库与 TMDB/Bangumi 的接口见 [docs/providers-library-contract.md](docs/providers-library-contract.md)。后续开发请看 [AGENTS.md](AGENTS.md) 与 [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md)。

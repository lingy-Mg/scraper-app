# JavDB App API 调研（开源实现 + 实测协议）

> 目标：给 `scraper-app` 的 AV 插件找一条**走官方 App JSON API** 的路径，而不是 HTML 抓取（无 Cloudflare 挑战、字段稳定、返回结构化 JSON）。
> 调研日期：2026-11-09；协议基于 JavDB App 1.9.28。

## 1. 最值得参考的开源项目

| 项目 | 语言 | 价值 | 许可 |
|---|---|---|---|
| [FlanChanXwO/javdb-cli](https://github.com/FlanChanXwO/javdb-cli) | Go | **首选**。完整实现 App API：签名、动态选线、搜索、详情、磁力、评论、排行、登录、反搜 | MIT |
| [ShotHeadman/mdcz](https://github.com/ShotHeadman/mdcz) | TypeScript/Electron | 技术栈最接近本项目（TS + 桌面），可参考 NFO/重命名/刮削流程 | 需确认 |
| [Solr159/JavBoss](https://github.com/Solr159/JavBoss) | Go | 完整媒体库刮削器，可参考数据模型与整理规则 | 需确认 |
| [TongWu/JAVDB_AutoSpider](https://github.com/TongWu/JAVDB_AutoSpider) | Python | 网页抓取向，参考字段解析 | 需确认 |
| [SiVeci/JavDB_magnet_Spider](https://github.com/SiVeci/JavDB_magnet_Spider) | Python | `curl_cffi` 过 Cloudflare 的网页方案（App API 不需要） | 需确认 |
| [javinfo/legacy](https://github.com/javinfo/legacy) | Python/FastAPI | 统一的 `/api` 服务形态，参考接口设计 | 已标记 Deprecated |
| [bdvajstudio/javdb](https://github.com/bdvajstudio/javdb) | — | 官方 App 仓库，只有 Release/AltStore 配置，**没有源码** | — |

结论：**只有 `javdb-cli` 把 App API 的签名与端点完整公开**，其余多是网页抓取。下面协议细节来自其源码 + 本机实测。

## 2. 协议要点（已实测可用）

### 2.1 Host

```
默认镜像: https://jdforrepam.com
主站:     https://javdb.com
启动候选: https://apidd.spthgb.com
          https://apidd.czssdgz.com
```

`GET /api/v1/startup` 会返回 `backup_domains_data`，AES-CBC 解密后含 `apiDomains` 动态域名。
实测该字段当前返回的 JSON 有损坏（`"apiDomains2:[...`），**不要强依赖动态域名**；固定镜像 + 失败切换即可。

### 2.2 签名

每个请求带 `jdsignature` 头，算法：

```
ts        = 当前 Unix 秒
prefix    = "71cf27bb...e3d8aa"   // 见 javdb-cli internal/javdb/protocol/signature/sign.go
suffix    = "lpw6vgqzsp"
jdsignature = `${ts}.${suffix}.${md5(ts + prefix)}`
```

其余请求头：

```
user-agent: Dart/3.4 (dart:io)
accept-language: en        // 或 zh-CN / zh-TW
authorization: Bearer <JWT>  // 可选；搜索/详情/磁力匿名可用
```

### 2.3 公共 query 参数（每个请求都带）

```
app_channel=official
app_version=1.9.28
app_version_number=10928
platform=android
system_version=13
device_model=Pixel 6
device_name=Pixel
device_uuid=<稳定 UUID，自己生成一次并持久化>
```

### 2.4 响应信封

```json
{ "success": 1, "action": "", "message": "", "data": { } }
```

`success` 为 `1/true` 才是成功；失败时 `action` 形如 `JWTVerificationError`、`LoginRequired` 等。

## 3. 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/v1/startup` | 启动配置、动态域名、用户信息 |
| GET | `/api/v2/search?q=&page=&limit=` | **按番号/关键词搜索** |
| GET | `/api/v4/movies/{id}` | 影片详情 |
| GET | `/api/v1/movies/{id}/magnets` | 磁力列表（匿名可用） |
| GET | `/api/v1/movies/{id}/reviews?page=&limit=` | 评论 |
| GET | `/api/v1/movies/tags?filter_by=&sort_by=&order_by=&page=&limit=` | 分类浏览 |
| GET | `/api/v2/tags?type=` | 标签目录（`type` 0/1/2/3） |
| POST | `/api/v1/sessions` | 登录（form: username/password）→ `token` |
| GET | `/api/v1/users` | 当前用户 |

搜索可选参数：

```
movie_type=0  有码 / 1 无码 / 2 欧美 / 3 FC2
movie_sort_by=<release_date|hit|score|...>
movie_filter_by=<p|m|c|s|i|v>
type=<movies|actors|series|codes|makers|directors|lists>
```

### 3.1 实测返回字段

`/api/v2/search` 的 `data`：

```
movies, current_page
movies[]: id, number, title, origin_title, thumb_url, cover_url, duration,
          magnets_count, can_play, has_preview_video, has_cnsub,
          has_preview_images, release_date, new_magnets, first_magnets, preview_images
```

`/api/v4/movies/{id}` 的 `data.movie`：

```
id, type, number, number_letter, title, origin_title, summary,
thumb_url, cover_url, has_cnsub, has_preview_images, duration, score,
reviews_count, comments_count, want_watch_count, watched_count, magnets_count,
has_preview_video, can_play, play_subtitle, play_sources, release_date,
top_rankings, maker_id, maker_name, director_id, director_name,
publisher_id, publisher_name, series_id, series_name, tags, actors,
review, preview_video_url, preview_images, relative_movies, actor_movies
```

`/api/v1/movies/{id}/magnets` 的 `data.magnets[]`：

```
name, hash, size, cnsub, hd, files_count, created_at, pikpak_url
```

磁力 URI：`magnet:?xt=urn:btih:<hash>`。

### 3.2 本机实测结果（2026-11-09）

```
STARTUP https://jdforrepam.com  200 success=1
SEARCH  /api/v2/search?q=SSIS-001  200 success=1  movies=3
DETAIL  /api/v4/movies/ZY5eq       200 success=1  (movie 字段齐全)
MAGNETS /api/v1/movies/ZY5eq/magnets 200 success=1  count=26
```

说明当前协议仍然有效，且**搜索/详情/磁力无需登录**。

## 4. 可直接用的最小 TypeScript 客户端

```ts
import { createHash } from 'node:crypto'

const PREFIX =
  '71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa'
const SUFFIX = 'lpw6vgqzsp'
const BASE = 'https://jdforrepam.com'

const DEVICE_UUID = 'your-stable-device-uuid'

function signature(ts = Math.floor(Date.now() / 1000)) {
  const md5 = createHash('md5').update(`${ts}${PREFIX}`).digest('hex')
  return `${ts}.${SUFFIX}.${md5}`
}

const PUBLIC = {
  app_channel: 'official',
  app_version: '1.9.28',
  app_version_number: '10928',
  platform: 'android',
  system_version: '13',
  device_model: 'Pixel 6',
  device_name: 'Pixel',
  device_uuid: DEVICE_UUID
}

async function api(path: string, params: Record<string, string> = {}, token?: string) {
  const qs = new URLSearchParams({ ...PUBLIC, ...params })
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: {
      'user-agent': 'Dart/3.4 (dart:io)',
      'accept-language': 'zh-CN',
      jdsignature: signature(),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    signal: AbortSignal.timeout(15000)
  })
  const body = (await res.json()) as { success: number | boolean; action?: string; message?: string; data?: any }
  if (!body.success) throw new Error(`${body.action || 'api'}: ${body.message || 'request failed'}`)
  return body.data
}

export async function search(keyword: string, page = 1, limit = 20) {
  const data = await api('/api/v2/search', { q: keyword, page: String(page), limit: String(limit) })
  return data.movies ?? []
}

export const detail = (id: string) => api(`/api/v4/movies/${id}`)
export const magnets = (id: string) => api(`/api/v1/movies/${id}/magnets`)
```

## 5. 映射到本项目的类型

| JavDB 字段 | 本项目 |
|---|---|
| `number` | `Row.code` / `Candidate.code` |
| `title` | `Row.title` / `Candidate.title` |
| `release_date.slice(0,4)` | `Row.year` / `Candidate.year` |
| `maker_name` | `Row.maker` |
| `actors[].name` | `Row.actors` |
| `cover_url` / `thumb_url` | `Row.posterUrl` / `Candidate.posterUrl`（列表、候选、详情弹窗均显示真实封面） |
| `duration`（**分钟**，API 原值） | `Row.dur`（本项目统一存秒：`minutes * 60`） |
| `summary` + `actors` + `tags` | NFO 生成 |
| `magnets[].hash` | 下载/磁力功能 |
| `id` | 内部 movie id，详情与磁力请求用 |

搜索策略建议：

1. 先用本地正则得到番号（如 `IDPC-001`）。
2. 用 `q=<番号>` 搜索，优先 `number` 大小写不敏感精确匹配；没有精确匹配时不要直接取第一条。
3. 精确匹配得到 `id` → `/api/v4/movies/{id}` 取详情。
4. 多结果时把 `number/title/release_date` 交给现有 AI 选择流程。

## 6. 已落地实现

**Bun 侧（HTTP 模式 / 插件模式）**

```
server/javdb.ts                 // 共享客户端：签名、限速、host 失败切换、缓存
server/plugins/javdb/
├─ plugin.json                  // id: javdb, labels: 番号/标题
└─ index.ts                     // identify() / resolve() 委托给 server/javdb.ts
server/plugins/av/index.ts      // AV 模式复用同一客户端
```

**Rust 侧（打包后的桌面应用）**

```
src-tauri/src/javdb.rs          // 同协议原生实现 + 单元测试（含 live 测试）
命令：javdb_identify / javdb_detail
```

**前端**

- `src/native.ts` 增加 `javdbIdentify` / `javdbDetail`，Tauri 走 `invoke`，HTTP 走 `/api/javdb/*`
- 识别优先级：插件（Bun）→ 原生 JavDB（Tauri）→ AI/正则
- `Row` / `Candidate` 增加 `posterUrl / maker / actors / duration / score / detailId`
- 整理时按模式配置写入 `<文件名>.nfo` 与 `<文件名>.jpg`

**实测（2026-11-09）**

```
插件 identify  SSIS-001.mp4 → 1 条精确候选，封面/演员/片商/评分齐全
原生 identify  cargo test live_identify_ssis_001 → ok
整理           目标目录生成 .mp4 + .nfo + .jpg（封面 157 KB）
NFO            runtime=150、uniqueid=ZY5eq、thumb=封面 URL
```

## 7. 风险与合规

- 签名常量来自 App 1.9.28 逆向，**升级后可能失效**；做成可配置常量并保留「网页抓取 / 手动匹配」降级。
- 请求频率要保守（建议 ≥1.5s/次，串行 + 指数退避）；不要并发轰站。
- 仅抓取元数据（番号/标题/演员/封面），不要下载受版权保护的影片。
- 遵守 JavDB 服务条款与所在地法律；本项目仅供个人媒体库管理。
- 参考代码许可：`javdb-cli` 为 MIT，可直接借鉴算法；其他仓库使用前先确认 License。

# 媒体库与元数据源接口约定

> 本文件用于并行开发：前端与 Bun 实现必须与下列签名、字段、行为一致。
> 元数据源已插件化，目录与调用契约见 [plugin-contract.md](plugin-contract.md)。

## 1. 媒体库（SQLite）

### 1.1 数据模型

```ts
export interface LibraryItem {
  path: string          // 绝对路径，主键
  file: string
  mode: string
  code: string
  title: string
  status: string        // done | unmatched | review | error
  year?: string
  maker?: string
  actors?: string
  overview?: string
  src?: string
  score?: number
  dur?: number          // 秒
  size?: number         // 字节
  posterUrl?: string
  posterCrop?: {        // 手动裁剪区域（源图像素）；为空表示完整封面
    x: number
    y: number
    width: number
    height: number
  }
  detailId?: string
  tags?: string[]
  updatedAt?: number    // 毫秒；由写入方生成
}
```

JSON 使用 camelCase。未知字段忽略。

### 1.2 Bun

文件：`server/library.ts`

```ts
export function listItems(): LibraryItem[]
export function upsertItems(items: LibraryItem[]): number
export function removeItems(paths: string[]): number
export function clearItems(mode?: string): number
```

- 数据库：`server/data/library.db`，`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;`
- 表：

```sql
CREATE TABLE IF NOT EXISTS items (
  path TEXT PRIMARY KEY,
  file TEXT NOT NULL,
  mode TEXT NOT NULL,
  code TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unmatched',
  year TEXT,
  maker TEXT,
  actors TEXT,
  overview TEXT,
  src TEXT,
  score REAL,
  dur INTEGER,
  size INTEGER,
  poster_url TEXT,
  detail_id TEXT,
  tags_json TEXT,
  updated_at INTEGER NOT NULL
);
```

- 所有写操作在事务内完成；`upsertItems` 返回受影响行数。
- 缺失 `updatedAt` 时使用当前时间。
- 数据库目录不存在时创建。
- 不要在模块加载时执行不可恢复的破坏性操作。

## 2. 元数据源

### 2.1 统一类型

Bun：`server/plugins/_shared/types.ts`

```ts
export interface ProviderCandidate {
  id: string
  title: string
  year: string
  code?: string
  source: string
  score: number
  overview: string
  poster: number
  posterUrl?: string
  maker?: string
  actors?: string
  duration?: number
  detailId?: string
  tags?: string[]
}

export interface ProviderDetail extends ProviderCandidate {
  tags?: string[]
  raw?: Record<string, unknown>
}
```

### 2.2 TMDB（电影 / 电视剧）

Bun：`server/plugins/_shared/tmdb.ts`（`movie` / `tv` 插件通过 `_shared/tmdb-plugin.ts` 共用）

```ts
export async function tmdbIdentify(
  filename: string,
  mediaType: 'movie' | 'tv',
  apiKey: string,
  lang?: string
): Promise<ProviderCandidate[]>

export async function tmdbDetail(
  id: string,
  mediaType: 'movie' | 'tv',
  apiKey: string,
  lang?: string
): Promise<ProviderDetail>
```

插件包装：

```ts
// movie/index.ts
export default makeTmdbPlugin('movie')
// tv/index.ts
export default makeTmdbPlugin('tv')
```

- 插件从 `ctx.options.apiKey` → `ctx.modeConfig.tmdbApiKey` → `ctx.config.tmdbApiKey` 依次取 Key。
- 语言从 `ctx.options.lang` → `ctx.modeConfig.tmdbLang` → `ctx.config.lang`（中文名映射 locale）读取。
- `sources` 中显式关闭 `TMDB` 时 `identify` 抛错；`resolve` 不受开关影响。

规则：

- 基础地址 `https://api.themoviedb.org/3`；语言默认 `zh-CN`。
- API Key：
  - 以 `eyJ` 开头的 v4 token → `Authorization: Bearer <key>`
  - 其它 v3 key → query `api_key=<key>`
- 搜索：`GET /search/movie`、`GET /search/tv`，参数 `query`、`language`、`include_adult=false`、`page=1`。
- 详情：`GET /movie/{id}`、`GET /tv/{id}`，`append_to_response=credits`。
- 图片：`https://image.tmdb.org/t/p/w500` + `poster_path`。
- 文件名清洗：去扩展名、`[...]`、`(...)`、`._`，去掉分辨率/编码/来源词（`1080p`、`2160p`、`BluRay`、`WEB-DL`、`x264`、`x265`、`HDR`、`DTS`、`AAC` 等），提取 4 位年份。
- 优先用去掉年份后的标题搜索；无结果再用完整清洗名。
- 返回最多 8 条，按「年份匹配优先、`popularity` 降序」排序。
- `id = tmdb:movie:<id>` / `tmdb:tv:<id>`；`detailId = movie:<id>` / `tv:<id>`。
- `source = "TMDB"`；`score = vote_average`；`overview = overview`。
- `maker = production_companies[0].name`；`actors = credits.cast` 前 6 个名字用 ` / ` 连接。
- `duration`：电影 `runtime`、剧集 `episode_run_time[0]`，单位为分钟 → 乘 60 存秒。
- `tags`：`genres[].name`。
- 无 API Key → 返回明确错误：`未配置 TMDB API Key`。
- 401 → `TMDB API Key 无效`；429 → `TMDB 请求过于频繁`。

### 2.3 Bangumi（动漫）

Bun：`server/plugins/anime/bangumi.ts`

```ts
export async function bangumiIdentify(
  filename: string,
  token?: string
): Promise<ProviderCandidate[]>

export async function bangumiDetail(
  id: string,
  token?: string
): Promise<ProviderDetail>
```

插件包装：`anime/index.ts` 从 `ctx.options.token` → `ctx.modeConfig.bangumiToken` → `ctx.config.bangumiToken` 取 token；`sources` 中显式关闭 `Bangumi` 时 `identify` 抛错。

规则：

- 搜索：`POST https://api.bgm.tv/v0/search/subjects?limit=10`
  body：`{ "keyword": "...", "filter": { "type": [2] } }`
- 详情：`GET https://api.bgm.tv/v0/subjects/{id}`
- 请求头必须带 `User-Agent: scraper-app/0.1 (https://github.com/local/scraper-app)`；有 token 时带 `Authorization: Bearer <token>`。
- 文件名清洗：去扩展名、`[...]` 组名、分辨率、`SxxExx`、`第xx话`、`- 01` 等集数；保留标题主体。
- 返回最多 10 条，按匹配度/评分排序。
- `id = bangumi:<id>`；`detailId = <id>`；`source = "Bangumi"`。
- `title = name_cn || name`；`year = date.slice(0,4)`；`score = rating.score`。
- `posterUrl = images.large || images.common || images.medium`。
- `overview = summary`；`tags = tags[].name` 前 8 个。
- `duration` 无可靠字段，留空；`maker/actors` 留空。
- 失败信息用中文说明（网络、非 2xx、无结果）。

## 3. 集成方式（由集成方完成）

- Bun：媒体库仍在 `server/index.ts` 注册：
  - `POST /api/library/list` → `{ items: [] }`（GET 亦可）
  - `POST /api/library/upsert` `{ items }` → `{ count }`
  - `POST /api/library/remove` `{ paths }` → `{ count }`
  - `POST /api/library/clear` `{ mode? }` → `{ count }`
- Bun：元数据源通过通用插件接口注册（不再有 `/api/tmdb/*`、`/api/bangumi/*`）：
  - `POST /api/plugins/{movie|tv}/identify` `{ filename, options: { apiKey, lang, mediaType } }` → `{ candidates }`
  - `POST /api/plugins/{movie|tv}/resolve` `{ candidateId, options: { apiKey, lang, mediaType } }` → detail
  - `POST /api/plugins/anime/identify` `{ filename, options: { token? } }` → `{ candidates }`
  - `POST /api/plugins/anime/resolve` `{ candidateId, options: { token? } }` → detail
- 前端：`native.ts` 保留原有 `tmdb*` / `bangumi*` 方法签名，内部改调插件接口。

## 4. 验收

- Bun：`bun build server/index.ts --target=bun` 成功；`GET /api/plugins` 能看到 5 个内置插件且 `status=ok`。
- 插件：`server/plugins/_shared/tmdb.ts`、`server/plugins/anime/bangumi.ts` 能被 `Bun.build` 打包进各自插件产物。
- Bangumi 可用真实请求测试（无需 Key）。
- TMDB 无 Key 必须报「未配置 TMDB API Key」；可用 mock 服务测试解析。
- 旧路由 `/api/tmdb/*`、`/api/bangumi/*`、`/api/javdb/*` 必须返回 404。

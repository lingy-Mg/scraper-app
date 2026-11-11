# 媒体库与元数据源接口约定

> 本文件用于并行开发：Bun/Rust 两侧实现必须与下列签名、字段、行为一致。

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

### 1.3 Rust

文件：`src-tauri/src/library.rs`

```rust
#[tauri::command]
pub fn library_list(app: tauri::AppHandle) -> Result<Vec<LibraryItem>, String>;
#[tauri::command]
pub fn library_upsert(app: tauri::AppHandle, items: Vec<LibraryItem>) -> Result<usize, String>;
#[tauri::command]
pub fn library_remove(app: tauri::AppHandle, paths: Vec<String>) -> Result<usize, String>;
#[tauri::command]
pub fn library_clear(app: tauri::AppHandle, mode: Option<String>) -> Result<usize, String>;
```

- 数据库：`app.path().app_data_dir()?/library.db`，自动创建目录。
- 结构体 `#[serde(rename_all = "camelCase")]`，字段同上，全部可选字段用 `Option`。
- `lib.rs` 的 `invoke_handler` 由集成方注册，**不要修改 lib.rs**。
- 事务批量 upsert；`tags` 存 JSON 文本（列 `tags_json`）。
- 附带 `#[cfg(test)]`：用临时目录测试 upsert/list/remove/clear。

## 2. 元数据源

### 2.1 统一类型

Bun：`server/providers/types.ts`

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

Rust：直接返回 `crate::models::Candidate`（已含 `tags` 字段）；详情返回 `serde_json::Value`。

### 2.2 TMDB（电影 / 电视剧）

Bun：`server/providers/tmdb.ts`

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

Rust 命令：

```rust
#[tauri::command]
pub async fn tmdb_identify(
  filename: String,
  media_type: String,
  api_key: String,
  lang: Option<String>,
) -> Result<Vec<Candidate>, String>;

#[tauri::command]
pub async fn tmdb_detail(
  id: String,
  media_type: String,
  api_key: String,
  lang: Option<String>,
) -> Result<serde_json::Value, String>;
```

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

Bun：`server/providers/bangumi.ts`

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

Rust 命令：

```rust
#[tauri::command]
pub async fn bangumi_identify(filename: String) -> Result<Vec<Candidate>, String>;

#[tauri::command]
pub async fn bangumi_detail(id: String) -> Result<serde_json::Value, String>;
```

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

- Bun：在 `server/index.ts` 注册：
  - `POST /api/library/list` → `{ items: [] }`（GET 亦可）
  - `POST /api/library/upsert` `{ items }` → `{ count }`
  - `POST /api/library/remove` `{ paths }` → `{ count }`
  - `POST /api/library/clear` `{ mode? }` → `{ count }`
  - `POST /api/tmdb/identify` `{ filename, mediaType, apiKey, lang? }` → `{ candidates }`
  - `POST /api/tmdb/detail` `{ id, mediaType, apiKey, lang? }` → detail
  - `POST /api/bangumi/identify` `{ filename, token? }` → `{ candidates }`
  - `POST /api/bangumi/detail` `{ id, token? }` → detail
- Rust：在 `lib.rs` 注册 `library_*`、`tmdb_*`、`bangumi_*` 命令。
- 前端：`native.ts` 增加对应方法。

## 4. 验收

- Bun：`bun build server/library.ts --target=bun`、`bun build server/providers/tmdb.ts`、`bangumi.ts` 成功。
- Bangumi 可用真实请求测试（无需 Key）。
- TMDB 无 Key 必须报「未配置 TMDB API Key」；可用 mock 服务测试解析。
- Rust：`cargo test --lib` 通过（library 测试 + 清洗/解析单元测试）。

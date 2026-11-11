# Git 工作流规范

> 本地仓库，**只提交不推送**。没有 remote，也不配置 remote。

## 1. 提交粒度

**一个可独立验证的小改动 = 一个提交。** 不要把多个不相关的改动攒在一起。

推荐的拆分方式：

| 改动 | 提交次数 |
|---|---|
| 新增一个接口 + 前端调用 + 样式 | 1 次（同一功能的完整闭环） |
| 重构目录结构 | 1 次（只动结构，不改行为） |
| 修复一个 bug | 1 次（含验证方式说明） |
| 改文档 | 1 次 |

反例：把「删 Tauri」「改插件加载」「调样式」放进同一个提交。

## 2. 提交前必须验证

至少跑通与改动相关的检查，失败不提交：

```powershell
npx tsc --noEmit
bun build server/index.ts --target=bun --outfile="$env:TEMP\server-check.js"   # 改了 server/
npm run build                                                                   # 改了前端/构建配置
```

纯文档/注释改动可跳过，但提交信息里要说明。

## 3. 提交信息格式

```
<type>(<scope>): <中文简述>

<可选：为什么这么改 / 验证方式>
```

`type` 取值：

- `feat` 新功能
- `fix` 修复缺陷
- `refactor` 重构（不改变外部行为）
- `perf` 性能
- `docs` 文档
- `test` 测试
- `chore` 构建、依赖、脚本、杂务
- `build` 打包配置

`scope` 用模块名：`scan` / `organize` / `library` / `plugin` / `javdb` / `ui` / `server` / `build`。

示例：

```
feat(plugin): JavDB 刮削改为插件动态注册
fix(scan): 跳过 .d.ts 避免被误判为 MPEG-TS
refactor(native): 移除演示模式，桥接层只保留 HTTP
```

## 4. 绝对不要提交

已在 `.gitignore` 中，不要用 `git add -f` 绕过：

- `data/` —— 含 AI Key、TMDB Key、Bangumi Token、媒体库、封面缓存
- `node_modules/`、`dist/`
- 任何 `.env`、`*.pem`、`*.key`

提交前自查：

```powershell
git diff --cached --name-only | Select-String -Pattern "data|node_modules|target/|\.env"
```

有输出就说明漏了。

## 5. 历史操作

- 不要 `git push`（没有 remote）
- 不要 `git reset --hard` 丢弃未提交的工作
- 不要改写已提交的历史（`rebase`/`commit --amend`）除非该提交是最近一次且未验证通过
- 大改前先提交一次当前状态，保证随时可回滚
- 回滚单个提交：`git revert <hash>`（保留历史，便于追溯）

## 6. AI 开发线程的硬性要求

任何自动化开发线程（子 Agent）必须：

1. 开始前 `git status` 确认工作区干净；不干净先说明原因
2. 每个小改动完成后立即 `git add` + `git commit`
3. 提交信息遵循第 3 节格式
4. 不推送、不改 remote、不 force push
5. 结束时报告提交哈希列表

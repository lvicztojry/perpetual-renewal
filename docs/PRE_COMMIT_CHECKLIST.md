# Pre-commit Checklist

本清单用于第一次 commit/push 前，以及每次准备推远端前快速自检。

## 1. 文件边界

- 项目产物只应位于 `D:\github_clone\perpetual-renewal`。
- 不要把真实 `.env.local`、`.env.*.local`、`.npm-cache/`、测试结果或浏览器缓存加入 Git。
- `git status --short` 中如果出现陌生文件，先确认是否真的是项目需要的源码、文档、测试或配置。
- 提交前运行 `git status --short --ignored`，确认 `.next/`、`.npm-cache/`、`node_modules/`、`test-results/`、`tsconfig.tsbuildinfo` 均未进入 staged。
- 当前 Git 可能提示无法读取 `C:\Users\lvicztojry/.config/git/ignore`，这是环境级全局 ignore 权限警告，不代表项目写入 C 盘。

## 2. Secret 检查

仓库中不能出现：

- 真实 `DATABASE_URL`。
- 真实 `LLM_API_KEY`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`、`GOOGLE_API_KEY`。
- 真实 `USER_KEY_VAULT_SECRET` 或 `PROACTIVE_CRON_SECRET`。
- Bearer token、JWT、vault 密文、数据库密码、供应商 raw payload。

推送前必跑：

```bash
npm run secrets:check
```

如果失败，先移除泄露内容并在供应商侧轮换 key。

## 3. 本地质量门禁

GitHub Actions 会在 `push` 和 `pull_request` 上自动运行不依赖真实 secret 的基线：

```bash
npm ci
npm run secrets:check
npm run docs:check
npm run git:boundary
npm run typecheck
npm run lint
npm run qa:samples
npm run qa:prompt
npm run qa:imports
npm run qa:vault
npm run qa:logging
npm run pwa:check
npm run env:readiness
npm run prisma:validate
npm run db:smoke
npm run smoke
npm run build
```

CI 不要求 `DATABASE_URL`、`LLM_API_KEY`、`USER_KEY_VAULT_SECRET` 或 `PROACTIVE_CRON_SECRET`，默认使用 mock/fallback 路线。

推荐直接运行顺序门禁：

```bash
npm run verify:local
```

发布前包含依赖漏洞扫描：

```bash
npm run verify:release
```

生产部署前严格验证：

```bash
npm run verify:deploy
```

等价的完整顺序：

```bash
npm run typecheck
npm run lint
npm run qa:samples
npm run qa:prompt
npm run qa:imports
npm run qa:vault
npm run qa:logging
npm run pwa:check
npm run docs:check
npm run git:boundary
npm run env:readiness
npm run prisma:validate
npm run db:smoke
npm run smoke
npm run build
npm run e2e
npm --cache .\.npm-cache audit --audit-level=high
```

说明：

- `db:smoke` 在未配置 `DATABASE_URL` 时会安全跳过；上线前不能把跳过当作生产数据库验收。
- `npm run verify:deploy` 会用 strict readiness 阻止缺少生产数据库、vault secret 或 cron secret 的部署候选误判通过。
- `npm run e2e` 仍保留为本地发布前检查；当前 Playwright 使用系统 Edge，默认不放入 GitHub Actions。
- `npm audit` 需要网络，使用项目内 `.npm-cache`，避免把 npm 缓存写到系统盘。
- `npm run verify:local` 和 `npm run verify:release` 会顺序运行 `smoke` 与 `e2e`，避免它们抢同一个 Next dev server 项目锁。
- `npm run docs:check` 会拦截旧安装命令、裸 audit 命令、旧 smoke 数字、生产迁移口径混淆、`latest` 依赖和危险 `.env.example`。
- `npm run git:boundary` 会拦截 `.env.local`、构建目录、npm cache、`node_modules`、测试结果、日志和 tsbuildinfo 等不应进入 Git scope 的文件。

## 4. 真实环境配置

上线前确认：

- Neon PostgreSQL `DATABASE_URL` 只在 `.env.local` 或部署平台 secret。
- `USER_KEY_VAULT_SECRET` 和 `PROACTIVE_CRON_SECRET` 是两段不同强随机值。
- `LLM_PROVIDER=compatible`、`LLM_BASE_URL=https://api.tryanotherone.com/v1`。
- 用户 API key 优先在设置页保存到加密 vault；服务端 key 只放环境变量。
- `VOICE_PROVIDER=shared-llm`，语音与 LLM 共用中转站。
- 设置页“配置状态”只显示就绪/缺失/提醒，不显示真实连接串、key 或 secret。

生成 secret 的建议命令：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

分别运行两次，填入 `USER_KEY_VAULT_SECRET` 与 `PROACTIVE_CRON_SECRET`。

## 5. 人工验收

发布前至少跑一遍 [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) 中的 20 分钟脚本，确认：

- 全关系对象能创建并进入聊天。
- 记忆、导入、主动回响、状态筛选可用。
- 设置页能保存用户 API key、读取模型列表、测试连接、查看配置状态。
- 语音 fallback、用量看板、数据导出可用且不泄露密钥。
- 390px 移动端无横向溢出。

## 6. 可接受的剩余状态

当前本地开发允许：

- 未配置 `DATABASE_URL`，因此 `db:smoke` 显示安全跳过。
- 未配置真实 LLM key，聊天走 mock fallback。
- Baseline commit 后，正常情况下不应出现大量 untracked 源码文件；如果出现，先确认是否只是缓存、构建产物或测试结果。

当前上线前不应接受：

- `secrets:check` 失败。
- `npm --cache .\.npm-cache audit --audit-level=high` 有未解释 high 漏洞。
- 生产环境缺少 `DATABASE_URL`、`USER_KEY_VAULT_SECRET` 或 `PROACTIVE_CRON_SECRET`。
- 设置页、导出、日志、配置状态 API 返回任何真实 key、Base URL、连接串、prompt 或 vault 密文。

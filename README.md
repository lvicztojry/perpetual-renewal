# 生生不息 / perpetual-renewal

“生生不息”是一个关系型 AI 陪伴项目：当用户想交流却无法真正抵达某个人或某段关系时，用可设定、可记忆、会回响的 AI 关系对象承接亲情、友情、爱情、纪念、替代和自定义陪伴。

## 本地启动

```bash
npm ci
npm run dev
```

默认开发地址：`http://localhost:3000`；本机真实体验时也可以固定用 `http://127.0.0.1:3000`，避免浏览器或代理把 `localhost` 解析得不一致。没有真实数据库或模型配置时，项目会使用本地 memory/mock 路线，方便先跑通体验；一旦配置了 `DATABASE_URL`，数据库连接或写入失败会直接暴露，不会静默保存到 memory。

如果要接真实数据库或模型，先复制 `.env.example` 为 `.env.local`，真实 key 只放 `.env.local`、部署平台 secret 或网站设置页的用户级 vault。
可用 `npm run env:secrets` 生成本地/部署用强随机 secret；命令只打印值，不写入文件。

## 当前发布候选

- 分支：`codex/mvp-release-candidate`
- 当前同步点：运行 `git status --short --branch` 和 `git log -1 --oneline` 查看。
- 初始 baseline：`ef4939e feat: build relationship ai mvp baseline`
- 推远端前建议运行：`npm run verify:pr`、`npm run e2e`、`npm run verify:release`、`git status --short --ignored`；本机已验证不等于目标部署已验证，真实部署前要把 env/secrets mirror 到目标环境并在那里运行 `npm run verify:deploy`。
- `npm run e2e` 默认启动 managed mock/memory 服务，作为稳定 UI 门禁；如要复用当前真实配置服务，先启动 `npm run dev`，再设置 `E2E_BASE_URL=http://127.0.0.1:3000` 只跑目标 spec/用例。
- 类型检查：`npm run typecheck` 会先运行 `npm run next:typegen`，确保 Next route types 已生成且 `next-env.d.ts` 保持稳定。

## 真实配置

真实值只放在 `.env.local`、部署平台环境变量或网站设置页的用户级 vault，不写入仓库。
分工可以这样记：`.env.local` 负责数据库、vault/session/cron secret 和可选服务端 fallback；网站设置页负责当前登录用户自己的 LLM API key、模型和连接测试。BYOK 模式下，`LLM_API_KEY` 和 `LLM_MODEL` 不一定要写进 `.env.local`，用户在设置页保存后也能完成真实聊天链路。

```bash
DATABASE_URL="Neon or PostgreSQL connection string"
DATABASE_URL_UNPOOLED=""
LLM_PROVIDER="compatible"
LLM_BASE_URL="https://api.tryanotherone.com/v1"
LLM_MODEL="selected-model-name"
USER_KEY_VAULT_SECRET="32-byte-or-longer-random-secret"
SESSION_COOKIE_SECRET=""
PROACTIVE_CRON_SECRET="random-cron-secret"
CRON_SECRET=""
VOICE_PROVIDER="shared-llm"
```

- 数据库：第一版推荐 Neon PostgreSQL；`DATABASE_URL` 可使用 pooled 连接服务应用请求，`DATABASE_URL_UNPOOLED` 可选填 direct 连接供 Prisma 迁移使用；配置后运行 `npm run db:smoke` 做连通性检查，部署目标还必须在 mirror env/secrets 后运行 `npm run verify:deploy`。
- LLM：默认使用 TryAnotherOne 的 compatible 中转站；用户可在网站内保存自己的 API key，也可用服务端环境变量做 fallback。
- 模型列表：设置页读取模型列表需要已保存或即将保存的 API key；如果供应商不支持 `/models` 或临时失败，可以手动填入模型名后点“测试连接”。
- 真实 BYOK 联调：需要显式 opt-in，设置 `REAL_PROVIDER_QA=1`、`REAL_LLM_API_KEY`、`REAL_LLM_BASE_URL`、`REAL_LLM_MODEL` 后运行 `npm run qa:real-provider`；脚本会验证用户 vault -> 模型诊断 -> 真实聊天 -> 用量记录，并脱敏输出。它不属于默认 `verify:pr`、CI 或发布门禁。
- fake-compatible 自测：`npm run qa:real-provider:fake` 使用本地假供应商验证真实联调脚本逻辑，不需要真实 key，不代表真实供应商联调通过。
- Vault：`USER_KEY_VAULT_SECRET` 用于加密用户 API key，生产环境必须设置强随机值。
- Session：`SESSION_COOKIE_SECRET` 可单独用于签名 session cookie；如果不设置，会复用强 `USER_KEY_VAULT_SECRET`。
- 主动回响：`PROACTIVE_CRON_SECRET` 保护 all-user 调度入口；Vercel Cron 可用 `CRON_SECRET` 作为同用途 alias。
- 本地主动回响：打开工作台时，当前关系对象会按 1 分钟节奏做前台检查；关闭页面后本地不会有常驻后台调度器。生产 all-user 自动调度由 Vercel Cron 或外部 cron 调用受保护入口。
- 语音：`VOICE_PROVIDER=shared-llm` 表示语音与 LLM 共用中转站配置。
- 命令行检查：`npm run env:readiness` 会读取项目根目录的 `.env.local`/`.env`，只输出就绪状态和下一步，不打印真实值。
- Secret 生成：`npm run env:secrets` 会生成 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 的强随机值，输出结果只应放入 `.env.local` 或部署平台 secret。

## 网站内配置

进入设置页后可以：

- 保存或删除用户自己的 LLM API key。
- 读取兼容中转站模型列表并选择模型。
- 点击“测试连接”验证当前 provider/baseUrl/model/key 是否可用。
- 查看配置状态向导，确认数据库、vault、session 签名、cron、LLM 和 voice 是否就绪。

## 验收命令

本地推荐一条命令顺序执行，避免 `smoke` 和 `e2e` 并发抢 dev server 锁：

```bash
npm run verify:local
```

PR 快速验证：

```bash
npm run verify:pr
```

发布前需要额外跑依赖漏洞扫描：

```bash
npm run verify:release
```

生产部署前严格验证：

```bash
npm run verify:deploy
```

也可以逐条执行：

```bash
npm run typecheck
npm run lint
npm run docs:check
npm run git:boundary
npm run db:smoke
npm run smoke
npm run qa:samples
npm run qa:prompt
npm run qa:imports
npm run qa:vault
npm run qa:logging
npm run qa:response
npm run qa:voice
npm run qa:real-provider:fake
npm run pwa:check
npm run env:readiness
npm run build
npm run e2e
npm run secrets:check
npm --cache .\.npm-cache audit --audit-level=high
```

真实 BYOK 供应商目标联调是单独的可选命令：

```bash
REAL_PROVIDER_QA=1 REAL_LLM_API_KEY="..." REAL_LLM_BASE_URL="..." REAL_LLM_MODEL="..." npm run qa:real-provider
```

## 文档入口

- [PRD](docs/PRD.md)
- [TASKBOOK](docs/TASKBOOK.md)
- [MVP_STATUS](docs/MVP_STATUS.md)
- [DEPLOYMENT](docs/DEPLOYMENT.md)
- [QA](docs/QA.md)
- [RELEASE_ACCEPTANCE](docs/RELEASE_ACCEPTANCE.md)
- [RELEASE_HANDOFF](docs/RELEASE_HANDOFF.md)
- [ERROR_COPY](docs/ERROR_COPY.md)

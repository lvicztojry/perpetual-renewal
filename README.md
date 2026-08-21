# 生生不息 / perpetual-renewal

“生生不息”是一个关系型 AI 陪伴项目：当用户想交流却无法真正抵达某个人或某段关系时，用可设定、可记忆、会回响的 AI 关系对象承接亲情、友情、爱情、纪念、替代和自定义陪伴。

## 本地启动

```bash
npm ci
npm run dev
```

默认开发地址：`http://localhost:3000`。没有真实数据库或模型配置时，项目会使用本地 fallback/mock 路线，方便先跑通体验。

如果要接真实数据库或模型，先复制 `.env.example` 为 `.env.local`，真实 key 只放 `.env.local`、部署平台 secret 或网站设置页的用户级 vault。

## 当前发布候选

- 分支：`codex/mvp-release-candidate`
- 当前同步点：运行 `git status --short --branch` 和 `git log -1 --oneline` 查看。
- 初始 baseline：`ef4939e feat: build relationship ai mvp baseline`
- 推远端前建议运行：`npm run verify:pr`、`npm run e2e`、`npm run verify:release`、`git status --short --ignored`；真实部署前在目标环境运行 `npm run verify:deploy`。
- 类型检查：`npm run typecheck` 会先运行 `npm run next:typegen`，确保 Next route types 已生成且 `next-env.d.ts` 保持稳定。

## 真实配置

真实值只放在 `.env.local`、部署平台环境变量或网站设置页的用户级 vault，不写入仓库。

```bash
DATABASE_URL="Neon or PostgreSQL connection string"
LLM_PROVIDER="compatible"
LLM_BASE_URL="https://api.tryanotherone.com/v1"
LLM_MODEL="selected-model-name"
USER_KEY_VAULT_SECRET="32-byte-or-longer-random-secret"
SESSION_COOKIE_SECRET=""
PROACTIVE_CRON_SECRET="random-cron-secret"
VOICE_PROVIDER="shared-llm"
```

- 数据库：第一版推荐 Neon PostgreSQL；配置后运行 `npm run db:smoke` 做连通性检查。
- LLM：默认使用 TryAnotherOne 的 compatible 中转站；用户可在网站内保存自己的 API key，也可用服务端环境变量做 fallback。
- Vault：`USER_KEY_VAULT_SECRET` 用于加密用户 API key，生产环境必须设置强随机值。
- Session：`SESSION_COOKIE_SECRET` 可单独用于签名 session cookie；如果不设置，会复用强 `USER_KEY_VAULT_SECRET`。
- 主动回响：`PROACTIVE_CRON_SECRET` 保护 all-user 调度入口。
- 语音：`VOICE_PROVIDER=shared-llm` 表示语音与 LLM 共用中转站配置。
- 命令行检查：`npm run env:readiness` 会读取项目根目录的 `.env.local`/`.env`，只输出就绪状态和下一步，不打印真实值。

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
npm run pwa:check
npm run env:readiness
npm run build
npm run e2e
npm run secrets:check
npm --cache .\.npm-cache audit --audit-level=high
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

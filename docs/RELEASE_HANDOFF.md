# 发布与交接

当前版本、部署和实际验收统一见 [MVP_STATUS.md](MVP_STATUS.md)。本文件只描述交接流程；旧的 M 系列范围、提交与验收原文见 [RELEASE_HANDOFF_HISTORY.md](RELEASE_HANDOFF_HISTORY.md)，历史任务定义见 [TASKBOOK_HISTORY.md](TASKBOOK_HISTORY.md)。

## 三条交付线

| 交付物 | 构建与说明 | 事实来源 |
| --- | --- | --- |
| 静态介绍站 | npm run site:build；部署 site/dist | netlify.toml、site/site.json；操作见 [SITE.md](SITE.md) |
| Web 聊天应用 | npm run build；数据库/邮件/调度另行部署 | [DEPLOYMENT.md](DEPLOYMENT.md)；介绍站上线不能替代应用验收 |
| Windows / Android | 原生构建、同身份更新、签名与发布 | [LOCAL_CLIENTS.md](LOCAL_CLIENTS.md)；版本与下载元数据取配置 |

Current branch tip：交接时运行 git status --short --branch 和 git log -1 --oneline，不在文档固定 ahead/behind。Initial baseline commit 及历史里程碑只用于追溯，见上面的历史归档，不代表当前 Release。

## 交接前检查

1. 阅读当前状态与 Taskbook，确认本次范围和未验项目。
2. 在对应隔离环境执行 [QA.md](QA.md) 所需检查；实际结果只登记当前状态，保留日期、环境和失败/跳过项。
3. 检查 git diff、生成物/密钥边界与 npm run secrets:check。数据库、个人数据、.netlify-token、签名私钥、缓存和安装包不入 Git。
4. 更新 src/lib/release-notes.json 时运行 npm run release:notes；不要手改 DEVELOPMENT_LOG。
5. 同步客户端版本、构建号及 site/site.json；运行 npm run release:check、npm run docs:check。
6. 提交、push、发布 Release 或触发 Netlify 均是独立动作。本地构建成功不代表已执行这些动作；按当前用户授权处理。

## 安装包和介绍站发布

- 安装包在 dist/installers/，公开附件及 SHA-256 对照 site/site.json；源码、包内配置与分发范围需逐次复核，不沿用旧“仅封闭测试”的结论。
- 发布前先用 npm run release:publish -- --dry-run 检查正文和文件；真实发布步骤见 [SITE.md](SITE.md)。
- 验证证据链接应能被接收者访问，公开记录指向仓库文档，不能声称 Git 忽略目录里的 JSON 是公开附件。
- 内部数据库备份、脱敏资料 JSON 和完整跨设备账户迁移是不同能力，不写成“已有一键外部恢复”。
- 部署静态站后核对线上首页、版本、下载链接和 Web 入口提示；记录实际部署与本地待发布修改的区别。

## 应用服务部署

仅当另行部署聊天应用时，在目标环境配置 DATABASE_URL、USER_KEY_VAULT_SECRET、SESSION_COOKIE_SECRET 或强 vault-secret fallback、PROACTIVE_CRON_SECRET、认证邮件和模型配置，再运行 npm run prisma:migrate:deploy 与 npm run verify:deploy。语音共用网关时为 VOICE_PROVIDER=shared-llm。细节见 DEPLOYMENT；本地历史通过不能代替新目标的验证。

主动回响的生产调度使用 `vercel.json` 里的 Vercel Cron 每分钟 GET `/api/proactive/run`；目标环境需配置 `CRON_SECRET`（`PROACTIVE_CRON_SECRET` 的同用途 alias），Vercel 会把它作为 Bearer token 发送到该路径。`npm run qa:proactive-cron` 静态复核这条链路与 `limit`/`maxDrafts` 护栏，本地交接前手动运行；它在 CI 里是提示档，不阻断合并。

## CI Expectations

CI 分三档，命名与 .github/workflows/ci.yml 的 job 对应；列出命令不表示本轮已经执行。

- **Gate（必跑，拦截合并）**：secrets / docs / 类型 / lint / 静态 QA / 构建，即下列命令中除 qa:proactive-cron 与 env:readiness、db:smoke 以外的全部项。
- **Advisory（提示，不拦截）**：npm run qa:proactive-cron。它是文档措辞契约断言，失败只提示，不阻断合并。
- **Deploy readiness（手动触发，需真实数据库与密钥）**：npm run env:readiness、npm run db:smoke。发布前用 workflow_dispatch 运行；本地做发布前严格检查时自行加 --strict 参数。

`npm run docs:check` 会把 scripts/verify-local.mjs 的基础步骤与本文件、ci.yml 对齐；改 CI 分档时三处需同步。

```bash
npm ci
npm run secrets:check
npm run docs:check
npm run next:typegen
npm run git:boundary
npm run typecheck
npm run lint
npm run qa:samples
npm run qa:prompt
npm run qa:memory-lifecycle
npm run qa:sync
npm run qa:imports
npm run qa:character-import
npm run qa:dream
npm run qa:groups
npm run qa:journey
npm run qa:abilities
npm run qa:vault
npm run qa:auth
npm run qa:logging
npm run qa:response
npm run qa:chat-delivery
npm run qa:providers
npm run qa:voice
npm run qa:voice-language
npm run qa:proactive-scheduler
npm run qa:proactive-cron
npm run qa:proactive-availability
npm run qa:real-provider:fake
npm run pwa:check
npm run qa:database-url
npm run env:readiness
npm run prisma:validate
npm run db:smoke
npm run smoke
npm run build
npm run qa:auth-access
```

npm run e2e、npm run qa:native、npm run qa:journey:native 及原生实机检查按改动范围执行。完整本地验证入口 npm run verify:local，发布依赖审计用 npm run verify:release；静态站构建单独使用 site:build。

## 交接应附内容

本次范围、对应状态链接、执行过的命令与环境、仍失败/待验的项目、交付物位置及下一动作。秘密只放本地或目标平台的 secret store，不粘贴进交接、Issue、日志或截图。

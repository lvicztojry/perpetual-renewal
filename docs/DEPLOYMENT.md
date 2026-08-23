# Deployment

本文件记录“生生不息 / perpetual-renewal”第一版推荐上线流程。仓库文档只写配置流程、变量名和占位值；真实 `DATABASE_URL`、LLM key、模型名和 secret 只放本机、部署平台或用户 vault。

## Recommended Stack

推荐路线：

- App hosting: Vercel。
- PostgreSQL: Neon。
- ORM/migration: Prisma。
- LLM: `LLM_PROVIDER=compatible`，接 TryAnotherOne 兼容中转站。
- Voice: 与 LLM 共用中转站/供应商路线，仍通过独立 `VOICE_*` 变量配置 STT/TTS 模型。

当前建议优先 Neon：和 Vercel 配合轻、连接串简单、免费层足够 MVP，代码层只依赖标准 PostgreSQL `DATABASE_URL`。Supabase 仍可作为替代方案。

## Secret Rules

真实密钥只允许放在：

- 本机 `.env.local`。
- Vercel / Supabase / Neon / CI 的 secret 或 environment variables。
- 设置页的用户级加密 vault。

不要把真实 key、真实数据库密码、真实中转站 token 写入：

- `.env.example`
- `README.md`
- `docs/*`
- Prisma migration
- 测试 fixtures
- issue/PR 描述

推送前运行：

```bash
npm run secrets:check
```

如果扫描失败，先移除或轮换泄露的 key，再提交。`.env.local`、`.env.*.local` 已被 `.gitignore` 排除；仓库只保留变量名、空值和示例占位。

生成本地或部署用强随机 secret：

```bash
npm run env:secrets
```

该命令只打印 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 的候选值，不写入文件；输出值只应放入 `.env.local` 或部署平台 secret。

## Environment Variables

本地真实测试建议创建 `.env.local`：

```text
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
DATABASE_URL_UNPOOLED=""

LLM_PROVIDER="compatible"
LLM_API_KEY=""
LLM_BASE_URL="https://api.tryanotherone.com/v1"
LLM_MODEL="provider-model-name"
USER_KEY_VAULT_SECRET="generate-a-long-random-secret"
SESSION_COOKIE_SECRET=""
PROACTIVE_CRON_SECRET="generate-a-different-long-random-secret"
CRON_SECRET=""

LLM_INPUT_COST_USD_PER_1M="0"
LLM_OUTPUT_COST_USD_PER_1M="0"

VOICE_PROVIDER="shared-llm"
VOICE_STT_MODEL="provider-stt-model"
VOICE_TTS_MODEL="provider-tts-model"
VOICE_DEFAULT_VOICE="warm"
VOICE_CREDENTIAL_SOURCE="server-env"
```

最小真实试用不要把所有变量都混在一起理解：数据库连接串和三类 secret 放 `.env.local`；当前用户自己的 LLM key、模型名和连接测试优先在网站设置页完成。`LLM_API_KEY`/`LLM_MODEL` 只有在你需要部署方提供服务端 fallback 时才必须写入服务端环境变量；纯 BYOK 试用可以保持为空。

说明：

- `DATABASE_URL` 是应用查询使用的 PostgreSQL 连接串；Neon/Vercel 部署可优先使用 pooled 连接。
- `DATABASE_URL_UNPOOLED` 是可选的 direct/unpooled 连接串，Prisma 迁移脚本会在 `npm run prisma:migrate` 和 `npm run prisma:migrate:deploy` 时优先使用它；Neon 的迁移、dump、replication 等管理任务更推荐 direct 连接。
- `LLM_PROVIDER=compatible` 是默认真实接入路线，不绑定 OpenAI。
- `USER_KEY_VAULT_SECRET` 用于用户级 API key vault 加密。生产必须配置强随机值，泄露后应轮换用户密钥。
- `SESSION_COOKIE_SECRET` 可单独用于 HMAC 签名 session cookie。为空时会复用强 `USER_KEY_VAULT_SECRET`，但生产更推荐单独配置以拆分职责。
- `PROACTIVE_CRON_SECRET` 用于保护 `/api/proactive/run` 的 all-user 调度入口。不要和 `USER_KEY_VAULT_SECRET` 复用。
- `CRON_SECRET` 是 Vercel Cron 的同用途 alias；Vercel 会把它作为 Bearer token 发给 cron 路径。使用 Vercel Cron 时，可把它设置为与 `PROACTIVE_CRON_SECRET` 相同的强随机值，或只设置 `CRON_SECRET`。
- `VOICE_PROVIDER=shared-llm` 时语音与文本共用 `LLM_API_KEY` 和 `LLM_BASE_URL`，调用兼容 OpenAI 风格的 `/audio/transcriptions` 与 `/audio/speech`；`VOICE_STT_MODEL`、`VOICE_TTS_MODEL` 为空时 fallback 到 `LLM_MODEL`。
- `LLM_INPUT_COST_USD_PER_1M` 与 `LLM_OUTPUT_COST_USD_PER_1M` 用于成本看板估算，单位是每 100 万 tokens 的美元价格，只做展示，不做订阅、扣费或额度限制。
- 用户也可以在设置页保存自己的 LLM API key。服务端只返回 provider、model、key 尾号、key 指纹、端点是否已配置和端点指纹；不返回 key 原文、Base URL 明文或 `baseUrl` 字段。聊天链路优先使用用户 vault，未配置时回落服务端环境变量或 mock。换句话说，设置页保存的是当前登录用户的 BYOK 凭据，`.env.local` 里的 `LLM_API_KEY` 是可选的服务端兜底。
- 设置页“配置状态”面板调用 `GET /api/me/config-status` 做只读检查，会提示 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、session 签名 secret、`PROACTIVE_CRON_SECRET`、LLM key/model/baseUrl 和 `VOICE_PROVIDER` 的就绪状态与下一步动作；响应只返回状态、标签和建议，不显示真实数据库连接串、API key、vault secret、session secret、cron secret 或 Base URL 原文。

本地或 CI 也可以运行命令行就绪检查：

```bash
npm run env:readiness
```

该命令会读取项目根目录的 `.env.local`/`.env`，便于本地真实配置和 Next.js 开发习惯保持一致；如果环境变量已由 shell、CI 或部署平台注入，则优先使用已存在的进程环境变量。

生产前可加 strict 模式，让缺少 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、session 签名 secret 或主动回响 cron secret 时直接失败：

```bash
npm run env:readiness -- --strict
```

该脚本只输出状态、说明和下一步，不打印真实连接串、API key、Base URL 或 secret。默认不强制要求服务端 LLM key，因为第一版支持用户在设置页保存自己的 API key；如部署策略要求服务端兜底 key，可运行 `npm run env:readiness -- --strict --server-llm-required`。

Prisma 相关 npm 脚本也会先读取项目根目录的 `.env.local`/`.env`，再调用本地 Prisma CLI；因此 `npm run prisma:migrate`、`npm run prisma:migrate:deploy`、`npm run prisma:generate` 和 `npm run prisma:seed` 与 `env:readiness` 使用同一套本地配置来源。若配置了 `DATABASE_URL_UNPOOLED`，迁移命令会临时用它替代 `DATABASE_URL`，应用运行时仍保留 `DATABASE_URL`。

## Local PostgreSQL Setup

1. 在 Neon 创建 PostgreSQL 项目。
2. 复制应用连接串到本地 `.env.local` 的 `DATABASE_URL`；如果使用 Neon pooled 连接，再把 direct/unpooled 连接串填入 `DATABASE_URL_UNPOOLED`。
3. 本地生成并校验 Prisma client：

```bash
npm run prisma:generate
npm run prisma:validate
```

4. 本地开发执行迁移：

```bash
npm run prisma:migrate
```

5. 可选：写入 demo seed：

```bash
npm run prisma:seed
```

6. 验证真实数据库链路：

```bash
npm run db:smoke
```

`npm run db:smoke` 会在 `DATABASE_URL` 未配置时安全跳过；配置后会先执行 Prisma generate/validate，再创建测试用户、关系对象、会话、消息、记忆、关系状态、主动草稿、安全事件和模型调用日志，并在结束时清理测试数据。脚本输出会脱敏，不打印真实连接串。

生产部署前优先运行：

```bash
npm run verify:deploy
```

该命令会先执行 strict readiness，缺少 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、session 签名 secret 来源或主动回响 cron secret 时直接失败，然后再跑 Prisma validation 和 DB smoke。不要把未配置数据库时的本地 `db:smoke` 跳过结果当作生产通过。

已配置真实 `DATABASE_URL` 的环境不要依赖内存 fallback。无论本地真实试用、preview 还是 production，只要 PostgreSQL 不可访问，Prisma 错误都应直接暴露；只有未配置数据库或显式设置 `RENEWAL_REPOSITORY=memory` 时才走 demo memory。Preview/production 目标库迁移使用后文 Vercel Deployment 里的 `npm run prisma:migrate:deploy`，不要使用交互式 `prisma migrate dev`。

## LLM Gateway Setup

本项目业务层只调用统一 LLM adapter，不直接依赖单个供应商 SDK。真实中转站接入推荐：

```text
LLM_PROVIDER="compatible"
LLM_API_KEY="..."
LLM_BASE_URL="https://api.tryanotherone.com/v1"
LLM_MODEL="provider-model-name"
```

如果走用户自带 API key 的真实试用，`LLM_API_KEY` 可以不写进 `.env.local`：先启动网站，登录后到设置页保存 key、Base URL 和模型。服务端 fallback 适合演示账号共用同一部署方 key；个人试用优先用用户 vault，泄露面更小。

配置完成后运行：

```bash
npm run typecheck
npm run lint
npm run build
npm run smoke
```

然后在本地手动验证：

- 登录。
- 创建一个关系对象。
- 发送消息。
- 查看回复中的 provider/model 是否来自真实供应商。
- 打开模型调用看板，确认 latency、tokens、估算成本有记录。
- 调用 `/api/voice/transcribe` 和 `/api/voice/synthesize`，确认语音接口返回真实 provider；如果网关暂未开通语音模型，应安全 fallback 到 mock。

如果缺少 key/baseUrl/model，开发环境会 fallback 到 mock provider，并在响应里返回 `fallbackReason`。这适合无密钥开发，但不应作为生产配置。

TryAnotherOne 的模型列表端点需要 Bearer token。推荐在设置页先保存用户 API key 和 `LLM_BASE_URL=https://api.tryanotherone.com/v1`，然后点击“读取模型列表”，从 `/api/me/llm-models` 返回的可选模型中选择模型名并保存连接配置。已保存 key 后，后续修改 provider/model 或输入新的 Base URL 不需要重新输入 API key；Base URL 输入框留空时沿用已保存端点。服务端只沿用 vault 中的加密 key 和端点配置，前端状态只返回端点是否已配置与端点指纹，不会把 key 原文、Base URL 明文或 provider 原始错误返回到响应或日志。

若“读取模型列表”失败，先确认设置页里 provider 是 `compatible`，Base URL 是 `https://api.tryanotherone.com/v1`，再点“测试连接”。有些中转站账号、套餐或模型端点不会稳定返回 `/models`；这时可以手动填入中转站文档里的模型名并保存，然后通过聊天和模型调用看板验证真实调用是否已经发生。

保存配置后，可以在设置页点击“测试连接”。该按钮调用 `POST /api/me/llm-test`，复用用户 vault 或服务端 env key，发送一次低 token chat completion 探针确认当前模型真的可用；`/models` 只作为 compatible provider 的辅助诊断，不再作为成功标准。无 key 或无模型名时应返回明确失败；成功或失败响应都不得包含 API key、Base URL 原文、Authorization header、prompt 或供应商 raw payload。测试连接不代表平台扣费、订阅或额度能力，仍然是用户自带 API 或部署方 env key 的连通性检查。

可选真实 BYOK 目标联调使用独立 opt-in 命令，不进入默认 CI 或发布门禁：

```bash
REAL_PROVIDER_QA=1 \
REAL_LLM_API_KEY="your-test-key" \
REAL_LLM_BASE_URL="https://api.tryanotherone.com/v1" \
REAL_LLM_MODEL="provider-model-name" \
npm run qa:real-provider
```

该脚本会创建唯一 QA 用户，把测试 key 保存到用户 vault，验证模型列表/连接测试、一次真实聊天、消息持久化、模型调用看板记录和主动回响 dry-run。失败输出会脱敏；不要把真实 key、Base URL、供应商 raw payload、prompt 或截图中的私密数据写进文档、PR 或日志。脚本会优先复用已启动的本地 3000 服务；`REAL_QA_BASE_URL=http://127.0.0.1:3000` 可显式指定已有服务，`REAL_PROVIDER_FORCE_NEW_SERVER=1` 可强制自启临时服务；默认结束会删除 QA 用户。

默认本地/CI 门禁使用 fake-compatible 自测，不需要真实 key：

```bash
npm run qa:real-provider:fake
```

该命令只验证真实 BYOK 联调脚本逻辑和脱敏边界，不访问真实供应商，也不代表真实供应商联调通过。

## Vercel Deployment

1. 将仓库连接到 Vercel。
2. 在 Vercel Project Settings 中配置环境变量：

```text
DATABASE_URL
DATABASE_URL_UNPOOLED
LLM_PROVIDER
LLM_API_KEY
LLM_BASE_URL
LLM_MODEL
LLM_INPUT_COST_USD_PER_1M
LLM_OUTPUT_COST_USD_PER_1M
VOICE_PROVIDER
VOICE_STT_MODEL
VOICE_TTS_MODEL
VOICE_DEFAULT_VOICE
VOICE_CREDENTIAL_SOURCE
USER_KEY_VAULT_SECRET
SESSION_COOKIE_SECRET
PROACTIVE_CRON_SECRET
CRON_SECRET
```

3. Build command 使用：

```bash
npm run build
```

4. 首次上线前，在本地或 CI 对目标数据库执行：

```bash
npm run prisma:migrate:deploy
```

5. 每次推送前至少运行：

```bash
npm run secrets:check
npm run docs:check
npm run next:typegen
npm run git:boundary
npm run typecheck
npm run lint
npm run build
npm run smoke
```

6. 上线后验证：

- 首页可打开。
- 登录/登出可用。
- 创建关系对象成功。
- 聊天能调用真实 LLM。
- `npm run db:smoke` 在相同 `DATABASE_URL` 下通过。
- 设置页“配置状态”面板可打开并可重新检查；数据库、vault secret、session 签名 secret、cron secret、LLM 与语音配置项显示符合当前环境预期，页面不展示任何真实 secret、连接串或 Base URL 原文。
- 模型调用看板不展示 key、baseUrl、prompt、用户消息正文或 AI 回复正文。

## Proactive Scheduler

主动回响调度入口：

```text
POST /api/proactive/run
GET /api/proactive/run
```

第一版应用进程内不常驻调度器，也不依赖后台 worker。Vercel Cron、GitHub Actions scheduled workflow 或外部 cron 可以按固定频率调用这个受保护入口。

本地体验和生产调度要分开看：浏览器工作台打开时，当前关系对象会每分钟做一次前台检查并展示新草稿；页面关闭后，本地开发服务器不会继续替所有用户定时生成草稿。生产 all-user 调度由下面的 GET/POST 入口承担。

Vercel Cron 使用 GET 请求。仓库根目录的 `vercel.json` 已配置每分钟调用：

```json
{
  "crons": [
    {
      "path": "/api/proactive/run?limit=20&maxDrafts=50",
      "schedule": "* * * * *"
    }
  ]
}
```

GET 入口只支持 all-user 调度，必须携带 Bearer cron secret；成功鉴权后默认 `dryRun:false`，由调度器自身的频率、去重和 `maxDrafts` 护栏控制实际草稿生成量。Vercel Cron 需要在部署平台配置 `CRON_SECRET`，它会作为 Bearer token 发送到 cron 路径。若当前 Vercel 套餐不允许每分钟 cron，可先把 `schedule` 改成平台允许的最低频率；主动回响对象自身仍可配置 1 分钟候选频率。

`limit` 控制本轮扫描关系对象数量，`maxDrafts` 控制本轮最多生成或保存的草稿数量；调度器会归一化并裁剪过大的值。`npm run qa:proactive-cron` 会静态复核 `vercel.json`、GET 鉴权、`CRON_SECRET` alias、`dryRun` 默认值和这两个护栏参数；`npm run verify:deploy` 已包含该门禁。

POST 入口仍保留给 GitHub Actions、外部 cron、手动验证和 smoke。默认 `scope` 是 `current-user`，适合登录用户手动触发或 smoke 验证。生产定时调用若要扫描全部用户，必须使用 `scope: all`，设置 `PROACTIVE_CRON_SECRET` 或 `CRON_SECRET`，并在请求头携带：

```text
Authorization: Bearer <PROACTIVE_CRON_SECRET_OR_CRON_SECRET>
```

GitHub Actions scheduled workflow 示例：

```yaml
name: proactive-cron

on:
  schedule:
    - cron: "*/5 * * * *"
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger proactive scheduler
        run: |
          curl --fail --silent --show-error \
            --request POST \
            --header "Content-Type: application/json" \
            --header "Authorization: Bearer $PROACTIVE_CRON_SECRET" \
            --data '{"scope":"all","dryRun":false,"limit":20,"maxDrafts":50}' \
            "$APP_URL/api/proactive/run"
        env:
          APP_URL: ${{ secrets.APP_URL }}
          PROACTIVE_CRON_SECRET: ${{ secrets.PROACTIVE_CRON_SECRET }}
```

如果只想先做生产演练，把 Vercel 路径改成 `/api/proactive/run?dryRun=true&limit=5&maxDrafts=5`，或把 Actions JSON 里的 `dryRun` 改成 `true`。演练通过的判断是接口返回 200、`scope:"all"`、`authMode:"cron-secret"`，并且 `savedCount` 为 0。

建议上线初期先用 `dryRun:true` 观察 `generatedCount` 和 `savedCount`，确认频率设置合理后再切到 `dryRun:false`。接口只返回调度摘要、草稿数量和候选时间，不返回 cron secret、API key、数据库连接串或 prompt。

## Pre-launch Privacy and Security Checklist

这份清单用于每次上线前逐项核对。所有真实 secret 只进入本机 `.env.local`、部署平台环境变量、CI secret 或用户级加密 vault；不要写入仓库、文档、截图、issue、PR 描述或测试 fixture。

### 1. Secret and Environment Inventory

- [ ] `DATABASE_URL` 已配置在 Vercel/CI/本机 `.env.local`，仓库中只保留 `.env.example` 占位。
- [ ] `DATABASE_URL_UNPOOLED` 可选配置为 Neon direct 连接串，用于 Prisma 迁移；仓库中只保留空占位。
- [ ] `USER_KEY_VAULT_SECRET` 已配置为生产专用强随机值，长度至少 32 bytes，且没有复用开发值。
- [ ] `SESSION_COOKIE_SECRET` 可选独立配置为生产专用强随机值，长度至少 32 bytes；未配置时确认 `USER_KEY_VAULT_SECRET` 足够强并可作为 session 签名来源。
- [ ] `PROACTIVE_CRON_SECRET` 已配置为另一段强随机值，不能与 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET`、数据库密码或供应商 API key 相同；使用 Vercel Cron 时也配置 `CRON_SECRET` 或用 `CRON_SECRET` alias。
- [ ] `LLM_PROVIDER=compatible`、`LLM_BASE_URL=https://api.tryanotherone.com/v1` 已确认；`LLM_API_KEY` 只在服务端环境变量或用户 vault 中保存。
- [ ] `VOICE_PROVIDER=shared-llm` 已确认；语音复用 LLM 中转站凭据，只通过 `VOICE_STT_MODEL`、`VOICE_TTS_MODEL` 指定语音模型。
- [ ] `.env.local`、`.env.*.local`、`.npm-cache/` 不会被 Git 跟踪。
- [ ] 用户在设置页保存的 API key 只进入加密 vault；导出、日志、成本看板、前端响应不返回 key 原文、vault 密文或 baseUrl。
- [ ] 设置页“配置状态”面板和 `GET /api/me/config-status` 只用于只读准备度检查；可提示 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、session 签名 secret 来源、`PROACTIVE_CRON_SECRET`、LLM key/model/baseUrl、`VOICE_PROVIDER` 是否就绪，但不返回真实值。

生成强随机 secret 时只把结果粘贴到本机或部署平台，不要写入仓库文件：

```bash
npm run env:secrets
```

命令会一次生成 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 的候选值，只打印、不写文件。如果 `USER_KEY_VAULT_SECRET` 泄露，第一版按密钥轮换事故处理：轮换 secret，并要求受影响用户重新保存自己的供应商 API key。

### 2. Database Gate

- [ ] 生产数据库优先使用 Neon PostgreSQL；连接串只放平台 secret。
- [ ] 首次上线或 schema 变更后，对目标数据库执行迁移。
- [ ] `npm run prisma:validate` 通过。
- [ ] `npm run verify:deploy` 在目标环境通过。
- [ ] `npm run db:smoke` 在目标 `DATABASE_URL` 下通过；无数据库环境中允许显示安全跳过，但不能把跳过结果当作生产验收。
- [ ] `db:smoke` 输出中未出现真实连接串、密码、API key、token 或 Bearer header。

### 3. LLM and Voice Gateway Gate

- [ ] 文本模型通过统一 adapter 调用，不在业务代码中硬编码供应商 SDK 或模型名。
- [ ] TryAnotherOne 模型列表通过用户 vault 或服务端 env key 读取；模型名保存为配置，不保存 key 原文。
- [ ] 设置页“测试连接”通过 `POST /api/me/llm-test` 复用用户 vault 或服务端 env key，执行低 token chat completion 探针；无 key 或无模型名时返回可预测失败，响应不包含 API key、Base URL 原文、prompt 或供应商 raw payload。
- [ ] `npm run qa:real-provider:fake` 通过，确认本地 fake-compatible provider 能驱动 BYOK 联调脚本逻辑；该结果不等于真实供应商通过。
- [ ] `npm run qa:voice` 通过，确认 shared-LLM 语音 fake-compatible STT/TTS、Bearer、模型 fallback、用户 vault 优先和失败脱敏仍可用。
- [ ] 可选执行 `npm run qa:real-provider` 做真实 compatible BYOK 目标联调；仅在显式设置 `REAL_PROVIDER_QA=1` 和 `REAL_LLM_*` 测试变量时运行，不写入默认 CI、`verify:pr` 或发布门禁。
- [ ] 设置页“配置状态”重新检查后，LLM key/model/baseUrl 的状态与实际配置一致；缺失项只显示下一步建议，不显示用户 key、服务端 env key 或 Base URL 原文。
- [ ] 真实语音调用与 LLM 共用中转站；若网关未开通音频模型，接口应安全 fallback 到 mock 或返回可理解失败，不泄露 key/baseUrl。
- [ ] 成本看板只记录 provider、model、用途、状态、tokens、估算成本和延迟，不记录 prompt、用户消息、AI 回复、供应商 raw payload 或密钥。

### 4. Proactive Cron Gate

- [ ] 第一版没有应用进程内常驻调度器；生产 all-user 调度由 Vercel Cron 调用 `GET /api/proactive/run`，或由 GitHub Actions/外部 cron 调用 `POST /api/proactive/run`。
- [ ] all-user 调度只允许携带 `Authorization: Bearer <PROACTIVE_CRON_SECRET_OR_CRON_SECRET>` 或 `x-proactive-cron-secret` 的请求访问。
- [ ] Cron 平台中只配置 secret 值，不把 secret 写进 URL query、日志命令或仓库脚本。
- [ ] 首次上线先用 POST `dryRun:true` 验证扫描数量和候选时间，再启用 Vercel Cron 或切换外部 cron 为 `dryRun:false`。
- [ ] 调度响应不包含 cron secret、API key、数据库连接串、prompt 或消息正文。

### 5. Local and CI Verification Gate

推送前至少执行：

```bash
npm run secrets:check
npm run qa:samples
npm run qa:prompt
npm run qa:imports
npm run qa:vault
npm run qa:logging
npm run qa:response
npm run qa:voice
npm run qa:real-provider:fake
npm run pwa:check
npm run prisma:validate
npm run db:smoke
npm run typecheck
npm run lint
npm run build
npm run smoke
```

依赖漏洞扫描需要网络时使用项目内 cache，避免把 npm 缓存写到系统盘：

```bash
npm --cache .\.npm-cache audit --audit-level=high
```

- [ ] `secrets:check` 通过，且没有把真实 API key、Bearer token、数据库密码、vault secret 写进仓库。
- [ ] `npm --cache .\.npm-cache audit --audit-level=high` 通过，或已记录明确的不可利用原因和升级计划。
- [ ] `build`、`smoke`、`qa:samples`、`qa:prompt`、`qa:imports`、`qa:vault`、`qa:logging`、`qa:response`、`qa:voice` 通过。
- [ ] 如本轮涉及前端交互，`npm run e2e` 也应通过。

### 6. Incident Response Before Push

- [ ] 如果发现 key 入仓库：立即从文件中移除，运行 `npm run secrets:check`，并在供应商侧轮换 key。
- [ ] 如果发现 `DATABASE_URL` 泄露：轮换数据库密码或连接串，确认旧连接失效。
- [ ] 如果发现 `USER_KEY_VAULT_SECRET` 泄露：轮换 secret，并通知/要求用户重新保存供应商 key。
- [ ] 如果发现 `SESSION_COOKIE_SECRET` 泄露：轮换 secret，并让现有登录态失效。
- [ ] 如果发现 `PROACTIVE_CRON_SECRET` 泄露：轮换 secret，并更新 Cron 平台配置。
- [ ] 不在提交信息、PR 描述、聊天记录截图中贴真实 secret。

## Release Checklist

- `DATABASE_URL` 只存在于 `.env.local` 或平台 secret。
- `DATABASE_URL_UNPOOLED` 如已配置，也只存在于 `.env.local` 或平台 secret。
- `LLM_API_KEY` 只存在于 `.env.local`、平台 secret 或用户级加密 vault。
- `USER_KEY_VAULT_SECRET` 已配置为强随机值，且不在仓库中。
- session 签名 secret 来源已确认：独立 `SESSION_COOKIE_SECRET`，或足够强的 `USER_KEY_VAULT_SECRET` fallback，且不在仓库中。
- `PROACTIVE_CRON_SECRET` 已配置为另一段强随机值，且不在仓库中。
- Vercel Cron 部署已配置 `CRON_SECRET`，或确认当前部署不使用 Vercel Cron。
- 设置页“配置状态”已人工检查并重新检查过，确认不暴露 `DATABASE_URL`、API key、Base URL、vault secret、session secret 或 cron secret 原文。
- `npm run secrets:check` 通过。
- `npm run prisma:validate` 通过。
- `npm run prisma:migrate:deploy` 已对目标数据库执行。
- `npm run verify:deploy` 已在目标部署环境通过，证明 env/secrets 已 mirror 且目标 `DATABASE_URL` 可用。
- `npm run db:smoke` 已在目标 `DATABASE_URL` 下通过；跳过结果只可用于未配置数据库的本地/CI baseline，不能作为生产验收。
- `npm run typecheck` 通过。
- `npm run lint` 通过。
- `npm run build` 通过。
- `npm run smoke` 通过。
- 成本看板只记录脱敏元数据，不记录正文和密钥。
- 付费订阅、额度系统、内容审核后台、反馈问卷、内测邀请机制暂不进入第一版上线范围。

## GitHub Actions CI

仓库包含保守的 CI 基线：`.github/workflows/ci.yml` 会在 `push` 和 `pull_request` 时运行，不需要 `DATABASE_URL`、`LLM_API_KEY` 或其他真实 secret。

CI 默认执行：

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
npm run qa:imports
npm run qa:vault
npm run qa:logging
npm run qa:response
npm run qa:voice
npm run pwa:check
npm run env:readiness
npm run prisma:validate
npm run db:smoke
npm run smoke
npm run build
```

CI 不默认执行 `npm run e2e`，因为当前 Playwright 配置使用本机系统 Edge，GitHub runner 未必有相同 channel。涉及前端交互、布局或录音入口的改动，仍应在本地发布前跑 `npm run e2e`。

CI 也不默认执行 `npm audit`，避免外部网络波动阻塞普通 PR。发布前仍需在本地使用项目内 cache 执行：

```bash
npm --cache .\.npm-cache audit --audit-level=high
```

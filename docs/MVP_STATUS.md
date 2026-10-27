# MVP Status

更新日期：2026-10-26（8 月历史验收与本轮候选分列）

本文件是主控施工状态面板，用于快速判断当前第一版 MVP 是否可演示、可继续开发、可进入真实环境联调。

## 当前结论

2026-10-26 主控确认 M136 会话切换隔离、M137 语音 locale、M138 持久化调度续扫的本地回归通过，已追加集成记录。M139 默认自托管邮箱/密码、注册验证、旧账号邮箱恢复、v2 session 与邮件代码已通过本地后端/SMTP 和 UI 回归；真实数据库认证集成、QQ SMTP/HTTP 投递与目标新增迁移仍待验证。M140 安全刷新剩余门禁待确认。`AUTH_MODE=local-email` 仅限显式非生产测试。

本轮 audit 初查为 6 vulnerabilities（5 high、1 critical）；Next.js/eslint-config-next 16.4.3 与传递依赖修复后主控确认 0 vulnerabilities，lint、typecheck、build、全量 E2E 32 项、本地调度 20 项、语音语言 16 项、本地认证后端及 SMTP 33 项通过。完整 memory smoke 正在修正 zh-CN→zh fixture 并复跑，尚不能标为通过。8 月历史 readiness/DB smoke 不代表本轮结果。

本轮 Playwright 实际展开并通过 32 个用例、6 个 spec；主控已用 Playwright `--list` JSON 修正文档计数。真实隔离 PostgreSQL 集成在 CREATE SCHEMA 阶段返回 `database_unreachable`，提权重试亦失败；没有创建 schema、没有执行迁移。可选 `qa:auth:postgres` 待数据库可达后重跑；严格 readiness 仍缺新认证邮件配置（AUTH_MAIL），真实邮件和目标迁移待验证。候选 M139、M140 依次继续验收。

当前项目已经完成纵切 MVP：账号、关系对象、聊天、回复格式清洗、记忆、关系状态、主动回响、用户级 LLM key vault、多供应商适配、签名 session cookie、私有 no-store API 响应边界、语音 mock/compatible adapter、模型调用日志、数据导出、账号删除、安全事件日志、响应式/PWA 工作台、结构化素材导入和上线前隐私/安全清单均已集成。

当前发布候选分支为 `codex/mvp-release-candidate`；当前同步点以 `git status --short --branch` 和 `git log -1 --oneline` 的实时结果为准；首个 baseline 提交为 `ef4939e feat: build relationship ai mvp baseline`。M56 Taskbook 状态门禁实现提交为 `d7a72f2 docs: sync taskbook status gates`，M66 发布门禁与隔离补强提交为 `fd6778a test: isolate memory fallback and derive release gates`。10 月新增模块与依赖修复尚有待验收项。远端目标分支为 `origin/codex/mvp-release-candidate`，是否 ahead 或已推送以 `git status --short --branch` 的实时结果为准；PR 创建页为 https://github.com/lvicztojry/perpetual-renewal/pull/new/codex/mvp-release-candidate ，PR 正文草稿为 [docs/PR_DRAFT.md](PR_DRAFT.md)。8 月本机曾通过严格 readiness 与真实 Neon/PostgreSQL smoke；部署目标仍需在目标环境设置同等 secret/env 后复跑 `npm run verify:deploy`。个人真实试用优先走设置页用户 vault；服务端 LLM key/model 只是 fallback。

## 已集成能力

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 账号与资料 | candidate | 资料设置/登出沿用；默认邮箱/密码、注册验证、旧账号邮箱恢复为 M139 待验收增量 |
| Session 安全 | candidate | HMAC 签名延续；密码 v2 到期校验与重置撤销为 M139 待验收增量 |
| API 缓存边界 | integrated | 用户数据、聊天、记忆、导出、用量、语音、主动回响和配置状态 API 返回 private no-store 响应头 |
| 全关系对象 | integrated | 恋人、朋友、家人、师友、现实替代、逝者纪念、前任、公众人物想象、虚构、原创、自定义 |
| 聊天闭环 | integrated | 消息持久化、失败恢复、重新生成、删除、标记重要 |
| LLM 适配 | integrated | compatible、Anthropic、Gemini、OpenAI Responses、mock fallback |
| 用户级 key vault | integrated | 设置页保存/删除/查看摘要；AES-256-GCM 加密；不返回 key 原文 |
| 模型列表与连接测试 | integrated | 通过用户 vault 或服务端 env 读取兼容中转站 `/models`，设置页可测试连接 |
| 配置状态向导 | integrated | 设置页只读展示数据库、vault secret、session 签名 secret、cron secret、LLM 和语音配置状态，不暴露真实值 |
| 账号删除 | integrated | 设置页危险区确认短语删除；后端清理当前用户关系、消息、记忆、日志、vault 并清除 session |
| Prompt 上下文预算 | integrated | 角色设定固定保留，记忆与最近消息按预算裁剪 |
| 记忆系统 | integrated | pending、active、archived、deleted 生命周期；deleted 记忆不进入用户列表、prompt 或导出 |
| 素材导入 | integrated | 单段文本、批量文本数组、JSON Lines、本地 `.txt/.jsonl/.json` 文件读取、媒体说明、照片/音视频文件摘要、通讯录脱敏摘要，默认 pending 并脱敏密钥形态 |
| 关系状态 | integrated | 共享状态演进逻辑已接入聊天后更新、关系状态 API 和主动回响上下文；Prisma/memory repository 持久化 |
| 主动回响 | integrated | 站内草稿、撒娇式未回复回响、1 分钟默认节奏、自定义频率、当前工作台前台自动检查、受保护 cron 入口 |
| 主动草稿状态 | integrated | draft、sent、dismissed、blocked 状态管理与筛选 |
| 安全边界 | integrated | 运行时规则、安全 QA 样例、脱敏安全事件日志 |
| 模型调用看板 | integrated | provider/model/latency/tokens/估算成本，不记录正文或 key |
| 语音能力 | integrated | 浏览器录音入口、shared-LLM compatible STT/TTS、mock fallback |
| 数据导出 | integrated | 当前用户 JSON 快照，排除 key/baseUrl/vault 密文和 deleted 记忆 |
| 响应式/PWA 体验 | integrated | 390px 移动端 E2E 覆盖无横向溢出；manifest、图标、离线页和安全 service worker 已接入 |

## 2026-08-23 历史主控验收

以下为 8 月历史记录；10 月新增候选、测试与依赖升级须重新验收：

```bash
npm run typecheck
npm run lint
npm run docs:check
npm run git:boundary
npm run secrets:check
npm run env:readiness -- --strict
npm run db:smoke
npm run smoke
npm run qa:samples
npm run qa:prompt
npm run qa:imports
npm run qa:vault
npm run qa:logging
npm run qa:response
npm run qa:providers
npm run qa:proactive-cron
npm run qa:real-provider:fake
npm run pwa:check
npm run prisma:validate
npm run build
npm run e2e
npm --cache .\.npm-cache audit --audit-level=high
```

结果摘要：

- `smoke`：94 checks passed。
- `docs:check`：documentation consistency passed。
- `git:boundary`：tracked and committable file boundary passed。
- M135 历史 `e2e`：15 tests passed；默认是 managed mock/memory 浏览器门禁，不依赖真实供应商响应速度。
- M136 会话切换隔离：会话草稿、延迟历史和进行中回复隔离，主控确认全量 E2E 32 项通过。
- M137 语音 locale 兼容：zh-CN 归一为 zh，本地语音语言 16 项通过；真实供应商另验。
- M138 主动调度公平续扫：数据库 checkpoint 与 keyset cursor 跨冷启动续扫，本地调度 20 项通过；目标迁移待验证。
- `pre-push audit`：0 vulnerabilities。
- `qa:samples`：10 relationship kinds、19 safety areas passed。
- `qa:prompt`：10 relationship kinds passed。
- `qa:imports`：structured media/contact import planner passed。
- `qa:vault`：vault and config readiness security matrix passed。
- `qa:logging`：runtime log sanitization passed。
- `qa:response`：API response text sanitization passed。
- `qa:providers`：non-compatible provider adapter hermetic fake-server coverage passed。
- `qa:voice`：shared-LLM voice fake-compatible STT/TTS passed。
- `qa:real-provider:fake`：local fake-compatible BYOK flow self-test passed。
- `pwa:check`：manifest、icons、offline shell 和 service worker boundary passed。
- `npm audit`：0 vulnerabilities。
- `env:readiness -- --strict`：missing=0，warning=3；输出保持脱敏。
- `db:smoke`：真实 Neon/PostgreSQL 连接通过；完整 smoke 94 checks passed。
- C 盘可视化目录无项目产物；npm audit cache 使用项目内 `.npm-cache`。

## 真实配置与部署复核

8 月本机 `.env.local` 曾通过严格 readiness、真实 DB smoke 与 `verify:deploy`。10 月认证邮件与新增迁移尚未完成目标验证；真实值仍只允许放在 `.env.local`、部署平台 secret 或网站设置页用户 vault，不写入仓库。部署到新目标环境时按下表逐项同步并复跑验证。

| 项 | 建议 |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL，连接串只放 `.env.local` 或部署平台 secret |
| `DATABASE_URL_UNPOOLED` | 可选 Neon direct 连接串，供 Prisma 迁移使用；只放 `.env.local` 或部署平台 secret |
| 认证邮件 | `AUTH_APP_URL`、`AUTH_MAIL_FROM`、`AUTH_MAIL_TRANSPORT=smtp` 配合 `AUTH_SMTP_HOST/PORT/USER/PASSWORD`；个人邮箱授权码测试无需自有域名。可选 `http` 配合 `AUTH_MAIL_API_URL/KEY`；真实投递待验证 |
| `USER_KEY_VAULT_SECRET` | 生产专用强随机值，至少 32 bytes，不复用开发值 |
| `SESSION_COOKIE_SECRET` | 可选独立 session 签名 secret，至少 32 bytes；为空时复用强 vault secret |
| `PROACTIVE_CRON_SECRET` | 另一段强随机值，不能和 vault secret 或数据库密码相同 |
| `CRON_SECRET` | Vercel Cron alias；使用 Vercel Cron 时配置它或 `PROACTIVE_CRON_SECRET` |
| LLM 配置 | 默认 `LLM_PROVIDER=compatible`、`LLM_BASE_URL=https://api.tryanotherone.com/v1`；key 放用户 vault 或服务端 secret |
| Voice 配置 | 默认 `VOICE_PROVIDER=shared-llm`，语音模型用 `VOICE_STT_MODEL`、`VOICE_TTS_MODEL` |
| 数据库迁移 | 本地开发用 `npm run prisma:migrate`；生产目标数据库用 `npm run prisma:migrate:deploy` 后跑 `npm run verify:deploy` |
| 推送/PR 前检查 | 必跑 `npm run verify:local -- --skip-e2e`、`npm run e2e`、`npm run verify:release`、`git status --short --branch` 与 `git status --short --ignored`；目标部署环境同步配置后再跑 `npm run verify:deploy`；真实 API/真实 LLM 体验验证单独记录，不替代 mock/local E2E 门禁 |

生成 secret 的建议命令：

```bash
npm run env:secrets
```

命令会一次生成 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 的候选值，只打印、不写文件；输出值只放入 `.env.local` 或部署平台 secret。

本地体验口径：用 `npm run dev` 启动后打开 `http://127.0.0.1:3000` 或 `http://localhost:3000`；真实 API key 优先在设置页保存。工作台打开时当前关系对象会每分钟检查主动回响草稿；如果关闭页面，本地没有 all-user 常驻调度，生产才由 Vercel Cron、GitHub Actions 或外部 cron 调用受保护入口。

E2E 口径：`npm run e2e` 是发布前稳定浏览器门禁，runner 会清空 LLM key/baseUrl/model 并使用 mock fallback。复用已有服务或显式 `E2E_REAL_PROVIDER=1` 时，结果只作为真实供应商联调/体验风险记录；供应商慢响应、超时、429、余额不足或模型列表不可读但可手动填写模型名，不直接判定发布门禁失败。

## 继续施工队列

本轮已继续完成：

- M25 导入体验 QA 补强：已把文本文件导入、JSONL 解析失败、过大文件拒绝写进 QA 文档与验收说明。
- M26 设置页模型体验收束：已补充连接测试的 LLM、部署和 QA 文档说明。
- M27 第一版发布候选清理：已统一 README、Taskbook、MVP 状态与上线文档中的验收命令和当前 check 数。
- M28 真实配置状态向导：已在设置页增加只读配置状态检查，提示缺少 `DATABASE_URL`、vault secret、session 签名 secret 来源、cron secret、LLM key/model/baseUrl 和语音配置，但不暴露具体值。
- M29 发布候选手动验收脚本：已新增 20 分钟人工演示脚本。
- M30 错误状态文案统一：已补充聊天、导入、语音、模型连接、数据导出、数据库和 cron secret 等错误状态的文案规范。
- M31 配置状态 QA 文档：已补充 `GET /api/me/config-status` 的脱敏验收口径和人工检查步骤。
- M32 设置页配置状态 E2E 补强：已在桌面和 390px 移动端 E2E 中检查配置状态面板与重新检查入口。
- M33 发布候选 README 精简：已把 README 和 docs README 整理成新协作者入口。
- M34 真实配置向导文档收束：已把配置状态面板补进部署文档和发布候选人工验收脚本。
- M35 首次提交前检查清单：已新增 commit/push 前文件边界、密钥扫描、质量门禁、真实配置和人工验收清单。
- M36 首次提交准备与执行：已创建 `codex/mvp-release-candidate` 分支并提交 `ef4939e feat: build relationship ai mvp baseline`。
- M37 GitHub Actions CI 基线：已新增 push/PR 门禁，覆盖 install、密钥扫描、类型、lint、QA、Prisma、smoke 和 build。
- M38 命令行环境就绪检查：已新增 `npm run env:readiness`，本地提示缺失配置，strict 模式用于生产门禁，输出保持脱敏。
- M39 本地顺序验证脚本：已新增 `npm run verify:local`、`npm run verify:pr`、`npm run verify:release` 和 `npm run verify:deploy`，顺序跑质量门禁；deploy 版本使用 strict readiness 与真实 DB smoke，避免缺生产配置时误判通过；verify 本地/发布入口会在 Git boundary 前先运行 `next:typegen`，防止 Next dev server 留下的 dev route type 路径阻塞发布检查。
- M40 协作者开发说明：已新增 `docs/CONTRIBUTING.md`，说明模块边界、fallback、密钥规则、常用命令和文档更新方式。
- M41 命令行本地 env 加载一致性：已新增共享 `.env.local`/`.env` 加载 helper，让 `env:readiness` 与 `db:smoke` 的命令行检查和 Next.js 本地配置习惯对齐，同时保持脱敏输出。
- M42 发布迁移与密钥扫描补强：已新增生产迁移脚本 `prisma:migrate:deploy`，固定依赖版本，清空 `.env.example` 数据库示例值，CI 增加 readiness/db smoke，并扩展密钥扫描到数据库连接串、vault/cron secret、Bearer/JWT 和 vault 密文形态。
- M43 发布文档命令一致性：已将文档入口、协作者说明和数据库文档中的安装/迁移命令统一到 `npm ci`、本地 `prisma:migrate`、生产 `prisma:migrate:deploy` 的口径。
- M44 发布口径自动检查：已新增 `npm run docs:check` 并接入 CI 与本地 verify，自动检查旧安装命令、裸 audit、旧 smoke 数字、生产迁移口径、`latest` 依赖、危险 `.env.example` 和 CI 文档门禁。
- M45 Git 文件边界自动检查：已新增 `npm run git:boundary` 并接入 CI 与本地 verify，自动确认项目不在 C 盘，且 `.env.local`、构建目录、npm cache、`node_modules`、测试结果、日志和 tsbuildinfo 等不进入 Git scope。
- M46 Post-baseline 状态回写：已把 M36 的分支、提交 hash 和当前剩余阻塞同步回主控状态文档。
- M47 PR/发布候选交接材料：已新增 `.github/pull_request_template.md` 与 `docs/RELEASE_HANDOFF.md`，记录 PR 模板、push 前命令、CI 预期、目标环境配置复核和后续动作。
- M48 Pre-push 发布验证：当时已重新执行 E2E 与 high severity audit；当时 E2E 结果为 15 tests passed，`npm --cache .\.npm-cache audit --audit-level=high` 为 0 vulnerabilities，并回写到 `docs/RELEASE_HANDOFF.md`。
- M49 Next typed routes 稳定化：已新增 `npm run next:typegen`，`npm run typecheck` 会先生成 Next route types；E2E 结束后也会重新 typegen，避免 `next-env.d.ts` 在 `.next/dev/types` 与 `.next/types` 之间留下脏工作树。
- M50 发布门禁增强：`npm run git:boundary` 已新增 `next-env.d.ts` 检查，若残留 `.next/dev/types` 引用会提示先运行 `npm run next:typegen`。
- M51 导入候选去重体验：导入规划会跳过同批重复内容，导入 API 会跳过当前关系已有非 deleted 记忆，工作台展示“本次重复/已存在”摘要。
- M52 语音 shared-LLM 兼容性加固：语音 API 返回脱敏 runtime metadata，剥离内部 raw 字段，并兼容常见 STT/TTS 响应变体。
- M53 主动回响成本护栏：`POST /api/proactive/run` 新增 `maxDrafts` 调度上限，默认限制单轮生成/保存草稿数量，降低全量 cron 一次生成过多草稿的风险。
- M54 施工决策点收束：Taskbook 末尾旧的技术栈/模型/数据库/部署疑问已改为“已决策基线”和“仍需外部配置”。
- M55 Session 接入状态收束：Taskbook 中 M1 的旧 userId 待接入状态已更新为当前 session `userId` 已接入 renewal API。
- M56 Taskbook 状态门禁：已同步任务定义与当前任务快照的状态口径，并让 `npm run docs:check` 拦截关键任务状态漂移。
- M57 账号删除：新增 `/api/me/account` 与设置页危险区，确认短语为“删除我的账号”，删除当前用户数据、vault、日志并清除 session；smoke 覆盖错误确认和正确删除。
- M58 移动端 PWA：新增 `manifest.webmanifest`、SVG 图标、离线页和 service worker；service worker 明确跳过 `/api/*`，不缓存用户数据或密钥相关响应。
- M59 多媒体/照片/通讯录导入：工作台导入面板新增媒体/通讯录结构化入口，原文件只在浏览器读取为说明或脱敏摘要，继续复用导入 API 写入 pending 记忆。
- M60 PRD 范围回写门禁：PRD 升级到 v0.3，第一版范围同步用户自带 key、结构化导入、语音基础链路、PWA 和账号删除，并由 docs check 拦截旧范围表述回流。
- M61 接口输入护栏：导入 API 坏 JSON 返回 400；STT 要求音频或 mock 文本并校验 base64/MIME/大小；TTS 限制文本长度、voice 名称和 speed 范围；当时 smoke 覆盖因接口输入护栏扩展而提升。
- M62 密钥与发布门禁：vault 指纹改为 HMAC，生产 vault secret 强制 32 bytes；secret scan 泛化到 `*_API_KEY`、`*_SECRET`、`*_TOKEN`、vault 密文字段；新增 `pwa:check`、`verify:pr` 和 `verify:deploy`。
- M63 文档命令/链接门禁：`docs:check` 纳入 PR 模板、本地 Markdown 链接和文档里的 `npm run` 命令，防止 PR/发布文档引用不存在的文件或脚本。
- M64 结构化导入与 vault QA：新增 `qa:imports` 与 `qa:vault`，分别覆盖媒体/通讯录 planner 脱敏兼容和生产 vault/config readiness 安全矩阵。
- M65 导出隐私、DB credential 和设置页 E2E 硬化：导出层新增字符串级敏感内容脱敏；DB smoke 覆盖 ProviderCredential 读写、唯一约束和级联清理；E2E 增加设置页密钥、连接失败态、导出下载、账号删除确认和 320px/768px 响应式覆盖。
- M66 本地 session 隔离、cron 边界和文档指标派生门禁：memory fallback 登录按邮箱派生隔离 userId，避免并行 E2E 共享 demo user；主动回响 all-user cron 覆盖 Bearer/header secret 与 guard clamp；`docs:check` 从测试源自动派生 smoke/E2E/QA 数字和最新 M milestone。
- M67 主动回响调度文档与交接门禁：架构与部署文档明确第一版应用进程内不常驻调度器，生产由 Vercel Cron、GitHub Actions 或外部 cron 调用受保护的 `POST /api/proactive/run`；`docs:check` 拦截旧调度表述回流；交接材料同步 PR 草稿路径、M66 后候选状态和生产 `verify:deploy` 前置配置口径。
- M68 关系状态 API 持久化收束：`/api/companions/:id/relationship-state` 读取和更新当前 session 用户的持久化关系状态，不再返回早期 mock/DEV-9 元数据；POST 基于当前 companion 状态经共享关系状态演进逻辑计算后写回 Prisma 或 memory fallback。
- M69 核心写接口 JSON 输入护栏：关系创建/编辑、消息发送/操作、记忆编辑和安全检查统一坏 JSON 400 响应，不暴露解析异常、内部 stack 或旧调试信息。
- M70 JSON 输入护栏补齐：登录、用户资料、账号删除、用户 LLM credential/test、关系记忆候选、关系状态、主动草稿和主动消息状态更新统一 JSON object 入参解析；坏 JSON、`null`、数组等非对象 body 返回友好 400，响应不暴露解析器原文、TypeError、stack、Bearer、baseUrl 或密钥相关内容。
- M71 JSON 解析入口收口：API 目录不再直接调用 `request.json()`；chat、导入、语音和主动调度入口统一共享 JSON helper；`POST /api/proactive/run` 保留空 body 默认 dry-run，但坏 JSON、`null`、数组等非对象 body 返回友好 400；QA/错误文案文档补齐 JSON body 护栏口径。
- M72 运行时 handoff 元数据清理：安全检查 API 不再向客户端返回早期 `next`/`DEV-11` handoff 字段；smoke 在全部安全样例中防止旧 DEV 元数据、prompt、key、Base URL 或输入原文回流。
- M73 数据库文档状态收口：`docs/DATABASE.md` 移除旧的 mock-dev session 和 relationship-state mock-oriented 口径，改为当前 session userId 隔离、email session fallback demo user，以及 relationship-state API 走 Prisma/memory repository 持久化。
- M74 运行时代码边界门禁：`git:boundary` 新增 API 路由不得直接调用 `request.json()`、运行时 `src/app`/`src/lib` 不得包含 `DEV-*` handoff 元数据的检查，防止 M71/M72 清理项回流。
- M75 运行时隐私与决策口径收束：运行时 fallback warning 使用 `safeLogValue()` 脱敏；用户 LLM vault 状态不返回 Base URL 明文或 `baseUrl` 字段；模型列表失败不透传 provider 原始异常；smoke 覆盖 profile 关闭主动回响、credential endpoint 隐私和模型列表失败脱敏；docs check 收束 TryAnotherOne、用户自带 API key、`VOICE_PROVIDER=shared-llm` 和暂缓产品项口径。
- M76 手动记忆候选 API 覆盖：smoke 覆盖 `POST /api/companions/:id/memories` 成功创建指定类型 pending 记忆、列表可见，以及 unsupported memory type 返回 400。
- M77 API/导出隐私边界补强：LLM credential 保存失败只返回白名单业务文案；voice unsupported provider fallback 不回显误配值；用户导出会脱敏 profile 内误写入的 token/provider endpoint；git boundary 阻止 API route 直接返回 raw `error.message` 和 voice raw payload。
- M78 API 校验错误边界收束：import/profile/account 路由不再直接返回异常对象 `error.message`；profile invalid PATCH smoke 覆盖多字段校验失败不会造成部分写入；git boundary 拦截 API route 直接回传 `error.message`。
- M79 模型列表供应商分支覆盖：smoke 覆盖已保存 `anthropic` 等非 compatible provider 后调用 `/api/me/llm-models` 返回稳定“仅支持兼容中转站”文案，且不泄露 key、endpoint、Bearer、`baseUrl` 或 raw payload。
- M80 主动回响重复生成门禁：smoke 覆盖调度器保存站内草稿后，在同一 `now` 再次执行不会立刻重复生成或保存草稿，并以已保存草稿作为下一次候选时间锚点。
- M81 手动记忆输入边界补强：smoke 覆盖手动创建记忆保留 `sourceMessageId` 链接，未知 `sourceMessageId` 与空白 `content` 返回稳定 400，且不写入悬挂/空 pending 记忆。
- M82 记忆编辑空内容护栏：`PATCH /api/memories/:id` 拒绝空白 `content` 并返回稳定 400；smoke 覆盖拒绝后保留原记忆内容，不把 active/pending 记忆覆盖为空。
- M83 设置页模型列表 E2E 隐私覆盖：E2E 覆盖保存用户 API key 后读取兼容中转站模型列表、点击模型回填输入框、失败文案和 diagnostic 前端脱敏稳定，且页面不回显完整 key、Base URL、Bearer、prompt、rawPayload 或 stack；当时 E2E 数量 15 tests。
- M84 聊天消息输入错误边界：`POST /api/conversations/:id/messages` 空白内容返回稳定 400；`regenerate` 拒绝用户消息并返回稳定文案，不透传异常对象。
- M85 导入错误恢复 E2E 覆盖：主链路 E2E 覆盖坏 `.json` 文件解析失败后的前端恢复，确认友好错误、导入按钮不可用，并可重新选择有效 `.jsonl` 文件继续导入候选。
- M86 关系对象校验错误边界：`POST/PATCH /api/companions` 对空名称、空语气、非法关系类型返回稳定白名单 400；非法关系不会创建记录，失败编辑不会部分写入其他字段。
- M87 用量看板查询范围边界：`GET /api/usage/model-calls` 只接受 1-90 天有限 `rangeDays`；非法 query 返回稳定 400，不回显 key、Base URL、prompt 或 raw payload。
- M88 关系表单失败恢复 E2E：创建/编辑关系失败时前端展示服务端稳定文案，状态栏提示重试，表单草稿保留且按钮恢复可用；当时 E2E 数量 15 tests。
- M89 运营反馈机制暂缓口径：PRD、Taskbook 和部署清单明确内容审核后台、反馈问卷、内测邀请机制不进入第一版，后续恢复时单独设计运营反馈模块。
- M90 用户模型端点类型校验：`PUT /api/me/llm-credential` 对非字符串 `baseUrl` 返回稳定 400，不静默忽略异常类型，也不回显用户 API key 或端点字段。
- M91 导出常见外部 token 脱敏：用户误把 GitHub PAT/`ghp_` 等常见外部 token 写入记忆时，导出快照会替换为 `[REDACTED_KEY]`，不把 token 原文带出。
- M92 设置页保存错误脱敏 E2E：模型列表、连接测试和保存失败错误会在前端再次脱敏当前 API key/Base URL；失败后草稿保留、按钮恢复可重试。
- M93 语音转写元数据边界：STT 输入拒绝异常文件名、语言标签和过长 mock 文本，错误响应不回显 Bearer、prompt、raw payload 或用户配置。
- M94 发布候选文档口径同步：README、部署、QA、PR 草稿、handoff 和 Taskbook 同步当前 smoke checks / 13 E2E tests、`qa:logging`、Neon-first PostgreSQL、TryAnotherOne compatible、BYOK 与 `VOICE_PROVIDER=shared-llm` 口径。
- M95 工作台错误展示脱敏：聊天、记忆、主动回响、导入、语音和用量看板错误展示统一走前端脱敏；E2E 覆盖调用看板错误夹带 Bearer、API key、Base URL、prompt、rawPayload、stack 时不显示原文。
- M96 模型连接失败隐私覆盖：`/api/me/llm-test` 与 `/api/me/llm-models` 覆盖 URL 构造失败、供应商 HTTP 失败、fetch 网络失败和 compatible 模型列表异常响应诊断，响应不回显 key、Bearer、endpoint/Base URL、prompt、rawPayload、stack 或底层网络原文；当前 smoke 基线 94 checks。
- M97 API 私有缓存边界：新增 `privateJson()`，用户数据、聊天、记忆、关系、导出、配置、模型、用量、语音、主动回响与安全检查 API 统一返回 `Cache-Control: private, no-store` 等响应头；smoke 覆盖代表性接口缓存头。
- M98 签名 session cookie：本地 email session cookie 从裸 `userId` 改为 HMAC 签名的 `v1.<payload>.<signature>`；生产环境要求 `SESSION_COOKIE_SECRET` 或 `USER_KEY_VAULT_SECRET`；smoke 覆盖伪造裸 userId cookie 不可越权、登录/登出/删号 cookie 属性和清理。
- M99 Session 签名 secret 门禁：运行时、设置页配置状态和 `env:readiness --strict` 统一检查 session 签名来源；生产环境要求 `SESSION_COOKIE_SECRET` 或可复用的强 `USER_KEY_VAULT_SECRET` 至少 32 bytes，短 secret 会失败或显示 warning。
- M100 Verify typegen 预检：`verify:local`、`verify:pr` 和 `verify:release` 在 `git:boundary` 前先执行 `next:typegen`，让 release gate 自行恢复 `next-env.d.ts` 的 production route type imports。
- M101 Session secret env 模板同步：`.env.example` 新增空的 `SESSION_COOKIE_SECRET` 占位；`docs:check` 要求 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 都保持空占位，不把真实配置写入仓库。
- M102 Session secret 日志脱敏覆盖：运行时日志脱敏显式覆盖 `SESSION_COOKIE_SECRET=...`；logging QA 与 secret scan smoke 同步验证 session signing secret 不会进入日志或可提交文件。
- M103 PR 配置清单 session secret 同步：PR 模板和 PR 草稿的生产配置清单补入 `SESSION_COOKIE_SECRET` 或强 `USER_KEY_VAULT_SECRET` fallback；`docs:check` 防止 PR 交接材料漏写 session 签名 secret 来源。
- M104 导出关系子树脱敏覆盖：导出 snapshot 对 companion 子树统一执行敏感字符串脱敏，覆盖消息正文、主动回响内容、关系状态和设定文本；smoke 覆盖用户误贴 API key 与 provider endpoint 时 `/api/me/export` 不泄露原文。
- M105 语音 fallback 展示脱敏：工作台朗读最近回复成功后展示的 `fallbackReason` 走前端脱敏；E2E 覆盖供应商回退原因夹带 Bearer、API key、Base URL、rawPayload 和 stack 时页面只显示安全占位。
- M106 API private JSON 门禁：`git:boundary` 拦截 API route 直接 `NextResponse.json()` 或 `Response.json()`，要求统一使用 `privateJson()`，防止新增接口漏掉 private no-store 响应头。
- M107 API fallback 响应脱敏：聊天、语音合成和语音转写 API 返回 `fallbackReason` 前统一走 `redactSensitiveResponseText()`；smoke 增加静态边界检查，防止 API route 绕过 JSON 解析 helper、`privateJson()` 或高风险 fallback 脱敏。
- M108 响应脱敏 QA 与自动引用脱敏：新增 `qa:response` 动态验证 API 响应文本脱敏；主动回响引用最近用户消息、自动 pending memory 引用用户消息、usage fallbackReason 入库前统一脱敏；部署文档 Vercel env 清单补入 `SESSION_COOKIE_SECRET` 并由 `docs:check` 守住。
- M109 账号删除派生数据回归：smoke 覆盖账号删除后重新登录同一邮箱时，旧关系对象、用户 vault、模型调用看板、导出快照中的消息/记忆/主动回响/安全事件/用量计数均不可读回，且不暴露旧 key、endpoint 或 vault 字段。
- M110 1 分钟主动回响体验：关系对象默认主动回响节奏改为 1 分钟；浏览器工作台打开时每分钟检查当前关系对象并展示新草稿；单关系草稿接口用历史主动草稿作为节奏锚点，避免自动检查立即重复生成。
- M111 聊天回复格式清洗：助手回复入库和返回前统一去除 Markdown 加粗/斜体、代码块、链接、星号动作和残留 `*`/`＊`，避免聊天对象回复里出现破坏沉浸感的格式符号。
- M112 删除记忆可见性边界：用户侧记忆列表忽略 `includeDeleted=true`，导出快照只包含未删除记忆；smoke 覆盖删除后 API 与导出均不可见。
- M113 本地 secret 生成助手：新增 `npm run env:secrets`，一次生成 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 的强随机候选值；命令只打印、不写文件，README 与部署文档同步提示真实值只能放入 `.env.local` 或部署平台 secret。
- M114 Prisma 本地 env 加载一致性：新增 `scripts/prisma-command.mjs`，让 `prisma:generate`、`prisma:migrate`、`prisma:migrate:deploy` 和 `prisma:seed` 先读取 `.env.local`/`.env` 再调用 Prisma CLI；真实 Neon 数据库已完成 6 个迁移、`db:smoke` 和 `verify:deploy`。
- M115 Neon direct migration URL：新增可选 `DATABASE_URL_UNPOOLED` 空占位和 readiness 提示；Prisma 迁移命令在该变量存在时优先使用 direct/unpooled URL，应用查询仍使用 `DATABASE_URL`。
- M116 DB smoke transient retry：`db:smoke` 对 Neon/serverless pooler 的短暂连接关闭或不可达错误增加清理/清理校验重试，不吞掉真实断言失败；真实数据库 `db:smoke` 与 `verify:deploy` 已重新通过。
- M117 Vercel Cron 主动回响入口：`GET /api/proactive/run` 支持 Vercel Cron 的 Bearer secret 调用，`CRON_SECRET` 可作为 `PROACTIVE_CRON_SECRET` alias；部署文档提供 Vercel Cron 与 GitHub Actions scheduled workflow 示例，readiness、设置页配置状态和 smoke 均覆盖该 alias。
- M118 现实替代沉浸口径补强：现实人物替代 prompt 从“不要声称自己就是现实本人”收束为“日常承接投射和想念，不主动拆穿沉浸；涉及现实本人意愿、线下联系、见面或现实行动时回到能力边界”。前任与公众人物想象补齐关系语气模板，保持沉浸但不诱导纠缠、不声称授权。
- M119 模型诊断脱敏补强：`/api/me/llm-models` 返回 compatible 模型列表 diagnostic 前再次执行响应文本脱敏，`response-safety` 覆盖 `raw payload` 自然语言字段写法，smoke 静态门禁锁住模型诊断与 raw payload 脱敏边界。
- M120 关系状态与持久化可靠性收束：聊天后关系状态更新和关系状态 API 复用共享 RelationshipState 演进逻辑，保留具体情绪、想念和重要事件信号并过滤误贴密钥/端点/prompt；已配置真实数据库时不再因 Prisma 短暂不可达静默切到 memory，避免本地体验误判为“保存成功但刷新丢失”。
- M121 持久化故障用户体验边界：新增统一 persistence error response；已配置真实 `DATABASE_URL` 且 Prisma/数据库不可用时，关键 auth、workspace、credential、profile、export、usage、safety、voice 和 proactive API 返回安全的 503、`database_unavailable` 与 `retryable=true`，前端展示可操作中文提示且不暴露连接串、Prisma 原始错误、stack、prompt 或 key。
- M122 真实 BYOK 供应商目标联调：新增 opt-in `npm run qa:real-provider`，显式 `REAL_PROVIDER_QA=1` 和 `REAL_LLM_*` 测试变量后，通过用户 vault 验证 compatible 模型诊断、连接测试、一次真实聊天、消息持久化、用量记录和主动回响 dry-run；脚本脱敏失败摘要和服务日志，不进入默认 CI、`verify:pr` 或发布门禁。
- M123 真实供应商联调脚本 fake-compatible 自测：新增 `npm run qa:real-provider:fake`，用本地假 OpenAI-compatible provider 驱动 M122 脚本的 BYOK/vault/聊天/用量/主动 dry-run 逻辑；该命令进入默认本地/CI 门禁，不需要真实 key，不代表真实供应商联调通过。
- M124 设置页错误脱敏一致性：设置页退出、删除模型密钥等剩余错误路径统一走前端脱敏；前端脱敏补齐 GitHub token、`raw payload` 自然语言字段和堆栈帧；工作台错误脱敏同步覆盖 `raw_payload`/`raw payload`；E2E 覆盖删除密钥失败时 API key、Base URL、Bearer、raw payload 和 stack 不外显。
- M125 单关系主动回响护栏与诊断：单关系主动草稿接口返回 schedule metadata、skippedReason、maxDrafts 与 draftLimitReached；工作台前台每分钟自动检查只保存 1 条草稿并显示下次候选时间和锚点后已过分钟数；smoke 覆盖单关系裁剪与立即二次检查不重复。
- M126 模型连接测试真实探针：设置页“测试连接”不再把 compatible `/models` 成功当作连通成功，而是必须完成一次低 token chat completion 探针；`/models` 不兼容但聊天探针成功时允许通过，供应商错误继续按脱敏边界返回。
- M127 供应商切换端点隔离：用户从 compatible 切换到 Anthropic/Gemini/OpenAI Responses 等 provider 时，不再静默沿用旧 compatible Base URL；切回 compatible 且无新端点时返回明确配置提示，避免旧中转站地址误配到其他供应商。
- M128 安全事件 keyed hash 门禁：持久化安全事件必须使用 `USER_KEY_VAULT_SECRET` 生成 `hmac-sha256:` 内容/risk hash；缺少强 secret 时真实仓库不写审计事件，本地 memory fallback 只使用进程级临时 HMAC 开发 hash。
- M129 用量与导出隐私元数据：模型调用日志写入/读取时统一脱敏 provider、model、errorKind 和 fallbackReason；用户导出新增 usage/safety `limits` 元数据，明确 limit、returned、truncated 和 availableAtLeast，避免 5000 条上限静默截断。
- M130 语音 shared-LLM QA 门禁：新增 `npm run qa:voice`，用本地 fake-compatible STT/TTS 覆盖 shared-LLM Bearer header、模型 fallback、用户 vault 优先和失败脱敏，并接入本地 verify 与 CI。
- M131 BYOK 浏览器闭环门禁：新增 fake-compatible 浏览器 E2E，覆盖设置页保存 BYOK key/baseUrl/model、测试连接走 chat completion、创建关系发送消息、provider 收到 Bearer，页面显示真实 provider 回复且不泄露 key/Base URL；E2E 改为单 worker 保障 memory/fake provider 稳定。
- M132 生产调度部署门禁复核：新增 `npm run qa:proactive-cron`，复核 `vercel.json` 每分钟 GET cron、Bearer/`CRON_SECRET` alias、GET 默认 `dryRun:false`、`limit`/`maxDrafts` 护栏和部署文档；`verify:deploy` 现在会在目标环境同时跑严格 readiness、cron 合同、Prisma validate 和 DB smoke。
- M133 非 compatible provider hermetic 覆盖：新增 `npm run qa:providers`，用本地 fake server 与 stub fetch 覆盖 Anthropic、Gemini、OpenAI Responses 的认证 header、payload、默认官方 base URL 不误用 compatible `LLM_BASE_URL`，以及供应商错误诊断脱敏；进入 verify-local 与 CI。
- M134 主动回响调度性能护栏：all-user scheduler 将规范化 `limit` 下推到 repository/Prisma `take`，同一用户 profile 读取复用缓存，达到 `maxDrafts` 后停止继续扫描；smoke 新增早停覆盖，真实 DB 下原 100 对象 clamp 路径从约 61 秒降到约 2.3 秒。
- M135 设置页模型列表 diagnostic 前端脱敏：模型列表失败时前端会对 diagnostic 再执行本地脱敏；E2E 覆盖异常响应夹带 Bearer、API key、Base URL、prompt、rawPayload 和 stack 时页面只显示安全占位；当时全量 E2E 数量 15 tests。
- M136 会话切换隔离：会话草稿、延迟历史和进行中回复隔离，主控确认全量 E2E 32 项通过。
- M137 语音 locale 兼容：zh-CN 归一为 zh，本地语音语言 16 项通过；真实供应商另验。
- M138 主动调度公平续扫：数据库 checkpoint 与 keyset cursor 跨冷启动续扫，本地调度 20 项通过；目标迁移待验证。
- 文档验收口径补丁：README、docs 入口、部署说明、MVP 状态和 Taskbook 已收束真实 API、BYOK、Vercel Cron/主动回响和本地体验说明；本补丁不改变 `src` 或 `tests`。
- 主动回响本地体验补丁：工作台主动回响面板已展示当前关系节奏、每分钟前台检查、最近检查结果和下次检查时间；E2E 新增一条本地/真实 API 体验可诊断性覆盖，避免用户误以为页面关闭后仍有本地 all-user 后台调度。

当前已获允许、但本机缺少认证工具的外部动作：

- PR 自动创建：本机未安装 `gh`，且没有 `GITHUB_TOKEN` / `GH_TOKEN`；已提供 GitHub PR 创建页和 [docs/PR_DRAFT.md](PR_DRAFT.md)，创建或更新 PR 前用 `git status --short --branch` 重新检查实时分支状态。

仍需目标环境复核后再做的模块：

- 部署目标数据库和 secret：将本机已验证的配置项同步到目标环境的 secret store，包括 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、可选独立 `SESSION_COOKIE_SECRET`、`PROACTIVE_CRON_SECRET` 或 Vercel `CRON_SECRET` alias，并在目标环境复跑 `npm run verify:deploy`。
- 真实 LLM 模型 key/model：优先由用户在设置页 vault 保存；部署平台 secret 只作为服务端 fallback；需要可复现目标联调时使用 `npm run qa:real-provider`，但不要把它作为默认发布门禁。
- 内容审核后台、用户反馈问卷、内测邀请机制：你已决定暂不进入当前第一版。

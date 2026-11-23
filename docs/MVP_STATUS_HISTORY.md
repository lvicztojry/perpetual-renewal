# 历史状态归档

本文件保存原状态面板的历史内容，不是当前基线或当前环境报告；其中“当前”“本轮”均指原记录当时。实时入口为 [项目当前状态](MVP_STATUS.md)。

# MVP Status

2026-11-05：聊天新增即时用户消息、人物名旁输入状态、跨会话等待隔离与客户端消息关联；生成完成不清除下一条草稿，失败保留未确认消息。新增 `qa:chat-delivery` 已接入 CI 和本地验收。

2026-11-05：主动回响新增人物化话题规划、长短变化、active 记忆轮换及本地重复检查；最多质量重写一次，真实模型失败不再自动回退固定模板投递。手动草稿默认一条，走相同模型策略。见 [PROACTIVE_QUALITY.md](PROACTIVE_QUALITY.md)；真实供应商的主观自然程度仍需实际试用评估。

本轮主动回响状态修复：完整浏览器回归 45 项通过（47.2 秒），包含真实内存开关与手动/自动发送区分；新增路由回归 30 项通过。原有模型设置测试增加载入就绪检查，记录导入测试直接检查 option 的 disabled 属性，避免测试识别误差。

2026-11-02：主动回响面板补齐账号/人物双开关与暂停原因，修正忽略 skippedReason 的误导提示；打开/刷新面板只读，手动草稿与按设置直接投递分开。开关与隔离 API 30 项、定向浏览器 9 项通过；真实账号偏好仅只读诊断，未替用户开启。

2026-11-02：聊天记录创建人物已集成，覆盖解析、身份指定、用户模型提炼、编辑预览、临时试聊及确认保存；全量浏览器回归 43 项通过。具体范围及存储边界见 [CHAT_CHARACTER_IMPORT.md](CHAT_CHARACTER_IMPORT.md)。

2026-11-02 个人账号页已实现：侧栏依据服务端登录状态显示“我的账号”；独立 `/account` 展示身份、邮箱与资料，支持保存昵称/时区/语言、发送密码重置邮件、退出以及进入数据隐私管理。完整浏览器回归 40 项通过；重置邮件在浏览器测试中拦截验证，本轮未向真实邮箱发信。

2026-11-02 视觉改版已实现：巨钟与显示屏开场、点击后合成钟声、静音/跳过/重播、双栏聊天、手机联系人返回导航、模态资料抽屉，以及统一的登录/设置/PWA 深色铜色主题。37 项完整浏览器回归通过，包含减少动态效果、焦点恢复、真实渲染截图和原有账号、BYOK、会话隔离、导入、语音、导出、删除流程。实现与素材说明见 [UI_REDESIGN.md](UI_REDESIGN.md)。公网部署仍按用户决定暂缓。

更新说明：已补充本轮真实数据库恢复、迁移和 QQ SMTP 认证验证；历史验收保留原日期。

本文件是主控施工状态面板，用于快速判断当前第一版 MVP 是否可演示、可继续开发、可进入真实环境联调。

截至 2026-10-31：真实数据库已恢复，认证/检查点迁移已应用，真实隔离 PostgreSQL 认证与 checkpoint CAS、DB smoke 通过。新增投递迁移通过真实 PostgreSQL 并发/关系验证且已应用到 public schema。QQ SMTP verify 通过，用户完成真实注册、邮件验证及登录。用户 vault 探针成功；此前 tests/qa-vault-provider 真实聊天及独立持久化通过。历史上增强版 vault QA 两次失败均为 kind=provider_response、HTTP 503，记录为当前上游可用性限制；临时 QA 关系对象清理通过。此前成功的真实聊天/独立持久化证据仍保留；模板 fallback 与投递已验证，2026-11-02 已通过真实模型主动生成、手动发送、独立持久化及去重验证；当前账号全局主动开关关闭，自动投递正确拒绝，测试未修改用户偏好。

Priority 4 本机集成验证已通过：模型按关系设定生成主动回响并自动直接送入聊天；每频率周期稳定幂等键、唯一消息关联、Serializable 事务重试及用户/关系关闭开关控制投递，手动发送复用同一路径。记忆采用中英文词面匹配、稳定事实回退与摘录式历史上下文，未实现 embeddings 或模型摘要。

当前自动验收：完整浏览器回归 52 项通过（约 1.2 分钟），客户端消息关联 6 项通过；Playwright --list JSON 派生基线为 52 tests。完整 memory API smoke 基线为 94 checks。真实供应商质量与公网部署另行验证，公网部署仍按用户决定暂缓。

2026-11-02 用户决定继续本机试用，暂缓公网部署；部署平台、套餐与调度方案留待上线时确认。 套餐与调度限制见 [部署文档](DEPLOYMENT.md#vercel-deployment)。

## 当前结论

M136 会话切换隔离、M137 语音 locale、M138 持久化调度续扫已通过本地回归。M139 已通过完整真实隔离 PostgreSQL 验证，覆盖注册、密码登录、重置撤销、旧账号恢复、限流和检查点 CAS；两份新增迁移已应用到当前数据库，真实 DB smoke 通过。QQ SMTP 的 TLS 连接和账号认证已通过；用户已完成真实注册邮件验证并确认登录，数据库只读复核邮箱验证状态为成功。`AUTH_MODE=local-email` 仅限显式非生产测试。

历史记录（2026-10-26）：audit 初查为 6 vulnerabilities（5 high、1 critical）；Next.js/eslint-config-next 16.4.3 与传递依赖修复后确认 0 vulnerabilities，lint、typecheck、build、全量 E2E 32 项、本地调度 20 项、语音语言 16 项、本地认证后端及 SMTP 33 项、完整 memory smoke 94 checks 已通过。本轮另通过邮件诊断 14 项、迁移 URL 路由 3 项及真实隔离数据库集成。

当前 Playwright --list JSON 派生 33 个用例、6 个 spec，主控确认全量 33 项通过；2026-10-26 历史全量为 32 项。本轮先恢复数据库连接，再清理确认属于隔离测试的空闲迁移锁，迁移统一使用同一 Neon compute 的直连地址。真实集成发现检查点原始 SQL 的 schema 兼容问题，现改为 Prisma 模型 API 和事务 CAS，并已通过真实 schema 验证；测试 schema 均已清理。用户已保存模型凭据并确认设置页连接测试成功，此前真实聊天/独立持久化通过；增强 vault QA 两次均为 provider_response HTTP 503，属当前上游可用性限制；清理通过，此前真实聊天/持久化与模板 fallback/投递证据保留，2026-11-02 真实模型主动生成与手动投递验证通过；自动投递遵守当前全局关闭设置，公网部署暂缓。本机 HTTP 回调适合本机测试，生产严格 readiness 需要 HTTPS 回调。

当前项目已经完成纵切 MVP：账号、关系对象、聊天、回复格式清洗、记忆、关系状态、主动回响、用户级 LLM key vault、多供应商适配、签名 session cookie、私有 no-store API 响应边界、语音 mock/compatible adapter、模型调用日志、数据导出、账号删除、安全事件日志、响应式/PWA 工作台、结构化素材导入和上线前隐私/安全清单均已集成。

当前发布候选分支为 `codex/mvp-release-candidate`；当前同步点以 `git status --short --branch` 和 `git log -1 --oneline` 的实时结果为准；首个 baseline 提交为 `ef4939e feat: build relationship ai mvp baseline`。M56 Taskbook 状态门禁实现提交为 `d7a72f2 docs: sync taskbook status gates`，M66 发布门禁与隔离补强提交为 `fd6778a test: isolate memory fallback and derive release gates`。10 月新增模块与依赖修复尚有待验收项。远端目标分支为 `origin/codex/mvp-release-candidate`，是否 ahead 或已推送以 `git status --short --branch` 的实时结果为准；PR 创建页为 https://github.com/lvicztojry/perpetual-renewal/pull/new/codex/mvp-release-candidate ，PR 正文草稿为 [docs/PR_DRAFT.md](PR_DRAFT.md)。8 月本机曾通过严格 readiness 与真实 Neon/PostgreSQL smoke；部署目标仍需在目标环境设置同等 secret/env 后复跑 `npm run verify:deploy`。个人真实试用优先走设置页用户 vault；服务端 LLM key/model 只是 fallback。

## 已集成能力

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 账号与资料 | integrated | 默认邮箱/密码、注册验证与旧账号恢复通过真实隔离 PostgreSQL；用户 QQ 注册收件/登录通过，新部署目标另验 |
| Session 安全 | integrated | HMAC 签名、v2 到期校验与重置撤销通过真实隔离 PostgreSQL |
| API 缓存边界 | integrated | 用户数据、聊天、记忆、导出、用量、语音、主动回响和配置状态 API 返回 private no-store 响应头 |
| 全关系对象 | integrated | 恋人、朋友、家人、师友、现实替代、逝者纪念、前任、公众人物想象、虚构、原创、自定义 |
| 聊天闭环 | integrated | 消息持久化、失败恢复、重新生成、删除、标记重要 |
| LLM 适配 | integrated | compatible、Anthropic、Gemini、OpenAI Responses、mock fallback |
| 用户级 key vault | integrated | 设置页保存/删除/查看摘要；AES-256-GCM 加密；不返回 key 原文 |
| 模型列表与连接测试 | integrated | 通过用户 vault 或服务端 env 读取兼容中转站 `/models`，设置页可测试连接 |
| 配置状态向导 | integrated | 设置页只读展示数据库、vault secret、session 签名 secret、cron secret、LLM 和语音配置状态，不暴露真实值 |
| 账号删除 | integrated | 设置页危险区确认短语删除；后端清理当前用户关系、消息、记忆、日志、vault 并清除 session |
| Prompt 上下文预算 | integrated | 角色设定固定保留，记忆与最近消息按预算裁剪 |
| 记忆系统 | integrated | pending、active、archived、deleted 生命周期；deleted 记忆不进入用户列表、prompt 或导出；Priority 4 采用中英文词面匹配、稳定事实回退、摘录式历史 |
| 素材导入 | integrated | 单段文本、批量文本数组、JSON Lines、本地 `.txt/.jsonl/.json` 文件读取、媒体说明、照片/音视频文件摘要、通讯录脱敏摘要，默认 pending 并脱敏密钥形态 |
| 关系状态 | integrated | 共享状态演进逻辑已接入聊天后更新、关系状态 API 和主动回响上下文；Prisma/memory repository 持久化 |
| 主动回响 | candidate | 既有调度已集成；Priority 4 模型个性化自动送入聊天与手动同路径投递已实现，2026-11-02 增强真实 QA 通过；账号全局自动开关关闭时不投递 |
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
- M136 会话切换隔离：会话草稿、延迟历史和进行中回复隔离，2026-10-26 历史全量 E2E 32 项通过。
- M137 语音 locale 兼容：zh-CN 归一为 zh，本地语音语言 16 项通过；真实供应商另验。
- M138 主动调度公平续扫：数据库 checkpoint 与 keyset cursor 跨冷启动续扫，调度现 31 项、当前数据库迁移及真实隔离 checkpoint CAS 通过；新部署目标另验。
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
- 历史记录（2026-08-23）`env:readiness -- --strict`：missing=0，warning=3；该记录不证明当前生产回调配置通过，本地 HTTP AUTH_APP_URL 须改为生产 HTTPS 后复验。
- `db:smoke`：真实 Neon/PostgreSQL 连接通过；完整 smoke 94 checks passed。
- C 盘可视化目录无项目产物；npm audit cache 使用项目内 `.npm-cache`。

## 真实配置与部署复核

当前 QQ SMTP 授权码配置及 verify、实际注册收件均已验证。剩余生产配置是将本地 HTTP 的 `AUTH_APP_URL` 换为用户可访问的 HTTPS 回调，再在目标环境复跑严格 readiness/verify:deploy；该待办不表示缺少 QQ 密码。readiness 已分别检查邮件凭据和生产 HTTPS 回调，12 项隔离测试通过，安全阈值保持不变。

8 月本机 `.env.local` 曾通过严格 readiness、真实 DB smoke 与 `verify:deploy`。截至 2026-10-31，当前数据库迁移及 QQ 用户真实注册收件通过，新部署目标另验；真实值仍只允许放在 `.env.local`、部署平台 secret 或网站设置页用户 vault，不写入仓库。部署到新目标环境时按下表逐项同步并复跑验证。

| 项 | 建议 |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL，连接串只放 `.env.local` 或部署平台 secret |
| `DATABASE_URL_UNPOOLED` | 可选 Neon direct 连接串，供 Prisma 迁移使用；只放 `.env.local` 或部署平台 secret |
| 认证邮件 | `AUTH_APP_URL`、`AUTH_MAIL_FROM`、`AUTH_MAIL_TRANSPORT=smtp` 配合 `AUTH_SMTP_HOST/PORT/USER/PASSWORD`；个人邮箱授权码测试无需自有域名。可选 `http` 配合 `AUTH_MAIL_API_URL/KEY`；QQ 注册收件通过；HTTP 与新部署另验 |
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

本地体验口径：用 `npm run dev` 启动后打开 `http://127.0.0.1:3000` 或 `http://localhost:3000`；真实 API key 优先在设置页保存。工作台打开时当前关系对象会每分钟检查主动回响；Priority 4 自动送入聊天已实现，2026-11-02 增强真实 QA 通过；账号全局自动开关关闭时不投递；如果关闭页面，本地没有 all-user 常驻调度，生产才由 Vercel Cron、GitHub Actions 或外部 cron 调用受保护入口。

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
- M136 会话切换隔离：会话草稿、延迟历史和进行中回复隔离，2026-10-26 历史全量 E2E 32 项通过。
- M137 语音 locale 兼容：zh-CN 归一为 zh，本地语音语言 16 项通过；真实供应商另验。
- M138 主动调度公平续扫：数据库 checkpoint 与 keyset cursor 跨冷启动续扫，调度现 31 项、当前数据库迁移及真实隔离 checkpoint CAS 通过；新部署目标另验。
- 文档验收口径补丁：README、docs 入口、部署说明、MVP 状态和 Taskbook 已收束真实 API、BYOK、Vercel Cron/主动回响和本地体验说明；本补丁不改变 `src` 或 `tests`。
- 主动回响本地体验补丁：工作台主动回响面板已展示当前关系节奏、每分钟前台检查、最近检查结果和下次检查时间；E2E 新增一条本地/真实 API 体验可诊断性覆盖，避免用户误以为页面关闭后仍有本地 all-user 后台调度。

当前已获允许、但本机缺少认证工具的外部动作：

- PR 自动创建：本机未安装 `gh`，且没有 `GITHUB_TOKEN` / `GH_TOKEN`；已提供 GitHub PR 创建页和 [docs/PR_DRAFT.md](PR_DRAFT.md)，创建或更新 PR 前用 `git status --short --branch` 重新检查实时分支状态。

仍需目标环境复核后再做的模块：

- 部署目标数据库和 secret：将本机已验证的配置项同步到目标环境的 secret store，包括 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、可选独立 `SESSION_COOKIE_SECRET`、`PROACTIVE_CRON_SECRET` 或 Vercel `CRON_SECRET` alias，并在目标环境复跑 `npm run verify:deploy`。
- 真实 LLM 模型 key/model：优先由用户在设置页 vault 保存；部署平台 secret 只作为服务端 fallback；需要可复现目标联调时使用 `npm run qa:real-provider`，但不要把它作为默认发布门禁。
- 内容审核后台、用户反馈问卷、内测邀请机制：你已决定暂不进入当前第一版。


---

# 2026-11-23 整理前状态快照

以下完整保留整理前状态，历史表述不代表本次重新执行。

# 项目当前状态

更新：2026-11-23。本文件是唯一的当前施工与验收状态入口；README、QA、PR 和交接文档引用此处。旧报告完整保留在 [历史状态归档](MVP_STATUS_HISTORY.md)，历史通过不等于当前重新验证。

## 当前结论

2026-11-23 已完成「初醒与终焉之地」0.1.3：开发范围为 Web、Windows、Android，功能同源推进；微信、macOS、iOS 暂停扩展。新增余念安剧情接引、用户级暂停续接、留灯会叙事与能力字幕登记，按实际创建人物、发送消息和开启梦境推进。旧账号只主动参加，原人物与聊天不重置。Web 生产构建、Windows 安装包及同签名 Android ARM64 APK 已生成；本机开发库新增进度表已迁移。三端实际验证与剩余边界见本页本轮验收记录，详细工作包见 [TASKBOOK.md](TASKBOOK.md)。

2026-11-21 本地安装包：按用户要求优先完成 Windows/Android，Mac/iPhone 暂缓。已补齐 Rust/MSVC/JDK/Android SDK/NDK，生成 0.1.1 Windows x64 NSIS 和固定签名的 Android 三架构 release APK，位于 dist/installers/。两端 0.1.0 → 0.1.1 实际覆盖更新通过，原账户、聊天、群聊、入梦及加密 Key 保留；Android release 已用旧密码从界面解锁。实体手机录音、播放、文件和后台生命周期及真实供应商另验。入口见 [LOCAL_CLIENTS.md](LOCAL_CLIENTS.md)。

微信小程序：按全功能范围新增 10 个原生页面及共享请求/生命周期/语音/文件能力，见 [WECHAT_FEATURE_PARITY.md](WECHAT_FEATURE_PARITY.md)。官方 WXML/WXSS、包体/事件检查和隔离 Next 原生页面联调通过。2026-11-21 用户重新授权，测试号 `wx39395c20924d8b67` 上的真实模拟器核心流程通过，含登录/Cookie、私聊/群聊发送、记忆、入梦、设置、抽样提炼和故事/动画。已修复运行时 JSON require 和按钮布局，截图已检查，测试拦截与会话已清除，最终模拟器 error 日志为空。真机录音/播放/分享及真实模型效果尚未验证，不代表完整设备验收或发布。步骤见 [WECHAT_MINIPROGRAM.md](WECHAT_MINIPROGRAM.md)。原长期队列仍暂停。

项目仍在本机运行。2026-11-21 用户要求给异地朋友长期体验，默认使用部署方中转站并允许个人覆盖；当前先准备独立数据库、受邀邮箱及后台调度的容器部署包，再选择云服务，未生成公网链接。步骤见 [CLOUD_SHARING.md](CLOUD_SHARING.md)。发布分支为 `codex/mvp-release-candidate`；远端同步情况以 `git status --short --branch` 为准，不在文档中固定 ahead/behind。

长期目标已按用户要求暂停，完整范围与完成证据列于 [TASKBOOK.md](TASKBOOK.md) 的长期目标执行队列。普通聊天不新增评价或人物纠正入口，人物校准集中在入梦。目标模式期间集成双版本原子事实替代、纠错历史、遗忘清理、一致导出、各生成场景的运行时钟与原始发言时间、主动选题时效防护，以及跨端消息和已读同步。时效规则不自动修改记忆状态；完整语义理解、历史搜索/分页/归档、恢复、后续体验扩展及实体双端交付仍未完成。

人物创建、聊天、账号、用户模型接入和数据持久化已实现。当前真实账号的模型凭据、主动开关及服务可用性必须在网站或只读诊断中确认，不能沿用历史检查结果。

「入梦」人物校准与生生不息/入梦双能力动画已集成。本机开发数据库已应用新增梦境表迁移；草稿、反馈、确认应用与版本恢复均有隔离浏览器和真实 PostgreSQL 验证。工作台人物页可进入入梦，设置页与 `/echoes` 可预览能力演出。

界面优化：生生不息按网络余念安人物图提取纯黑剪影，保留原图长发、提裙和交错双腿姿态；入梦仅新开梦境时播放入场，已有草稿直接续接。每轮反馈后聚焦下一轮输入，编辑内容在继续前自动暂存，最后通过「结束入梦」预览并确认应用。

群聊首版已集成，入口为侧栏「群聊」与 `/groups`，复用现有用户的模型配置。可邀请人物、@ 接话、确认共同记忆并带回私聊；群内主动权限与私聊开关独立。一键启动会启动本机后台群调度，群总开关默认关闭。范围和容量见 [GROUPS.md](GROUPS.md)。

跨端消息与未读任务已收尾，本机试用服务及原群调度已恢复；长期开发暂停，不开启下一模块。独立浏览器环境验收不代表实体电脑/手机或原生双端应用已完成。契约见 [MESSAGE_SYNC.md](MESSAGE_SYNC.md)。当前发布门禁仍有一项依赖审计未通过：开发工具链 picomatch 公告产生 14 个高危关联项，生产依赖审计为 0；上游暂无修复版，未强行降级 Next/ESLint。依据：[GitHub 公告](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)。

## 已集成能力

| 模块 | 已实现 | 实际边界 |
| --- | --- | --- |
| 群聊 | 邀请人物、成员关系文字、@ 选择、多人逐条接话、当前人物表达隔离、复读候选检查及单次重写、自动聊天简短收尾、即时消息、共同记忆及私聊衔接、独立主动节奏、本机调度、导出删除 | 主动默认关闭；共同记忆需确认；每群最多 12 人/1000 条消息/100 条共同记忆；复读检查以词面为主，真实自然度需模型体验；关系数值演化和长期归档尚未实现 |
| 账号与资料 | 邮箱密码、验证/找回、个人账户、退出、删除 | QQ 邮件及数据库有历史真实验证；目标部署另验 |
| 人物与导入 | 全关系、自定义、记录提炼、设定编辑、试聊确认；本地抽样预览和逐条勾选 | 仅上传选中双方样本，接口拒绝全文；不解密微信/QQ 数据库 |
| 入梦 | 三候选/自由试聊、纠正与范围、确认片段、独立持久草稿、应用预览、版本恢复、冲突核对、导出/清理 | 仅确认应用后更新性格/表达；练习不进入正式聊天或长期记忆；自动回归使用模拟供应商 |
| 聊天 | 持久化、即时消息、输入状态、失败恢复、重生成、日期分组、前台消息刷新、精确未读及已读同步 | 本地未确认消息不等于送达；各端未发送输入仅保留在当前页面；群详情忙碌时刷新可能暂缓；实体双端另验 |
| 模型与语音 | 多供应商 BYOK、用户加密 vault、模型列表/连接检查、STT/TTS | 供应商是否支持选定模型需实际测试 |
| 长期记忆 | 待确认/生效/归档/遗忘、手动纠错、双版本原子替代、分页变更历史和一致导出；候选保留完整陈述并过滤假设/引用，保守去重；提示词保留记录/编辑时间及消息/群来源，按问题召回旧共同经历 | 候选含标签最多 500 字符，超长整句跳过；规则与词面检索不能证明完整语义理解；历史从功能启用后开始，遗忘不删除原始聊天；尚无自动结束判定与向量语义检索。契约见 [记忆变化](MEMORY_LIFECYCLE.md) |
| 主动回响 | 双开关、自定义频率、模型生成、记忆轮换、长短控制、重复重写 | 本机只检查当前打开的人物；关闭页面不常驻调度 |
| 数据管理 | 隔离、导出、用量统计、密钥脱敏 | 原始密钥不进入仓库或导出 |
| 界面 | 巨钟双能力演出、光团显影/开门入梦、回响录、静音/跳过、青铜旧城主题、桌面/手机、PWA | 保留原封面构图；截图使用虚构人物；无手势时声音按浏览器限制静音降级 |

## 验收记录

2026-11-23 初醒与三端交付：9 组接引服务隔离检查、3 项能力登记/队列检查、认证、群聊、原生存储与完整原生浏览器回归通过。真实 PostgreSQL 随机 schema 已完成全部迁移、双连接首次/已有行 CAS、资源归属与真实消息/梦境证据、账号级联检查并清理；随后仅将新增 UserJourney 迁移应用本机开发库，旧账号不回填。最终类型、lint、Web 生产构建和 94 项隔离 API smoke 通过。Web 全量 99 项执行中最后一轮 95 项通过，4 项失败分别为图片测试的监听器/图片加载竞争、已移除悬浮入口的旧定位和一次建夹具连接重置；修正测试同步与入口后，开场、接引、消息并发三个相关文件共 22 项复验全通过，未再重复整套。原生最终接引专项验证新账号恢复码优先、暂停重载续接、账号隔离、旧快照兼容和重放不破坏数据。

| 本轮平台 | 实际交付与证据 | 本轮未覆盖 |
| --- | --- | --- |
| Web | 0.1.3 源码及生产构建；桌面/手机初醒截图、创建→私聊→入梦真实接口闭环；本机进度迁移 | 公网部署、真实供应商自然度复验 |
| Windows | 0.1.3 x64 NSIS；正式 WebView 与独立 D 盘 SQLite 的 8 个加密进度核验点通过，恢复码/暂停/重新解锁/续接/手动帮助正常 | 本轮未运行安装向导覆盖升级或进程重启；包未做 Authenticode 签名 |
| Android | 同一签名 0.1.3 ARM64 release（versionCode 4，v2/v3）；API 36 模拟器从 0.1.1 覆盖安装，启动前后旧账户密文一致；新账号初醒、暂停、强制结束与重启续接通过 | ARM64 包在模拟器经原生翻译运行；实体手机、录音/权限/后台生命周期仍待实机 |

测试使用虚构账号；未调用付费模型或发送真实邮件。截图在 `design/previews/2026-11-23/`，安装包及本轮校验与验证清单在 `dist/installers/`。两端本地账户仍各自保存，不代表自动跨设备同步。修复了原生同级组件重复 key 导致锁定后残留旧界面，以及悬浮帮助遮挡手机资料按钮；最终包已重建。

2026-11-21 本地客户端验收：Rust 迁移/失败回滚/安全恢复路径 3 项通过；Node 加密互操作、真实 SQLite、旧写入拒绝和发布身份/版本/历史迁移保护检查通过。共享界面浏览器回归通过，含原界面、账户创建/恢复/隔离、私聊、群聊、入梦和恢复后原 Key 连接本机假供应商。Windows 原生安装版覆盖更新、原生 SQLite/IPC 与更新前备份通过；Android API 36 模拟器上签名 release 覆盖更新通过，更新前后加密账户逐字节相同，原密码/恢复码/模型 Key 可解密，界面旧账户登录与人物显示通过。APK v2/v3 签名、三架构、版本号及 64 位 16KB 对齐检查通过。数据和 Key 均为虚构，未访问真实用户数据库或付费模型。Mac/iPhone 及实体手机能力仍待验。

2026-11-21 长期远程分享准备：新增 Docker/Compose 源码部署包，含独立 PostgreSQL 卷、版本迁移、Next 生产服务、Caddy HTTPS 入口和并行私聊/群聊分钟调度；默认中转站走服务端 `LLM_*`，用户 vault 可覆盖。新增可选精确邮箱名单，覆盖注册、验证、登录、密码恢复及旧会话撤销；未设置变量时保持原访问行为。配置生成、拒绝覆盖、随机密钥隔离、真实本地 HTTP 调度契约、认证专项、定向 ESLint、密钥/文档/文件边界检查通过；243 个源码文件的部署包哈希和边界检查、隔离 Webpack 生产构建及生产匿名/旧 session 拒绝检查通过。未读取个人凭据或数据库、未发送真实邮件或调用付费模型；原本地服务继续运行。本机没有 Docker，镜像构建/容器启动、真实邮件/模型、域名证书和云端双账号验收待选定平台后执行，尚无公网链接。入口见 [CLOUD_SHARING.md](CLOUD_SHARING.md)。

2026-11-21 小程序视觉回迁：按用户要求复用网页版青铜旧城、巨钟图层、衬线标题、金色细边框与方形头像；重做联系人首页、私聊和群聊的原生布局，固定输入区，将主动回响/共同记忆/成员选择收进可关闭面板，统一其他页面表单。复用原有 `bell-isolated.png` 和 `chat-room.webp`，不引入新生成图片。最终 `mini:check`、定向 ESLint、密钥扫描通过，主包约 1583 KiB；真实微信模拟器使用虚构数据检查首页/私聊/群聊与面板开关，截图逐张人工检查并保存到 `design/previews/2026-11-21/wechat-web-style-*.jpg`。验证后清除虚构会话，正常本地服务继续运行；本条为视觉与入口回归，不增加真实供应商或真机验收结论。

2026-11-21 微信模拟器：用户重新授权后，`node tests/miniprogram-simulator.mjs` 成功运行并通过真实运行时核心流程，使用 3218 隔离服务、mock 模型和内存测试账号，不使用真实用户数据或付费额度。`--restore` 已成功恢复请求和确认弹窗并清除测试会话，正常登录入口恢复；最终模拟器 error 日志为空。私聊、群聊及入梦截图人工检查后保存于 `design/previews/2026-11-21/`。最终 `mini:check` 与定向 ESLint 通过，包约 490 KiB。下述此前未获授权记录为历史，已由本条后续验收更新；真机能力和真实供应商不在本条范围。

2026-11-20—21 小程序实现：Node 请求契约、会话隔离与迟到响应检查通过；实际原生页面方法连接隔离 Next 服务，通过人物、私聊、重生成、记忆、入梦、群聊断线恢复、共同记忆、设置/凭据、文件导出、记录提炼与账号隔离；未使用真实用户数据或付费模型。10 页加 1 组件 WXML、3 份 WXSS 通过本机官方编译器，类型检查、21 项群服务回归、8 项来源校验、定向 ESLint、文档和密钥检查通过。新增实际模拟器脚本尚未成功执行。微信工具查询确认原提供 AppID 为小游戏，已换当前账号小程序测试号，首页真实截图已检查；完整模拟器交互和手机能力待验收。下述同日准备记录保留历史，不再表示当前仅有骨架。

2026-11-20 小程序准备：`node tests/miniprogram-client.mjs` 通过本地地址约束、Cookie 隔离、请求契约、错误恢复、页面状态、配置和全 API 范围覆盖检查；新增小程序目录和测试的定向 ESLint、文档一致性及密钥扫描通过，未调用模型。仅为 Node 模拟请求和静态检查，不代表微信开发者工具编译、WXML 渲染、真实账号或手机验收。本机 3000 端口检查未监听；未自动启动服务、未上传或发布。全部功能仍按全量清单待移植，原网页验收不自动沿用。

下列记录有明确日期和范围，不表示更新当天重新全部运行。测试定义变化时，当前数量由 Playwright 和 smoke 脚本派生；用例数量不作为通过证明。

| 日期 | 范围 | 已有证据 |
| --- | --- | --- |
| 2026-11-18 | 人物表达与群聊复读优化 | 对照 SillyTavern 官方角色卡/群聊机制，当前人物自己的历史改为 assistant 正文并保留选中消息时间索引，用户本轮问题与最近群友分别定位；私聊具体人设优先，避免统一咨询师语气。最近可见历史检查整段/群友末句复读及重复长开头，最多一次同模型重写，共享原 45 秒窗口并分别记录用量；自动接聊不自问自答，可在明确短收尾停止。隔离浏览器 29 项通过，含新增 2 项真实适配器接本机假供应商的丢弃不闪现/不落库、二次失败、显式恢复与费用检查；重复检查 10 项、群生成 33 项、群服务 21 项、开场包 4 项通过；私聊 10 类关系及 12 组合 smoke、上下文 29 项、提取 8 项、主动专项和投递 10 项通过。未用真实模型或用户语料做自然度评测，不能据此声称消除所有语义复述；未迁移数据库，长期目标仍暂停，本次为用户另行请求的局部优化。机制与费用边界见 [GROUPS.md](GROUPS.md) |
| 2026-11-18 | 局域网已读 403 根因修复 | 实际手机已读请求被内部 request.url 的主机名校验拒绝，前轮 localhost 回归未覆盖。统一已读、群操作、入梦、记忆替代及留灯会安装的可信来源判断，认可明确配置的应用来源与仅开发模式的精确白名单，保留外站/缺失 Origin 拒绝。真实试用日志已读由 403 转为 200，用户实体手机复验确认私聊与群聊均恢复正常。隔离实例经实际 LAN 地址的手机/留灯会浏览器 6 项通过，localhost 群聊与同步 15 项通过；来源边界 8 项、同步逻辑 29 项、服务端回执 23 项通过，并包含内部 localhost 请求 URL 与 LAN Origin 的双范围落库验证。认证、入梦、记忆与群业务专项通过；未操作真实用户消息、未迁移数据库，长期开发仍暂停 |
| 2026-11-18 | 手机聊天遮挡与未读修复 | 群简介默认折叠、消息独立滚动、小屏输入区随 visualViewport 高度调整，群管理侧栏可关闭返回；私聊状态提示不再挤乱消息与输入区。已读移除不可靠的焦点要求，打开已选人物立即检查，新来信不取消在途回执，旧 GET 不恢复角标。隔离 memory/mock 浏览器 26 项通过（手机布局/未读、私群主链路与跨端同步），同步/移动端回执逻辑 29 项及服务端回执 19 项通过；手机截图已检查。键盘使用模拟可视视口变化，修复后实体手机效果尚待用户复验；不调用真实模型、不迁移数据库，长期开发仍暂停 |
| 2026-11-18 | 同 Wi-Fi 试用配置 | 新增局域网启动入口，自动选择本机 Wi-Fi 私有地址，进程级登录来源和开发资源白名单；保留原本机启动，不改凭据文件、不改防火墙。用户实体手机已确认可打开登录页，用原账号看到相同人物与聊天，并确认手机发送后收到回复、电脑同步看到消息。LAN/localhost 空登录验证均 400（已通过来源校验），外站 403；新增来源边界 3 项通过，HTTP 消息 ID 兼容 3 项纳入同步门禁。说明见 [LAN_TRIAL.md](LAN_TRIAL.md) |
| 2026-11-18 | 当前任务收尾与暂停 | 已读表迁移已应用本机开发库，Prisma Client 已生成；真实随机 schema 使用项目实际 migrations 完成部署、双连接并发及实际 40001 重试、私群与删除级联/导出验收后清理。最终集成门禁在 Audit 前全部通过，含类型、lint、密钥、文档、API smoke 94 项、生产构建、生产认证和数据库诊断；全量浏览器单独 91 项通过。Audit high 未通过：picomatch 开发链 14 项关联高危，omit=dev 为 0；保留失败记录，不能称全门禁通过。本机登录 HTTP 200，群后台有效检查恢复；桌面和手机角标截图已人工检查。改动留本地，未提交/推送或公网发布 |
| 2026-11-18 | 跨端消息与未读 | 完整隔离浏览器 91 项通过，含新增同步 6 项：两个浏览器、手机列表、上翻、远端删除、草稿与账号切换、旧 GET 晚到；轮询/快照 13 项及回执 19 项通过。真实 PostgreSQL 随机临时 schema 验证私群、同毫秒/倒序消息、并发幂等和实际 40001 重试、整批所有权校验、软删/硬删级联与导出过滤后已清理；修复原始 SQL schema 隔离。桌面/手机角标截图已生成，手机截图已人工检查；不代表实体设备或真实模型质量验收 |
| 2026-11-17 | 时间上下文基础完整门禁 | `verify:local -- --audit` 全部 34 步通过，含完整隔离浏览器 85 项、API smoke 94 项、生产构建及认证隔离、数据库诊断与 0 漏洞审计。检索/时间/历史预算 27 项、提取 8 项、群生成 28 项、群服务 20 项及私聊传递 10 项通过；时钟跨午夜、夏令时、无效时区、原消息位置和旧历史日期有明确样例。随后持续否定事实、互动诉求及周期偏好修正经主动策略 24 项、完整主动专项 142 项复验，最新 lint/生产构建通过并恢复本机试用。最后修正后未重复全部浏览器；这些自动测试不代表真实模型已具备完整时间理解 |
| 2026-11-17 | 本轮最终门禁与试用恢复 | 真实配置数据库 API smoke 94 项通过；默认 smoke 改为强制内存隔离后再次 94 项通过。生产构建、生产认证隔离、lint、文档、密钥和文件边界检查通过；Next/eslint-config-next 更新至 16.4.6，并定向更新 lint 传递依赖后 npm audit 为 0 漏洞。本机 localhost:3000 登录页 HTTP 200，原群后台检查恢复；未执行公网发布或远端提交 |
| 2026-11-17 | 记忆变化与并发保护 | 完整隔离浏览器 85 项通过；规划器/事务适配/导出快照 8 项、内存删账号交错 4 项通过，类型检查通过。真实 PostgreSQL 临时 schema 验证全部迁移、重连、审计失败回滚、双连接 CAS、导出/遗忘一致快照和账号级联清理后已删除；新增记忆历史迁移已应用本机开发库。未调用真实模型或邮件；两个数据库连接与手机窗口不等于实体双端互通验收 |
| 2026-11-17 | 记忆与接话离线验收 | 提示词覆盖全部关系类别，提取完整性/引用过滤 8 项、检索上下文 20 项、私聊关联/群记忆衔接 10 项、群生成 27 项、群业务 20 项、现有开场包 4 项通过；结构化导入、入梦 20 项与费用 6 项通过。类型、lint 已通过；保留本轮开始前已有未提交改动；未调用真实模型、邮件或修改数据库，未重跑浏览器/生产构建 |
| 2026-11-13 | 群聊集成 | 首轮完整隔离浏览器 77 项通过；前端分队列修复后群聊专项共 9 项分批通过（8 项通过，最后一项调整 Next 播报节点断言范围后定向通过）；群生成/记忆上下文 20 项、业务与恢复 20 项离线通过；手机和桌面截图已检查 |
| 2026-11-13 | 群聊数据库 | 真实 PostgreSQL 独立临时 schema 运行全部迁移、重连、双连接 CAS、所有权与账号级联删除通过，临时 schema 已清理；新增 GroupWorkspace 迁移已应用于本机开发库 |
| 2026-11-13 | 集成与超时修复 | 真实数据库 API smoke 94 项、最终生产构建、生产认证隔离、类型、lint、文档和密钥检查通过；私聊消息与群记忆衔接 9 项、投递 24 项及超时响应 9 项通过。修复跨区数据库投递超过默认事务时限的问题，超时返回固定 private/no-store 503；未调用真实模型或邮件 |
| 2026-11-12 | 参考图剪影替换 | 使用 imagegen 从余念安人物参考图制作透明 PNG 遮罩；确认真实 alpha、长发与提裙轮廓，双能力预览浏览器 1 项通过，新截图人工检查通过；lint、文档和密钥检查通过 |
| 2026-11-12 | 连续入梦与剪影优化 | 入梦与巨钟定向浏览器 21 项分别通过：首轮 20 项通过，更新遗留按钮断言后冲突恢复 1 项复验通过；覆盖手机连续两轮、生成/反馈前自动暂存、刷新不重播、正式设定隔离和显式结束；新版演出截图人工检查通过 |
| 2026-11-12 | 入梦与动画浏览器 | 完整隔离回归 69 项通过（约 1.7 分钟）；最终显影视觉微调及脱敏样本整理后，定向 2 项通过；含手机闭环、草稿续接、冲突原文保留、基准核对、版本恢复、导出清理及双能力预览 |
| 2026-11-12 | 数据库 | 独立临时 schema 应用全部版本迁移、断开重连、应用/恢复、所有权与过期修订、真实事务回滚、账号级联检查通过，并已清理；之后仅将新增 DreamWorkspace 表迁移应用于本机开发库 |
| 2026-11-12 | 集成与门禁 | memory API smoke 94 项、入梦服务 20 项、失败用量费用 6 项、生产构建、类型、lint、认证隔离、日志/响应脱敏、PWA、文档及密钥检查通过；未调用真实模型或 QQ 邮件 |
| 2026-11-11 | 巨钟主题 | 首轮完整隔离浏览器 52 项通过；样式补改后在明确启动的 memory/local-email 实例上定向复验 33 项通过；最终 320/390/768/1024/1440px 聊天布局及 320/768px 登录检查通过 |
| 2026-11-11 | 界面构建与门禁 | 生产构建、类型、lint、PWA、文档及密钥扫描通过；本轮没有数据库迁移、真实模型或邮件调用 |
| 2026-11-09 | 文档、隐私与记忆 | 文档一致性、提炼 24 案例/366 断言、消息与记忆 8 项、完整浏览器 52 项（约 1.3 分钟）通过；默认隔离供应商 |
| 2026-11-09 | 集成 | 完整 memory API smoke 94 项、生产构建、类型检查通过；未调用真实模型或邮件服务 |
| 2026-11-05 | 完整浏览器 | 全量 52 项通过，约 1.2 分钟 |
| 2026-11-05 | memory API、构建、消息关联 | 完整 smoke 94 项、build、关联 6 项、lint 通过 |
| 2026-11-05 | 主动回响 | 调度/投递/策略/生成/质量共 120 项、开关与路由 41 项通过 |
| 2026-11-06 | 巨钟 | 3 项已有服务开场检查、离线音频渲染、类型和 lint 通过 |
| 2026-11-06 | 消息日期 | 8 项隔离聊天回归、类型及 lint 通过 |
| 2026-10-31 至 11-02 | 真实外部配置 | 数据库、QQ SMTP、注册登录、BYOK 及主动生成的历史证据见归档 |

默认浏览器和 API 回归使用 mock/memory，不能证明真实模型质量、邮件送达或生产数据库可用。真实检查必须显式执行，不默认发送邮件或修改真实账号偏好。

## 当前施工顺序

1. 已完成：当前状态与历史归档分离，次级入口引用；一致性门禁检查唯一来源。
2. 已完成：浏览器本地抽样、脱敏、逐条勾选与完整预览，提炼接口只接收选中样本。
3. 已完成：显示本页最近检查与原因，说明忙碌暂缓、关闭页面与后台延迟，失败时不展示错误倒计时。
4. 已完成：减少完全重复的候选，保留否定、数字、类型差异；沿用手动纠错，归档记录不被去重改写。
5. 已完成：入梦独立草稿、候选与反馈、确认应用、版本恢复、冲突恢复及双能力演出；保留本机试用，公网部署仍暂缓。
6. 已完成：群聊首版、多人接话、共同记忆和私聊衔接、分钟主动节奏及本机后台调度；人物之间关系以文字设定，自动演化与长期归档为后续范围。
7. 已集成基础：独立记忆面板双版本事实替代、纠错历史、归档防误恢复与遗忘清理；导出中记忆及历史为同一快照。自动结束/过期语义、旧库重复记忆的确认合并与语义检索仍待完善。
8. 后续：继续人物一致性、主动与多人自然度、未读/历史检索、备份恢复以及电脑和手机互通；真实模型质量及实体设备链路另验。向量检索需确认供应商与嵌入模型支持，不静默增加调用成本。

## 验收与维护入口

- 验证步骤和隔离口径：[QA](QA.md)。
- 可执行门禁：`npm run docs:check`、`npm run verify:local`；后者包含数据库诊断，运行前核对环境。
- 工作拆分与历史里程碑：[Taskbook](TASKBOOK.md)。
- 外部配置和上线检查：[部署说明](DEPLOYMENT.md)。
- 主动回响策略：[PROACTIVE_QUALITY.md](PROACTIVE_QUALITY.md)。
- 导入范围与隐私：[CHAT_CHARACTER_IMPORT.md](CHAT_CHARACTER_IMPORT.md)。
- 入梦与二创规则：[DREAM.md](DREAM.md)。
- 群聊与本机后台调度：[GROUPS.md](GROUPS.md)。
- 记忆替代、遗忘范围与历史：[MEMORY_LIFECYCLE.md](MEMORY_LIFECYCLE.md)。

每次更新只在这里登记本轮实际执行的范围和结果；功能文档描述契约，历史文件保留当时证据。新增或变更测试不自动把旧通过记录升级为新版本通过。

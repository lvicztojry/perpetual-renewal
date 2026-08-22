# MVP Status

更新日期：2026-08-22

本文件是主控施工状态面板，用于快速判断当前第一版 MVP 是否可演示、可继续开发、可进入真实环境联调。

## 当前结论

当前项目已经完成纵切 MVP：账号、关系对象、聊天、回复格式清洗、记忆、关系状态、主动回响、用户级 LLM key vault、多供应商适配、签名 session cookie、私有 no-store API 响应边界、语音 mock/compatible adapter、模型调用日志、数据导出、账号删除、安全事件日志、响应式/PWA 工作台、结构化素材导入和上线前隐私/安全清单均已集成。

当前发布候选分支为 `codex/mvp-release-candidate`；当前同步点以 `git status --short --branch` 和 `git log -1 --oneline` 的实时结果为准；首个 baseline 提交为 `ef4939e feat: build relationship ai mvp baseline`。M56 Taskbook 状态门禁实现提交为 `d7a72f2 docs: sync taskbook status gates`，M66 发布门禁与隔离补强提交为 `fd6778a test: isolate memory fallback and derive release gates`。当前没有代码级阻塞项。远端目标分支为 `origin/codex/mvp-release-candidate`，是否 ahead 或已推送以 `git status --short --branch` 的实时结果为准；PR 创建页为 https://github.com/lvicztojry/perpetual-renewal/pull/new/codex/mvp-release-candidate ，PR 正文草稿为 [docs/PR_DRAFT.md](PR_DRAFT.md)。剩余真正外部阻塞项是生产环境配置：真实 PostgreSQL `DATABASE_URL`、生产级 `USER_KEY_VAULT_SECRET`、session 签名 secret 来源（独立 `SESSION_COOKIE_SECRET` 或强 vault secret fallback）、`PROACTIVE_CRON_SECRET`，以及至少一个可用的用户自带 API key 或服务端 LLM API key/model。

## 已集成能力

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 账号与资料 | integrated | 本地 email session、资料设置、登出 |
| Session 安全 | integrated | 登录 cookie 使用 HMAC 签名，不暴露裸 userId；登出和账号删除用同属性过期 cookie |
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
| 关系状态 | integrated | 熟悉度、亲密度、近期情绪、重要事件 |
| 主动回响 | integrated | 站内草稿、撒娇式未回复回响、1 分钟默认节奏、自定义频率、当前工作台前台自动检查、受保护 cron 入口 |
| 主动草稿状态 | integrated | draft、sent、dismissed、blocked 状态管理与筛选 |
| 安全边界 | integrated | 运行时规则、安全 QA 样例、脱敏安全事件日志 |
| 模型调用看板 | integrated | provider/model/latency/tokens/估算成本，不记录正文或 key |
| 语音能力 | integrated | 浏览器录音入口、shared-LLM compatible STT/TTS、mock fallback |
| 数据导出 | integrated | 当前用户 JSON 快照，排除 key/baseUrl/vault 密文和 deleted 记忆 |
| 响应式/PWA 体验 | integrated | 390px 移动端 E2E 覆盖无横向溢出；manifest、图标、离线页和安全 service worker 已接入 |

## 最近主控验收

本轮主控已通过：

```bash
npm run typecheck
npm run lint
npm run docs:check
npm run git:boundary
npm run secrets:check
npm run db:smoke
npm run smoke
npm run qa:samples
npm run qa:prompt
npm run qa:imports
npm run qa:vault
npm run qa:logging
npm run qa:response
npm run pwa:check
npm run prisma:validate
npm run build
npm run e2e
npm --cache .\.npm-cache audit --audit-level=high
```

结果摘要：

- `smoke`：89 checks passed。
- `docs:check`：documentation consistency passed。
- `git:boundary`：tracked and committable file boundary passed。
- `e2e`：12 tests passed。
- `pre-push audit`：0 vulnerabilities。
- `qa:samples`：10 relationship kinds、19 safety areas passed。
- `qa:prompt`：10 relationship kinds passed。
- `qa:imports`：structured media/contact import planner passed。
- `qa:vault`：vault and config readiness security matrix passed。
- `qa:logging`：runtime log sanitization passed。
- `qa:response`：API response text sanitization passed。
- `pwa:check`：manifest、icons、offline shell 和 service worker boundary passed。
- `npm audit`：0 vulnerabilities。
- `db:smoke`：当前未配置 `DATABASE_URL`，按设计安全跳过。
- C 盘可视化目录无项目产物；npm audit cache 使用项目内 `.npm-cache`。

## 上线前必须补齐

| 项 | 建议 |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL，连接串只放 `.env.local` 或部署平台 secret |
| `USER_KEY_VAULT_SECRET` | 生产专用强随机值，至少 32 bytes，不复用开发值 |
| `SESSION_COOKIE_SECRET` | 可选独立 session 签名 secret，至少 32 bytes；为空时复用强 vault secret |
| `PROACTIVE_CRON_SECRET` | 另一段强随机值，不能和 vault secret 或数据库密码相同 |
| LLM 配置 | 默认 `LLM_PROVIDER=compatible`、`LLM_BASE_URL=https://api.tryanotherone.com/v1`；key 放用户 vault 或服务端 secret |
| Voice 配置 | 默认 `VOICE_PROVIDER=shared-llm`，语音模型用 `VOICE_STT_MODEL`、`VOICE_TTS_MODEL` |
| 数据库迁移 | 本地开发用 `npm run prisma:migrate`；生产目标数据库用 `npm run prisma:migrate:deploy` 后跑 `npm run verify:deploy` |
| 推送/PR 前检查 | 必跑 `npm run verify:local -- --skip-e2e`、`npm run e2e`、`npm run verify:release`、`git status --short --branch` 与 `git status --short --ignored`；生产环境补齐配置后再跑 `npm run verify:deploy` |

生成 secret 的建议命令：

```bash
npm run env:secrets
```

命令会一次生成 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 的候选值，只打印、不写文件；输出值只放入 `.env.local` 或部署平台 secret。

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
- M47 PR/发布候选交接材料：已新增 `.github/pull_request_template.md` 与 `docs/RELEASE_HANDOFF.md`，记录 PR 模板、push 前命令、CI 预期、生产配置缺口和后续动作。
- M48 Pre-push 发布验证：当时已重新执行 E2E 与 high severity audit；当前发布候选的最新 E2E 结果为 12 tests passed，`npm --cache .\.npm-cache audit --audit-level=high` 为 0 vulnerabilities，并回写到 `docs/RELEASE_HANDOFF.md`。
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
- M68 关系状态 API 持久化收束：`/api/companions/:id/relationship-state` 读取和更新当前 session 用户的持久化关系状态，不再返回早期 mock/DEV-9 元数据；POST 基于当前 companion 状态更新并写回 Prisma 或 memory fallback。
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
- M83 设置页模型列表 E2E 隐私覆盖：E2E 覆盖保存用户 API key 后读取兼容中转站模型列表、点击模型回填输入框、失败文案稳定，且页面不回显完整 key；当前 E2E 基线 12 tests。
- M84 聊天消息输入错误边界：`POST /api/conversations/:id/messages` 空白内容返回稳定 400；`regenerate` 拒绝用户消息并返回稳定文案，不透传异常对象。
- M85 导入错误恢复 E2E 覆盖：主链路 E2E 覆盖坏 `.json` 文件解析失败后的前端恢复，确认友好错误、导入按钮不可用，并可重新选择有效 `.jsonl` 文件继续导入候选。
- M86 关系对象校验错误边界：`POST/PATCH /api/companions` 对空名称、空语气、非法关系类型返回稳定白名单 400；非法关系不会创建记录，失败编辑不会部分写入其他字段。
- M87 用量看板查询范围边界：`GET /api/usage/model-calls` 只接受 1-90 天有限 `rangeDays`；非法 query 返回稳定 400，不回显 key、Base URL、prompt 或 raw payload。
- M88 关系表单失败恢复 E2E：创建/编辑关系失败时前端展示服务端稳定文案，状态栏提示重试，表单草稿保留且按钮恢复可用；当前 E2E 基线 12 tests。
- M89 运营反馈机制暂缓口径：PRD、Taskbook 和部署清单明确内容审核后台、反馈问卷、内测邀请机制不进入第一版，后续恢复时单独设计运营反馈模块。
- M90 用户模型端点类型校验：`PUT /api/me/llm-credential` 对非字符串 `baseUrl` 返回稳定 400，不静默忽略异常类型，也不回显用户 API key 或端点字段。
- M91 导出常见外部 token 脱敏：用户误把 GitHub PAT/`ghp_` 等常见外部 token 写入记忆时，导出快照会替换为 `[REDACTED_KEY]`，不把 token 原文带出。
- M92 设置页保存错误脱敏 E2E：模型列表、连接测试和保存失败错误会在前端再次脱敏当前 API key/Base URL；失败后草稿保留、按钮恢复可重试。
- M93 语音转写元数据边界：STT 输入拒绝异常文件名、语言标签和过长 mock 文本，错误响应不回显 Bearer、prompt、raw payload 或用户配置。
- M94 发布候选文档口径同步：README、部署、QA、PR 草稿、handoff 和 Taskbook 同步 89 smoke checks / 12 E2E tests、`qa:logging`、Neon-first PostgreSQL、TryAnotherOne compatible、BYOK 与 `VOICE_PROVIDER=shared-llm` 口径。
- M95 工作台错误展示脱敏：聊天、记忆、主动回响、导入、语音和用量看板错误展示统一走前端脱敏；E2E 覆盖调用看板错误夹带 Bearer、API key、Base URL、prompt、rawPayload、stack 时不显示原文。
- M96 模型连接失败隐私覆盖：`/api/me/llm-test` 与 `/api/me/llm-models` 覆盖 URL 构造失败、供应商 HTTP 失败和 fetch 网络失败，响应不回显 key、Bearer、endpoint/Base URL、prompt、rawPayload、stack 或底层网络原文；当前 smoke 基线 89 checks。
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

当前已获允许、但本机缺少认证工具的外部动作：

- PR 自动创建：本机未安装 `gh`，且没有 `GITHUB_TOKEN` / `GH_TOKEN`；已提供 GitHub PR 创建页和 [docs/PR_DRAFT.md](PR_DRAFT.md)，创建或更新 PR 前用 `git status --short --branch` 重新检查实时分支状态。

仍需外部配置后再做的模块：

- 生产数据库和 secret：`DATABASE_URL`、`USER_KEY_VAULT_SECRET`、可选独立 `SESSION_COOKIE_SECRET`、`PROACTIVE_CRON_SECRET`。
- 真实 LLM 模型 key/model：可由用户在设置页 vault 保存，或由部署平台 secret 提供服务端 fallback。
- 内容审核后台、用户反馈问卷、内测邀请机制：你已决定暂不进入当前第一版。

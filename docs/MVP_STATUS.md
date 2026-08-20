# MVP Status

更新日期：2026-08-20

本文件是主控施工状态面板，用于快速判断当前第一版 MVP 是否可演示、可继续开发、可进入真实环境联调。

## 当前结论

当前项目已经完成纵切 MVP：账号、关系对象、聊天、记忆、关系状态、主动回响、用户级 LLM key vault、多供应商适配、语音 mock/compatible adapter、模型调用日志、数据导出、安全事件日志、响应式工作台和上线前隐私/安全清单均已集成。

当前发布候选 baseline 已提交到 `codex/mvp-release-candidate`，提交为 `ef4939e feat: build relationship ai mvp baseline`。当前没有代码级阻塞项。剩余真正外部阻塞项是生产环境配置：真实 PostgreSQL `DATABASE_URL`、生产级 `USER_KEY_VAULT_SECRET`、`PROACTIVE_CRON_SECRET`，以及至少一个可用的用户或服务端 LLM API key/model。

## 已集成能力

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| 账号与资料 | integrated | 本地 email session、资料设置、登出 |
| 全关系对象 | integrated | 恋人、朋友、家人、师友、现实替代、逝者纪念、前任、公众人物想象、虚构、原创、自定义 |
| 聊天闭环 | integrated | 消息持久化、失败恢复、重新生成、删除、标记重要 |
| LLM 适配 | integrated | compatible、Anthropic、Gemini、OpenAI Responses、mock fallback |
| 用户级 key vault | integrated | 设置页保存/删除/查看摘要；AES-256-GCM 加密；不返回 key 原文 |
| 模型列表与连接测试 | integrated | 通过用户 vault 或服务端 env 读取兼容中转站 `/models`，设置页可测试连接 |
| 配置状态向导 | integrated | 设置页只读展示数据库、vault secret、cron secret、LLM 和语音配置状态，不暴露真实值 |
| Prompt 上下文预算 | integrated | 角色设定固定保留，记忆与最近消息按预算裁剪 |
| 记忆系统 | integrated | pending、active、archived、deleted 生命周期 |
| 素材导入 | integrated | 单段文本、批量文本数组、JSON Lines、本地 `.txt/.jsonl/.json` 文件读取，默认 pending 并脱敏密钥形态 |
| 关系状态 | integrated | 熟悉度、亲密度、近期情绪、重要事件 |
| 主动回响 | integrated | 站内草稿、撒娇式未回复回响、自定义频率、受保护 cron 入口 |
| 主动草稿状态 | integrated | draft、sent、dismissed、blocked 状态管理与筛选 |
| 安全边界 | integrated | 运行时规则、安全 QA 样例、脱敏安全事件日志 |
| 模型调用看板 | integrated | provider/model/latency/tokens/估算成本，不记录正文或 key |
| 语音能力 | integrated | 浏览器录音入口、shared-LLM compatible STT/TTS、mock fallback |
| 数据导出 | integrated | 当前用户 JSON 快照，排除 key/baseUrl/vault 密文 |
| 响应式体验 | integrated | 390px 移动端 E2E 覆盖无横向溢出 |

## 最近主控验收

本轮主控已通过：

```bash
npm run typecheck
npm run lint
npm run docs:check
npm run git:boundary
npm run secrets:check
npm run smoke
npm run qa:samples
npm run qa:prompt
npm run prisma:validate
npm run build
npm run e2e
npm --cache .\.npm-cache audit --audit-level=high
```

结果摘要：

- `smoke`：49 checks passed。
- `docs:check`：19 docs/readme files passed。
- `git:boundary`：147 committable files passed。
- `e2e`：2 tests passed。
- `pre-push audit`：0 vulnerabilities。
- `qa:samples`：10 relationship kinds、14 safety areas passed。
- `qa:prompt`：10 relationship kinds passed。
- `npm audit`：0 vulnerabilities。
- `db:smoke`：当前未配置 `DATABASE_URL`，按设计安全跳过。
- C 盘可视化目录无项目产物；npm audit cache 使用项目内 `.npm-cache`。

## 上线前必须补齐

| 项 | 建议 |
| --- | --- |
| `DATABASE_URL` | Neon PostgreSQL，连接串只放 `.env.local` 或部署平台 secret |
| `USER_KEY_VAULT_SECRET` | 生产专用强随机值，至少 32 bytes，不复用开发值 |
| `PROACTIVE_CRON_SECRET` | 另一段强随机值，不能和 vault secret 或数据库密码相同 |
| LLM 配置 | 默认 `LLM_PROVIDER=compatible`、`LLM_BASE_URL=https://api.tryanotherone.com/v1`；key 放用户 vault 或服务端 secret |
| Voice 配置 | 默认 `VOICE_PROVIDER=shared-llm`，语音模型用 `VOICE_STT_MODEL`、`VOICE_TTS_MODEL` |
| 数据库迁移 | 本地开发用 `npm run prisma:migrate`；生产目标数据库用 `npm run prisma:migrate:deploy` 后跑 `npm run db:smoke` |
| 推送前检查 | 必跑 `npm run secrets:check` 与 `npm --cache .\.npm-cache audit --audit-level=high` |

生成 secret 的建议命令：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

分别运行两次，分别填入 `USER_KEY_VAULT_SECRET` 和 `PROACTIVE_CRON_SECRET`。

## 继续施工队列

本轮已继续完成：

- M25 导入体验 QA 补强：已把文本文件导入、JSONL 解析失败、过大文件拒绝写进 QA 文档与验收说明。
- M26 设置页模型体验收束：已补充连接测试的 LLM、部署和 QA 文档说明。
- M27 第一版发布候选清理：已统一 README、Taskbook、MVP 状态与上线文档中的验收命令和当前 check 数。
- M28 真实配置状态向导：已在设置页增加只读配置状态检查，提示缺少 `DATABASE_URL`、vault secret、cron secret、LLM key/model/baseUrl 和语音配置，但不暴露具体值。
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
- M39 本地顺序验证脚本：已新增 `npm run verify:local` 和 `npm run verify:release`，顺序跑质量门禁，避免 smoke/e2e 抢 dev server 锁。
- M40 协作者开发说明：已新增 `docs/CONTRIBUTING.md`，说明模块边界、fallback、密钥规则、常用命令和文档更新方式。
- M41 命令行本地 env 加载一致性：已新增共享 `.env.local`/`.env` 加载 helper，让 `env:readiness` 与 `db:smoke` 的命令行检查和 Next.js 本地配置习惯对齐，同时保持脱敏输出。
- M42 发布迁移与密钥扫描补强：已新增生产迁移脚本 `prisma:migrate:deploy`，固定依赖版本，清空 `.env.example` 数据库示例值，CI 增加 readiness/db smoke，并扩展密钥扫描到数据库连接串、vault/cron secret、Bearer/JWT 和 vault 密文形态。
- M43 发布文档命令一致性：已将文档入口、协作者说明和数据库文档中的安装/迁移命令统一到 `npm ci`、本地 `prisma:migrate`、生产 `prisma:migrate:deploy` 的口径。
- M44 发布口径自动检查：已新增 `npm run docs:check` 并接入 CI 与本地 verify，自动检查旧安装命令、裸 audit、旧 smoke 数字、生产迁移口径、`latest` 依赖、危险 `.env.example` 和 CI 文档门禁。
- M45 Git 文件边界自动检查：已新增 `npm run git:boundary` 并接入 CI 与本地 verify，自动确认项目不在 C 盘，且 `.env.local`、构建目录、npm cache、`node_modules`、测试结果、日志和 tsbuildinfo 等不进入 Git scope。
- M46 Post-baseline 状态回写：已把 M36 的分支、提交 hash 和当前剩余阻塞同步回主控状态文档。
- M47 PR/发布候选交接材料：已新增 `.github/pull_request_template.md` 与 `docs/RELEASE_HANDOFF.md`，记录 PR 模板、push 前命令、CI 预期、生产配置缺口和后续决策点。
- M48 Pre-push 发布验证：已重新执行 E2E 与 high severity audit；`npm run e2e` 通过 2 tests，`npm --cache .\.npm-cache audit --audit-level=high` 通过 0 vulnerabilities，并回写到 `docs/RELEASE_HANDOFF.md`。
- M49 Next typed routes 稳定化：已新增 `npm run next:typegen`，`npm run typecheck` 会先生成 Next route types；E2E 结束后也会重新 typegen，避免 `next-env.d.ts` 在 `.next/dev/types` 与 `.next/types` 之间留下脏工作树。
- M50 发布门禁增强：`npm run git:boundary` 已新增 `next-env.d.ts` 检查，若残留 `.next/dev/types` 引用会提示先运行 `npm run next:typegen`。

当前需要你确认后才能执行的外部动作：

- 是否 push `codex/mvp-release-candidate` 到远端仓库并发起 PR。当前本地分支和提交已完成，但没有默认推送远端。

需要你后续决策后再做的模块：

- 账号删除：会级联删除用户全部关系、消息、记忆、日志，属于高风险破坏性能力。
- 移动端 PWA：需要决定是否做离线 shell、安装图标、推送策略。
- 多媒体/照片/通讯录导入：涉及隐私、授权、格式和删除策略，需要单独设计。
- 内容审核后台、用户反馈问卷、内测邀请机制：你已决定暂不进入当前第一版。

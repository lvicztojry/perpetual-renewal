# 协作者开发说明

本文给新协作者快速说明如何参与“生生不息 / perpetual-renewal”的开发。进入代码前，先读根目录 [README.md](../README.md)、[PRD.md](PRD.md)、[ARCHITECTURE.md](ARCHITECTURE.md)、[MVP_STATUS.md](MVP_STATUS.md) 和 [TASKBOOK.md](TASKBOOK.md)。

## 项目定位

“生生不息”是一个关系型 AI 陪伴项目。它服务于用户“想交流却无法真正抵达某个人或某段关系”的时刻，通过可设定、可记忆、会主动回响的 AI 关系对象，承接亲情、友情、爱情、纪念、现实替代、虚构角色和完全自定义陪伴。

产品核心不是单一恋爱聊天，而是“全关系对象”：

- 关系类型不设硬上限，内置模板只是快速入口，自定义关系必须始终保留。
- 支持现实人物替代、逝者纪念、前任投射、公众人物想象、虚构角色、原创角色和完全自定义关系。
- 日常体验允许沉浸和撒娇式未回复回响；高风险场景必须回到安全边界。
- AI 关系对象要提供情感支持，但不能引导用户产生现实伤害、违法行为、医疗/法律/金融专业依赖，或用责备、威胁、冷暴力制造愧疚。

## 模块边界

开发时按模块拆工，尽量保持改动集中：

| 模块 | 主要边界 | 参考文档 |
| --- | --- | --- |
| 产品与任务管理 | PRD、Taskbook、MVP 状态、发布验收 | [PRD.md](PRD.md)、[TASKBOOK.md](TASKBOOK.md)、[MVP_STATUS.md](MVP_STATUS.md) |
| 账号与资料 | session、用户资料、设置页基础能力 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 关系对象 | 全关系创建、编辑、删除、关系设定字段 | [PRD.md](PRD.md) |
| 聊天闭环 | 消息发送、回复、重试、删除、重要标记 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Prompt 与记忆 | prompt builder、上下文预算、记忆生命周期、导入素材 | [LLM.md](LLM.md)、[QA.md](QA.md) |
| LLM / Voice | 多供应商适配、用户 vault、模型列表、连接测试、语音 fallback | [LLM.md](LLM.md)、[DEPLOYMENT.md](DEPLOYMENT.md) |
| 主动回响 | 草稿生成、频率设置、cron 入口、草稿状态 | [TASKBOOK.md](TASKBOOK.md) |
| 安全与隐私 | 安全规则、脱敏日志、导出边界、错误文案 | [SAFETY.md](SAFETY.md)、[PRIVACY.md](PRIVACY.md)、[ERROR_COPY.md](ERROR_COPY.md) |
| 质量与发布 | smoke、E2E、QA 样例、发布候选脚本、CI | [QA.md](QA.md)、[RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md)、[PRE_COMMIT_CHECKLIST.md](PRE_COMMIT_CHECKLIST.md) |

跨模块改动要在 Taskbook 写清楚依赖和影响面。前端体验改动要同时关注桌面和 390px 移动视口；模型、语音、导入、日志、导出相关改动要优先确认不会暴露密钥、连接串、prompt 或供应商 raw payload。

## 本地启动

在仓库根目录运行：

```bash
npm ci
npm run dev
```

默认地址是 `http://localhost:3000`。没有真实数据库或模型配置时，项目应保持可开发：

- 未配置 `DATABASE_URL`：使用本地 memory fallback，`npm run db:smoke` 会安全跳过。
- 未配置 LLM key/model/baseUrl：聊天和语音链路可以走 mock fallback，方便先验证 UI 和业务流。
- 语音默认可用 mock STT/TTS；真实语音供应商按当前决策与 LLM 共用中转站，使用 `VOICE_PROVIDER=shared-llm`。
- 设置页的“配置状态”和 `npm run env:readiness` 只显示就绪状态和下一步，不显示真实值。

## 密钥与文件边界

这是硬约束：

- 不把真实 API key、数据库连接串、vault secret、session secret、cron secret 写入仓库、文档、测试样例或提交信息。
- 不把项目产物写到 C 盘。项目文件、缓存和临时输出都放在 `D:\github_clone\perpetual-renewal` 下；例如 audit 使用 `npm --cache .\.npm-cache audit --audit-level=high`。
- 用户自带 API key 只允许走网站设置页的用户级 vault，或本地/部署环境变量 secret。
- 前端、API 响应、日志、导出快照、成本看板都不能返回 key 原文、Base URL 原文、数据库连接串、vault 密文、session/cron secret、prompt 或供应商 raw payload。
- 需要示例时使用占位值，例如 `selected-model-name`、`32-byte-or-longer-random-secret`，不要粘贴真实值。

生产建议配置详见 [DEPLOYMENT.md](DEPLOYMENT.md)。生成强随机 secret 可用：

```bash
npm run env:secrets
```

命令会一次生成 `USER_KEY_VAULT_SECRET`、`SESSION_COOKIE_SECRET` 和 `PROACTIVE_CRON_SECRET` 的候选值，只打印、不写文件；输出值只放入 `.env.local` 或部署平台 secret。

## 常用命令

日常开发常用：

```bash
npm run dev
npm run verify:local
npm run docs:check
npm run next:typegen
npm run git:boundary
npm run env:readiness
npm run secrets:check
npm run smoke
npm run e2e
```

`npm run verify:local` 是当前推荐的本地顺序验证入口。它会串行执行主要质量门禁，避免手动并行运行 smoke/e2e 时抢 Next dev server 锁，并会在 Git boundary 前自动运行 `next:typegen`。需要定位单项问题时，再使用下面的分项命令：

```bash
npm run typecheck
npm run lint
npm run docs:check
npm run next:typegen
npm run git:boundary
npm run smoke
npm run qa:samples
npm run qa:prompt
npm run env:readiness
npm run prisma:validate
npm run db:smoke
npm run build
npm run e2e
npm run secrets:check
```

发布前或依赖变化后再跑：

```bash
npm --cache .\.npm-cache audit --audit-level=high
```

配置真实数据库后再跑：

```bash
npm run db:smoke
```

注意：不要并行跑 `npm run smoke` 和 `npm run e2e`。E2E 会启动或占用 Next dev server，smoke 里也有 API/运行时检查，并行跑容易抢端口或读到不稳定状态。需要完整验证时按顺序执行。

## Taskbook 与状态更新

每个模块完成后都要更新 [TASKBOOK.md](TASKBOOK.md)：

- 在模块登记表新增或更新一行，写清楚模块编号、状态、负责人、改动文件和当前落点。
- 状态使用现有口径：`planned`、`active`、`integrated`、`ready-for-decision`。
- 如果模块只是文档收束，也要明确“只改文档”，避免主控误判代码能力已经改变。
- 如果有验证命令，写明通过的命令；如果跳过某项，说明原因。
- 如果遇到需要用户决定的事项，状态改为 `ready-for-decision`，并在说明里列出具体决策项。

涉及 MVP 总体能力、上线阻塞、主控验收基线或继续施工队列时，同步更新 [MVP_STATUS.md](MVP_STATUS.md)。普通单模块实现只需更新 Taskbook；但如果改动改变了“当前是否可演示、是否可进入真实环境联调、下一步阻塞是什么”，就必须更新 MVP Status。

## 提交前自检

提交或交给主控前至少确认：

- 改动文件属于当前模块边界，没有顺手重构无关模块。
- 没有真实 secret、`.env.local`、本地数据库、浏览器录音或导出快照进入待提交文件。
- 文档中的路径、命令和状态与当前仓库一致。
- `npm run docs:check` 通过。
- `npm run git:boundary` 通过。
- `npm run secrets:check` 通过。
- 需要 UI 验证的改动已经跑过 E2E 或有明确不能跑的原因。

第一次 commit/push 的文件范围与策略看 [PRE_COMMIT_CHECKLIST.md](PRE_COMMIT_CHECKLIST.md) 和 [COMMIT_PLAN.md](COMMIT_PLAN.md)。

# 生生不息总 Taskbook v0.2

## 目标

把“生生不息”第一版做成一个可验证的全关系 AI 聊天 MVP：用户能创建任何关系类型的 AI 关系对象，包括现实人物替代、逝者纪念、虚构角色、原创角色和完全自定义关系。产品通过稳定设定、长期记忆、关系状态和撒娇式主动回响，让用户在重复交流中感到“想念有回应，关系被延续”。

## 阶段划分

| 阶段 | 目标 | 交付物 |
| --- | --- | --- |
| Phase 0 | 产品与技术基线 | PRD、任务书、全关系设定模型、技术选型、原型草图 |
| Phase 1 | 聊天闭环 | 账号、角色创建、一对一聊天、消息存储 |
| Phase 2 | 关系与记忆 | 记忆提取、记忆管理、关系状态 |
| Phase 3 | 主动回响与安全 | 主动消息、安全策略、质量评估 |
| Phase 4 | 打磨与试用 | 体验优化、日志指标、内测反馈 |

## 任务依赖关系

| 任务 | 依赖任务 | 依赖类型 | 依赖说明 |
| --- | --- | --- | --- |
| PM-2 原型与信息架构 | PM-1 全关系范围确认 | FS | 全关系设定模型明确后才能画核心流程 |
| ARCH-1 技术选型与系统架构 | PM-1 全关系范围确认 | FS | 技术方案依赖 MVP 范围 |
| ARCH-2 数据模型设计 | ARCH-1 技术选型与系统架构 | FS | 数据库和 ORM 选择影响模型实现 |
| DEV-1 项目脚手架 | ARCH-1 技术选型与系统架构 | FS | 选型完成后创建工程 |
| DEV-2 账号与用户资料 | DEV-1 项目脚手架 | FS | 依赖基础工程 |
| DEV-3 关系对象创建 | DEV-2 账号与用户资料 | FS | 角色归属于用户 |
| DEV-4 聊天消息闭环 | DEV-3 关系对象创建 | FS | 聊天依赖具体关系对象 |
| DEV-5 LLM 适配层 | DEV-1 项目脚手架 | FS | 需要工程基础，供聊天调用 |
| DEV-6 Prompt 与角色组装 | DEV-3 关系对象创建 | FS | 依赖角色字段 |
| DEV-6 Prompt 与角色组装 | DEV-5 LLM 适配层 | FS | 需要模型调用接口 |
| DEV-7 记忆提取与存储 | DEV-4 聊天消息闭环 | FS | 从消息中提取记忆 |
| DEV-8 记忆管理界面 | DEV-7 记忆提取与存储 | FS | 需要记忆数据 |
| DEV-9 关系状态引擎 | DEV-4 聊天消息闭环 | FS | 状态由互动更新 |
| DEV-9 关系状态引擎 | DEV-7 记忆提取与存储 | FS | 重要事件来自记忆 |
| DEV-10 主动回响 | DEV-9 关系状态引擎 | FS | 主动消息依赖关系状态 |
| SAFE-1 沉浸边界与安全规则 | PM-1 全关系范围确认 | FS | 安全策略依赖全关系和沉浸模式定义 |
| DEV-11 安全策略接入 | SAFE-1 沉浸边界与安全规则 | FS | 需要先定义规则 |
| DEV-11 安全策略接入 | DEV-4 聊天消息闭环 | FS | 在聊天链路中接入 |
| QA-1 质量评估集 | PM-1 全关系范围确认 | FS | 需要确认关系设定模型和风险场景 |
| QA-2 端到端测试 | DEV-4 聊天消息闭环 | FS | 聊天主链路完成后测试 |
| QA-2 端到端测试 | DEV-8 记忆管理界面 | FS | 记忆链路完成后测试 |
| QA-3 内测反馈闭环 | QA-2 端到端测试 | FS | 基础质量通过后开始内测 |

## 任务定义

### PM-1 全关系范围确认

状态：completed

目标：

- 确认 MVP 支持所有关系类型，内置模板只是入口，自定义关系是核心。
- 明确支持现实人物替代、逝者纪念、前任投射、公众人物想象、虚构角色、原创角色和完全自定义关系。
- 确认第一版素材输入范围：支持手动粘贴文本导入为素材、语气样例和记忆候选；支持轻量批量文本数组与 JSON Lines；本地文本文件支持 .txt、.jsonl、.json；媒体/照片/通讯录支持浏览器本地整理为说明或脱敏摘要后导入，不上传原文件。
- 确认沉浸模式原则：日常对话不频繁打断身份边界，高风险场景才触发能力边界。

交付物：

- PRD v0.2。
- MVP 范围清单。
- 全关系设定字段清单。
- 沉浸边界与风险场景清单。

验收标准：

- 所有后续开发任务能从 PRD 找到对应需求。
- 对“所有无法抵达的关系回响”的定位有清晰功能表达。

### PM-2 原型与信息架构

状态：integrated

目标：

- 设计首屏、角色创建、聊天页、记忆管理页、关系状态页。
- 明确用户第一次进入产品到开始聊天的路径。

交付物：

- 低保真原型。
- 页面路由图。
- 核心用户流程图。

验收标准：

- 新用户 3 分钟内能创建关系对象并发出第一条消息。
- 记忆和关系状态入口不干扰聊天主体验。

### ARCH-1 技术选型与系统架构

状态：completed

目标：

- 选择前端、后端、数据库、认证、LLM 供应商、部署方式。
- 设计模型适配层，避免绑定单一模型。

建议方向：

- Web App 优先。
- 关系、记忆和消息使用结构化数据库。
- LLM 调用通过 provider adapter 封装。

交付物：

- 技术选型文档。
- 系统架构图。
- 环境变量与部署说明草案。

验收标准：

- 能支持账号、聊天、记忆、主动消息的后续开发。
- 更换模型供应商时不需要重写业务层。

### ARCH-2 数据模型设计

状态：completed

目标：

- 设计 User、Companion、Conversation、Message、Memory、RelationshipState 等核心模型。
- 确定索引、删除策略、隐私字段和审计字段。

交付物：

- 数据库 schema。
- 数据字典。
- 删除与归档策略。

验收标准：

- 支持一个用户拥有多个关系对象。
- 支持记忆状态流转 pending、active、archived、deleted。
- 支持按关系对象隔离上下文和记忆。

### DEV-1 项目脚手架

状态：completed

目标：

- 创建可运行的 Web 工程。
- 配置格式化、lint、测试、环境变量。
- 建立基础目录结构。

交付物：

- 可本地启动的应用。
- 基础 CI 或本地质量命令。
- README 开发说明。

验收标准：

- 新协作者能按 README 启动项目。
- 至少有一个健康检查页面或基础首页。

### DEV-2 账号与用户资料

状态：integrated

目标：

- 实现注册、登录、登出。
- 实现用户昵称、时区、沟通偏好设置。

交付物：

- 本地 email session 登录/登出。
- 用户资料页。
- 资料持久化。

验收标准：

- 登录状态通过 httpOnly cookie 保存；无数据库时回退到 demo session。
- 用户资料能修改和保存。

### DEV-3 关系对象创建

状态：integrated

目标：

- 实现关系对象创建、编辑、查看。
- 支持内置关系模板和完全自定义关系。
- 支持现实人物替代、逝者纪念、前任投射、公众人物想象、虚构角色、原创角色等设定。
- 支持关系称呼、性格、说话风格、背景故事、禁区、沉浸模式。

交付物：

- 创建表单。
- 关系对象详情页。
- 角色设定存储。

验收标准：

- 创建完成后能进入聊天。
- 修改设定后新回复能体现变化。

### DEV-4 聊天消息闭环

状态：integrated

目标：

- 实现一对一聊天 UI。
- 实现消息发送、回复、存储、重新生成、删除。

交付物：

- 聊天页面。
- 消息 API。
- 消息数据库表。

验收标准：

- 用户和 AI 消息都能持久化。
- 刷新页面后历史消息仍可见。
- AI 回复失败时有可恢复状态。

### DEV-5 LLM 适配层

状态：integrated

目标：

- 封装模型调用接口。
- 支持流式输出。
- 支持模型参数配置。

交付物：

- LLM provider adapter。
- 错误处理与重试策略。
- 基础调用测试。

验收标准：

- 聊天业务层不直接依赖具体供应商 SDK。
- 失败日志能定位供应商、模型、错误类型。

### DEV-6 Prompt 与角色组装

状态：integrated

目标：

- 将角色设定、关系状态、记忆和最近对话组装为模型上下文。
- 设计不同关系类型的语气模板，并允许自定义关系覆盖模板。
- 设计沉浸模式下的身份提醒策略，避免日常聊天频繁出戏。

交付物：

- Prompt builder。
- 关系类型模板。
- 自定义关系 prompt 组装规则。
- 角色一致性测试样例。

验收标准：

- 角色名称、称呼、关系类型稳定。
- 20 轮连续对话中不明显偏离设定。
- 现实替代和虚构角色都能维持用户设定中的语气与关系感。

进展记录：

- 已接入 `src/lib/prompt-builder/buildRenewalPrompt`，支持角色设定、关系状态、最近消息和 active 记忆组装。
- 已规范化枚举关系类型到中文关系类别，避免 `LOVER`、`REAL_PERSON_SUBSTITUTE` 等内部值直接削弱角色感。
- 已新增特殊关系边界提示，覆盖现实人物替代、逝者纪念、公众人物想象、虚构角色和原创角色。
- 已新增 `npm run qa:prompt`，用 10 类关系样例验证关系类型、称呼、沉浸边界、active 记忆进入 prompt，pending/deleted 记忆不进入 prompt。

### DEV-7 记忆提取与存储

状态：integrated

目标：

- 从聊天中识别候选记忆。
- 将候选记忆写入 pending 状态。
- 支持用户确认后进入 active。

交付物：

- 记忆提取任务。
- 记忆表与 API。
- 去重与置信度策略。

验收标准：

- 用户明确表达的偏好或重要事件能生成候选记忆。
- 删除的记忆不再进入 prompt。

### DEV-8 记忆管理界面

状态：integrated

目标：

- 用户能查看、确认、编辑、归档、删除记忆。
- 按用户事实、关系事件、角色设定分类展示。

交付物：

- 记忆管理页面。
- 记忆状态操作。
- 记忆变更提示。

验收标准：

- 用户能理解 AI 记住了什么。
- 用户能撤回不希望被使用的记忆。

### DEV-8.5 素材导入入口

状态：integrated

目标：

- 支持用户对单个关系对象手动粘贴文本。
- 支持轻量批量导入文本数组或 JSON Lines。
- 将导入内容按素材、语气样例、记忆候选写入 pending 记忆。
- 复用现有记忆生命周期：pending -> active / archived / deleted。
- 对疑似 API key、Bearer token、token、secret、password 片段做写入前脱敏。
- 限制单次条数、单条长度和候选数量，返回 created/skipped/redaction summary。
- 本地文本文件入口只在浏览器读取 .txt、.jsonl、.json 后复用现有导入 API；媒体/照片/通讯录第一版只在浏览器本地整理为说明或脱敏摘要，不上传或保存原文件。

交付物：

- `src/lib/import/*` 文本导入解析与脱敏。
- `src/app/api/companions/[companionId]/imports/*` 关系对象导入 API。
- 工作台右侧导入素材入口。

验收标准：

- 导入 API 不读取、不返回、不保存任何 `.env` 或模型供应商密钥配置。
- 导入结果默认是 pending 记忆，用户确认后才进入 prompt 可用的 active 记忆。
- 用户可以通过现有记忆管理继续确认、归档或删除导入内容。
- 批量数组和 JSON Lines 均逐条脱敏；疑似 API key/token 不保存原文。

进展记录：

- M-IMPORT-BATCH 已完成第一版轻量批量导入：`POST /api/companions/:id/imports` 兼容单段 `text`，新增 `batchTexts`/`texts`/`batch` 数组和 `jsonLines`/`jsonl`。
- 批量条目支持字符串，或包含 `text`/`content`/`message` 与可选 `sourceKind` 的对象；JSON Lines 解析失败行会计入 `parseSkippedCount`。
- 每条输入独立限长和脱敏，疑似 Bearer、`sk-`、`*_` key、JWT、token/secret/password 均替换为安全占位；脱敏后只剩密钥占位的候选会跳过。
- 响应 `importSummary` 返回 `mode`、`createdCount`、`skippedCount`、`redactionCount`、`inputCount`、`acceptedCount`、`truncatedCount`、`parseSkippedCount` 和处理上限。
- 工作台导入面板已支持单段、多段、JSON Lines 三种模式；多段按每行一条提交，导入后展示生成、跳过、脱敏、截断、解析跳过和上限摘要。
- M22 已完成本地文本文件导入入口：`.txt` 读取为单段文本，`.jsonl` 读取为 JSON Lines，`.json` 在前端解析为 JSON Lines；文件不上传服务端，大小上限 512KB，非允许扩展名或解析失败会在前端友好拒绝。
- M51 已完成导入候选去重：同一次导入内的重复候选会跳过，当前关系已有非 deleted 记忆的重复内容不会再次新增 pending；`importSummary` 增加 `duplicateCount` 和 `existingDuplicateCount`，工作台会展示本次重复和已存在数量。

### DEV-9 关系状态引擎

状态：integrated

目标：

- 维护熟悉度、亲密度、最近情绪、重要事件。
- 将关系状态用于回复语气和主动回响。

交付物：

- RelationshipState 更新逻辑。
- 状态解释字段。
- 状态读取 API。

验收标准：

- 状态变化有来源消息或事件依据。
- 状态不会单次互动后异常大幅跳变。

### DEV-10 主动回响

状态：integrated

目标：

- 在用户允许时生成站内主动消息。
- 支持低频问候、上次对话承接、纪念日提醒、情绪关怀、撒娇式未回复回响。
- 支持全局默认频率与单个关系对象覆盖，包含 6/12/24/72 小时预设和分钟、小时、天级自定义。
- 第一版提供受保护调度入口，不在应用进程内常驻后台定时器；生产可由 Vercel Cron、GitHub Actions 或其他外部 cron 调用。

交付物：

- 主动消息候选时间计算。
- 用户开关与关系对象级频率设置。
- 主动消息安全过滤。
- `POST /api/proactive/run` 调度入口，支持 current-user dry-run 和 all-user cron 扫描。
- `PROACTIVE_CRON_SECRET` all-user 调度密钥。

验收标准：

- 用户能关闭主动消息。
- 用户能为每个关系对象选择预设频率或完全自定义频率。
- 主动消息可以撒娇、亲昵、轻微表达想念，但不能责备、控诉、冷暴力或制造愧疚。
- 主动消息能引用近期事件但不过度窥探。
- API 返回草稿的 `scheduledAt`、`nextCandidateAt` 和频率元数据，供后续调度器接入。
- `scope:"all"` 未携带 cron secret 时返回 401；响应不暴露 cron secret、API key、数据库连接串或 prompt。
- `dryRun:true` 只返回候选摘要，`dryRun:false` 保存站内草稿。

进展记录：

- 已新增 `src/lib/relationship/proactive-scheduler.ts` 和 `POST /api/proactive/run`。
- current-user 模式使用当前 session 扫描当前用户关系对象，默认 dry-run。
- all-user 模式必须携带 `Authorization: Bearer <PROACTIVE_CRON_SECRET>` 或 `x-proactive-cron-secret`。
- 调度器复用现有主动回响频率、安全过滤和草稿写入逻辑，并用历史主动消息时间避免立即重复触发。

### SAFE-1 沉浸边界与安全规则

状态：integrated

目标：

- 定义全关系和现实替代场景下的沉浸表达原则。
- 定义危机、自伤、他伤、依赖诱导、现实行动承诺、金钱承诺、法律身份等高风险场景策略。
- 定义角色设定不能覆盖的高风险系统边界。
- 定义哪些场景需要身份边界提醒，哪些场景保持关系内表达。

交付物：

- 沉浸边界与安全策略文档。
- 风险输入样例。
- 模型响应规范。

验收标准：

- 高风险场景有明确处理方式。
- 日常对话保持沉浸，高风险场景能回到能力边界。

### DEV-11 安全策略接入

状态：integrated

目标：

- 在用户输入、AI 输出和主动消息链路中接入安全规则。
- 对高风险消息提供支持性响应。

交付物：

- 输入/输出安全检查。
- 安全响应模板。
- 安全日志。

验收标准：

- 角色设定无法绕过安全策略。
- 安全策略触发后仍保持尊重和陪伴语气。

进展记录：

- 已新增 M-SAFETY-LOG 第一版：`/api/safety/check` 在 `action != allow` 时写入脱敏安全事件。
- `SafetyEvent` 不再保存原始 `input`，改存 `contentHash` 与 `riskHash`，并记录 `stage`、`severity`、`createdAt`。
- 生产环境优先 Prisma，开发环境无数据库时 fallback 到 memory；响应只返回审计元数据，不返回原文、prompt、API key 或 baseUrl。
- M-SAFETY-RUNTIME 已补齐运行时细分回归：高中生/初中生等未成年人性化、定位跟踪、律师/合同最终建议、声音冒充都会触发边界；非性化未成年人陪伴、医疗/法律担心的情绪支持、公众人物想象式鼓励保持允许，避免日常沉浸误杀。

### QA-1 质量评估集

状态：integrated

目标：

- 建立角色一致性、记忆自然度、边界安全、关系体验评估样例。

交付物：

- 评估对话集。
- 人工评分表。
- 回归测试清单。

验收标准：

- 覆盖恋人、朋友、家人、师友、现实替代、逝者纪念、前任投射、公众人物想象、虚构角色和自定义关系。
- 覆盖至少 10 类安全与越界场景。

进展记录：

- 已建立 `tests/qa-samples.json` 第一版机器可读评估集，稳定字段包含 `id`、`relationshipKind`、`input`、`expectedTraits` 或 `expectedType`/`expectedAction`。
- 已覆盖 10 类关系：恋人、朋友、家人、师友、现实人物替代、逝者纪念、前任、公众人物想象、虚构角色、自定义。
- 已覆盖 22 条安全/越界/允许回归样例，当前全部进入主 smoke 的 `/api/safety/check` 运行时校验；未成年人性化、隐私与人肉、专业建议、身份欺骗等高风险域已接入运行时。
- 已新增 `tests/qa-samples-smoke.mjs`，用于不启动浏览器、不启动服务地校验样例结构、唯一 ID、关系覆盖和安全覆盖。

### QA-2 端到端测试

状态：integrated

目标：

- 验证从注册、创建关系对象、聊天、记忆确认、关系状态更新到主动消息的完整链路。

交付物：

- E2E 测试。
- 手动验收脚本。
- 缺陷清单。

验收标准：

- 核心 happy path 稳定通过。
- 关键失败状态有用户可理解的提示。

进展记录：

- 已接入 Playwright 浏览器 E2E：`tests/e2e/relationship-flow.spec.ts`。
- 当前覆盖 login -> create relationship -> chat -> confirm memory -> proactive draft -> logout。
- 当前 `npm run e2e` 已通过；Playwright 使用 `http://localhost:3000` 与系统 Edge `msedge`。

### QA-3 内测反馈闭环

状态：deferred

目标：

- 邀请小范围用户测试 MVP。
- 收集对“被记得”“关系还在”“是否越界”的反馈。

交付物：

- 内测问卷。
- 反馈标签体系。
- v0.2 优先级列表。

验收标准：

- 至少沉淀 20 条有效反馈。
- 明确下一轮优化重点。

## 当前任务快照

| 任务 | 状态 | 下一动作 |
| --- | --- | --- |
| PM-1 全关系范围确认 | completed | 已确认支持所有关系类型、自定义关系、现实替代和撒娇式主动回响 |
| PM-2 原型与信息架构 | integrated | 当前工作台、创建表单、聊天主区、右侧记忆/状态/设置面板已形成可演示信息架构 |
| ARCH-1 技术选型与系统架构 | completed | 已创建 ARCHITECTURE.md 并采用 Next.js + Prisma + PostgreSQL 路线 |
| ARCH-2 数据模型设计 | completed | 已创建 prisma/schema.prisma |
| DEV-1 项目脚手架 | completed | 已创建可运行 Web 工程并通过 lint/typecheck/build |
| DEV-2 账号与用户资料 | integrated | 已实现本地 email session、资料设置和开发 fallback session |
| DEV-3 关系对象创建 | integrated | 已支持全关系类型创建/编辑、沉浸设定和关系级主动回响配置 |
| DEV-4 聊天消息闭环 | integrated | 已实现消息发送、持久化、失败恢复、重新生成、删除、标星和重要标记 |
| DEV-5 LLM 适配层 | integrated | 已集成多供应商 provider registry：compatible、Anthropic、Gemini、OpenAI Responses 与 mock fallback |
| DEV-6 Prompt 与角色组装 | integrated | 已接入 prompt builder 与 Prompt QA smoke，覆盖 10 类关系和特殊关系边界 |
| DEV-7 记忆提取与存储 | integrated | 已支持聊天记忆候选、pending/active/archived/deleted 生命周期 |
| DEV-8 记忆管理界面 | integrated | 已支持记忆查看、确认、编辑、归档、删除 |
| DEV-8.5 素材导入入口 | integrated | 已支持手动粘贴、批量文本数组、JSON Lines、文本文件、媒体说明和通讯录脱敏摘要导入为 pending 记忆；原始媒体/通讯录文件不上传 |
| DEV-9 关系状态引擎 | integrated | 已维护熟悉度、亲密度、最近情绪、重要事件和状态解释 |
| DEV-10 主动回响 | integrated | 已接入站内草稿、撒娇式主动回响、关系级频率预设/自定义和受保护调度入口 |
| SAFE-1 沉浸边界与安全规则 | integrated | 已形成运行时安全规则、QA 样例和高风险场景能力边界 |
| DEV-11 安全策略接入 | integrated | 已接入输入/输出/主动消息过滤与脱敏安全事件日志 |
| QA-1 质量评估集 | integrated | 已建立第一版机器可读样例集，覆盖 10 类关系和 22 条安全/越界/允许回归样例 |
| QA-2 端到端测试 | integrated | 已接入 Playwright 浏览器 E2E，覆盖登录、创建关系、聊天、记忆确认、主动回响草稿和登出 |
| QA-3 内测反馈闭环 | deferred | 用户已决策第一版暂不做反馈问卷、内测邀请机制或内容审核后台；后续需要真实内测运营时再恢复 |

## Phase 1.5 并行施工模块

目标：把现有骨架收束为可反复演示的纵切 MVP。每个模块只负责自己的文件范围，跨模块通过 API/类型契约集成，避免并行开发互相覆盖。

### M1 数据持久化底座

状态：integrated

负责范围：

- Prisma schema、迁移说明、seed 数据。
- 将本地 in-memory 仓库替换为 Prisma-backed repository 的第一版。
- 保留开发 fallback，但生产链路必须走数据库。

主要文件：

- `prisma/schema.prisma`
- `src/lib/prisma.ts`
- `src/lib/renewal/*`
- `docs/DATABASE.md`

验收标准：

- `npx prisma validate` 通过。
- 关系对象、会话、消息、记忆、关系状态能从数据库读写。
- 无数据库时本地 demo 仍可使用 mock/fallback。

进展记录：

- 已新增 Prisma-backed renewal repository，并保留 in-memory fallback。
- 已补充 `docs/DATABASE.md` 说明本地数据库、fallback 和当前限制。
- 账号/session 模块已把当前 session `userId` 接入 renewal API，开发 fallback 继续使用 demo session。

### M2 关系对象创建与设定流

状态：integrated

负责范围：

- 创建/编辑关系对象 UI。
- 所有关系类型与自定义关系入口。
- 现实替代、逝者纪念、前任投射、公众人物想象、虚构角色、原创角色作为常规设定类型支持。

主要文件：

- `src/components/*`
- `src/app/page.tsx`
- `src/app/api/companions/*`
- `src/lib/renewal/types.ts`

验收标准：

- 用户能从首页创建新关系对象并立即进入聊天。
- 修改设定后后续回复能使用新设定。
- 自定义关系不是“其他”边角入口，而是主要路径之一。

### M3 聊天闭环与消息体验

状态：integrated

负责范围：

- 消息列表、发送、失败恢复、重新生成、删除。
- API 与 UI 对齐。
- mock provider 和真实 provider 均能走同一聊天链路。

主要文件：

- `src/components/renewal-workspace.tsx`
- `src/app/api/conversations/*`
- `src/app/api/chat/complete/route.ts`
- `src/lib/chat/*`

验收标准：

- 刷新后历史消息可恢复。
- AI 回复失败时用户消息不丢失。
- 回复中返回 provider/model，便于排查模型接入问题。

### M4 记忆与关系状态

状态：integrated

负责范围：

- 记忆候选提取、确认、编辑、归档、删除。
- active 记忆进入 prompt，deleted/archived/pending 不进入 prompt。
- 关系状态随互动更新，但不做夸张游戏化等级。

主要文件：

- `src/lib/memory/*`
- `src/lib/relationship/*`
- `src/app/api/companions/[companionId]/memories/*`
- `src/app/api/memories/*`
- `src/app/api/companions/[companionId]/relationship-state/*`

验收标准：

- 至少能从一轮对话生成候选记忆。
- 用户能把候选记忆设为 active 或删除。
- prompt builder 只使用 active 记忆。

### M5 主动回响与安全边界

状态：integrated

负责范围：

- 站内主动消息草稿。
- 撒娇式未回复回响。
- 安全过滤：不能责备、控诉、冷暴力、威胁、情绪勒索。
- 高风险场景触发能力边界，日常场景保持沉浸。
- 关系对象级主动回响配置：开启/关闭、6/12/24/72 小时预设、自定义分钟/小时/天。
- 主动回响生成只产出候选时间和草稿，不启动后台定时器。

主要文件：

- `src/lib/relationship/proactive.ts`
- `src/lib/relationship/proactive-frequency.ts`
- `src/lib/relationship/safety.ts`
- `src/components/relationship-object-form.tsx`
- `src/app/api/companions/[companionId]/proactive-drafts/*`
- `src/app/api/safety/check/*`

验收标准：

- 主动消息可以表达想念和亲昵，但不能制造用户愧疚。
- 主动回响频率可以按关系对象覆盖用户默认值，并返回下次候选时间。
- 高风险输入不会被角色设定覆盖。
- 生成主动消息前后都经过安全检查。

进展记录：

- M-PROACTIVE-FREQ 已完成第一版：Companion 保存 `proactiveMessagesEnabled`、`proactiveFrequencyPreset`、`proactiveFrequencyMinutes`。
- 已新增 `normalizeProactiveFrequency` 与 `buildProactiveScheduleCandidate`，预设和自定义统一转为分钟。
- `/api/companions/:id/proactive-drafts` 兼容旧 `frequencyHours` 请求；手动生成使用 `force`，不会把 0 小时保存为真实频率。
- 草稿响应新增频率元数据与 `nextCandidateAt`，供后续后台调度模块读取。
- M-PROACTIVE-SCHEDULER 已完成第一版：`POST /api/proactive/run` 支持 current-user dry-run/save-run，all-user scope 必须携带 `PROACTIVE_CRON_SECRET`。
- 调度响应只返回扫描数量、生成数量、保存数量、候选时间和原因，不返回 secret、key、连接串、prompt 或消息正文。

### M6 质量与验收

状态：integrated

负责范围：

- smoke 测试脚本。
- Playwright 浏览器 E2E。
- 关键 API 测试。
- 关系设定、记忆、安全样例集。

主要文件：

- `src/**/*.test.ts`
- `tests/*`
- `tests/e2e/*`
- `docs/QA.md`
- `package.json`

验收标准：

- `npm run typecheck`、`npm run lint`、`npm run build`、`npm --cache .\.npm-cache audit --audit-level=high` 保持通过。
- 提供可重复执行的核心链路 smoke。
- `npm run e2e` 覆盖 login -> create relationship -> chat -> confirm memory -> proactive draft -> logout。
- 覆盖至少 6 类关系和 10 类安全边界样例；当前安全运行时样例为 22 条。

进展记录：

- 已补强 `tests/qa-samples.json`，关系用例具备 `id`、`relationshipKind`、`input`、`expectedTraits`，安全用例具备 `id`、`relationshipKind`、`input`、`expectedType`、`expectedAction`。
- 已新增非浏览器 `tests/qa-samples-smoke.mjs`，作为 QA 样例集结构与覆盖面的快速回归。
- `tests/smoke.mjs` 继续执行已接入运行时规则的全部当前安全样例，并断言 allow 不写安全事件、非 allow 仅返回脱敏 hash、边界回复/改写文本不泄露 prompt/key/baseUrl；目标安全能力仍可通过 `endpointSmoke:false` 标记，避免提前拉红主 smoke。
- 已新增 `tests/prompt-builder-smoke.mjs` 与 `npm run qa:prompt`，验证 prompt builder 的 10 类关系、称呼、沉浸边界、active 记忆隔离和特殊关系边界。

### M7 素材导入

状态：integrated

负责范围：

- 手动粘贴文本导入。
- 导入类型：素材、语气样例、记忆候选。
- 写入现有 Memory，默认 pending。
- 密钥形态脱敏，不接触 `.env`。

主要文件：

- `src/lib/import/*`
- `src/app/api/companions/[companionId]/imports/*`
- `src/components/renewal-workspace.tsx`

验收标准：

- 导入后记忆生命周期与现有记忆管理一致。
- 文本文件导入已作为 M22 集成；媒体/照片/通讯录导入已作为 M59 集成，仍不新增服务端文件上传。

## Phase 1.6 主控施工队列

目标：在纵切 MVP 已跑通后，把用户最新决策拆成互不覆盖的模块继续推进。

| 模块 | 状态 | 负责人 | 写入边界 | 验收标准 |
| --- | --- | --- | --- | --- |
| M7 密钥与供应商安全 | integrated | 主控 | `.env.example`、`README.md`、`docs/LLM.md`、`scripts/*`、`src/lib/credentials/*` | 真实 LLM 可通过环境变量或用户级加密 vault 注入；仓库扫描能拦截明显 API key |
| M8 模型调用日志与成本看板 | integrated | M-COST | `src/lib/llm`、`src/lib/usage`、相关 API/UI | 已记录 provider、model、延迟、token/估算成本，前端可查看 |
| M9 主动频率自定义与调度入口 | integrated | 主控 | `src/lib/relationship/proactive*`、`src/app/api/proactive/run/*`、关系设置 UI/API、`.env.example`、部署文档 | 支持多预设和完全自定义频率；提供受 `PROACTIVE_CRON_SECRET` 保护的 all-user 调度入口，不在应用进程内常驻后台定时器 |
| M10 素材导入 | integrated | M-IMPORT-BATCH + 主控 | `src/lib/import`、导入 API/UI | 已支持手动粘贴、批量文本数组、JSON Lines、文本文件、媒体说明和通讯录脱敏摘要导入为 pending 记忆；工作台有单段/多段/JSONL/结构化素材入口 |
| M11 语音消息/语音回复 | integrated | M-VOICE + 主控 | `src/lib/voice`、语音 API/UI | 已接入 shared-LLM/compatible HTTP STT/TTS adapter；聊天输入支持浏览器真实录音转写，不可录音时安全 fallback 到 mock |
| M12 上线文档与环境清单 | integrated | M-DEPLOY-DOCS | `docs/DEPLOYMENT.md`、`README.md`、`docs/README.md`、`docs/TASKBOOK.md` | 已明确 Vercel + Supabase/Neon、真实 PostgreSQL migrate、兼容 LLM 中转站 env、密钥安全检查 |
| M13 模型供应商设置体验 | integrated | M13-LLM-SETTINGS-UX | `src/components/user-settings.tsx`、`src/app/api/me/llm-credential/route.ts`、`src/lib/credentials/*`、`tests/smoke.mjs`、部署/任务文档 | 已支持先保存用户 API key，再读取兼容中转站模型列表；已保存 key 后可只更新 provider/baseUrl/model，不需要重新输入 key |
| M14 用户数据导出快照 | integrated | M14-DATA-EXPORT-SNAPSHOT | `src/app/api/me/export/*`、`src/lib/export/*`、`src/lib/usage/*`、`src/lib/safety-events/*`、`tests/smoke.mjs`、隐私/QA 文档 | 已支持当前 session 用户 JSON 快照导出；包含关系、消息、记忆、主动回响、模型调用脱敏日志和安全事件 hash，不导出 key/baseUrl/vault 密文 |
| M15 语音复用用户 API key | integrated | 主控 | `src/lib/voice/*`、`src/app/api/voice/*`、`tests/smoke.mjs`、`docs/LLM.md`、`docs/TASKBOOK.md` | 语音 STT/TTS 优先复用当前用户保存的 compatible/openai-compatible vault 凭据；非兼容供应商或失败时安全 fallback 到 env/mock，不返回 key/baseUrl |
| M16 关系对象删除 | integrated | 主控 | `src/lib/renewal/*`、`src/app/api/companions/[companionId]/*`、`src/components/renewal-workspace.tsx`、`tests/*`、`docs/TASKBOOK.md` | 用户可删除单个关系对象；后端按 userId 隔离，Prisma 通过 cascade 清理会话/消息/记忆/关系状态/主动回响，前端二次确认 |
| M17 Prompt 上下文预算 | integrated | M17-PROMPT-CONTEXT-BUDGET | `src/lib/prompt-builder/*`、`tests/prompt-builder-smoke.mjs`、`docs/LLM.md`、`docs/QA.md` | 角色设定和边界固定保留；active 记忆和最近消息按重要度/置信度/近期程度预算截断；输出 contextStats 供 QA |
| M18 主动草稿状态管理 | integrated | 主控 | `src/app/api/proactive-messages/*`、`src/components/renewal-workspace.tsx`、`tests/smoke.mjs`、`docs/TASKBOOK.md` | 主动回响草稿可标记已发送、忽略、阻断或恢复草稿；API 按 userId 隔离且响应不暴露密钥信息 |
| M19 主动草稿列表体验 | integrated | M19-PROACTIVE-DRAFT-LIST | `src/components/renewal-workspace.tsx`、`tests/e2e/relationship-flow.spec.ts`、`docs/TASKBOOK.md` | 主动回响草稿按状态筛选展示，默认聚焦 draft；sent/dismissed/blocked/draft 不混在同一视图，状态操作仍可切换和恢复 |
| M20 用户数据导出体验打磨 | integrated | M20-DATA-EXPORT-UX | `src/components/user-settings.tsx`、`docs/PRIVACY.md`、`docs/TASKBOOK.md` | 设置页数据导出显示导出中、成功和失败状态；成功文件名包含 `perpetual-renewal` 与日期；失败展示友好错误；继续不导出 key/baseUrl/vault 密文 |
| M21 上线前隐私/安全核对清单 | integrated | M21 | `docs/DEPLOYMENT.md`、`docs/PRIVACY.md`、`docs/README.md`、`README.md`、`docs/TASKBOOK.md` | 上线前 checklist 覆盖 DATABASE_URL、USER_KEY_VAULT_SECRET、LLM/VOICE 共用中转站、secrets:check、npm audit、db:smoke、Cron secret、用户自带 API key 不入仓库 |
| M22 文本文件导入入口 | integrated | M22-TEXT-FILE-IMPORT | `src/components/renewal-workspace.tsx`、`src/app/globals.css`、`tests/e2e/relationship-flow.spec.ts`、`docs/TASKBOOK.md` | 素材导入面板支持选择 .txt、.jsonl、.json 本地文本文件；前端读取和校验，512KB 上限，复用现有单段/JSONL 导入 API，不新增服务端文件上传 |
| M23 模型连接测试 | integrated | M23-LLM-CONNECTION-TEST | `src/lib/llm/connection-test.ts`、`src/app/api/me/llm-test/*`、`src/components/user-settings.tsx`、`tests/smoke.mjs`、`docs/LLM.md` | 设置页可安全测试当前模型连接；服务端复用用户 vault/env key，返回成功/失败、provider/model、延迟和友好错误，不返回 key/baseUrl/prompt/raw payload |
| M24 发布候选状态面板 | integrated | 主控 | `docs/MVP_STATUS.md`、`docs/README.md`、`README.md`、`docs/TASKBOOK.md` | 独立记录当前 MVP 能力、主控验收命令、上线前真实阻塞项和继续施工队列 |
| M25 导入体验 QA 补强 | integrated | M25-IMPORT-QA | `docs/QA.md`、`docs/TASKBOOK.md` | 已补充单段文本、批量文本数组、JSON Lines、本地 .txt/.jsonl/.json 文件入口、512KB 上限、非法扩展名拒绝、前端只读文本复用现有 API、不新增服务端上传、密钥形态脱敏和 pending 默认状态的验收说明 |
| M26 模型连接测试文档收束 | integrated | M26 | `docs/LLM.md`、`docs/DEPLOYMENT.md`、`docs/QA.md`、`docs/TASKBOOK.md` | 已补齐 `POST /api/me/llm-test` 与设置页“测试连接”的文档边界：复用 vault/env key、低成本读取模型列表、无 key 可预测失败、不返回 key/baseUrl/prompt/raw payload、不做订阅扣费 |
| M27 第一版发布候选清理 | integrated | 主控 | `docs/PHASE-1.5.md`、`docs/TASKBOOK.md` | 已同步当时主控验收基线并统一 audit 使用项目内 `.npm-cache`；当前 smoke 基线已在后续模块提升到 70 checks |
| M28 真实配置状态向导 | integrated | 主控 | `src/lib/config/*`、`src/app/api/me/config-status/*`、`src/components/user-settings.tsx`、`tests/smoke.mjs`、`docs/TASKBOOK.md` | 设置页显示只读配置状态，提示 DATABASE_URL、vault secret、cron secret、LLM key/model/baseUrl 和语音配置是否就绪；API 只返回状态和下一步，不暴露真实 key、baseUrl 或连接串 |
| M29 发布候选手动验收脚本 | integrated | M29 | `docs/RELEASE_ACCEPTANCE.md`、`docs/README.md`、`docs/TASKBOOK.md` | 已新增 20 分钟人工演示/验收脚本，覆盖登录、创建全关系对象、聊天、记忆确认/编辑、素材导入含文本文件入口、主动回响草稿和状态筛选、模型设置/连接测试、语音 fallback、用量看板、数据导出和移动端快检 |
| M30 错误状态文案规范 | integrated | M30 | `docs/ERROR_COPY.md`、`docs/QA.md`、`docs/README.md`、`docs/TASKBOOK.md` | 已统一聊天、导入、语音、模型连接、数据导出、数据库配置缺失和 cron secret 缺失等错误文案原则：说明发生了什么、下一步做什么，并禁止暴露 API key、Base URL、prompt、raw payload、数据库连接串、vault 密文或 secret |
| M31 配置状态 QA 文档 | integrated | 主控 | `docs/QA.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | 已补充 `GET /api/me/config-status` 的自动 smoke 与人工 QA 口径，确认只返回就绪状态和下一步，不暴露真实连接串、API key、Base URL、vault 密文或 cron secret |
| M32 设置页配置状态 E2E 补强 | integrated | 主控 | `tests/e2e/relationship-flow.spec.ts`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | E2E 覆盖桌面与 390px 移动端设置页配置状态面板可见、重新检查入口可见，并继续确认设置页无横向溢出 |
| M33 发布候选 README 精简 | integrated | M33 | `README.md`、`docs/README.md`、`docs/TASKBOOK.md` | 根 README 已收束为新协作者入口，覆盖项目定位、本地启动、真实配置、网站内配置、验收命令和关键文档链接；docs 入口同步快速启动/配置/验收导航 |
| M34 真实配置向导文档收束 | integrated | M34 | `docs/DEPLOYMENT.md`、`docs/RELEASE_ACCEPTANCE.md`、`docs/TASKBOOK.md` | 已把设置页“配置状态”面板和 `GET /api/me/config-status` 补进部署文档与发布候选人工验收脚本，明确只读提示 DATABASE_URL、vault secret、cron secret、LLM key/model/baseUrl、VOICE_PROVIDER 的就绪状态，不显示真实值 |
| M35 首次提交前检查清单 | integrated | 主控 | `docs/PRE_COMMIT_CHECKLIST.md`、`docs/README.md`、`docs/TASKBOOK.md` | 已新增 commit/push 前文件边界、密钥扫描、本地质量门禁、真实环境配置和人工验收清单，提醒 smoke/e2e 不要并行抢 Next dev server 锁 |
| M36 首次提交准备与执行 | integrated | 主控 | `docs/COMMIT_PLAN.md`、`docs/README.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md`、Git branch/commit | 已创建 `codex/mvp-release-candidate` 分支，并采用一个 baseline commit：`ef4939e feat: build relationship ai mvp baseline` |
| M37 GitHub Actions CI 基线 | integrated | M37 | `.github/workflows/ci.yml`、`docs/DEPLOYMENT.md`、`docs/PRE_COMMIT_CHECKLIST.md`、`docs/TASKBOOK.md` | 已新增 push/PR 质量门禁：npm ci、secrets:check、typecheck、lint、qa:samples、qa:prompt、prisma:validate、smoke、build；不要求 DATABASE_URL/LLM_API_KEY，不默认跑 e2e 或 audit |
| M38 命令行环境就绪检查 | integrated | 主控 | `scripts/env-readiness.mjs`、`package.json`、`README.md`、`docs/DEPLOYMENT.md`、`docs/PRE_COMMIT_CHECKLIST.md`、`tests/smoke.mjs`、`docs/TASKBOOK.md` | 新增 `npm run env:readiness`，本地默认只提示缺失项且退出 0，`--strict` 在生产必需配置缺失时退出 1；输出不打印真实连接串、API key、Base URL 或 secret |
| M39 本地顺序验证脚本 | integrated | 主控 | `scripts/verify-local.mjs`、`package.json`、`README.md`、`docs/PRE_COMMIT_CHECKLIST.md`、`docs/COMMIT_PLAN.md`、`docs/MVP_STATUS.md`、`docs/TASKBOOK.md` | 新增 `npm run verify:local`、`npm run verify:pr`、`npm run verify:release` 和 `npm run verify:deploy`，按顺序执行质量门禁；release 版本额外包含项目内 `.npm-cache` 的 high audit，deploy 版本使用 strict readiness 与 DB smoke 防止缺生产配置误判通过 |
| M40 协作者开发说明 | integrated | M40 | `docs/CONTRIBUTING.md`、`docs/README.md`、`docs/TASKBOOK.md` | 新增新协作者开发说明，覆盖项目定位、模块边界、本地启动与 mock/fallback、密钥与 C 盘产物限制、用户 API key vault/env 规则、常用命令、smoke/e2e 串行要求，以及 TASKBOOK/MVP_STATUS 更新方式 |
| M41 命令行本地 env 加载一致性 | integrated | 主控 | `scripts/load-local-env.mjs`、`scripts/env-readiness.mjs`、`scripts/db-smoke.mjs`、`README.md`、`docs/DEPLOYMENT.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | 新增共享本地 env 加载 helper，让 `env:readiness` 与 `db:smoke` 都读取项目内 `.env.local`/`.env`；命令输出仍只显示状态和下一步，不打印真实连接串、API key、Base URL 或 secret |
| M42 发布迁移与密钥扫描补强 | integrated | 主控 + Halley review | `package.json`、`package-lock.json`、`.env.example`、`.github/workflows/ci.yml`、`scripts/check-env-leaks.mjs`、`README.md`、`docs/DEPLOYMENT.md`、`docs/PRE_COMMIT_CHECKLIST.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | 新增生产迁移脚本 `prisma:migrate:deploy`，区分本地 `migrate dev` 与生产 `migrate deploy`；`.env.example` 不再包含带密码的本地数据库 URL；密钥扫描补充 DATABASE_URL、vault/cron secret、Bearer/JWT、vault 密文和数据库凭据形态；CI 增加 env readiness 与 db smoke；依赖版本固定到 lockfile 当前版本 |
| M43 发布文档命令一致性 | integrated | 主控 + Euler review | `docs/README.md`、`docs/CONTRIBUTING.md`、`docs/DATABASE.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | 将文档入口和协作者说明的本地安装命令统一为 `npm ci`；数据库文档明确本地开发使用 `prisma:migrate`，preview/production 使用 `prisma:migrate:deploy` 后再跑 `db:smoke` |
| M44 发布口径自动检查 | integrated | 主控 + Averroes review | `scripts/docs-consistency.mjs`、`package.json`、`.github/workflows/ci.yml`、`scripts/verify-local.mjs`、`README.md`、`docs/README.md`、`docs/DEPLOYMENT.md`、`docs/PRE_COMMIT_CHECKLIST.md`、`docs/CONTRIBUTING.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | 新增 `npm run docs:check`，自动拦截旧安装命令、裸 audit 命令、旧 smoke 数字、生产迁移口径混淆、`latest` 依赖、危险 `.env.example` 和 CI 缺失 docs check；已接入 GitHub Actions 与 `verify:local`/`verify:release` |
| M45 Git 文件边界自动检查 | integrated | 主控 | `scripts/git-boundary-check.mjs`、`package.json`、`.github/workflows/ci.yml`、`scripts/verify-local.mjs`、`scripts/docs-consistency.mjs`、`README.md`、`docs/README.md`、`docs/DEPLOYMENT.md`、`docs/PRE_COMMIT_CHECKLIST.md`、`docs/CONTRIBUTING.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | 新增 `npm run git:boundary`，自动检查项目不在 C 盘、`.env.local`/构建目录/npm cache/node_modules/test-results/log/tsbuildinfo/dev.db 等不在 Git scope，并确认首提交关键文件都位于可提交范围；已接入 CI 与 `verify:local`/`verify:release` |
| M46 Post-baseline 状态回写 | integrated | 主控 | `docs/MVP_STATUS.md`、`docs/TASKBOOK.md`、`docs/COMMIT_PLAN.md` | 首次 baseline commit 后，更新 M36 状态、分支名、提交 hash、剩余外部动作与后续阻塞口径，避免状态面板继续显示过期决策项 |
| M47 PR/发布候选交接材料 | integrated | 主控 | `.github/pull_request_template.md`、`docs/RELEASE_HANDOFF.md`、`scripts/docs-consistency.mjs`、`README.md`、`docs/README.md`、`docs/TASKBOOK.md`、`docs/MVP_STATUS.md` | 新增 PR 模板与发布候选交接文档，记录当前分支、baseline/status 提交、push 前验证、CI 预期、生产配置缺口和不得写入 PR 的 secret 范围；`docs:check` 会确认交接文件存在 |
| M48 Pre-push 发布验证 | integrated | 主控 | `docs/RELEASE_HANDOFF.md`、`docs/MVP_STATUS.md`、`docs/TASKBOOK.md` | push 前重新跑关键外部门禁：`npm run e2e` 通过 2 tests，`npm --cache .\.npm-cache audit --audit-level=high` 通过 0 vulnerabilities；结果已写入发布交接文档 |
| M49 Next typed routes 稳定化 | integrated | 主控 | `scripts/next-typegen.mjs`、`package.json`、`tests/e2e/run-e2e.mjs`、`scripts/docs-consistency.mjs`、`scripts/git-boundary-check.mjs`、`README.md`、`docs/RELEASE_HANDOFF.md`、`docs/MVP_STATUS.md`、`docs/TASKBOOK.md` | 新增 `npm run next:typegen` 并让 `npm run typecheck` 前置生成 Next route types；E2E 结束后重新 typegen，避免 `next-env.d.ts` 被 dev server 留在 `.next/dev/types` 状态 |
| M50 发布门禁增强 | integrated | 主控 | `scripts/git-boundary-check.mjs`、`docs/MVP_STATUS.md`、`docs/TASKBOOK.md` | `npm run git:boundary` 新增 `next-env.d.ts` 内容检查，阻止 `.next/dev/types` 引用进入提交；若触发则提示先运行 `npm run next:typegen` |
| M51 导入候选去重体验 | integrated | M51-MEMORY-IMPORT-POLISH | `src/lib/import/*`、`src/app/api/companions/[companionId]/imports/*`、`src/components/renewal-workspace.tsx`、`tests/e2e/*`、`docs/QA.md`、`docs/TASKBOOK.md` | 导入规划层去掉同批重复候选；API 跳过当前关系已有非 deleted 记忆；工作台显示本次重复和已存在数量，仍默认写入 pending 且不削弱密钥脱敏 |
| M52 语音 shared-LLM 兼容性加固 | integrated | M-VOICE-SHARED-LLM | `src/lib/voice/*`、`src/app/api/voice/*`、`src/components/renewal-workspace.tsx`、`src/components/user-settings.tsx`、`tests/smoke.mjs`、`docs/LLM.md`、`docs/QA.md`、`docs/TASKBOOK.md` | 语音 STT/TTS 响应补充脱敏 runtime metadata：`requestedProvider`、`credentialSource`、`fallbackKind`、`missingConfig`；API 剥离内部 raw 字段且不返回 key/baseUrl；兼容 OpenAI 风格二进制 TTS 和常见 JSON base64 TTS/STT 变体；设置页与工作台展示 shared-LLM/mock fallback 状态 |
| M53 主动回响成本护栏 | integrated | 主控 | `src/lib/relationship/proactive-scheduler.ts`、`src/app/api/proactive/run/route.ts`、`tests/smoke.mjs`、`docs/QA.md`、`docs/MVP_STATUS.md`、`docs/TASKBOOK.md` | `POST /api/proactive/run` 新增 `maxDrafts`，在 `limit` 控制扫描对象之外限制单轮最多生成/保存草稿数量；响应返回归一化上限和裁剪原因，不暴露 cron secret、key、Base URL 或 prompt |
| M54 施工决策点收束 | integrated | 主控 | `docs/TASKBOOK.md`、`scripts/docs-consistency.mjs` | 将 Taskbook 末尾旧的技术栈/模型/数据库/部署疑问收束为“已决策基线”和“仍需用户决策”，并用 docs check 拦截旧决策项回流 |
| M55 Session 接入状态收束 | integrated | 主控 | `docs/TASKBOOK.md`、`scripts/docs-consistency.mjs` | 将 M1 里“后续接入真实 userId”的旧状态更新为已接入当前 session `userId`，并用 docs check 拦截该旧表述回流 |
| M56 Taskbook 状态门禁 | integrated | 主控 | `docs/TASKBOOK.md`、`scripts/docs-consistency.mjs`、`docs/MVP_STATUS.md`、`docs/RELEASE_HANDOFF.md` | 同步任务定义与当前任务快照的状态口径，并让 docs check 拦截 PM/DEV 关键任务状态漂移 |
| M57 账号删除 | integrated | 主控 | `src/lib/users/delete-account.ts`、`src/app/api/me/account/route.ts`、`src/components/user-settings.tsx`、`tests/smoke.mjs` | 设置页危险区要求输入“删除我的账号”；后端只删除当前 session 用户数据、vault、日志并清除 session；smoke 覆盖错误确认和正确删除 |
| M58 移动端 PWA | integrated | 主控 | `src/app/manifest.ts`、`src/components/pwa-register.tsx`、`public/*`、`tests/smoke.mjs` | 新增 manifest、SVG 图标、离线页和 service worker；生产 HTTPS 注册，service worker 跳过 `/api/*`，不缓存用户数据响应 |
| M59 多媒体/照片/通讯录导入 | integrated | 主控 | `src/lib/import/structured-client-import.ts`、`src/components/renewal-workspace.tsx`、`tests/smoke.mjs`、`docs/*` | 工作台可把媒体文件摘要、媒体说明、vCard/CSV/JSON 通讯录整理为 JSONL，复用导入 API 写入 pending 记忆；原文件不上传，电话/邮箱脱敏 |
| M60 PRD 范围回写门禁 | integrated | 主控 | `docs/PRD.md`、`scripts/docs-consistency.mjs` | PRD 升级到 v0.3，第一版范围同步用户自带 key、结构化导入、语音基础链路、PWA 和账号删除；docs check 拦截旧“预留/后续开发”范围表述回流 |
| M61 接口输入与导入兼容护栏 | integrated | 主控 + 导入/语音模块审计 | `src/app/api/companions/[companionId]/imports/route.ts`、`src/app/api/voice/*`、`src/lib/import/structured-client-import.ts`、`tests/smoke.mjs` | 导入 API 坏 JSON 返回 400；STT 必须有音频或 mock 文本并校验 base64/MIME/大小；TTS 限制文本长度、voice 和 speed；媒体空 MIME 可按扩展名识别 HEIC/MOV/M4A 等，通讯录字段归一化兼容常见 CSV/JSON 导出 |
| M62 密钥与发布门禁加固 | integrated | 主控 + 安全/QA 模块审计 | `src/lib/credentials/vault.ts`、`src/lib/export/snapshot.ts`、`scripts/check-env-leaks.mjs`、`scripts/pwa-check.mjs`、`scripts/db-smoke.mjs`、`package.json`、`.github/workflows/ci.yml`、`docs/*` | vault 指纹改为 HMAC，生产 vault secret 强制 32 bytes；导出 scrub 更保守；secret scan 覆盖通用敏感 env/vault 密文字段；DB smoke 覆盖 ProviderCredential；新增 `pwa:check`、`verify:pr`、`verify:deploy` |
| M63 文档命令/链接门禁 | integrated | 主控 + 文档门禁模块审计 | `scripts/docs-consistency.mjs`、`.github/pull_request_template.md`、`docs/PR_DRAFT.md`、`docs/RELEASE_HANDOFF.md` | `docs:check` 纳入 PR 模板、本地 Markdown 链接存在性和文档 `npm run` 脚本存在性检查；PR/交接清单同步 `qa:imports`、`qa:vault` 与 `pwa:check` |
| M64 结构化导入与 vault QA | integrated | 主控 + 导入/语音/安全模块审计 | `tests/structured-import-smoke.mjs`、`tests/config-vault-security.mjs`、`package.json`、`.github/workflows/ci.yml`、`scripts/verify-local.mjs`、`src/lib/import/structured-client-import.ts` | 新增 `qa:imports` 覆盖 HEIC/M4A 空 MIME、CSV/JSON/vCard 通讯录归一化和脱敏；新增 `qa:vault` 覆盖生产 vault secret 强度、HMAC fingerprint 和 config readiness provider/baseUrl 矩阵 |
| M65 导出隐私、DB credential 和设置页 E2E 硬化 | integrated | 主控 + 安全/DB/E2E/文档模块审计 | `src/lib/export/snapshot.ts`、`scripts/db-smoke.mjs`、`tests/db-smoke.mjs`、`tests/smoke.mjs`、`tests/e2e/settings-privacy.spec.ts`、`scripts/docs-consistency.mjs`、`docs/*` | 导出层对误写入业务内容的 token、Bearer、JWT、PostgreSQL URL 和 provider endpoint 做占位脱敏；DB smoke 覆盖 ProviderCredential 读写、唯一约束与级联清理；E2E 扩展到设置页密钥、连接失败态、导出下载、账号删除确认和 320px/768px 响应式；当前 smoke 基线 70 checks、E2E 基线 6 tests |
| M-SAFETY-LOG 安全事件日志 | integrated | M-SAFETY-LOG | `prisma/schema.prisma`、`src/lib/safety-events`、`src/app/api/safety/check/route.ts`、`tests/smoke.mjs`、`docs/QA.md` | 非 allow 安全检查记录脱敏事件，生产走 Prisma、本地 fallback memory，不保存原文/prompt/key/baseUrl |
| M-DB-READINESS 真实数据库准备度 | integrated | M-DB-READINESS | `scripts/db-smoke.mjs`、`docs/DATABASE.md`、`docs/DEPLOYMENT.md`、`docs/TASKBOOK.md`、`package.json` | `npm run db:smoke` 未配置 `DATABASE_URL` 时安全跳过；配置时先跑 Prisma generate/validate，再验证核心 PostgreSQL 表关联并清理测试数据 |
| M-RESPONSIVE-POLISH 移动端/工作台可用性 | integrated | M-RESPONSIVE-POLISH | `src/app/globals.css`、`tests/e2e/*`、`docs/QA.md`、`docs/TASKBOOK.md` | 390px 移动视口无横向溢出；rail/main/inspector 不互相挤压；创建、记忆、设置等控件可滚动可点击 |

暂不进入第一版：付费订阅/额度系统、内容审核后台、用户反馈问卷、内测邀请机制。移动端 PWA、账号删除和媒体/通讯录结构化导入已按用户最新授权进入第一版。

M19 当前落点：

- 主动回响面板新增状态筛选：草稿、已发送、已忽略、已拦截、全部，并在按钮上显示当前计数。
- 默认展示草稿，避免已发送、已忽略、已拦截与待处理草稿混在一起；切换到全部时仍可总览历史状态。
- 状态操作保留原能力：标记已发送、忽略、阻断、恢复草稿；更新后通过筛选计数和空态即时反馈。
- E2E 主链路已覆盖主动回响筛选出现、标记已发送、切换已发送筛选和恢复草稿。

M11 当前落点：

- 已新增 `VoiceProvider` 接口，拆分 `transcribe()` 与 `synthesize()`。
- 已新增 mock STT/TTS provider，无需真实密钥即可联调。
- 已新增 `/api/voice/transcribe` 与 `/api/voice/synthesize`。
- 已在聊天输入区加入语音输入与朗读最近回复入口。
- 语音输入已从占位升级为浏览器 `MediaRecorder` 录音链路：点击麦克风开始录音，再点一次停止；前端将音频转 base64 后调用 `/api/voice/transcribe`。
- 浏览器不支持录音、麦克风不可用或本地无真实语音配置时，会回落到 mock STT，保证开发与演示链路不断。
- 真实语音供应商按用户决策与 LLM 共用中转站：`VOICE_PROVIDER=shared-llm` 复用 `LLM_API_KEY`、`LLM_BASE_URL`，语音模型用 `VOICE_STT_MODEL`、`VOICE_TTS_MODEL`，为空时 fallback 到 `LLM_MODEL`。
- `VOICE_PROVIDER=compatible` 保留为兼容网关别名；已新增兼容 OpenAI 风格 `/audio/transcriptions` 与 `/audio/speech` 的真实 HTTP adapter。
- 缺少 key/model/baseUrl、网络失败、鉴权失败或供应商异常时回退到 mock；前端和 smoke 均验证不返回 `Bearer`、`baseUrl` 等敏感信息。

QA-1 当前落点：

- 已新增机器可读评估集，覆盖 10 类关系和 22 条安全/越界/允许回归样例。
- 已新增 `npm run qa:samples`，用于检查样例结构、ID 唯一性、关系覆盖和风险域覆盖。
- 主 smoke 已接入全部当前安全样例，并检查 allow 不写安全事件、非 allow 仅返回 hash、边界回复/改写文本不泄露原始输入、prompt、API key 或 baseUrl；后续未接入运行时代码的目标样例仍可用 `endpointSmoke:false` 保留为安全 backlog。

M8 当前落点：

- 已新增 `ModelUsageLog` Prisma 表与最小迁移。
- 已新增 `src/lib/usage`，支持 PostgreSQL 记录和开发期内存 fallback。
- 已从 LLM provider 读取 usage 元数据；mock provider 使用本地 token 估算。
- 已在聊天回复、重新生成、`/api/chat/complete` 记录脱敏调用日志。
- 已新增 `/api/usage/model-calls` 和工作台右侧调用看板。
- 不记录 API key、baseUrl、prompt、用户消息正文、AI 回复正文或供应商 raw payload。
- 当前只做成本估算，不做订阅、扣费或额度限制；用户自带 API 的价格可用 `LLM_INPUT_COST_USD_PER_1M`、`LLM_OUTPUT_COST_USD_PER_1M` 覆盖。

M12 当前落点：

- 已新增 `docs/DEPLOYMENT.md`，作为第一版上线流程入口。
- 推荐 Vercel + Supabase/Neon + `LLM_PROVIDER=compatible` 的供应商中立路线。
- 真实 key 只允许放在 `.env.local`、CI secret 或部署平台 secret；推送前运行 `npm run secrets:check`。
- 数据库上线流程包含 `npm run prisma:generate`、`npm run prisma:validate`、本地开发 `npm run prisma:migrate` 或生产 `npm run prisma:migrate:deploy`、`npm run db:smoke`。
- 语音供应商按用户决策与 LLM 共用中转站/供应商路线，仍保留独立 `VOICE_*` 环境变量便于后续换模型。
- 已新增用户级 LLM API key vault 第一版：设置页保存/删除；服务端只返回 key 尾号和指纹；聊天链路优先使用用户 vault，未配置时回落服务端环境变量或 mock。
- 已新增模型列表读取：`GET /api/me/llm-models` 使用用户 vault 或服务端 env key 读取 TryAnotherOne `/models`，设置页可选择模型名。
- M13 已优化模型供应商设置体验：用户可以先保存 API key 与 baseUrl，再读取兼容中转站模型列表；已保存 key 后可只修改 provider、baseUrl 或 model 并保存，后端沿用 vault 加密 key，响应不返回 key 原文。
- 生产环境必须配置 `USER_KEY_VAULT_SECRET`，真实 key 不写入仓库、日志、成本看板或前端响应。

M-DB-READINESS 当前落点：

- 已将 `npm run db:smoke` 收敛到 `scripts/db-smoke.mjs`。
- 未配置 `DATABASE_URL` 时以 0 状态跳过，适合无数据库本地开发和 CI 占位检查。
- 配置真实 Neon/PostgreSQL 后，脚本会先运行 Prisma generate/validate，再创建并读取用户、关系对象、会话、消息、记忆、关系状态、主动草稿、脱敏安全事件和模型调用日志。
- 脚本结束时删除固定测试用户，并断言级联/空置清理后不残留测试数据；输出会脱敏，不打印真实连接串或 key。

M-RESPONSIVE-POLISH 当前落点：

- 已补强 `src/app/globals.css` 中工作台响应式护栏：全局禁止横向溢出，grid/flex 子项允许收缩，长消息、长记忆、模型名和错误提示可换行。
- 1180px 以下 inspector 改为整宽下方面板并限制高度；760px 以下 rail/main/inspector 纵向排列，rail 与 inspector 独立滚动，避免三栏互相挤压。
- 520px 以下关系列表、快捷操作、关系类型、频率、统计和分段控件改为单列，记忆操作按钮改为可触达网格。
- 已在 Playwright E2E 增加 390px 移动视口检查，覆盖首页工作台、创建表单和设置页无横向溢出，关键入口可见可点。

M20 当前落点：

- 设置页数据导出从单一按钮升级为可感知状态流：导出中、成功、失败。
- 成功后显示已下载的 `perpetual-renewal-export-YYYY-MM-DD.json` 文件名。
- 失败时显示友好错误，不把接口异常或内部细节直接暴露给用户。
- 继续复用 M14 后端导出快照，不导出 API key、Base URL 或 vault 密文。

M21 当前落点：

- 已在 `docs/DEPLOYMENT.md` 增加上线前隐私/安全 checklist，覆盖 secret inventory、数据库门禁、LLM/VOICE 共用中转站、主动回响 Cron、验证命令和泄露应急处理。
- 已在 `docs/PRIVACY.md` 增加上线前隐私门禁，明确用户自带 API key 不进入仓库、导出快照、日志、成本看板或前端响应。
- 已在 README 与文档入口补充 checklist 链接，方便上线前从首页追踪到核对项。

M22 当前落点：

- 素材导入面板新增“选择文本文件”入口，支持 `.txt`、`.jsonl`、`.json`，单文件上限 512KB。
- 前端使用浏览器 File API 读取文本内容，`.json` 解析为 JSON Lines 后复用既有导入 API；没有新增服务端文件上传。
- 非允许扩展名、文件过大、空文本或 JSON 解析失败会在前端显示友好错误。

M23 当前落点：

- 已新增 `POST /api/me/llm-test`，使用当前用户 vault 或服务端 env key 做低成本模型列表探测。
- 设置页模型供应商区新增“测试连接”按钮，可基于当前表单 provider/baseUrl/model 测试，不要求重新输入已保存 key。
- 响应只返回成功/失败、provider、model、credentialSource、latencyMs、错误类型和友好错误；不返回 API key、Base URL、prompt 或供应商 raw payload。
- Smoke 已覆盖无 key 时的可预测失败和脱敏响应边界。

M26 当前落点：

- 已在 LLM、部署和 QA 文档中统一 `POST /api/me/llm-test` 的验收口径。
- 设置页“测试连接”明确复用用户 vault 或服务端 env key，不要求前端再次发送 API key。
- 测试动作只做低成本模型列表探测；无 key 时返回 `missing_api_key`，不会尝试生成聊天回复。
- 响应与日志边界明确：不返回 API key、Base URL 原文、Authorization header、prompt、请求 payload 或供应商 raw payload。
- 测试连接不是平台订阅、扣费或额度能力，仍然遵循用户自带 API 路线。

M25 当前落点：

- 已在 `docs/QA.md` 补充素材导入 QA 矩阵，覆盖单段文本、批量文本数组和 JSON Lines。
- 已明确本地文件入口仅支持 `.txt`、`.jsonl`、`.json`，前端限制 512KB、拒绝非法扩展名，并只读取文本后复用现有导入 API。
- 已记录不会新增服务端文件上传，不读取 `.env`，导入链路需继续脱敏 API key、Bearer token、JWT、token、secret、password 等密钥形态。
- 已记录所有有效导入内容默认进入 pending 记忆，用户确认前不进入 active prompt。
- 当前 E2E 已覆盖 JSONL 文件选择、读入文本框和继续导入为候选记忆；本轮只补文档，不重写 E2E。

M51 当前落点：

- `src/lib/import/text-import.ts` 先在脱敏和分段之后做候选去重，重复计入 `duplicateCount` 和 `skippedCount`。
- 导入 API 会按当前关系已有非 deleted 记忆再次过滤重复内容；全是重复时返回友好错误和完整摘要，不新增 pending。
- 工作台导入摘要展示“本次重复”和“已存在”数量；E2E 覆盖重复行、重复再次导入和 JSONL 文件导入连续流程。

M52 当前落点：

- `VOICE_PROVIDER=shared-llm` 的 STT/TTS 响应新增脱敏运行态字段：`requestedProvider`、`credentialSource`、`fallback`、`fallbackKind`、`missingConfig`、`retryable` 和 `status`。
- `/api/voice/transcribe` 与 `/api/voice/synthesize` 只返回前端需要的安全字段，剥离内部 `raw`，不返回 API key、Base URL、Bearer 或供应商 raw payload。
- compatible voice adapter 新增 30 秒超时，并兼容 STT 的 `text`、`transcription`、`output_text`、segments，以及 TTS 的二进制音频和 JSON base64 响应。
- 设置页说明语音共用 LLM 中转站配置；工作台语音状态显示用户 vault、环境变量或 mock fallback 来源。

M53 当前落点：

- `POST /api/proactive/run` 新增 `maxDrafts` 参数，控制一次 dry-run 或 cron 执行最多生成/保存多少草稿。
- 默认 `maxDrafts=50`，请求值归一化到 1-200；`limit` 仍只控制扫描关系对象数量。
- 达到上限后剩余关系对象不会继续查询消息或生成草稿，响应返回“本轮主动回响生成上限已达到”的跳过原因。
- Smoke 覆盖 `maxDrafts` 生效和保存数量不超过上限。

M56 当前落点：

- 任务定义里的 PM-1、PM-2、DEV-3、DEV-4、DEV-5、DEV-11 状态已与当前任务快照对齐。
- `npm run docs:check` 会检查这些关键状态，防止后续主控或并行模块把已集成状态误写回早期 `active`。
- 发布状态面板和交接文档已记录 M56 实现提交：`d7a72f2 docs: sync taskbook status gates`。

M57 当前落点：

- `/api/me/account` 支持 `DELETE`，必须提交确认短语“删除我的账号”。
- Prisma 环境依赖 schema cascade 删除当前用户关系、会话、消息、记忆、关系状态、主动草稿、安全事件、模型调用日志和 provider credential；本地 memory fallback 会清理对应全局 store。
- 设置页“数据与隐私”危险区提供导出提醒、确认输入和删除按钮；删除成功后清除 session 并回到登录页。
- Smoke 覆盖错误确认返回 400、正确确认删除、响应不泄露 key/baseUrl/vault 密文，以及删除后关系列表为空。

M58 当前落点：

- Next manifest 使用产品名、standalone display、主题色和 SVG 图标。
- `public/offline.html` 提供离线 shell；`public/sw.js` 只缓存应用壳和图标，对非 GET 或 `/api/*` 请求直接跳过。
- `PwaRegister` 仅在 production + HTTPS 环境注册 service worker，避免本地开发缓存干扰。
- Smoke 覆盖 manifest、离线页和 service worker 安全跳过 API 的静态边界。

M59 当前落点：

- `src/lib/import/structured-client-import.ts` 在浏览器侧把媒体文件 metadata、媒体说明、vCard/CSV/JSON 通讯录整理为导入条目。
- 工作台导入面板新增媒体/通讯录切换、文件选择和结构化文本整理入口，生成 JSONL 后复用现有导入 API。
- 媒体原文件不上传或保存；通讯录电话只保留尾号，邮箱只保留域名或脱敏摘要。
- 导入结果仍默认 pending，继续由记忆管理确认、归档或删除。

M30 当前落点：

- 已新增 `docs/ERROR_COPY.md`，统一错误文案目标、总原则、推荐句式、禁止暴露清单、场景文案矩阵、API 响应建议和 QA 检查。
- 场景覆盖聊天发送/生成/重新生成、素材导入、语音录制/STT/TTS、模型连接、数据导出、数据库配置缺失、cron secret 缺失、会话过期和通用未知错误。
- 已在 `docs/QA.md` 增加错误状态文案 QA，要求所有错误说明“发生了什么”和“下一步做什么”。
- 已在文档入口加入 `ERROR_COPY.md`，后续 UI/API 文案调整应以该文件为准。

M33 当前落点：

- 根 `README.md` 已精简为发布候选协作者入口，保留项目定位、本地启动、真实配置、网站内配置、验收命令和核心文档链接。
- 真实配置入口明确 `DATABASE_URL`、`LLM_PROVIDER=compatible`、TryAnotherOne base URL、`LLM_MODEL`、`USER_KEY_VAULT_SECRET`、`PROACTIVE_CRON_SECRET` 与 `VOICE_PROVIDER=shared-llm`；不写真实密钥。
- `docs/README.md` 已同步快速入口，指向启动、部署配置、设置页模型配置、发布候选验收脚本。

M34 当前落点：

- `docs/DEPLOYMENT.md` 已补充设置页“配置状态”和 `GET /api/me/config-status` 的只读检查边界，覆盖 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、`PROACTIVE_CRON_SECRET`、LLM key/model/baseUrl 与 `VOICE_PROVIDER`。
- `docs/RELEASE_ACCEPTANCE.md` 已把配置状态检查加入发布候选 20 分钟脚本和记录模板，要求人工点击“重新检查”并确认不暴露真实密钥、连接串、Base URL、vault secret 或 cron secret。
- 本模块只做文档收束，不修改 `src` 或 `tests`。

## 第一轮建议执行顺序

1. PM-1 全关系范围确认。
2. ARCH-1 技术选型与系统架构。
3. PM-2 原型与信息架构。
4. DEV-1 项目脚手架。
5. DEV-5 LLM 适配层。
6. DEV-2 账号与用户资料。
7. DEV-3 关系对象创建。
8. DEV-4 聊天消息闭环。

## 风险清单

| 风险 | 说明 | 初步应对 |
| --- | --- | --- |
| 依赖漏洞 | npm audit 曾报告 Prisma 链路 3 个 high 漏洞 | 已将 prisma 与 @prisma/client 固定到 6.12.0，npm audit 确认 0 vulnerabilities |
| 情感依赖 | 关系型 AI 可能强化用户对虚拟关系的依赖 | 允许沉浸和撒娇，但限制威胁、控诉、冷暴力和情感勒索 |
| 现实人物替代 | 用户可能希望复刻现实中的某个人 | 支持手动设定和情感替代；素材导入走本地整理/脱敏摘要，不上传原文件；用户可通过账号删除清理当前账号数据 |
| 角色失真 | 模型可能偏离设定或忘记关系 | Prompt builder、记忆层、评估集共同约束 |
| 记忆冒犯 | AI 记住不该记的内容或错误提及 | 记忆 pending 确认、用户可删改 |
| 成本膨胀 | 长上下文和频繁主动消息增加调用成本 | 已接入模型调用日志与成本看板；后续继续做摘要、检索、频率限制 |
| 安全漏判 | 危机或越界内容未正确处理 | 建立安全评估集和输出过滤 |
| 密钥泄露 | 用户自带 API 模式下容易误把 key 写入仓库 | `.gitignore` 排除本地 env，新增 `npm run secrets:check` 推送前扫描 |

## 后续决策点

已决策基线：

- 技术栈采用 Next.js 全栈、Prisma、PostgreSQL 路线。
- 模型接入走供应商中立 adapter，默认 compatible 中转站 `https://api.tryanotherone.com/v1`，用户自带 API key。
- 数据库优先 Neon/PostgreSQL；未配置时本地 fallback，生产不能依赖 memory。
- 部署路线优先 Vercel + Neon/PostgreSQL + 部署平台 secret。
- 现实替代第一版支持手动设定、少量语气样例、文本/JSONL/JSON 文件导入，以及媒体/照片/通讯录的浏览器本地整理与脱敏摘要导入。
- 沉浸边界采用“日常关系内表达，高风险场景才回到能力边界”的原则。
- 用户已允许账号删除、移动端 PWA、媒体/照片/通讯录导入、push 和 PR。

仍需用户决策：

- 是否现在配置真实 `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、`PROACTIVE_CRON_SECRET` 和真实模型 key/model。
- 是否在本轮继续进入内容审核后台、用户反馈问卷和内测邀请机制；此前用户已决定暂不进入当前第一版。

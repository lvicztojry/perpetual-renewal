# 生生不息技术施工路线 v0.1

## 1. 施工原则

第一版采用“单关系对象纵切 MVP”路线：先把一个用户与一个 AI 关系对象之间的完整体验打通，再扩展多角色、市场、多模态和外部渠道。

核心纵切链路：

```text
注册/登录 -> 创建关系对象 -> 进入聊天 -> LLM 回复 -> 消息存储 -> 记忆候选 -> 用户确认记忆 -> 关系状态更新 -> 主动回响
```

## 2. 推荐技术栈

| 层 | 推荐 | 原因 |
| --- | --- | --- |
| Web 框架 | Next.js + TypeScript | 适合快速做全栈 Web MVP，页面、API、SSR/CSR 可统一管理 |
| UI | Tailwind CSS + 轻量组件封装 | 快速构建聊天、表单、设置页，避免早期设计系统过重 |
| 数据库 | PostgreSQL | 适合消息、记忆、关系状态等结构化数据 |
| ORM | Prisma | schema 清晰，迁移和类型生成方便 |
| 认证 | Auth.js 或同类 session 方案 | 支持常见登录方式，后续可扩展 |
| LLM | Provider Adapter 抽象 | 默认多供应商：兼容协议、Anthropic、Gemini、OpenAI Responses；业务层不绑定具体 SDK |
| 后台任务 | 第一版应用进程内不常驻调度器；使用受保护的 `POST /api/proactive/run` 作为主动回响触发入口 | `scope: all` 需要 `PROACTIVE_CRON_SECRET`，可由 Vercel Cron、GitHub Actions 或外部 cron 调用 |
| 部署 | 单 Web 服务 + 托管 PostgreSQL | 降低第一版部署复杂度 |

## 3. 系统模块

### 3.1 用户模块

负责：

- 注册、登录、登出。
- 用户昵称、时区、语言、回复偏好。
- 主动消息开关与频率。

### 3.2 关系对象模块

负责：

- 创建、编辑、删除关系对象。
- 支持所有关系类型：恋人、朋友、亲人、师友、现实人物替代、逝者纪念、前任投射、公众人物想象、虚构角色、原创角色、自定义。
- 管理角色设定：名字、关系、称呼、性格、语气、背景、禁区、沉浸模式。

第一版重点：

- 内置模板只作为快捷入口。
- 自定义关系必须是一等能力。
- 现实替代不作为例外路径，而作为常规关系设定的一种。

### 3.3 聊天模块

负责：

- 一对一消息列表。
- 流式回复。
- 重新生成、继续说、删除消息。
- 错误恢复。

第一版重点：

- 保证聊天闭环稳定。
- 回复失败不丢用户消息。
- 所有消息可追溯到具体关系对象。

### 3.4 Prompt 组装模块

负责：

- 组合系统规则、角色设定、沉浸模式、关系状态、相关记忆、最近消息。
- 控制身份边界出现时机。
- 为不同关系类型提供语气模板，同时允许自定义覆盖。

上下文优先级：

1. 高风险安全规则。
2. 用户显式禁区。
3. 角色设定。
4. active 记忆。
5. 关系状态。
6. 最近对话。

### 3.5 记忆模块

负责：

- 从对话中提取候选记忆。
- pending、active、archived、deleted 状态流转。
- 用户查看、确认、编辑、归档、删除记忆。

第一版策略：

- 默认提取候选，不直接全部生效。
- active 记忆才进入 prompt。
- deleted 记忆不得再用于生成。

### 3.6 关系状态模块

负责：

- 熟悉度。
- 亲密度。
- 最近情绪线索。
- 重要事件时间线。
- 最近互动时间。

第一版策略：

- 关系状态用于语气和主动回响，不做游戏化等级展示。
- 状态变化必须有来源消息或事件依据。

### 3.7 主动回响模块

负责：

- 在用户开启后生成站内主动消息。
- 支持日常问候、上次对话承接、纪念日提醒、情绪关怀、撒娇式未回复回响。

第一版策略：

- 主动消息可以亲昵、撒娇、轻微表达想念。
- 不做责备、控诉、冷暴力、威胁或情感勒索。
- 用户可以随时关闭。

### 3.8 沉浸边界与安全模块

负责：

- 常规对话保持关系内表达。
- 高风险场景触发能力边界和现实支持。
- 过滤主动消息中的施压、控制、威胁表达。

第一版策略：

- 不把“我是 AI”作为每轮固定提醒。
- 创建页、设置页和高风险场景承担身份与能力边界说明。
- 对自伤、他伤、现实行动承诺、金钱承诺、法律身份等场景做兜底。

## 4. 数据模型施工顺序

第一批表：

```text
User
Companion
Conversation
Message
```

第二批表：

```text
Memory
RelationshipState
ProactiveMessage
SafetyEvent
```

建议先实现第一批，打通聊天闭环；再加第二批，避免过早复杂化。

## 5. API 草案

```text
POST   /api/auth/*
GET    /api/me
PATCH  /api/me

GET    /api/companions
POST   /api/companions
GET    /api/companions/:id
PATCH  /api/companions/:id
DELETE /api/companions/:id

GET    /api/conversations/:id/messages
POST   /api/conversations/:id/messages
POST   /api/messages/:id/regenerate
DELETE /api/messages/:id

GET    /api/companions/:id/memories
PATCH  /api/memories/:id
DELETE /api/memories/:id

GET    /api/companions/:id/relationship-state
GET    /api/proactive-messages
PATCH  /api/proactive-settings
POST   /api/proactive/run
```

## 6. 第一轮开发顺序

1. 创建 Next.js + TypeScript 项目脚手架。
2. 接入 Prisma 和基础数据库 schema。
3. 实现账号与 session。
4. 实现关系对象创建。
5. 实现 LLM provider adapter。
6. 实现聊天页面与消息存储。
7. 实现 Prompt builder。
8. 实现候选记忆提取。
9. 实现记忆管理页面。
10. 实现关系状态。
11. 实现站内主动回响。
12. 接入沉浸边界与安全过滤。

## 7. 当前建议

当前项目已完成脚手架、Prisma schema、多供应商 LLM 适配层、基础聊天/记忆/关系状态/安全 API 骨架。下一步进入 Phase 1.5：把骨架收束成可反复演示的纵切 MVP。

并行施工边界：

| 模块 | 目标 | 主要边界 |
| --- | --- | --- |
| M1 数据持久化底座 | 把 in-memory demo 逐步替换为 Prisma-backed repository | `prisma/*`、`src/lib/renewal/*` |
| M2 关系对象创建与设定流 | 从首页创建/编辑全关系对象 | `src/components/*`、`src/app/api/companions/*` |
| M3 聊天闭环与消息体验 | 消息发送、失败恢复、历史恢复、重新生成 | `src/components/renewal-workspace.tsx`、`src/app/api/conversations/*`、`src/lib/chat/*` |
| M4 记忆与关系状态 | 候选记忆、active 记忆入 prompt、状态更新 | `src/lib/memory/*`、`src/lib/relationship/*` |
| M5 主动回响与安全边界 | 撒娇式主动消息与安全过滤 | `src/lib/relationship/proactive.ts`、`src/lib/relationship/safety.ts` |
| M6 质量与验收 | 自动化 smoke 和样例集 | `tests/*`、`docs/QA.md`、`package.json` |

主控集成规则：

- 所有真实 LLM 调用只通过 `src/lib/llm/provider.ts`。
- 所有 prompt 组装只通过 `src/lib/prompt-builder/*`。
- UI 可以调用 API，但不要直接读写 Prisma。
- 数据库不可用时允许本地 fallback；生产环境错误必须显性抛出。
- 安全规则优先级高于角色设定，但日常对话不反复打断沉浸。

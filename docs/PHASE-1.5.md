# Phase 1.5 主控施工面板

目标：把现有骨架收束成可反复演示的纵切 MVP。

## 模块边界

| 模块 | 状态 | 写入范围 | 交付目标 |
| --- | --- | --- | --- |
| M1 数据持久化底座 | integrated | `prisma/*`、`src/lib/renewal/*`、`docs/DATABASE.md` | Prisma-backed repository 与开发 fallback |
| M2 关系对象创建与设定流 | integrated | `src/components/*`、`src/app/api/companions/*`、`src/lib/renewal/types.ts` | 创建/编辑全关系对象 |
| M3 聊天闭环与消息体验 | integrated | `src/components/renewal-workspace.tsx`、`src/app/api/conversations/*`、`src/lib/chat/*` | 发送、失败恢复、历史恢复、重新生成 |
| M4 记忆与关系状态 | integrated | `src/lib/memory/*`、`src/lib/relationship/state.ts`、记忆/关系状态 API | active 记忆入 prompt 与状态更新 |
| M5 主动回响与安全边界 | integrated | `src/lib/relationship/proactive.ts`、`src/lib/relationship/safety.ts`、安全/主动消息 API | 撒娇式主动回响与安全过滤 |
| M6 质量与验收 | integrated | `tests/*`、`docs/QA.md`、测试脚本 | 可重复 smoke 与样例集 |

## 集成契约

- 业务层调用 LLM 只通过 `createLlmProvider()`。
- 真实供应商配置必须使用 `LLM_PROVIDER`、`LLM_API_KEY`、`LLM_BASE_URL`、`LLM_MODEL` 这组中立变量；供应商专用 key 只是兼容 fallback。
- UI 只调用 API，不直接读写 Prisma。
- Prompt builder 只接收结构化上下文，不直接读取数据库。
- 只有 `active` 记忆能进入 prompt。
- 安全策略优先级高于角色设定，但日常聊天不频繁出戏。
- 主动消息允许亲昵和撒娇，不允许责备、控诉、威胁、冷暴力或情绪勒索。

## 主控验收命令

```bash
npm run typecheck
npm run lint
npm run build
npm run prisma:validate
npm --cache .\.npm-cache audit --audit-level=high
npm run e2e
```

如开发服务器已运行，还需要 smoke：

```bash
npm run smoke
```

## 当前基线

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- `npm --cache .\.npm-cache audit --audit-level=high`：0 vulnerabilities。
- `npm run e2e`：通过 7 tests，覆盖 login -> create relationship -> chat -> confirm memory -> file import -> proactive draft -> logout、设置页密钥保存/删除/测试连接失败态、导出脱敏、账号删除确认、memory fallback 用户隔离，以及 320px/390px/768px 响应式可用性。
- `npm run smoke`：当前通过 78 checks，覆盖关系、导入、聊天、记忆、关系状态、主动回响、用户 vault、模型连接测试、语音 fallback 与输入护栏、用量看板、数据导出、账号删除、PWA 静态资源、安全样例、导出脱敏和密钥扫描自测。
- 首页、`/api/companions`、`/api/me`、`/api/chat/complete`、`/api/me/llm-test`：已 smoke 通过。

## Phase 2 启动记录

- API 路由开始接入 `getCurrentSession()`，不再只依赖默认 `demo-user`。
- Renewal repository 增加记忆读写契约，记忆 API 可在本地 fallback 与 Prisma repository 间复用。
- 工作台右侧新增记忆管理视图：pending 可确认，active 可归档，archived 可恢复，记忆可软删除。
- 工作台右侧新增主动回响视图：可按当前关系状态生成站内草稿，并展示安全检查结果。
- 增加初始 Prisma migration、seed 脚本和 `npm run db:smoke`，用于真实 PostgreSQL 持久化验证。
- 增加本地 email session 登录/登出：`/login`、`POST /api/auth/login`、`POST /api/auth/logout`。当前不是 OAuth，目标是先把用户隔离和 cookie session 打稳。
- 主动回响草稿已从临时 mock 返回升级为 repository 持久化：无数据库时写入内存 fallback，真实数据库配置后写入 `ProactiveMessage`。
- 前端创建/编辑关系对象增加保存中、失败提示和禁用态；主动回响视图展示来源、状态、时间与安全结果。
- LLM provider 增加统一错误分类、`retryable` 和 `fallbackReason`，并扩展安全评估覆盖公众人物授权与现实替代承诺。

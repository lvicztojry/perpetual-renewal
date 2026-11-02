# Phase 1.5 主控施工面板

目标：把现有骨架收束成可反复演示的纵切 MVP。

截至 2026-10-31：真实数据库已恢复，认证/检查点迁移已应用，真实隔离 PostgreSQL 认证与 checkpoint CAS、DB smoke 通过。新增投递迁移通过真实 PostgreSQL 并发/关系验证且已应用到 public schema。QQ SMTP verify 通过，用户完成真实注册、邮件验证及登录。用户 vault 探针成功；此前 tests/qa-vault-provider 真实聊天及独立持久化通过。历史上增强版 vault QA 两次失败均为 kind=provider_response、HTTP 503，记录为当前上游可用性限制；临时 QA 关系对象清理通过。此前成功的真实聊天/独立持久化证据仍保留；模板 fallback 与投递已验证，2026-11-02 已通过真实模型主动生成、手动发送、独立持久化及去重验证；当前账号全局主动开关关闭，自动投递正确拒绝，测试未修改用户偏好。

Priority 4 本机集成验证已通过：模型按关系设定生成主动回响并自动直接送入聊天；每频率周期稳定幂等键、唯一消息关联、Serializable 事务重试及用户/关系关闭开关控制投递，手动发送复用同一路径。记忆采用中英文词面匹配、稳定事实回退与摘录式历史上下文，未实现 embeddings 或模型摘要。

已通过：调度 31 项、投递 19 项、主动模型 24 项、记忆 17 项、定向关系浏览器 7 项；主控确认全量 E2E 43 项通过（41.0 秒），最终 typecheck 通过。Playwright --list JSON 派生基线为 43 tests；完整 memory smoke 保持 94 checks。2026-11-02 增强版真实 vault QA 已通过；公网部署按用户决定暂缓。最新主控确认：完整 memory smoke 94 checks、build 与 qa:auth-access 均通过。

2026-11-02 用户决定继续本机试用，暂缓公网部署；部署平台、套餐与调度方案留待上线时确认。 套餐与调度限制见 [部署文档](DEPLOYMENT.md#vercel-deployment)。

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
npm run verify:local -- --skip-e2e
npm run e2e
npm run verify:release
```

`verify:local` 与 `verify:release` 会顺序运行 smoke/build/QA 门禁，包含 `qa:logging`；`e2e` 单独保留为本地发布前 mock/local 浏览器门禁。真实 API/真实 LLM 联调用 targeted existing-server E2E 或人工 QA 记录，不作为默认发布门禁。

## 当前基线

- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run build`：通过。
- M135 历史（2026-08-23）`npm --cache .\.npm-cache audit --audit-level=high`：0 vulnerabilities；10 月初查 6 vulnerabilities（5 high、1 critical），主控确认 16.4.3 升级后 audit 为 0 vulnerabilities，完整 memory smoke 94 checks 已通过；2026-11-02 增强真实 QA 通过；账号全局自动开关关闭时不投递。
- M135 历史（2026-08-23）`npm run e2e`：通过 15 tests；默认自动启动 managed mock/memory 环境，覆盖 login -> create relationship -> chat -> confirm memory -> file import -> proactive draft -> logout、主动回响 1 分钟状态提示、设置页密钥保存/删除/测试连接失败态、模型列表读取与选择、模型列表失败 diagnostic 前端脱敏、BYOK fake-compatible 浏览器闭环、导出脱敏、账号删除确认、memory fallback 用户隔离、工作台错误展示脱敏、设置页删除密钥失败脱敏、语音 fallback reason 前端脱敏，以及 320px/390px/768px 响应式可用性。真实供应商慢响应、超时、429 或模型不可用不计入该门禁，需单独按联调风险记录。
- M135 历史（2026-08-23）`npm run smoke`：通过 94 checks，覆盖关系、导入、聊天、记忆、关系状态、主动回响、Vercel Cron GET 鉴权、用户 vault、模型连接测试、模型列表兼容响应/失败隐私、语音 fallback 与输入护栏、用量看板、数据导出、账号删除、PWA 静态资源、安全样例、导出脱敏、API 响应边界和密钥扫描自测。
- 首页、`/api/companions`、`/api/me`、`/api/chat/complete`、`/api/me/llm-test`：已 smoke 通过。

## Phase 2 启动记录

- API 路由开始接入 `getCurrentSession()`，不再只依赖默认 `demo-user`。
- Renewal repository 增加记忆读写契约，记忆 API 可在本地 fallback 与 Prisma repository 间复用。
- 工作台右侧新增记忆管理视图：pending 可确认，active 可归档，archived 可恢复，记忆可软删除。
- 工作台右侧新增主动回响视图：可按当前关系状态生成站内草稿，并展示安全检查结果。
- 增加初始 Prisma migration、seed 脚本和 `npm run db:smoke`，用于真实 PostgreSQL 持久化验证。
- 增加本地 email session 登录/登出：`/login`、`POST /api/auth/login`、`POST /api/auth/logout`。这是 8 月历史路线；10 月默认改为邮箱/密码并验证注册邮箱，原演示登录只限显式非生产 `AUTH_MODE=local-email` 测试（M139 真实隔离 PostgreSQL 与 QQ 注册收件已通过，新部署目标另验）。
- 主动回响草稿已从临时 mock 返回升级为 repository 持久化：无数据库时写入内存 fallback，真实数据库配置后写入 `ProactiveMessage`。
- 前端创建/编辑关系对象增加保存中、失败提示和禁用态；主动回响视图展示来源、状态、时间与安全结果。
- LLM provider 增加统一错误分类、`retryable` 和 `fallbackReason`，并扩展安全评估覆盖公众人物授权与现实替代承诺。

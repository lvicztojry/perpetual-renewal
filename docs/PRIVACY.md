# 生生不息隐私与数据导出 v0.1

## 用户数据导出快照

`GET /api/me/export` 返回当前 session 用户的 JSON 快照，用于用户查看、备份或迁移自己的项目数据。

设置页的数据导出会在点击后显示导出中、成功或失败状态。成功下载的文件名使用
`perpetual-renewal-export-YYYY-MM-DD.json` 格式，便于用户识别来源和日期；失败时只显示友好错误提示，不暴露内部接口细节。

当前快照包含：

- 用户资料：昵称、邮箱、语言、时区、主动回响偏好。
- 关系对象：关系类型、自定义设定、称呼、性格、语气、背景、边界与关系状态。
- 对话数据：每个关系对象当前可见的会话和消息。
- 记忆数据：包含 pending、active、archived、deleted 状态，便于用户审阅完整记忆生命周期。
- 主动回响：草稿、发送、忽略或阻断记录，以及脱敏后的安全元数据。
- 模型调用记录：provider、model、用途、状态、token、估算成本、延迟和错误类别等脱敏审计字段。
- 安全事件：仅导出事件类型、动作、阶段、严重度、`contentHash`、`riskHash` 和时间。

导出快照按当前 session 的 `userId` 隔离。生产环境 Prisma 查询必须始终带 `userId` 条件；本地开发无数据库时使用 memory fallback，仍使用同一个 session 用户范围。

## 明确不导出的内容

导出快照不包含供应商密钥原文、供应商 endpoint URL、vault 密文、加密 IV、认证 tag、Authorization header、Bearer token、password、secret 或 token 字段。

凭证配置只导出安全摘要：是否已配置、provider、model、凭证来源和更新时间。不会导出可用于调用供应商接口的任何材料。

安全事件不保存也不导出原始文本，只保留 hash 以便排查趋势和重复风险。

## 上线前隐私门禁

上线前必须按 [DEPLOYMENT.md](DEPLOYMENT.md) 的 Pre-launch Privacy and Security Checklist 完成核对，重点确认：

- `DATABASE_URL`、`USER_KEY_VAULT_SECRET`、`PROACTIVE_CRON_SECRET` 和供应商 API key 不进入仓库。
- 用户自带 API key 只通过设置页保存到用户级加密 vault；导出快照、模型调用日志、成本看板和前端响应都不返回 key 原文、vault 密文或供应商 endpoint URL。
- `VOICE_PROVIDER=shared-llm` 时语音复用 LLM 中转站配置，不新增前端可见的语音密钥字段。
- `PROACTIVE_CRON_SECRET` 只保护 all-user 主动回响调度入口，不写入 URL query、前端代码或文档示例。
- 推送前运行 `npm run secrets:check`；依赖审计使用 `npm --cache .\.npm-cache audit --audit-level=high`，让 npm cache 留在项目目录。
- `npm run db:smoke` 在真实 `DATABASE_URL` 下通过后，才能把数据库链路视为生产就绪。

## 验收

自动 smoke 会覆盖：

- `/api/me/export` 返回稳定 schema version。
- 导出数据只属于当前 session 用户。
- 导出包含关系对象、消息、记忆、主动回响和模型调用日志。
- 已保存用户 key 时，导出只包含凭证摘要，不包含 key 原文、endpoint URL 或 vault 字段。
- 安全事件导出只包含 hash，不包含原始安全输入。
- 设置页导出交互能显示导出中、成功文件名和友好失败提示。

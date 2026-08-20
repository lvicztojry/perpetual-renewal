# 生生不息文档入口

## 快速入口

- 本地启动：在仓库根目录运行 `npm ci`，再运行 `npm run dev`。
- 真实配置：优先看 [DEPLOYMENT.md](DEPLOYMENT.md)，根 README 也列出 `DATABASE_URL`、TryAnotherOne compatible LLM、`USER_KEY_VAULT_SECRET`、`PROACTIVE_CRON_SECRET` 和 `VOICE_PROVIDER=shared-llm` 的最小配置。
- 网站内配置：进入设置页保存用户 API key、读取模型列表、测试连接，并查看只读配置状态。
- 发布候选验收：先跑根 README 的验收命令，其中包含 `npm run docs:check` 的发布口径自动检查和 `npm run git:boundary` 的文件边界检查；再按 [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md) 做 20 分钟人工演示。

## 阅读顺序

1. [PRD.md](PRD.md)：产品定位、用户场景、MVP 范围、功能需求与边界。
2. [TASKBOOK.md](TASKBOOK.md)：总任务拆解、依赖关系、验收标准与阶段规划。
3. [ARCHITECTURE.md](ARCHITECTURE.md)：第一版技术施工路线、系统模块、数据层和模型调用策略。
4. [CONTRIBUTING.md](CONTRIBUTING.md)：新协作者开发说明，覆盖模块边界、本地 fallback、密钥规则、常用命令和状态更新方式。
5. [MVP_STATUS.md](MVP_STATUS.md)：当前 MVP 能力、最新验收、上线前真实阻塞项与继续施工队列。
6. [DEPLOYMENT.md](DEPLOYMENT.md)：Vercel + Supabase/Neon 上线流程、本地 `migrate dev` 与生产 `migrate deploy`、LLM/VOICE 共用中转站 env、Cron secret 与上线前隐私/安全 checklist。
7. [PRIVACY.md](PRIVACY.md)：用户数据导出、用户自带 API key 不入仓库、不入导出快照的隐私规则。
8. [ERROR_COPY.md](ERROR_COPY.md)：聊天、导入、语音、模型连接、导出、数据库和 cron secret 等错误状态的中文文案规范。
9. [RELEASE_ACCEPTANCE.md](RELEASE_ACCEPTANCE.md)：发布候选 20 分钟人工演示/验收脚本，覆盖全关系、聊天、记忆、导入、主动回响、模型、语音、用量、导出和移动端快检。
10. [PRE_COMMIT_CHECKLIST.md](PRE_COMMIT_CHECKLIST.md)：第一次 commit/push 前的文件边界、密钥、验收命令和真实配置检查。
11. [COMMIT_PLAN.md](COMMIT_PLAN.md)：首次提交的推荐分组、提交信息和应纳入/排除文件范围。

## 项目一句话

生生不息希望在用户“想交流却无法实现”的时刻，提供一个具有明确设定、长期记忆和关系演化能力的 AI 陪伴对象。关系类型不预设上限，现实人物、虚构角色、逝者纪念、理想关系与完全自定义关系都应能被承接，让“只要想念，就会想见”，“念念不忘，必有回响”成为可体验的产品能力。

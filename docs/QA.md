# QA 与验收方法

当前能力和实际执行结果只登记于 [MVP_STATUS.md](MVP_STATUS.md)。本文件描述怎样检查，不维护第二份“最新通过”清单。整理前的详细用例、旧测试数及历史记录完整保留在 [QA_HISTORY.md](QA_HISTORY.md)。

## 选择合适的验证范围

| 改动 | 检查入口 | 边界 |
| --- | --- | --- |
| 文档、文件整理 | npm run docs:check、npm run secrets:check、npm run git:boundary、npm run release:check | 不等于业务/数据库/实机验收 |
| 静态介绍站 | npm run site:build；npm run site:preview | site/dist 是生成目录；成功不等于线上已部署 |
| Web 代码 | npm run typecheck、npm run lint；对应 qa:* 与 E2E | 使用隔离账号、memory/mock 或明确隔离的数据库 |
| 原生共享代码 | npm run qa:native、npm run qa:journey:native | 浏览器 IndexedDB 适配不代替原生 SQLite/IPC、签名与真机 |
| 应用部署 | 目标环境 npm run verify:deploy | 会检查真实配置/数据库；先确认目标，不能拿静态站作为结果 |

完整本地检查入口 npm run verify:local；跳过浏览器用 npm run verify:pr；含依赖审计用 npm run verify:release。这些命令可能读取本机配置并访问数据库，不能为了文档改动默认执行整套。先运行 npm ci 准备锁定依赖。

## 默认隔离与真实配置

npm run e2e 默认由托管服务启动 mock/memory；E2E_BASE_URL 复用服务时，先核实其配置和数据隔离，不能把真实用户服务当测试夹具。一次只运行一个使用同一构建目录的 Web 测试/构建流程，避免 .next 锁和历史截图覆盖。原生浏览器 QA 使用独立测试数据和本机假供应商。

真实数据库、QQ SMTP、真实模型及语音均须逐次说明环境和实际范围。测试定义数量来自 Playwright --list，而非数源文件行；定义存在不代表执行通过，专项成功也不代表整套成功。不用文档中的历史通过推定当前供应商质量或线上可用。

## 功能专项

| 范围 | 可重复执行入口 |
| --- | --- |
| 提示词/记忆 | npm run qa:prompt；npm run qa:memory-lifecycle |
| 消息/已读/并发 | npm run qa:sync；npm run qa:chat-delivery；tests/e2e/sync-flow.spec.ts 和 conversation-isolation.spec.ts |
| 素材导入/人物提炼 | npm run qa:imports；npm run qa:character-import；tests/e2e/chat-character-import.spec.ts |
| 入梦 | npm run qa:dream；tests/e2e/dream-flow.spec.ts |
| 群聊/留灯会/复读 | npm run qa:groups；tests/e2e/group-flow.spec.ts、group-reply-quality.spec.ts |
| 初醒/进度/演出 | npm run qa:journey；npm run qa:abilities；tests/e2e/journey-flow.spec.ts、bell-intro.spec.ts |
| 认证/访问/凭据 | npm run qa:auth；npm run qa:auth-access；npm run qa:vault；tests/e2e/password-auth.spec.ts、settings-privacy.spec.ts |
| 供应商/语音 | npm run qa:providers；npm run qa:voice；npm run qa:voice-language；npm run qa:real-provider:fake |
| 主动回响 | npm run qa:proactive-scheduler；npm run qa:proactive-cron；npm run qa:proactive-availability |
| 安全/隐私 | npm run qa:samples；npm run qa:logging；npm run qa:response；npm run secrets:check |
| PWA/应用 API | npm run pwa:check；npm run smoke |
| 原生本地 | npm run qa:native；npm run qa:journey:native；实际安装、SQLite、恢复与生命周期另验 |

供应商接口规范与 BYOK 说明见 [LLM.md](LLM.md)，数据范围见 [PRIVACY.md](PRIVACY.md)。测试配置向导应检查 session 签名 secret 及 session_cookie_secret 状态，日志和导出不能出现原始凭据。

## PostgreSQL 专项

下列命令默认需要显式 opt-in，并创建、验证、清理随机临时 schema。运行前检查脚本和目标配置，不使用真实人物/聊天作夹具：

- JOURNEY_DATABASE_QA=1 npm run qa:journey:postgres
- GROUP_DATABASE_QA=1 npm run qa:groups:postgres
- MEMORY_DATABASE_QA=1 npm run qa:memory:postgres
- MESSAGE_SYNC_DATABASE_QA=1 npm run qa:sync:postgres
- DREAM_DATABASE_QA=1 npm run qa:dream:postgres
- AUTH_DATABASE_QA=1 npm run qa:auth:postgres

变量语法按 shell 调整；例如 PowerShell 先设置对应环境变量再执行命令。生产/目标应用部署用 npm run prisma:migrate:deploy，不用开发迁移代替。真实执行结果必须与模拟事务测试分开记录。

## 文档漂移门禁

npm run docs:check 核对当前状态入口、文档职责、版本与下载配置、目录和本地链接、命令以及历史引用。MVP_STATUS 是唯一当前任务快照；旧 TASKBOOK/QA/交接全文放在对应 *_HISTORY 文件，不把过去的 integrated、测试数字或部署计划搬成今天的事实。

版本记录由 src/lib/release-notes.json 生成 DEVELOPMENT_LOG，npm run release:check 拒绝手改生成内容或客户端版本不匹配；下载元数据维护在 site/site.json；构建目录不可纳入 Git。检查规则的反例由 tests/docs-status-guard.mjs 验证。

## 证据登记格式

在当前状态记录日期、范围、命令/环境、实际结果、失败或未执行项及证据路径。历史证据追加到归档；截图使用虚构数据，持久化配置/恢复码/密码必须脱敏。不得以“测试数量增加”“构建生成”替代真实执行或安装验证。

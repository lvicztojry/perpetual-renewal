# 生生不息文档入口

先读 [MVP_STATUS.md](MVP_STATUS.md) 确认当前能力、发行与部署边界、验收证据和阻塞，再读 [TASKBOOK.md](TASKBOOK.md) 的本轮任务与依赖；按任务需要查阅设计和操作文档。历史通过不代表本轮复验。

## 阅读顺序与按需入口

1. [当前状态与验收](MVP_STATUS.md) → [本轮任务规划](TASKBOOK.md) → [协作规则](CONTRIBUTING.md)。
2. 按需设计：[产品范围](PRD.md)、[架构](ARCHITECTURE.md)、[模型接入](LLM.md)、[记忆变化](MEMORY_LIFECYCLE.md)、[入梦](DREAM.md)、[群聊](GROUPS.md)、[消息同步](MESSAGE_SYNC.md)。
3. 运行与交付：[本机/LAN 试用](LAN_TRIAL.md)、[独立客户端](LOCAL_CLIENTS.md)、[介绍站操作](SITE.md)、[应用部署与真实配置](DEPLOYMENT.md)（含 `SESSION_COOKIE_SECRET`）、[认证与邮件](AUTH.md)、[远程分享部署方案](CLOUD_SHARING.md)。介绍站上线、应用 Web 公网运行和安装包公开发行须分别判断。
4. 检查与发布：[质量检查](QA.md)、[人工验收流程](RELEASE_ACCEPTANCE.md)、[发布交接](RELEASE_HANDOFF.md)、[提交前检查](PRE_COMMIT_CHECKLIST.md)；实际结果统一回到当前状态。

## 文档职责

| 入口 | 负责内容 |
| --- | --- |
| [MVP_STATUS.md](MVP_STATUS.md) | 唯一当前事实、任务快照与验收入口：能力、交付、证据、未覆盖项和阻塞 |
| [TASKBOOK.md](TASKBOOK.md) | 任务范围、规划、依赖和分工；不复制验收流水 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 协作规则、模块边界、验证与交接要求 |
| [SITE.md](SITE.md) / [site/site.json](../site/site.json) | 介绍站操作流程 / 站点与下载配置单源 |
| [DEPLOYMENT.md](DEPLOYMENT.md) / [LOCAL_CLIENTS.md](LOCAL_CLIENTS.md) | 应用服务部署 / 本地客户端构建、数据与更新规则 |
| [PRD.md](PRD.md) / [ARCHITECTURE.md](ARCHITECTURE.md) 等专题 | 产品与技术设计、长期契约；不代替当前状态 |
| [MVP_STATUS_HISTORY.md](MVP_STATUS_HISTORY.md) | 历史状态与验收证据；不作为当前已通过结论 |
| [TASKBOOK_HISTORY.md](TASKBOOK_HISTORY.md) / [QA_HISTORY.md](QA_HISTORY.md) / [RELEASE_HANDOFF_HISTORY.md](RELEASE_HANDOFF_HISTORY.md) | 整理前的任务定义、详细用例和交接原文；编号与历史证据保留 |
| [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md) | 从 [release-notes.json](../src/lib/release-notes.json) 生成的版本日志，不手工编辑 |

新手教程专项施工定义见 [余念安陪伴式新手教程施工任务书](JOURNEY_GUIDE_TASKBOOK.md)，包含页面光圈指引、剧情与课程、状态兼容、任务依赖和验收标准；实际进度仍以 MVP_STATUS 为准。

隐私、安全与文案约束见 [PRIVACY.md](PRIVACY.md)、[SAFETY.md](SAFETY.md)、[ERROR_COPY.md](ERROR_COPY.md)。

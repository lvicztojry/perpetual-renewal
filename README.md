# 生生不息 / perpetual-renewal

只要想念，就会想见。一个基于《十日终焉》二创世界观的全关系 AI 陪伴项目，支持人物设定、私聊/群聊、长期记忆、主动回响和「入梦」校准。

[介绍站](https://perpetual-renewal.netlify.app/) · [下载测试版](https://github.com/lvicztojry/perpetual-renewal/releases) · [当前进度与验收](docs/MVP_STATUS.md) · [文档目录](docs/README.md)

当前持续开发 Web、Windows、Android。介绍站已上线，应用 Web 仍为本机/同 Wi-Fi 试用；原生客户端按设备保存账户和数据，尚无自动跨设备同步。具体版本、部署事实与待验项只在 [MVP_STATUS.md](docs/MVP_STATUS.md) 维护。

## 选择使用方式

| 需要做什么 | 入口 |
| --- | --- |
| 了解项目、获取 Windows / Android 测试安装包 | 介绍站与 GitHub Releases；数据及更新限制见 [LOCAL_CLIENTS.md](docs/LOCAL_CLIENTS.md) |
| 在电脑运行 Web 应用 | 根目录「启动生生不息.bat」，或按下文开发步骤启动 |
| 手机与电脑同 Wi-Fi 试用 Web | 「局域网启动生生不息.bat」，步骤见 [LAN_TRIAL.md](docs/LAN_TRIAL.md) |
| 配置模型、邮件和数据库 | 网站设置页管理个人模型；服务配置见 [DEPLOYMENT.md](docs/DEPLOYMENT.md) 和 [.env.example](.env.example) |
| 修改/部署介绍站 | [SITE.md](docs/SITE.md)，与聊天应用分开构建 |

已有账号可从侧栏「找余念安」进入初醒；普通聊天保留沉浸，人物校准集中在入梦。素材导入只发送用户选中的双方样本，不解密微信/QQ 数据库。模型与语音生成仍需访问用户配置的供应商。

## 本地开发

```bash
npm ci
npm run prisma:generate
npm run dev
```

先将 .env.example 复制为本机 .env.local，按 [AUTH.md](docs/AUTH.md) 和部署文档配置。默认邮箱密码认证需要数据库与验证邮件。个人模型 Key 优先在设置页保存到用户 vault；数据库连接、vault、session 签名和 cron secret 由本机/部署环境提供。

本机地址通常为 http://localhost:3000。只有显式非生产测试才可启用 AUTH_MODE=local-email 和 memory/mock；不要把测试模式当作公开登录服务。配置数据库后可用 npm run db:smoke 检查，目标应用部署另需 npm run verify:deploy。

静态介绍站可独立构建：

```bash
npm run site:build
npm run site:preview
```

前者生成 site/dist，后者本地预览；两者都不会自行部署。无需为文档或静态站整理启动真实聊天、邮件或数据库测试。

## 目录归属

| 路径 | 职责 |
| --- | --- |
| [src/](src/) / [prisma/](prisma/) | Web 应用与共享业务 / PostgreSQL 数据模型和版本迁移 |
| [native/](native/) | Windows、Android 本地运行适配、Tauri 和原生构建 |
| [site/](site/) / [netlify.toml](netlify.toml) | 静态介绍站素材、下载配置 / Netlify 构建目标 |
| [public/](public/) / [design/](design/) | 应用运行素材 / 设计来源、方案与带日期截图；历史设计不代表当前主题 |
| [scripts/](scripts/) / [tests/](tests/) | 开发、构建、运维和验证工具 / 自动回归与夹具 |
| [docs/](docs/) | 状态、任务、契约、操作与明确标记的历史归档 |
| [deploy/](deploy/) | 应用服务的容器部署方案，目录存在不代表目标环境已上线 |
| [miniprogram/](miniprogram/) | 历史小程序实现，当前暂停扩展 |
| dist/、site/dist/、native/dist/ | 本机交付/生成目录，不入 Git |
| logs/、.tmp-*/、.build-tools/ | 本机日志、隔离 QA 和工具缓存，保留在 D 盘、不入 Git |
| .env.local、.netlify-token、.release-keys/ | 私密配置和签名材料，不入 Git、不放进文档 |

不为整理而删除用户数据、签名身份、工具链或带日期的验证素材。各目录新增文件应按职责归位，临时结果使用已忽略的目录。

## 验证与协作

```bash
npm run docs:check
npm run release:check
npm run secrets:check
npm run git:boundary
```

按改动范围选择 [QA.md](docs/QA.md) 的其他检查。完整入口 npm run verify:local；PR 用 npm run verify:pr；发布依赖审计用 npm run verify:release。注意完整验证可能连接本机配置的数据库，不要与使用同一构建目录的 E2E/构建并行执行。

先读当前状态，再按 [TASKBOOK.md](docs/TASKBOOK.md) 定位任务，遵守 [CONTRIBUTING.md](docs/CONTRIBUTING.md) 的模块和文件边界。提交前运行 git status --short --branch 和 git log -1 --oneline 查看实际状态，文档不固定远端同步结论。

## 文档与配置单源

- 当前事实、任务状态、实际验收：[MVP_STATUS.md](docs/MVP_STATUS.md)。
- 近期任务与暂停的长期队列：[TASKBOOK.md](docs/TASKBOOK.md)。
- 版本记录：[release-notes.json](src/lib/release-notes.json)；[DEVELOPMENT_LOG.md](docs/DEVELOPMENT_LOG.md) 由 npm run release:notes 生成，不手改。
- 介绍站与下载元数据：[site/site.json](site/site.json)；发布/部署流程见 [RELEASE_HANDOFF.md](docs/RELEASE_HANDOFF.md)。
- 历史任务、QA 和交接全文在 docs 中对应 *_HISTORY.md，不作为当前实现或刚通过的证据。

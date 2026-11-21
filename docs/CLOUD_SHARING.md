# 长期分享给受邀朋友

本方案提供可在电脑关机后继续访问的**网页版 HTTPS 链接**，保留现有网页设计及全部已实现功能。朋友使用自己的邮箱注册、验证并登录，各自拥有聊天、人物、群聊、记忆和模型设置。微信原生小程序的测试号权限、合法域名和正式发布仍需另行配置；部署本包不会自动发布小程序。

当前交付为可搬运到云服务器的源码部署包。尚未购买云服务、配置真实域名或生成公网链接。服务器、域名和模型按所选服务实际计费，不承诺永久免费或无停机。

## 包含什么

- Next.js 生产服务，沿用原网页 UI。
- 独立 PostgreSQL 数据卷，不复制本机数据库和聊天记录。
- Caddy HTTPS 入口；域名解析与网络条件满足时自动申请及续期证书，见 [Caddy 官方说明](https://caddyserver.com/docs/automatic-https)。
- 独立后台调度进程：私聊主动消息和群聊各自按分钟检查，慢群聊不会阻塞私聊检查。保留应用内开关、节奏和去重约束；不保证整点送达。
- 邮箱邀请名单：只允许列出的邮箱注册、登录和使用会话；移除邮箱并重建应用容器后，旧会话也失效。
- 服务端默认模型配置及每个用户自己的加密 Key 设置。

## 生成和传输部署包

以下生成命令在完整开发仓库根目录运行；已拿到压缩包时，直接阅读“在目标服务器初始化”：

```bash
npm run qa:cloud
npm run cloud:package
```

产物为 `dist/renewal-cloud.tar.gz`。包内 `MANIFEST.json` 列出源文件和 SHA-256；不包含 `.env.local`、本机数据库、用户 vault、日志、截图、`node_modules` 或小程序测试配置。该文件是源码包，首次构建仍需下载 Node、npm、PostgreSQL 和 Caddy 镜像/依赖。

本地已有 npm 依赖时，可运行 `npm run cloud:verify`：检查压缩包文件哈希与私密文件边界，在临时目录使用同一 Webpack 生产编译器构建，并验证生产匿名访问限制。该命令不读取本机 `.env.local`，也不验证 Docker 镜像。

选好云服务器后，将包上传并解压到独立目录。服务器须支持 Docker Engine 与 **Docker Compose 2.30.0 或更新版本**，公网开放 80/443，域名指向服务器。Compose 的 `env_file.format: raw` 保留密码中的 `$` 等字符，见 [官方服务配置](https://docs.docker.com/reference/compose-file/services/#env_file)。不要先对真实服务执行下面的示例域名命令。

## 在目标服务器初始化

解压目录内运行（宿主机需要 Node；也可用下面容器方式）：

```bash
node deploy/init.mjs --url https://YOUR_DOMAIN --emails owner@example.com,friend@example.com
```

只有 Docker 的 Linux 服务器也可运行：

```bash
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/workspace" -w /workspace node:22-bookworm-slim node deploy/init.mjs --url https://YOUR_DOMAIN --emails owner@example.com,friend@example.com
```

把占位域名和邮箱替换为实际值。脚本生成四个私密配置文件，不打印密钥且拒绝覆盖：

- `deploy/cloud.env`：独立数据库连接、vault/session/cron 随机密钥、邀请名单，以及待填写的邮件和模型配置。
- `deploy/scheduler.env`：调度器需要的 cron 密钥，与应用一致。
- `deploy/.secrets/db_password`：PostgreSQL 初始化密码。
- `deploy/site.env`：HTTPS 入口域名。

这些文件已在 Git 和 Docker 构建上下文中排除。限制服务器文件访问，只在目标主机/部署平台保存，不要发到聊天或提交仓库。Compose secret 的文件挂载方式见 [Docker 官方说明](https://docs.docker.com/compose/how-tos/use-secrets/)；宿主机仍须妥善保护原文件。

编辑 `deploy/cloud.env`，逐行写入实际值，**不加引号、不跨行**：

| 变量 | 本次分享配置 |
| --- | --- |
| `AUTH_APP_URL` | 最终访问的 HTTPS 来源，必须与发给朋友的域名一致 |
| `AUTH_ALLOWED_EMAILS` | 你和朋友的实际邮箱，英文逗号分隔，不支持通配符 |
| `AUTH_MAIL_FROM` / `AUTH_SMTP_HOST` / `AUTH_SMTP_PORT` / `AUTH_SMTP_USER` / `AUTH_SMTP_PASSWORD` | 可沿用已验证的 SMTP 路线；授权码放在这里，需在目标云环境验证发送与收件 |
| `LLM_PROVIDER` | 当前中转站一般选择 `compatible` |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 填入你希望给朋友默认使用的中转站配置，仅进入云端运行环境 |
| `VOICE_STT_MODEL` / `VOICE_TTS_MODEL` | 中转站实际支持的语音模型；空值会沿用文本模型名，文本模型不一定支持音频 |

你当前保存在个人网页设置中的 Key 属于自己的账号 vault，不会自动成为朋友默认值。共享默认值需要显式配置为云端 `LLM_*`。朋友在设置页保存自己的配置后，优先使用自己的 Key；未配置时回落到你的服务端默认值。双方密钥不会作为配置明文返回给浏览器。

默认中转站的请求费用记在你的账户上。应用现有用量统计是估算展示，没有按朋友强制扣费/限额能力；先在中转站创建单独的演示 Key，并按供应商支持设置预算/额度。启用的主动消息、群聊、入梦、提炼和语音也可能产生模型费用。

不要改成 `AUTH_MODE=local-email` 或内存仓库。部署启动入口会检查邀请名单、生产数据库、邮件、默认模型和密钥准备度，缺少必填项就退出。邮件默认采用 SMTP，也可改用现有 HTTP 邮件网关。此检查只验证配置，不代表远程服务真实可用。

## 启动、验证和更新

```bash
docker compose -f deploy/compose.yaml config --quiet
docker compose -f deploy/compose.yaml up -d --build
docker compose -f deploy/compose.yaml ps
```

启动顺序为数据库健康检查 → 全部版本迁移完成 → 应用 HTTP 健康检查 → 后台调度与 HTTPS 入口。使用 [Compose 官方依赖条件](https://docs.docker.com/compose/how-tos/startup-order/)。未发布数据库端口；应用仅映射宿主机 `127.0.0.1:3300`，公网走 Caddy 443。HTTP 健康检查仅确认登录页可响应，不能替代数据库/模型验收。

首次发链接前，在目标环境依次核验：

1. HTTPS 页面、注册邮件、验证登录、密码恢复及退出。
2. 两个受邀账号各建人物和聊天，确认互相看不到数据；未受邀邮箱被拒绝。
3. 默认中转站真实回复、个人 Key 覆盖与删除后的默认回落、模型错误提示。
4. 私聊/群聊、记忆、入梦、导入导出、语音及主动开关；离开网页后观察后台任务。
5. 重启应用后数据仍在，并实际演练数据库备份恢复。

查看状态可用 `docker compose -f deploy/compose.yaml logs --tail 50 app scheduler https`。日志不可分享原始用户内容或密钥；避免直接输出 `docker compose config` 全文，以免打印运行配置。

修改邀请邮箱、模型等配置后，运行：

```bash
docker compose -f deploy/compose.yaml up -d --force-recreate app scheduler
```

迁移升级前先备份数据库；更新源码后重新运行 `up -d --build`，检查迁移、应用和调度器均正常。`docker compose down` 保留命名数据卷；**带 `-v` 会删除持久数据，勿用于普通更新**。本包不会自动将生产库导回本地。

## 备份

在 Linux 服务器的项目根目录执行，备份包含朋友的私密数据，须加密保存、限制权限，并将备份安全复制到另一处存储：

```bash
umask 077
mkdir -p backups
docker compose -f deploy/compose.yaml exec -T db pg_dump -U renewal -d renewal -Fc > "backups/renewal-$(date +%F-%H%M%S).dump"
```

另行保管部署配置，特别是 `USER_KEY_VAULT_SECRET`；只备份数据库不足以恢复用户保存的 API Key。不要重新运行初始化脚本替换现有数据库密码或加密主密钥。恢复应先在隔离环境验证，再安排生产维护窗口。

## 本轮验证边界

本机没有 Docker，不能宣称镜像、Linux 容器、自动证书或云端联调已经通过。准备阶段验证配置生成/拒绝覆盖、认证访问限制与撤销、调度真实 HTTP 契约及脱敏、源码包边界与隔离生产构建；具体结果以仓库 `docs/MVP_STATUS.md` 为准。选好云服务后还需完成本节前面的目标环境验收，才能给朋友可用的链接。

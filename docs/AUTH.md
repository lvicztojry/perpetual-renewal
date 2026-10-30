# 账号认证与 QQ 邮箱配置

默认使用自托管邮箱/密码认证，需要 PostgreSQL 和认证迁移。新用户先注册并验证邮箱，再使用邮箱/密码登录；密码为 12–128 个字符。已有 email-only 用户通过原邮箱“忘记密码”设置密码，保留原账号资料与关系数据，不能仅凭邮箱认领旧账号。

## 本机 QQ 邮箱测试

个人 QQ 邮箱 SMTP 测试无需自有域名。在 QQ 邮箱设置中启用 SMTP 并取得授权码；`AUTH_SMTP_PASSWORD` 填 SMTP 授权码，不能填 QQ 登录密码。将下列占位示例放入自己维护的 `.env.local`，用自己的邮箱地址和授权码替换；本轮文档更新未修改 `.env.local`。

```dotenv
AUTH_APP_URL=http://localhost:3000
AUTH_MAIL_TRANSPORT=smtp
AUTH_MAIL_FROM=user@qq.com
AUTH_SMTP_HOST=smtp.qq.com
AUTH_SMTP_PORT=465
AUTH_SMTP_USER=user@qq.com
AUTH_SMTP_PASSWORD="<QQ SMTP authorization code, NOT QQ password>"
```

还需配置 `DATABASE_URL`、强 `USER_KEY_VAULT_SECRET` 和可选独立 `SESSION_COOKIE_SECRET`，见 [DEPLOYMENT.md](DEPLOYMENT.md#认证与邮件)。使用 `npm run dev` 后固定打开 `http://localhost:3000`，保持访问地址与 `AUTH_APP_URL` 一致。`localhost` 只指向访问者自己的电脑；发给其他用户的邮件不能使用这个地址。生产须设置用户可访问的 HTTPS `AUTH_APP_URL`。

默认 SMTP 端口 `465` 使用 TLS；`587` 使用 STARTTLS，须确认所用邮箱服务支持。SMTP 接收邮件并不保证到达收件箱；首次测试应在收件箱/垃圾箱实际完成注册验证和密码恢复。当前真实 QQ SMTP 投递尚未验证，公开新用户的配额、反垃圾策略和送达率仍属外部验证项。

## 可选 HTTP 邮件网关

设置 `AUTH_MAIL_TRANSPORT=http`、`AUTH_MAIL_API_URL` 和 `AUTH_MAIL_API_KEY`，保留 `AUTH_APP_URL`、`AUTH_MAIL_FROM`。网关须接受带 Bearer 凭证的 POST JSON `{from,to,subject,text}`；2xx 仅表示受理。若不显式指定 transport，有 `AUTH_MAIL_API_URL` 则选 HTTP，否则选 SMTP。

## 链接与登录态

验证/重置链接分别为 `/verify-email#token=…` 和 `/reset-password#token=…`；页面读取后清除 fragment，由用户提交时通过 JSON 请求体消费令牌。令牌仅存 hash，30 分钟内单次有效；密码使用随机盐 scrypt hash。密码 v2 cookie 含签名到期时间，最长 30 天，读取时校验数据库凭证版本；重置密码轮换版本，使旧登录态失效。验证/重置令牌、密码 hash、邮箱授权码和邮件 API 凭证不得进入日志或用户导出。

`AUTH_MODE=local-email` 仅限显式非生产测试夹具；未配置时默认密码认证，生产不能使用旧邮箱演示登录。mock/memory 演示通过不能证明真实认证数据库或邮件通过。

## 本轮验证与待办

2026-10-26 主控已确认 Next.js 16.4.3 下全量 E2E 32 项、lint、typecheck、build 通过；主动调度本地 20 项、语音语言 16 项、本地认证后端及 SMTP 33 项通过；依赖升级后的 audit 为 0 vulnerabilities。这些结果包含认证 UI 的拦截响应及本地邮件测试，不能代替真实数据库的注册/恢复事务与邮件投递验证。

数据库已恢复，两份认证/检查点迁移已应用到当前数据库，真实 DB smoke 通过。完整隔离 PostgreSQL 集成已验证注册、密码登录、重置撤销旧会话、旧账号恢复、限流、检查点 CAS 和级联清理；测试 schema 已移除。最近完整 memory smoke 已通过 94 checks。

本机 QQ SMTP 的 TLS 连接与账号认证已通过，未在自检中发送邮件。真实注册邮件送达与点击验证需在网站完成。生产仍需 HTTPS `AUTH_APP_URL` 和独立部署环境验证；文档占位示例不表示部署 secret 已补齐。

QQ 授权码的生成步骤见 [QQ 邮箱官方帮助](https://help.mail.qq.com/detail/106/985)。取得后只在本机 `.env.local` 填入 `AUTH_SMTP_PASSWORD`。先运行 `npm run env:mail` 检查配置，再运行 `npm run env:mail -- --verify` 验证 SMTP 连接和认证；这两个命令都不发送邮件，也不输出授权码。生产环境的 `AUTH_APP_URL` 必须改为 HTTPS。

三个新增自动门禁已进入 verify-local 与 CI：

```bash
npm run qa:auth
npm run qa:voice-language
npm run qa:proactive-scheduler
```

可选真实隔离数据库验证为 `qa:auth:postgres`，须显式 `AUTH_DATABASE_QA=1`，不进入默认 CI；PowerShell 示例：

```powershell
$env:AUTH_DATABASE_QA="1"
npm run qa:auth:postgres
Remove-Item Env:AUTH_DATABASE_QA
```

最终结果见 [QA.md](QA.md) 和 [MVP_STATUS.md](MVP_STATUS.md)。目标部署仍须运行 `npm run prisma:migrate:deploy` 和 `npm run verify:deploy`，并用实际收件邮箱完成验收。

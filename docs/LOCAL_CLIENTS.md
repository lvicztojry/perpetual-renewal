# Web、Windows、Android 与本地测试客户端

当前持续开发 Web、Windows、Android，共用界面与业务功能；macOS、iOS、微信暂停扩展。共享原生客户端在 `native/`，设备独立保存数据并直接连接模型服务，使用者无需安装 Node.js、PostgreSQL 或 Docker。当前事实、验收证据与未覆盖项统一见 [MVP_STATUS.md](MVP_STATUS.md)，本页维护构建、数据与更新规则。

2026-11-23，Windows x64 与 Android ARM64 的 **0.1.3** 测试安装包已在 GitHub Releases 公开预发布，供所有人下载，已不限于本机交付或受邀测试。公开下载直链、文件名及校验值以 [site/site.json](../site/site.json) 为准；`dist/installers/` 保留本机构建与交付说明。介绍站已部署到 Netlify，应用 Web 仍仅 LAN 试用，操作分别见 [SITE.md](SITE.md) 和 [LAN_TRIAL.md](LAN_TRIAL.md)。公开发行不等于所有实体设备能力验收通过。

0.1.3 新增余念安「初醒」接引、留灯会叙事和能力演出登记；新账号自动开始，旧账号从侧栏「找余念安」主动参加。教程可暂停、续接、跳过和重放，只有实际操作才推进相应进度。原生进度纳入原账户加密快照，旧快照缺少进度时不自动重放教程；该版本不改变 SQLite 结构版本或账户数据格式。具体实测与边界见 [当前状态](MVP_STATUS.md)。0.1.2 包保留供更新比对，不作为本轮下载入口。

以下为 **0.1.2 历史记录**：登录前的版本公告与右上角消息入口，每台设备每个版本只自动展示一次，登录前后均可手动查看历史记录。开发记录见 [开发与版本更新日志](DEVELOPMENT_LOG.md)，由 `src/lib/release-notes.json` 经 `npm run release:notes` 生成，不手工编辑；原生构建及 QA 自动检查日志与版本是否匹配。以下 0.1.1 描述均为此前验证记录，不代表本轮复验。

2026-11-22 已从当前修复源码重新构建 Android ARM64 的 `dist/installers/renewal-0.1.1-arm64.apk` 和 Windows x64 的 `dist/installers/renewal-0.1.1-windows-x64-setup.exe`。旧安装包、Android 通用包和旧源码发布归档已删除。手机私聊工具栏改为两行文字按钮，优先显示“入梦、人物设置、主动回响”；主动回响面板可直达人物开关与频率配置。Android 新包已验证签名并在 API 36 模拟器中验证入口、开关/频率控件可访问、分区索引、入梦与 SQLite 重启持久化；Windows 原生客户端也完成索引、入梦和持久化检查。另通过 320/360/390 像素手机视口回归。实体 Android 手机和 Windows 安装向导仍需另行验收，Windows 包未进行 Authenticode 代码签名。校验值和具体范围见交付目录的 `SHA256SUMS.txt`、`VALIDATION.json`、`WINDOWS-VALIDATION.json`；同为 `0.1.1` 的包请依据构建时间和校验值判断新旧。

2026-11-21 历史范围曾提出四端独立运行、保留原网页设计及业务功能、测试者各自使用单独限额 Key，并接受手机后台调度受系统限制；当时没有 Mac 和 Apple 开发者会员，先准备代码。该历史目标不代表 Apple 平台已交付，当前范围仍以本页开头及 [当前状态](MVP_STATUS.md) 为准。

## 当前代码及验证边界

| 范围 | 代码情况 | 尚需验证 |
| --- | --- | --- |
| 原网页界面 | 复用人物/私聊、群聊、记忆、入梦、设置、资料、导入和回响录组件及原素材 | Windows/Android 原生窗口、键盘、安全区域与无障碍检查；Apple 扩展暂停 |
| 本地业务 | 复用既有服务和接口处理逻辑，由设备内请求分发器执行；不启动 HTTP 服务 | 原生完整功能验收 |
| 数据 | 每个账户独立的密码包装主密钥、AES-GCM 加密状态；SQLite 原子比较版本写入；Windows/Android 已实际写入 | 实体手机断电恢复和容量测试；Apple 构建暂缓 |
| 账号 | 本地创建、登录、锁定、恢复码重设密码；重设时保留原主密钥和数据 | 原生生命周期与密码管理器检查 |
| 模型与语音 | 沿用多供应商适配器和个人 vault，原生 HTTPS 请求传输；朗读在原生壳内改用设备本地语音引擎（`speechSynthesis`），语音转文字改用系统 `SpeechRecognizer`（内联插件 `renewal-speech`），因为 WebView 既不支持 Edge TTS 的自定义 WebSocket 头，也不实现 Web Speech API | 使用者实际供应商配置、录音/播放/识别和权限真机验收 |
| 后台任务 | 应用运行时检查私聊和群聊；群聊使用现有完整 scheduled 流程；手机返回前台检查 | Android 实际生命周期；iOS 暂缓；没有实现系统定时唤醒的承诺 |
| 文件 | 保留已有 JSON/资料导入导出；原生保存对话框与文件写入已接入 | 当前平台文件选择、Android content URI；iOS 保存待恢复扩展后另验 |
| 更新保护 | 固定应用 ID、SQLite 迁移历史校验、升级前备份、事务回滚、拒绝降级、旧版本来源检查 | 逐版本覆盖更新证据、未执行项见 [MVP_STATUS.md](MVP_STATUS.md)；实体设备及 Apple 平台另验 |

浏览器 QA 使用显式测试构建中的 IndexedDB 适配器，验证共享业务和加密状态；不能代替原生 SQLite/IPC 或真机验证。正式构建不启用此适配器，普通浏览器打开正式页面会拒绝启动。

## 架构

使用 Tauri 2 包装原有 React 界面，设备通过原生 HTTPS 插件访问模型供应商。本地存储由 Rust/rusqlite 提供，无需测试者安装 Node.js、PostgreSQL 或 Docker。开发者构建时需要 Node、Rust 和对应系统工具。框架依赖见 [Tauri 官方前置要求](https://v2.tauri.app/start/prerequisites/)。

共享业务原有内存仓库承担单次操作的计算，事务调度器在返回结果前把账户状态加密提交到原生 SQLite。提交失败会恢复到上次已提交状态，不把未持久化结果当作成功。不同账户解锁时替换完整的工作状态；Map、Date、记忆历史、群回复计划、草稿和凭据密文均纳入快照。原网页的 PostgreSQL/认证逻辑不因本地适配而放宽。

账户密码通过 PBKDF2-SHA256 派生包装密钥，随机主密钥用于加密账户状态；恢复码包装同一个主密钥。账户数据中不保存明文密码、恢复码或主密钥。个人模型 Key 还沿用既有 vault 加密。恢复码只在创建时显示，必须由用户单独保存。没有密码和恢复码时，不能通过清空数据“恢复”原账户。

本地邮箱是此设备的账户标识，不是经统一服务器验证的网络身份。相同邮箱在不同设备不会自动成为同一个账户，也没有自动跨设备同步。原网站账号、数据库和私密聊天不会被源码包复制；已有 JSON 数据导入与完整账号/凭据迁移是不同功能，不应混为一谈。

不安装本地大模型：使用真实回复、提炼和语音仍需联网访问配置的供应商。公开下载与供应商使用权限是两件事；受邀测试中单独发放限额 Key 的历史安排不代表所有下载者都获赠额度。预算与撤销在供应商执行；发布应检查默认凭据、签名私钥和个人数据边界，不要把通用 Key、发布签名私钥或自己的数据库放进安装包。本轮文档整理未审计既有安装包是否含默认 Key，不能据此宣称包内无 Key。

## 数据与更新规则

固定应用 ID 为 `com.perpetualrenewal.localtest`。数据库 `renewal.sqlite3` 位于系统应用数据目录，安装程序文件和数据库分开。不得为了新版本改应用 ID、重建空库、重置密码/主密钥，或要求用户卸载后再安装。

升级流程：

1. 发布端先比较上一版本发布清单，检查版本递增、应用 ID 和旧迁移哈希。
2. 用户通过同一应用身份和受信任签名覆盖安装；安装包替换程序，保留应用数据。
3. 新程序检查数据库版本和迁移历史。数据库来自更新版本或旧迁移被改写时，停止启动并保留文件。
4. 在执行待应用迁移前保存一致性备份，整个迁移序列放在一个 SQLite 事务中。失败回滚，不回落到新空库。
5. 解锁时继续使用原密码、包装主密钥和加密状态。

当前数据库结构版本及加密状态格式均为 1。未来结构变更必须新增迁移并测试；加密状态格式变化需要明确转换器，发布检查器目前拒绝隐式转换。修改 API Key、模型名或界面不需要更换账户主密钥。

应用内提供“备份数据”和选取内部备份恢复的代码。恢复前须输入确认文字，并保留当前数据库；恢复后重新登录。备份覆盖此设备所有本地账户，不能只考虑当前解锁的账户。当前备份保存于应用数据目录的 `backups/`；**内部备份不等于卸载、换机或设备损坏时的外部备份**。原生完整备份文件导出/导入和跨设备账户迁移仍需后续实现及验收。普通资料 JSON 导出沿用既有脱敏规则，不包含可恢复的账户凭据。

没有应用更新服务器时，采用手动分发平台更新包。当前没有配置在线检查版本、自动下载或静默热更新；数据迁移保护与下载安装包是两个环节。

## 平台分发与身份保留

Windows/Android 为当前交付范围；macOS/iPhone 条目保留为暂停扩展后的构建参考，不代表已有安装包或当前任务。

| 系统 | 测试分发与更新 | 必须保留的身份 |
| --- | --- | --- |
| Windows | 构建原生安装程序，后续同应用覆盖安装 | 应用 ID、产品身份，按发布策略保持代码签名身份 |
| macOS | 在 Mac 构建 `.app`/`.dmg`，同应用更新 | Bundle ID、签名与发布身份 |
| Android | 构建签名 APK，发给测试者安装；后续覆盖升级 | 包名、兼容的应用签名和递增版本号 |
| iPhone | 在 Mac/Xcode 构建签名，通过选定的 Apple 测试渠道更新 | Bundle ID、开发团队与配置文件 |

Android 更新的签名身份要求见 [官方应用签名说明](https://developer.android.com/studio/publish/app-signing)。Android 私钥须单独备份，不进仓库或用户数据包。

iPhone 常规异地内测可用 TestFlight，需要 Apple 开发者会员；官方标准年费为 99 美元或当地价格，每个构建最多测试 90 天，外部测试可能需要审核。见 [Apple 会员费用](https://developer.apple.com/help/account/membership/program-enrollment/)、[TestFlight 说明](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/)。不能把一个未签名 IPA 当作任意朋友都能安装的测试包。当前尚未配置开发团队、证书、描述文件或 TestFlight。

首版配置的 Apple 最低系统为 iOS 17、macOS 14；Android WebView 及 Windows WebView2 的兼容性仍需实际设备确认。

## 构建准备

以下命令用于完整开发仓库或源码准备包中的开发环境，不是发给普通测试者的安装步骤：

```bash
npm ci
npm run prisma:generate
npm ci --prefix native
npm run native:build
npm run qa:native
```

`prisma:generate` 只生成共享代码的类型，不需要迁移或连接本机真实数据库。完整仓库中已有私密 `.env.local` 时，该脚本会读取本地配置；准备包不包含此文件，原生客户端也不会使用该文件。

Windows/macOS 原生构建在具备 [官方工具链](https://v2.tauri.app/start/prerequisites/) 的对应系统运行：

```bash
npm --prefix native run desktop:build
```

当前 Windows 交付使用 `npm --prefix native run desktop:build -- --bundles nsis`，避免默认 MSI 英文代码页与中文产品名冲突。`bundle.useLocalToolsDir` 将安装工具缓存保存在 D 盘项目的 `target/.tauri/`。

Android 先安装 Android Studio、SDK/NDK，配置 Rust Android targets、Java 与 SDK 路径，再运行：

```bash
npm --prefix native run android:init
npm --prefix native run android:build
```

`android:build` 会先执行 `native/scripts/prepare-mobile.mjs`，向生成的 AndroidManifest 补齐 `RECORD_AUDIO` 与 `MODIFY_AUDIO_SETTINGS`。两者缺一不可：wry 处理 WebView 的音频采集时会同时申请这两个权限，并要求全部授予才放行 `getUserMedia`。同一步还会把 `native/android/SpeechPlugin.kt` 复制进生成工程——Tauri 不会自动编译应用自己的 Kotlin 插件，漏复制时语音识别会在运行时报「插件未初始化」。声明不等于用户已经授予权限，录音与识别仍需真机检查，包括第一次点击麦克风时的系统授权弹窗。

语音识别依赖设备的识别服务：多数量产 ROM 自带，部分精简 ROM 没有，此时按钮会提示改用文字输入。系统的 `SpeechRecognizer` 在某些引擎上需要联网才能出结果，因此离线设备可能识别失败——这是引擎限制，不是应用配置问题。

iPhone 在 Mac 上准备 Xcode、Rust iOS targets，设置实际 Apple 团队和签名，再运行：

```bash
npm --prefix native run ios:init
npm --prefix native run ios:build
```

本机已准备 Rust/MSVC、JDK 21、Android SDK 36 和 NDK 29，开发缓存位于忽略目录 `.build-tools/`。`scripts/native-env.ps1 -WithProxy` 只配置当前构建进程的环境及已有本机代理，不修改系统代理。Rust 迁移、失败回滚及安全恢复路径的 3 项测试已通过。

Windows 已完成 NSIS 0.1.0 → 0.1.1 实际覆盖安装，原生 SQLite 中的账户、聊天、群聊、入梦、密码包装主密钥、恢复码包装密钥和模型 Key 配置均保留，更新前自动备份存在。测试使用 `RENEWAL_DATA_DIR` 指定的隔离目录；普通启动仍使用固定应用 ID 的系统数据目录。该变量只接受绝对路径，普通测试者无需设置。

Windows 的 Android 构建可使用 `native/scripts/build-android.ps1`；它在系统不允许符号链接时复制已编译原生库再交由 Gradle 打包，不需要启用 Windows 开发者模式。首次先运行 `android:init`。签名使用 `native/scripts/sign-android.mjs`；固定私钥和凭据保存在忽略目录 `.release-keys/android/`，必须由发布者安全备份。后续 APK 必须沿用同一私钥并递增版本号，不能重新生成签名身份。

## 发布源码准备包

```bash
npm run native:package
```

按 `native/package.json` 的版本生成 `dist/renewal-local-source-<版本>.tar.gz` 和同名 `.release.json`。清单写明 `source-preparation-not-an-installer`，列出源文件哈希、应用 ID、数据格式和迁移哈希；打包边界排除 `.env.local`、测试者数据、API Key、构建输出、系统运行时或签名私钥。此处是源码准备包规则，不替代已发布安装包的内容审计。

制作后续版本源码包时，将原清单作为更新来源：

```bash
node scripts/prepare-native.mjs --previous path/to/previous.release.json
```

`--previous` 会拒绝应用 ID 变化、非递增版本、数据库降级、历史迁移修改/删除及没有转换器的加密数据格式变化。源码文件哈希用于校验内容，不替代平台代码签名，也不代表自动更新器已经实现。发布给测试者前，仍须完成原生构建、签名及旧包覆盖更新的真机演练。

## 必须完成的验收

用虚构数据建立账号、人物、消息、群聊、记忆历史、入梦草稿和个人 Key，安装新版后逐项核对。模拟迁移中断、磁盘写入失败、旧版本打开新库、重复提交和密码恢复，确认不自动重置数据。当前交付平台分别验证录音、播放、文件、键盘、锁屏/恢复和备份恢复；Apple 平台恢复开发时另验。

手机处于后台、被系统挂起或关闭时，不能保证每分钟实时生成。当前实现应用运行时检查与回到前台检查，没有静默唤醒的保证，也不把补处理伪装成过去已发送的消息。iOS 运行时间由系统安排，见 [Apple 后台任务说明](https://developer.apple.com/documentation/backgroundtasks/choosing-background-strategies-for-your-app)。

已经通过和仍待执行的项目以开发仓库 `docs/MVP_STATUS.md` 为准，源码准备不等于全功能原生验收完成。

## 历史安装包验收（0.1.1）

以下保留旧包验证范围；本轮安装包与当前未覆盖项只见 [MVP_STATUS.md](MVP_STATUS.md)。

0.1.1 安装包、使用说明、SHA256SUMS.txt 和 VALIDATION.json 当时保存在 dist/installers/，不代表旧包今天仍在磁盘。Android API 36 模拟器将同签名 0.1.0 基线覆盖为关闭调试的 0.1.1 release，SQLite 完整性及加密账户逐字节保留检查通过，原密码和恢复码可解密聊天、群聊、入梦和原模型 Key；界面旧账户登录及原人物显示通过。当时 APK 包含 ARM64/ARMv7/x86_64，v2/v3 签名验证、ZIP 16KB 对齐及两个 64 位 ELF 的 0x4000 对齐通过。Windows NSIS 没有 Authenticode 发布者证书。未将模拟器通过记为实体手机录音、播放、文件或后台生命周期验收。

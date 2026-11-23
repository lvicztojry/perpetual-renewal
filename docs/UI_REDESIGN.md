# 生生不息：旧城与回响

用户于 2026-11-02 确认首轮视觉稿并授权实现。视觉原稿及生成提示词位于 `design/previews/2026-11-02/`。

## 初醒接引（2026-11-23）

新增余念安的独立剧情立绘 `public/visuals/yu-nianan-guide.png`，用于初醒和找余念安，保留巨钟演出原有黑色剪影。画面采用长发白裙、旧城暖铜光、绘本式人物与青铜绿对话面板；小屏完整缩放立绘，不裁切头像。故事按用户指定的二创设定编写，不作为原著结局考据。教程选择为固定对白，不调用模型，也不进入人物记忆。

图像使用内置 imagegen 工具生成，PNG 1024×1536，含透明通道；不含外部字体、文字或真实用户内容。生成提示词记录如下：

> Create a polished visual novel dialogue character standing portrait asset, transparent background, no text, no border, no scenery. A young adult Chinese woman inspired by the user's fanfiction Yu Nian'an: very long straight black hair, simple flowing white sleeveless ankle-length dress, modest elegant neckline, warm quiet expression, intelligent calm eyes, subtle bittersweet smile. Three-quarter body down below knees, anatomically beautiful relaxed hands, one hand lightly resting over the other at waist, looking gently toward viewer. Painterly high-end Chinese narrative game illustration, muted ivory and charcoal palette, warm bronze rim light and soft cool shadow as if waiting in an abandoned old city, understated atmospheric realism with fine ink-like edges, NOT chibi, NOT doll, NOT sexy outfit, NOT plastic 3D, no flowers or accessories. Isolated clean alpha silhouette including wispy hair, character centered with some breathing room, full crown of head visible. Design for a serious literary Chinese emotional companion app in an antique bronze nocturnal city theme.

## 巨钟封面风格延伸（2026-11-11）

用户明确保留原封面方向。日常界面采用同一组旧城、青铜、深石材与暖尘光元素；开场构图、屏幕文字、动画和钟声沿用已确认版本。

- 工作台：巨钟画面成为联系人栏的题头，联系人以铭牌头像和刻线区分；选中状态使用铜色竖线。桌面保留双栏，窄屏保留联系人与聊天之间的返回导航。
- 对话：正文阅读列独立于低亮度旧城背景；人物回复采用轻竖线与自然段，用户消息采用低圆角铜色底。日期、即时发送、输入状态和消息操作继续可用。
- 品牌：新增悬钟与未闭合回响环组成的 SVG 标记，工作台、浏览器图标和 PWA 图标保持一致；图标不依赖外部字体。
- 配套页面：登录复用巨钟分层素材，表单保持实底；账号、设置、导入统一宋体标题、青铜刻线和低圆角控件。
- 共享颜色与标题字体在 `src/app/globals.css` 维护，功能布局在各组件 CSS module 维护。没有新增图像、字体或动画依赖，也没有变更数据库及模型调用契约。

实际页面截图位于 `design/previews/2026-11-11/`，人物与聊天文字为隔离环境里的虚构演示，不使用真实账号数据。当前验收范围见 [MVP_STATUS.md](MVP_STATUS.md)。

## 视觉与交互

- 以炭黑、暖白、烟灰、旧铜组织界面；正文保持清晰，装饰纹理不覆盖文字。
- 巨钟开场使用独立背景、透明钟体、真实屏幕文字和浏览器动画。屏幕文字为“我看到了【生生不息】的激荡”。
- 钟声由浏览器合成，在用户操作后启用；提供静音、跳过和减少动态效果支持。
- 2026-11-06：巨钟音色增强低频钟体、十组铜钟泛音、敲击起音与立体空间余响；使用动态压缩及峰值整形，五秒场景末尾淡出。声音模块为 `src/lib/audio/giant-bell.ts`，静音与场景淡出分别控制，恢复声音不会重置余响包络。
- 首次浏览器会话展示开场，之后不重复阻断导航；设置页可以重播。
- 桌面默认显示联系人和聊天两栏，资料、记忆、导入、回响及用量面板按需打开。
- 手机按联系人列表与当前聊天切换，输入框贴近底部，并保留返回入口。
- 2026-11-06：每条聊天消息显示浏览器本地时间的 `YYYY-MM-DD HH:mm`，日期变化时插入实际日期分隔，不再固定标成“今天”；跨午夜、跨年及消息发送隔离回归通过。
- 登录、邮箱验证、密码恢复、用户设置和 PWA 图标使用同一套视觉语言。

## 素材

素材由内置 image_gen 根据用户批准的原创概念稿编辑，最终文件位于 D 盘项目：

- `public/visuals/bell-scene.png`：空钟位与空屏幕的场景。
- `public/visuals/bell-isolated.png`：透明钟体，独立摆动。
- `public/visuals/chat-room.webp`：低亮度聊天背景，压缩后约 88 KB。
- `design/previews/2026-11-02/implementation-assets.txt`：素材编辑提示词。

动画和界面中的中文由代码呈现，不依赖概念稿里烘焙的文字。项目不引用小说或游戏的官方美术资产。

## 个人账号页补充（2026-11-02）

已登录工作台侧栏显示“我的账号”，入口为 `/account`；未登录访问账号页会跳转登录。账号页沿用炭黑与旧铜主题，桌面采用身份侧栏和内容双栏，手机折为单栏。

个人资料支持保存昵称、时区与语言，登录邮箱只读；保存不覆盖主动回响偏好。账号安全支持向自己的登录邮箱发送密码重置邮件和退出登录；数据与隐私提供到现有导出/删除区的入口。重置邮件错误使用固定提示，允许失败重试。完整浏览器回归 40 项通过，新增桌面及手机截图为 `account-desktop-implemented.png`、`account-mobile-implemented.png`。

## 主动回响状态补充（2026-11-02）

打开铃铛面板只读取记录和真实开关，不自动生成草稿。面板分为“自动发送”和“回响记录与草稿”：分别显示账号总开关、当前人物开关及暂停原因；账号关闭时不显示下一次自动检查倒计时。用户可明确点击“开启账号主动回响”，只更改该开关，保留频率等偏好。

“按当前设置检查一次”遵守到期判断并直接投递；“手动生成草稿”仅供核对后手动发送。刷新按钮只读更新记录。日常保持聊天页打开并选中人物时每分钟检查当前关系；页面关闭或切换后不继续检查原人物，部署后台 cron 是独立路径。

计时器不再随消息列表同步或打开面板重建。新增关闭总开关、显式开启、历史读取无生成副作用以及面板操作不延迟一分钟投递的浏览器验证。

## 原有功能回归范围

保留邮箱密码登录、用户 vault、模型选择、聊天持久化、主动消息、记忆、导入、语音、导出和账号删除的原有行为。浏览器测试通过测试端 sessionStorage fixture 隔离开场，不在产品代码添加认证旁路。

实现后的浏览器截图放在同一设计目录，供与概念稿比较。验证结果以主控运行记录及 `MVP_STATUS.md` 为准。

2026-11-02：完整浏览器回归 37 项、隔离 API smoke 94 项、lint、生产构建、PWA、文档和密钥检查均通过；开场、桌面和 390px 手机实际截图已生成。新增开场状态只保存会话标记，密码验证/重置测试继续确认令牌不进入浏览器存储。语音生成成功提示在聊天播放器旁可见，供应商诊断按需展开。

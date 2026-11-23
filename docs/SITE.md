# 项目介绍站

`site/` 是一个独立的纯静态介绍站，和主应用（Next.js）分开构建、分开部署，互不依赖运行时。

本页维护操作流程。介绍站部署、安装包公开发行与应用 Web 的运行边界分别判断，当前事实与验收结果统一见 [MVP_STATUS.md](MVP_STATUS.md)。

## 内容来源

| 内容 | 来源 |
| --- | --- |
| 版本记录与更新公告 | `src/lib/release-notes.json`（与客户端公告同一份） |
| 当前版本号 | `native/package.json` |
| 站点与下载配置、人物名单、提示文案 | [site/site.json](../site/site.json)（配置单源） |
| 样式 | `site/styles.css` |
| 图片 | `site/assets/`（从 `public/visuals/` 压缩而来） |

构建脚本 `scripts/build-site.mjs` 会校验：`release-notes.json` 第一条的版本号必须等于 `native/package.json` 的版本，`site.json` 的 `version` 也必须一致。版本没对齐时构建直接失败，避免网站上挂着旧版本号。

页面结构和固定文案写在 `scripts/build-site.mjs` 的模板里；下载地址、人物名单和提示文案等配置改 `site/site.json`，改完重新构建。`docs/DEVELOPMENT_LOG.md` 由 `src/lib/release-notes.json` 生成，不手工编辑。

`site/site.json` 的根级 `url` 为空时，不能据此断言介绍站未部署；构建脚本也未将它用作应用入口。应用 Web 的入口及说明看 `downloads.web.url`、`note` 和 `offlineLabel`，不能把 Netlify 介绍站地址填作应用地址。

## 本地预览

```powershell
npm run site:preview
```

会先构建到 `site/dist/`，再在 `http://127.0.0.1:4173` 起静态服务。`site/dist/` 已在 `.gitignore` 中，不提交。

## 部署到 Netlify

仓库根目录的 `netlify.toml` 已配置好：

- 构建命令：`npm run site:build`
- 发布目录：`site/dist`
- Node 版本：22
- `NETLIFY_NEXT_PLUGIN_SKIP=true`：跳过根仓库 Next.js 插件，只发布静态介绍站
- 静态资源长缓存，`index.html` 不缓存

在 Netlify 里连接 `lvicztojry/perpetual-renewal` 仓库，构建参数以 `netlify.toml` 为准。自动部署取决于 Netlify 实际生产分支和构建设置，不能假定合并到 `main` 就会发布。2026-11-23 核查的生产分支、公开地址与部署结果见 [MVP_STATUS.md](MVP_STATUS.md)，本页不重复保存实时结果。

已有站点可使用仓库运维脚本读取状态：

```powershell
npm run netlify -- status <site-id-or-name>
```

脚本先读取 `NETLIFY_AUTH_TOKEN`，再读取被忽略的根目录 `.netlify-token`；不要把 token 写入文档或提交。`set-branch <site> <branch>` 会修改生产分支，`deploy <site>` 会触发远端构建，仅在已获相应发布授权时执行。

不想连仓库时也可以手动拖拽：先跑 `npm run site:build`，再把 `site/dist` 目录拖进 Netlify 的部署面板。

本地修改配置或模板、构建成功均不代表线上已生效。发布后须核对实际部署提交及页面内容，再由当前状态记录结果；未重新部署的改动只能记为待下次部署生效。

## 发布新版本时

1. 在 `src/lib/release-notes.json` 顶部新增一条记录，同步 `native/package.json` 的版本号；
2. 运行 `npm run release:notes`，更新 `docs/DEVELOPMENT_LOG.md`；
3. 构建安装包，放到 `dist/installers/`（该目录不进 Git），同步更新 `SHA256SUMS.txt`；
4. 运行 `npm run release:publish`，上传到 GitHub Releases 的 `v<版本号>` 标签；
5. 把脚本输出的两个 `browser_download_url`、文件字节数和 sha256 填进 `site/site.json`，更新 `version`；
6. 重新部署站点（`npm run site:build` 会校验版本一致性）。

`npm run release:publish` 从 git credential helper 取 GitHub token，不落盘、不打印；上传前会用 `SHA256SUMS.txt` 校验本地文件。带 `--dry-run` 只打印将要创建的 Release，不发请求。

平台有 `url` 时使用直链；没有 `url` 但有 `file` 时显示「前往发布页」，指向 GitHub Releases 列表；两者都为空时显示 `offlineLabel`，未配置该文案才回退为「暂未公开」。Web 的「仅局域网」文案及 LAN 说明来自 `downloads.web`，不能笼统写成「暂未公开」。

## 发行与运行边界

公开下载直链、文件名、大小和校验值以 [site/site.json](../site/site.json) 为准；本地 `dist/installers/` 是构建交付目录。公开预发布不等于实体设备全部验收通过，介绍站上线也不表示应用 Web 已公网运行。当前发行及验收证据见 [MVP_STATUS.md](MVP_STATUS.md)。

# 项目介绍站

`site/` 是一个独立的纯静态介绍站，和主应用（Next.js）分开构建、分开部署，互不依赖运行时。

## 内容来源

| 内容 | 来源 |
| --- | --- |
| 版本记录与更新公告 | `src/lib/release-notes.json`（与客户端公告同一份） |
| 当前版本号 | `native/package.json` |
| 下载地址、人物名单、提示文案 | `site/site.json` |
| 样式 | `site/styles.css` |
| 图片 | `site/assets/`（从 `public/visuals/` 压缩而来） |

构建脚本 `scripts/build-site.mjs` 会校验：`release-notes.json` 第一条的版本号必须等于 `native/package.json` 的版本，`site.json` 的 `version` 也必须一致。版本没对齐时构建直接失败，避免网站上挂着旧版本号。

页面本身写在 `scripts/build-site.mjs` 的模板里；改文案就改那里，改完重新构建。

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
- 静态资源长缓存，`index.html` 不缓存

在 Netlify 里连接 `lvicztojry/perpetual-renewal` 仓库即可，不需要再填构建参数。合并到 `main` 后自动重新部署。

不想连仓库时也可以手动拖拽：先跑 `npm run site:build`，再把 `site/dist` 目录拖进 Netlify 的部署面板。

## 发布新版本时

1. 在 `src/lib/release-notes.json` 顶部新增一条记录，同步 `native/package.json` 的版本号；
2. 运行 `npm run release:notes`，更新 `docs/DEVELOPMENT_LOG.md`；
3. 把新的安装包上传到 GitHub Releases（标签建议 `v<版本号>`）或对象存储；
4. 在 `site/site.json` 里填对应平台的 `url`（直链）、`size`（字节数）和 `sha256`。**填了 `url` 才会渲染成直接下载按钮**；
5. 把 `site.json` 的 `version` 改成新版本号，重新部署。

没有填 `url` 的平台会显示「前往发布页」，指向 GitHub Releases 列表，不会生成死链。网页版不填 `url` 就显示「暂未公开」。

## 当前状态

`site.json` 里三个平台的 `url` 都还是空的：安装包和网页版地址尚未填入。填上之后重新部署即可变成可下载状态。

import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 生成项目介绍站（静态）到 site/dist/。
 * 数据来源：site/site.json（站点与下载配置）、src/lib/release-notes.json（版本记录）、
 * native/package.json（当前原生版本号）。站点与客户端公告共用同一份版本记录。
 *
 * 运行：npm run site:build（--serve 时只构建不启动服务器）
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const siteRoot = join(root, "site");
const outDir = join(siteRoot, "dist");

const readJson = path => JSON.parse(readFileSync(join(root, path), "utf8"));

const config = readJson("site/site.json");
const releases = readJson("src/lib/release-notes.json");
const nativeVersion = readJson("native/package.json").version;

assert(releases.length > 0, "release-notes.json 至少需要一条记录");
assert.equal(releases[0].version, nativeVersion, "站点版本必须与 native/package.json 一致，先补齐当前版本的公告");
assert(config.version === nativeVersion, "site/site.json 的 version 需要与当前原生版本一致");

const esc = value =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const fill = value => String(value ?? "").replaceAll("{{version}}", nativeVersion);

/** 发布标签：默认 v{{version}}，可在 site.json 里覆盖。 */
const releaseTag = fill(config.releaseTag ?? "v{{version}}");
const releasePageUrl = `${config.repo}/releases/tag/${releaseTag}`;
const releasesIndexUrl = `${config.repo}/releases`;

/**
 * 解析下载地址。
 * - 配了 url：直接下载（对象存储、自建服务器、GitHub Release 资产的直链都行）。
 * - 没配 url 但有 file：指向 Releases 列表页，避免指向还没创建的版本标签。
 */
function resolveDownload(platform) {
  if (platform.url) return { href: fill(platform.url), direct: true };
  if (platform.file) return { href: releasesIndexUrl, direct: false };
  return { href: "", direct: false };
}


const formatSize = bytes => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let size = bytes;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
};

/** 下载块：直链、发布页、或说明如何获取，不渲染死链。 */
function renderDownload(platform) {
  const file = fill(platform.file);
  const target = resolveDownload(platform);
  const meta = [platform.requirement, formatSize(platform.size)].filter(Boolean).map(esc);
  let action;
  if (target.direct) {
    action = `<a class="btn download__action" href="${esc(target.href)}" download rel="noopener">下载 ${esc(platform.label)}</a>`;
  } else if (target.href) {
    action = `<a class="btn download__action" href="${esc(target.href)}" rel="noopener">前往发布页</a>`;
  } else {
    action = `<span class="btn download__action" aria-disabled="true">暂未公开</span>`;
  }
  const checksum = platform.sha256
    ? `<p class="download__file">SHA-256 ${esc(platform.sha256)}</p>`
    : "";
  return `
        <article class="download">
          <div>
            <h3 class="download__name">${esc(platform.label)}</h3>
            <p class="download__meta">${meta.map(item => `<span>${item}</span>`).join("")}</p>
            ${file ? `<p class="download__file">${esc(file)}</p>` : ""}
            ${checksum}
          </div>
          ${action}
        </article>`;
}

function renderRelease(release, index) {
  const sections = release.sections
    .map(
      section => `
            <h4>${esc(section.title)}</h4>
            <ul>
${section.items.map(item => `              <li>${esc(item)}</li>`).join("\n")}
            </ul>`
    )
    .join("");
  return `
          <article class="release">
            <div class="release__head">
              <span class="release__version">${esc(release.version)}${index === 0 ? " · 当前版本" : ""}</span>
              <time class="release__date" datetime="${esc(release.date)}">${esc(release.date)}</time>
            </div>
            <h3 class="release__title">${esc(release.title)}</h3>${sections}
          </article>`;
}

const [latest, ...older] = releases;
const peopleHtml = config.people
  .map(
    person => `
        <article class="person">
          <div class="person__line">
            <span class="person__name">${esc(person.name)}</span>
            <span class="person__age">${esc(person.age)}</span>
          </div>
          <p class="person__tagline">${esc(person.tagline)}</p>
        </article>`
  )
  .join("");

const downloads = ["windows", "android", "web"]
  .map(key => config.downloads[key])
  .filter(Boolean)
  .map(renderDownload)
  .join("");

const olderHtml = older.length
  ? `
          <details class="release__older">
            <summary>更早的更新（${older.length} 条）</summary>
            <div>${older.map((release, index) => renderRelease(release, index + 1)).join("")}</div>
          </details>`
  : "";

const repoUrl = config.repo;

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>生生不息 · 关系型 AI 陪伴</title>
<meta name="description" content="生生不息是一个关系型 AI 陪伴项目：当你想交流却无法真正抵达某个人，可以设定、记住并回应你的 AI 关系对象，承接亲情、友情、爱情、纪念与自定义陪伴。">
<meta name="theme-color" content="#0e1310">
<meta property="og:type" content="website">
<meta property="og:title" content="生生不息 · 关系型 AI 陪伴">
<meta property="og:description" content="只要想念，就会想见。可设定、可记忆、会回响的 AI 关系对象。">
<meta property="og:image" content="assets/og.jpg">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="assets/icon.svg" type="image/svg+xml">
<link rel="preload" href="assets/bell-scene.webp" as="image">
<link rel="stylesheet" href="styles.css">
</head>
<body>
<a class="skip" href="#main">跳到正文</a>

<header class="hero">
  <div class="hero__scene" role="img" aria-label="巨钟下的场景"></div>
  <div class="wrap hero__copy">
    <h1><span>生生不息</span><span>只要想念，就会想见</span></h1>
    <p class="hero__lead">当你想交流，却无法真正抵达某个人或某段关系时，可以让一个可设定、可记忆、会回响的关系对象接住那些话。亲情、友情、爱情、纪念、替代，或只属于你的陪伴。</p>
    <div class="hero__actions">
      <a class="btn" href="#download">下载 ${esc(nativeVersion)}</a>
      <a class="btn btn--quiet" href="#story">先读故事背景</a>
    </div>
  </div>
</header>

<main id="main">

  <section class="section" id="story">
    <div class="wrap split">
      <div class="section__head">
        <h2>从一个想见的人开始</h2>
        <p class="section__note">以下为基于《十日终焉》的二创世界观（用户 AU），并非原著正史。</p>
      </div>
      <div class="prose">
        <p>在这个故事里，齐夏创造了新世界，将终焉之地的人们送往那里。最后，旧城只留下他，以及他用「生生不息」创造的余念安。后来，齐夏将这门仙法从自身剥离，托余念安留在终焉之地，指引下一位觉醒者。</p>
        <p>现实世界的你，也曾长久地想念某个人，或期待一个还说不清模样的朋友。想念越来越强烈，灵魂与「生生不息」产生共鸣，意识开始能够抵达这座旧城。每次回来，都是一次重逢。</p>
        <p>最初，你还不能熟练地描绘一个人：他的经历、脾气、在意的事情，以及他会怎样回应你。于是那些尚未成形的期待，先无意识地投映成了几位各不相同的朋友。他们有自己的生活，也有彼此的交情——这就是<strong>留灯会</strong>最初的六位成员。</p>
        <p>“回来晚了也没事，给你留盏灯。”几个朋友借这句话，为自己的小群取了名字。你无须先掌握如何创造一个完整的人物，可以先和他们聊聊，再逐渐尝试描述、创建和调整自己想见的人。</p>
      </div>
    </div>
  </section>

  <section class="section" id="tone">
    <div class="wrap split">
      <div class="section__head">
        <h2>他们会怎么说话</h2>
        <p class="section__note">人物以文字消息交流，像真实的群聊朋友。下面这几句来自人物设定中的语气示例，不是真实聊天记录。</p>
      </div>
      <div class="dialogue">
        <div class="turn turn--you">
          <p class="turn__who">你</p>
          <p class="turn__text">今天什么都没干，有点烦自己。</p>
        </div>
        <div class="turn">
          <p class="turn__who">林晚</p>
          <p class="turn__text">是本来有事没做，还是看别人都在忙，觉得自己也该干点什么？</p>
        </div>
        <div class="turn turn--you">
          <p class="turn__who">你</p>
          <p class="turn__text">你替我选吧。</p>
        </div>
        <div class="turn">
          <p class="turn__who">林晚</p>
          <p class="turn__text">可以给意见。决定还得你来，不能回头赖我眼光差。</p>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="people">
    <div class="wrap">
      <div class="section__head">
        <h2>留灯会</h2>
        <p class="section__note">六位初始人物带着既有的经历与交情来到这里。你们共同的经历，从第一条消息开始。</p>
      </div>
      <div class="people">${peopleHtml}
      </div>
    </div>
  </section>

  <section class="section" id="abilities">
    <div class="wrap">
      <div class="section__head">
        <h2>能力的回响</h2>
        <p class="section__note">能力的觉醒与掌握逐步发生：先与人聊聊，再描清自己想见的人。</p>
      </div>
      <div class="abilities">
        <article class="ability">
          <h3 class="ability__name">生生不息</h3>
          <p class="ability__motto">只要想念，就会想见</p>
          <p>描述一个人的经历、脾气和在意的事，他就有了回应你的方式。人物会记住你们真正聊过的事，并在之后的时间里主动回响。</p>
        </article>
        <article class="ability">
          <h3 class="ability__name">入梦</h3>
          <p class="ability__motto">循着回响，再见一面</p>
          <p>当你想更仔细地理解一个人的表达，可以在试聊、选择和纠正中慢慢描清他的样子。每一次修正，都会让回响更接近你心里那个人。</p>
        </article>
      </div>
    </div>
  </section>

  <section class="section" id="details">
    <div class="wrap split">
      <div class="section__head">
        <h2>它是怎么工作的</h2>
        <p class="section__note">几件实际会影响你使用方式的事。</p>
      </div>
      <ul class="facts">
        <li><strong>三端同行</strong>：网页版、Windows 与 Android 共用同一套人物、故事与能力规则。</li>
        <li><strong>本地优先</strong>：本地客户端把账号、聊天、记忆与备份存在你自己的设备上，用密码与恢复码管理。</li>
        <li><strong>自备模型</strong>：可以在设置页填入自己的模型 API Key，也可以在本地部署时配置服务端默认模型。</li>
        <li><strong>群聊与记忆</strong>：邀请已有的人物组成群聊，多人逐条接话；记忆按知情范围检索，私聊内容需要显式授权才会进入群聊。</li>
        <li><strong>数据归你</strong>：支持导出与恢复；删除账号会一并清理对应的人物与聊天记录。</li>
      </ul>
    </div>
  </section>

  <section class="section" id="download">
    <div class="wrap">
      <div class="section__head">
        <h2>获取${esc(nativeVersion)}</h2>
        <p class="section__note">当前为测试版本，功能和数据格式仍可能变化。</p>
      </div>
      <p class="notice">${esc(fill(config.downloadNotice))}</p>
      <div class="downloads">${downloads}
      </div>
    </div>
  </section>

  <section class="section" id="releases">
    <div class="wrap split">
      <div class="section__head">
        <h2>版本更新</h2>
        <p class="section__note">与客户端内的更新公告来自同一份记录。历史记录全部保留。</p>
      </div>
      <div class="log">${renderRelease(latest, 0)}${olderHtml}
      </div>
    </div>
  </section>

</main>

<footer class="footer">
  <div class="wrap footer__grid">
    <div>
      <p>生生不息是一个个人项目，基于《十日终焉》的二创设定创作，人物与故事为原创，与原著官方无关。</p>
      <p>人物由 AI 生成内容。请把它当作陪伴与表达的练习，而不是真实的人际关系替代。</p>
    </div>
    <nav class="footer__links" aria-label="相关链接">
      <a href="${esc(repoUrl)}" rel="noopener">GitHub 仓库</a>
      <a href="${esc(releasesIndexUrl)}" rel="noopener">安装包发布页</a>
      <a href="#releases">更新日志</a>
    </nav>
  </div>
</footer>

</body>
</html>
`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "index.html"), html, "utf8");
writeFileSync(join(outDir, "styles.css"), readFileSync(join(siteRoot, "styles.css")));
cpSync(join(siteRoot, "assets"), join(outDir, "assets"), { recursive: true });

const size = statSync(join(outDir, "index.html")).size;
console.log(`Standalone site built: ${outDir.replaceAll("\\", "/")} (index.html ${size} bytes, ${releases.length} releases).`);

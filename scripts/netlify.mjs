import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Netlify 运维脚本（不安装 netlify-cli，直接调 REST API）。
 *
 * 用法：
 *   node scripts/netlify.mjs status <site-id-or-name>
 *   node scripts/netlify.mjs set-branch <site> <branch>
 *   node scripts/netlify.mjs deploy <site>
 *
 * Token 来源（按顺序）：
 *   1. 环境变量 NETLIFY_AUTH_TOKEN
 *   2. 项目根目录的 .netlify-token 文件（已在 .gitignore 中）
 * 只打印站点信息，永远不打印 token。
 */

const root = fileURLToPath(new URL("../", import.meta.url));
const tokenFile = join(root, ".netlify-token");

function readToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN.trim();
  if (existsSync(tokenFile)) {
    const value = readFileSync(tokenFile, "utf8").trim();
    if (value) return value;
  }
  throw new Error(
    [
      "没有找到 Netlify token。把 token 放进项目根目录的 .netlify-token 文件即可：",
      "  1) 打开 https://app.netlify.com/user/applications#personal-access-tokens",
      "  2) 点 New access token，起个名字（例如 perpetual-renewal），生成后复制",
      "  3) 新建 .netlify-token 文件，把 token 粘进去保存",
      "",
      "也可以用环境变量：$env:NETLIFY_AUTH_TOKEN=\"<token>\""
    ].join("\n")
  );
}

async function api(path, options = {}) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${readToken()}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${path} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function resolveSite(identifier) {
  if (!identifier || identifier === ".") {
    const statePath = join(root, ".netlify/state.json");
    if (existsSync(statePath)) {
      const { siteId } = JSON.parse(readFileSync(statePath, "utf8"));
      if (siteId) return api(`/sites/${siteId}`);
    }
    throw new Error("需要传站点 id 或名字，例如：node scripts/netlify.mjs status perpetual-renewal");
  }
  if (/^[0-9a-f-]{20,}$/i.test(identifier)) return api(`/sites/${identifier}`);
  const sites = await api("/sites?per_page=100");
  const site = sites.find(s => s.name === identifier || s.custom_domain === identifier || s.ssl_url?.includes(identifier));
  if (!site) throw new Error(`未找到站点 ${identifier}；可用站点：${sites.map(s => s.name).join(", ")}`);
  return api(`/sites/${site.id}`);
}

function summarize(site) {
  const latest = site.published_deploy;
  return [
    `站点: ${site.name}`,
    `  id: ${site.id}`,
    `  url: ${site.ssl_url ?? site.url ?? "(未分配)"}`,
    `  仓库: ${site.build_settings?.repo_url ?? "(无)"}`,
    `  生产分支: ${site.build_settings?.repo_branch ?? site.default_branch ?? "(未知)"}`,
    `  构建命令: ${site.build_settings?.cmd ?? "(默认)"}`,
    `  发布目录: ${site.build_settings?.dir ?? "(默认)"}`,
    `  最近发布: ${latest ? `${latest.state} @ ${latest.created_at}` : "无"}`
  ].join("\n");
}

const [command, target, ...rest] = process.argv.slice(2);

try {
  switch (command) {
    case "status": {
      const site = await resolveSite(target);
      console.log(summarize(site));
      if (site.published_deploy?.error_message) console.log(`  失败原因: ${site.published_deploy.error_message}`);
      break;
    }
    case "branches": {
      const site = await resolveSite(target);
      console.log(summarize(site));
      console.log(`\n  分支设置: production=${site.build_settings?.repo_branch ?? "?"} deploy_previews=${site.build_settings?.repo_branch === "*" ? "?" : "?"}`);
      break;
    }
    case "set-branch": {
      const branch = rest[0];
      if (!branch) throw new Error("用法：set-branch <site> <branch>");
      const site = await resolveSite(target);
      const updated = await api(`/sites/${site.id}`, {
        method: "PATCH",
        body: JSON.stringify({ build_settings: { repo_branch: branch } })
      });
      console.log(`已把生产分支设为 ${branch}`);
      console.log(summarize(updated));
      break;
    }
    case "deploy": {
      const site = await resolveSite(target);
      const deploy = await api(`/sites/${site.id}/builds`, {
        method: "POST",
        body: JSON.stringify({ clear_cache: false })
      });
      console.log(`已触发构建: ${deploy.id ?? deploy.deploy_id ?? "(无 id)"}`);
      console.log(`在 Netlify 的 Deploys 页面查看进度。`);
      break;
    }
    default:
      console.log(
        [
          "用法：",
          "  node scripts/netlify.mjs status <site-id-or-name>",
          "  node scripts/netlify.mjs set-branch <site> <branch>",
          "  node scripts/netlify.mjs deploy <site>",
          "",
          "Token：环境变量 NETLIFY_AUTH_TOKEN，或根目录被忽略的 .netlify-token 文件。"
        ].join("\n")
      );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

// Pure, offline checks: docs must point to evidence/configuration rather than
// turn historical task milestones or generated artifacts into a release claim.
export function validateDocumentationContract({ documents, versions, site, netlify }) {
  const findings = [];
  const current = documents["docs/MVP_STATUS.md"] ?? "";
  const taskbook = documents["docs/TASKBOOK.md"] ?? "";
  const versionLines = [...current.matchAll(/^应用版本：`([^`]+)`/gm)];
  if (versionLines.length !== 1) findings.push("Current status must declare exactly one application version.");
  for (const [source, version] of Object.entries(versions)) {
    if (!version || version !== versions.native) findings.push(`Version drift: ${source} must match native/package.json.`);
  }
  if (versionLines[0]?.[1] !== versions.native) findings.push("Current status application version differs from native/package.json.");
  if (site.version !== versions.native) findings.push("site/site.json version differs from native/package.json.");

  const requiredHistory = ["TASKBOOK", "QA", "RELEASE_HANDOFF"];
  for (const name of requiredHistory) {
    const filename = `docs/${name}.md`;
    const archive = `${name}_HISTORY.md`;
    if (!documents[filename]?.includes(archive)) findings.push(`${filename} must link its history archive.`);
    if (!documents[`docs/${archive}`]?.includes("MVP_STATUS.md")) findings.push(`${archive} must redirect current facts to MVP_STATUS.md.`);
  }
  for (const [filename, content] of Object.entries(documents)) {
    if (filename === "docs/MVP_STATUS.md" || filename.endsWith("_HISTORY.md")) continue;
    if (/^## 当前任务快照\s*$/m.test(content)) findings.push(`${filename} duplicates the current task snapshot.`);
  }
  if ([...current.matchAll(/^## 当前任务快照\s*$/gm)].length !== 1) findings.push("There must be exactly one current task snapshot.");
  const snapshot = current.split(/^## 当前任务快照\s*$/m)[1]?.split(/^## /m)[0];
  if (!snapshot) findings.push("Current status must have a current task snapshot.");
  else {
    const rows = snapshot.split(/\r?\n/).filter(line => /^\|/.test(line)).slice(2);
    const allowed = new Set(["planned", "active", "blocked", "completed", "cancelled", "superseded"]);
    const seen = new Set();
    if (!rows.length) findings.push("Current task snapshot must not be empty.");
    for (const row of rows) {
      const [, task, status] = row.split("|").map(cell => cell.trim());
      if (!allowed.has(status)) findings.push(`Current task ${task} has a non-current or invalid status.`);
      if (seen.has(task)) findings.push(`Duplicate current task: ${task}.`);
      seen.add(task);
      const id = /^(DOC-\d+)\b/.exec(task)?.[1];
      if (id && !new RegExp(`^### ${id} `, "m").test(taskbook)) findings.push(`Current task ${id} has no Taskbook definition.`);
    }
  }
  for (const heading of ["## 本轮工作窗口", "## 任务依赖关系", "## 任务定义"]) {
    if (!taskbook.includes(heading)) findings.push(`Taskbook missing ${heading}.`);
  }

  if (!/^\s*publish\s*=\s*"site\/dist"\s*$/m.test(netlify) ||
      !/^\s*command\s*=\s*"npm run site:build"\s*$/m.test(netlify)) {
    findings.push("Netlify must build the standalone introduction site, not the chat application.");
  }
  if (site.url) {
    try { if (new URL(site.url).protocol !== "https:") throw new Error(); }
    catch { findings.push("Introduction site URL must be HTTPS."); }
    if (!current.includes(site.url)) findings.push("Current status must reference the configured introduction URL.");
    if (!documents["README.md"]?.includes(site.url)) findings.push("Root README introduction URL differs from site/site.json.");
  }
  for (const platform of ["windows", "android"]) {
    const download = site.downloads?.[platform];
    if (!download?.url) continue;
    if (typeof download.file !== "string" || !download.file.includes(`-${site.version}-`)) findings.push(`${platform} filename version drift.`);
    if (!Number.isSafeInteger(download.size) || download.size <= 0 || !/^[a-f0-9]{64}$/i.test(download.sha256 ?? "")) {
      findings.push(`${platform} public download requires byte size and SHA-256.`);
    }
    try {
      const url = new URL(download.url);
      if (url.protocol !== "https:") throw new Error();
      const filename = decodeURIComponent(url.pathname.split("/").at(-1));
      if (filename !== download.file) findings.push(`${platform} URL and filename disagree.`);
      const tag = String(site.releaseTag ?? `v${site.version}`).replaceAll("{{version}}", site.version);
      if (url.hostname === "github.com" && !url.pathname.includes(`/releases/download/${tag}/`)) findings.push(`${platform} public Release tag version drift.`);
    } catch { findings.push(`${platform} download URL must be valid HTTPS.`); }
  }
  const web = site.downloads?.web;
  if (web?.url && web.url.replace(/\/$/, "") === site.url?.replace(/\/$/, "")) {
    findings.push("Introduction site must not be presented as the chat application URL.");
  }
  if (!web?.url && !current.includes("局域网") && !current.includes("同 Wi-Fi")) findings.push("Current status must explain the unpublished Web application boundary.");
  return findings;
}

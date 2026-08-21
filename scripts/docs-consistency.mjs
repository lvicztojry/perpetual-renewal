import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize, sep } from "node:path";
import process from "node:process";

const findings = [];
const files = readCommittableFiles();
const docsAndReadmes = files.filter(
  (file) =>
    file === "README.md" ||
    file.startsWith(`docs${sep}`) ||
    file.startsWith("docs/") ||
    file === join(".github", "pull_request_template.md") ||
    file === ".github/pull_request_template.md"
);

checkDocsText(docsAndReadmes);
checkVolatileReleaseStateWording(docsAndReadmes);
checkMarkdownLinks(docsAndReadmes);
checkDocumentedNpmScripts(docsAndReadmes);
checkMigrationContexts(docsAndReadmes);
checkPackageJson();
checkEnvExample();
checkCi();
checkDeploymentDocs();
checkPrdScopeSync();
checkReleaseHandoff();
checkTaskbookDecisions();
checkTaskbookStatusSync();

if (findings.length > 0) {
  console.error("Documentation consistency check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Documentation consistency check passed for ${docsAndReadmes.length} docs/readme files.`
);

function checkDocsText(targetFiles) {
  for (const file of targetFiles) {
    const content = readText(file);
    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const location = `${file}:${index + 1}`;
      if (line.includes("npm install")) {
        findings.push(`${location} uses npm install; use npm ci for this lockfile-backed app.`);
      }

      if (/\b(?:46|48|49|57|63|69) checks\b/i.test(line)) {
        findings.push(`${location} mentions an outdated smoke check count; current baseline is 70 checks.`);
      }

      if (/\b2 tests\b/i.test(line) && !line.includes("M48")) {
        findings.push(`${location} mentions an outdated E2E test count; current baseline is 6 tests.`);
      }

      if (/14 safety areas/i.test(line) || /14 类安全/.test(line)) {
        findings.push(`${location} mentions outdated safety coverage; current baseline is 19 safety areas.`);
      }

      if (line.includes("npm audit --audit-level=high")) {
        findings.push(
          `${location} uses bare npm audit; use npm --cache .\\.npm-cache audit --audit-level=high.`
        );
      }
    });
  }
}

function checkVolatileReleaseStateWording(targetFiles) {
  const releaseFiles = new Set([
    "README.md",
    join("docs", "MVP_STATUS.md"),
    "docs/MVP_STATUS.md",
    join("docs", "RELEASE_HANDOFF.md"),
    "docs/RELEASE_HANDOFF.md",
    join("docs", "PR_DRAFT.md"),
    "docs/PR_DRAFT.md",
    join(".github", "pull_request_template.md"),
    ".github/pull_request_template.md"
  ]);

  const volatilePatterns = [
    {
      pattern: /分支已\s*push/i,
      message: "hard-codes that the branch has already been pushed"
    },
    {
      pattern: /^\s*Push status:\s*$/i,
      message: "hard-codes a push status heading; document the push command/check instead"
    },
    {
      pattern: /codex\/mvp-release-candidate\s*->\s*origin\/codex\/mvp-release-candidate/i,
      message: "hard-codes a branch-to-origin push result"
    }
  ];

  for (const file of targetFiles) {
    if (!releaseFiles.has(file)) {
      continue;
    }

    const content = readText(file);
    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const { pattern, message } of volatilePatterns) {
        if (pattern.test(line)) {
          findings.push(
            `${file}:${index + 1} ${message}; use git status --short --branch for live ahead/push state.`
          );
        }
      }
    });
  }
}

function checkMarkdownLinks(targetFiles) {
  const linkPattern = /(?<!!)\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

  for (const file of targetFiles) {
    const content = readText(file);
    if (!content) {
      continue;
    }

    for (const match of content.matchAll(linkPattern)) {
      const rawTarget = match[1]?.trim();
      if (!rawTarget || shouldSkipMarkdownLink(rawTarget)) {
        continue;
      }

      const targetPath = decodeURIComponent(rawTarget.split("#")[0] ?? "").trim();
      if (!targetPath) {
        continue;
      }

      const resolved = normalize(join(dirname(file), targetPath));
      if (!existsSync(resolved)) {
        findings.push(`${file} links to missing local file: ${rawTarget}`);
      }
    }
  }
}

function checkDocumentedNpmScripts(targetFiles) {
  const packageJson = parseJsonFile("package.json");
  if (!packageJson) {
    return;
  }

  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  const commandPattern = /\bnpm\s+run\s+([A-Za-z0-9:_-]+)/g;

  for (const file of targetFiles) {
    const content = readText(file);
    if (!content) {
      continue;
    }

    for (const match of content.matchAll(commandPattern)) {
      const scriptName = match[1];
      if (!scripts.has(scriptName)) {
        findings.push(`${file} documents missing package script: npm run ${scriptName}`);
      }
    }
  }
}

function shouldSkipMarkdownLink(target) {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(target) ||
    target.startsWith("#") ||
    target.startsWith("<") ||
    target.includes("://")
  );
}

function checkMigrationContexts(targetFiles) {
  const localContextPattern = /本地|开发|local|development/i;
  const productionContextPattern = /生产|上线|preview|production|vercel|目标数据库|deployment/i;

  for (const file of targetFiles) {
    const content = readText(file);
    if (!content) {
      continue;
    }

    const lines = content.split(/\r?\n/);
    lines.forEach((line, index) => {
      const usesDevMigration =
        (line.includes("npm run prisma:migrate") && !line.includes("prisma:migrate:deploy")) ||
        line.includes("prisma migrate dev");

      if (!usesDevMigration) {
        return;
      }

      if (/不要使用|不要用|不应使用|do not use|don't use|not use/i.test(line)) {
        return;
      }

      const context = lines
        .slice(Math.max(0, index - 8), Math.min(lines.length, index + 9))
        .join("\n");

      if (productionContextPattern.test(context) && !context.includes("prisma:migrate:deploy")) {
        findings.push(
          `${file}:${index + 1} uses dev migration near production wording; use npm run prisma:migrate:deploy for preview/production targets.`
        );
        return;
      }

      if (!localContextPattern.test(context)) {
        findings.push(
          `${file}:${index + 1} uses npm run prisma:migrate without a nearby local/development qualifier.`
        );
      }
    });
  }
}

function checkPackageJson() {
  const packageJson = parseJsonFile("package.json");
  if (!packageJson) {
    return;
  }

  const scripts = packageJson.scripts ?? {};
  expectEqual(scripts["prisma:migrate"], "prisma migrate dev", "package.json scripts.prisma:migrate");
  expectEqual(
    scripts["prisma:migrate:deploy"],
    "prisma migrate deploy",
    "package.json scripts.prisma:migrate:deploy"
  );
  expectEqual(scripts["docs:check"], "node scripts/docs-consistency.mjs", "package.json scripts.docs:check");
  expectEqual(scripts["qa:imports"], "node tests/structured-import-smoke.mjs", "package.json scripts.qa:imports");
  expectEqual(scripts["qa:vault"], "node tests/config-vault-security.mjs", "package.json scripts.qa:vault");
  expectEqual(scripts["pwa:check"], "node scripts/pwa-check.mjs", "package.json scripts.pwa:check");
  expectEqual(scripts["git:boundary"], "node scripts/git-boundary-check.mjs", "package.json scripts.git:boundary");
  expectEqual(scripts["next:typegen"], "node scripts/next-typegen.mjs", "package.json scripts.next:typegen");
  expectEqual(
    scripts["typecheck"],
    "npm run next:typegen && tsc --noEmit",
    "package.json scripts.typecheck"
  );
  expectEqual(
    scripts["verify:pr"],
    "npm run verify:local -- --skip-e2e",
    "package.json scripts.verify:pr"
  );
  expectEqual(
    scripts["verify:deploy"],
    "npm run env:readiness -- --strict && npm run prisma:validate && npm run db:smoke",
    "package.json scripts.verify:deploy"
  );

  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
      if (version === "latest") {
        findings.push(`package.json ${section}.${name} still uses latest; pin it to the lockfile version.`);
      }
    }
  }
}

function checkEnvExample() {
  const content = readText(".env.example");
  if (!content) {
    findings.push(".env.example is missing.");
    return;
  }

  const databaseLine = content
    .split(/\r?\n/)
    .find((line) => line.trim().startsWith("DATABASE_URL="));
  if (!databaseLine) {
    findings.push(".env.example is missing DATABASE_URL.");
    return;
  }

  if (!/^DATABASE_URL\s*=\s*""\s*$/.test(databaseLine.trim())) {
    findings.push('.env.example DATABASE_URL should stay empty: DATABASE_URL="".');
  }
}

function checkCi() {
  const content = readText(join(".github", "workflows", "ci.yml"));
  if (!content) {
    findings.push(".github/workflows/ci.yml is missing.");
    return;
  }

  for (const required of [
    "npm ci",
    "npm run secrets:check",
    "npm run docs:check",
    "npm run git:boundary",
    "npm run qa:imports",
    "npm run qa:vault",
    "npm run pwa:check",
    "npm run env:readiness",
    "npm run db:smoke"
  ]) {
    if (!content.includes(required)) {
      findings.push(`.github/workflows/ci.yml should include ${required}.`);
    }
  }
}

function checkReleaseHandoff() {
  const requiredFiles = [".github/pull_request_template.md", "docs/RELEASE_HANDOFF.md"];
  for (const file of requiredFiles) {
    if (!readText(file)) {
      findings.push(`${file} is missing.`);
    }
  }

  const handoff = readText("docs/RELEASE_HANDOFF.md") ?? "";
  for (const snippet of [
    "M51",
    "M52",
    "M53",
    "M54",
    "M55",
    "M56",
    "M57",
    "M58",
    "M59",
    "M60",
    "M61",
    "M62",
    "M63",
    "M64",
    "M65",
    "d7a72f2",
    "sync taskbook status gates",
    "70 checks",
    "19 safety areas"
  ]) {
    if (!handoff.includes(snippet)) {
      findings.push(`docs/RELEASE_HANDOFF.md should mention ${snippet}.`);
    }
  }
}

function checkTaskbookDecisions() {
  const taskbook = readText("docs/TASKBOOK.md") ?? "";
  const staleDecisionSnippets = [
    "技术栈：是否采用 Next.js 全栈方案",
    "模型：第一版接入哪个 LLM 供应商",
    "数据库：是否优先 PostgreSQL",
    "部署：是否先用单机/云托管快速上线",
    "现实替代素材：第一版是否允许少量手动语气样例",
    "沉浸边界：创建页、设置页和高风险场景分别怎样表达 AI 能力边界",
    "后续需由账号/session 模块把真实 userId 接入 renewal API"
  ];

  for (const snippet of staleDecisionSnippets) {
    if (taskbook.includes(snippet)) {
      findings.push(`docs/TASKBOOK.md still contains stale decision point: ${snippet}`);
    }
  }

  for (const snippet of ["已决策基线", "仍需用户决策", "M54 施工决策点收束", "M55 Session 接入状态收束"]) {
    if (!taskbook.includes(snippet)) {
      findings.push(`docs/TASKBOOK.md should mention ${snippet}.`);
    }
  }

  for (const snippet of [
    "M56 Taskbook 状态门禁",
    "M56 当前落点",
    "M57 账号删除",
    "M58 移动端 PWA",
    "M59 多媒体/照片/通讯录导入",
    "M60 PRD 范围回写门禁",
    "M61 接口输入与导入兼容护栏",
    "M62 密钥与发布门禁加固",
    "M63 文档命令/链接门禁",
    "M64 结构化导入与 vault QA",
    "M65 导出隐私、DB credential 和设置页 E2E 硬化",
    "sync taskbook status gates"
  ]) {
    if (!taskbook.includes(snippet)) {
      findings.push(`docs/TASKBOOK.md should mention ${snippet}.`);
    }
  }
}

function checkTaskbookStatusSync() {
  const taskbook = readText("docs/TASKBOOK.md") ?? "";
  const expectedStatuses = new Map([
    ["PM-1 全关系范围确认", "completed"],
    ["PM-2 原型与信息架构", "integrated"],
    ["DEV-3 关系对象创建", "integrated"],
    ["DEV-4 聊天消息闭环", "integrated"],
    ["DEV-5 LLM 适配层", "integrated"],
    ["DEV-11 安全策略接入", "integrated"]
  ]);

  const sections = parseTaskbookDefinitionStatuses(taskbook);
  for (const [taskName, expectedStatus] of expectedStatuses.entries()) {
    const actualStatus = sections.get(taskName);
    if (!actualStatus) {
      findings.push(`docs/TASKBOOK.md is missing task definition status for ${taskName}.`);
      continue;
    }

    if (actualStatus !== expectedStatus) {
      findings.push(
        `docs/TASKBOOK.md task definition ${taskName} status should be ${expectedStatus}; found ${actualStatus}.`
      );
    }
  }
}

function parseTaskbookDefinitionStatuses(taskbook) {
  const sections = new Map();
  const lines = taskbook.split(/\r?\n/);
  let currentTask = null;

  for (const line of lines) {
    const heading = /^###\s+(.+)$/.exec(line.trim());
    if (heading) {
      currentTask = heading[1];
      continue;
    }

    const status = /^状态：(.+)$/.exec(line.trim());
    if (currentTask && status) {
      sections.set(currentTask, status[1].trim());
    }
  }

  return sections;
}

function checkDeploymentDocs() {
  const requiredSnippets = [
    ["docs/DEPLOYMENT.md", "npm run prisma:migrate:deploy"],
    ["docs/DATABASE.md", "npm run prisma:migrate:deploy"],
    ["docs/QA.md", "npm run prisma:migrate:deploy"],
    ["docs/MVP_STATUS.md", "70 checks"],
    ["docs/MVP_STATUS.md", "19 safety areas"],
    ["docs/MVP_STATUS.md", "npm run db:smoke"],
    ["docs/MVP_STATUS.md", "npm run verify:deploy"],
    ["docs/MVP_STATUS.md", "npm run qa:imports"],
    ["docs/MVP_STATUS.md", "npm run qa:vault"],
    ["docs/MVP_STATUS.md", "npm run pwa:check"],
    ["docs/MVP_STATUS.md", "M51"],
    ["docs/MVP_STATUS.md", "M52"],
    ["docs/MVP_STATUS.md", "M53"],
    ["docs/MVP_STATUS.md", "M54"],
    ["docs/MVP_STATUS.md", "M55"],
    ["docs/MVP_STATUS.md", "M56"],
    ["docs/MVP_STATUS.md", "M57"],
    ["docs/MVP_STATUS.md", "M58"],
    ["docs/MVP_STATUS.md", "M59"],
    ["docs/MVP_STATUS.md", "M60"],
    ["docs/MVP_STATUS.md", "M61"],
    ["docs/MVP_STATUS.md", "M62"],
    ["docs/MVP_STATUS.md", "M63"],
    ["docs/MVP_STATUS.md", "M64"],
    ["docs/MVP_STATUS.md", "M65"],
    ["docs/PHASE-1.5.md", "70 checks"],
    ["README.md", "npm run db:smoke"]
  ];

  for (const [file, snippet] of requiredSnippets) {
    const content = readText(file);
    if (!content?.includes(snippet)) {
      findings.push(`${file} should mention ${snippet}.`);
    }
  }
}

function checkPrdScopeSync() {
  const prd = readText("docs/PRD.md") ?? "";
  const staleSnippets = [
    "批量导入聊天记录、照片、通讯录、社交平台资料等能力作为独立模块后续开发",
    "第一版预留语音消息和语音回复能力",
    "MVP 不做自动批量导入聊天记录、照片、通讯录等现实人物素材",
    "现实人物替代的素材输入第一版做到什么程度",
    "第一版是否做本地模型支持？建议架构预留，但先接一个主模型供应商"
  ];

  for (const snippet of staleSnippets) {
    if (prd.includes(snippet)) {
      findings.push(`docs/PRD.md still contains stale MVP scope wording: ${snippet}`);
    }
  }

  for (const snippet of [
    "# 生生不息 PRD v0.3",
    "用户自带模型 API key",
    "媒体、照片、音视频文件只在浏览器本地整理为文件说明或用户补充描述",
    "通讯录只在浏览器本地整理为脱敏摘要",
    "VOICE_PROVIDER=shared-llm",
    "响应式/PWA",
    "已决策基线与仍需外部配置"
  ]) {
    if (!prd.includes(snippet)) {
      findings.push(`docs/PRD.md should mention ${snippet}.`);
    }
  }
}

function readCommittableFiles() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith("node_modules/") && !file.startsWith(".next/"));
}

function readText(file) {
  if (!existsSync(file)) {
    return null;
  }
  return readFileSync(file, "utf8");
}

function parseJsonFile(file) {
  const content = readText(file);
  if (!content) {
    findings.push(`${file} is missing.`);
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    findings.push(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    findings.push(`${label} should be ${JSON.stringify(expected)}.`);
  }
}

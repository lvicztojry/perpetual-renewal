import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
const qaMetrics = readQaMetrics();
const smokeMetrics = readSmokeMetrics(qaMetrics);
const e2eMetrics = readE2eMetrics();
const taskbookMilestones = readTaskbookMilestones();
const verifyLocalScripts = readVerifyLocalBaseScripts();

checkDocsText(docsAndReadmes);
checkVolatileReleaseStateWording(docsAndReadmes);
checkReleaseSyncWording();
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
checkReleaseMilestoneSync();
checkVerificationCommandSync();
checkProactiveSchedulerDocs();

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

      for (const snippet of staleDocumentationSnippets()) {
        if (line.includes(snippet)) {
          findings.push(`${location} contains stale documentation wording: ${snippet}.`);
        }
      }

      checkDerivedCount(
        location,
        line,
        /\b(\d+)\s+checks\b/i,
        smokeMetrics.checkCount,
        "smoke check count",
        { allowHistoricalMilestone: true }
      );

      checkDerivedCount(
        location,
        line,
        /\b(\d+)\s+tests\b/i,
        e2eMetrics.testCount,
        "E2E test count",
        { allowHistoricalMilestone: true }
      );

      checkDerivedCount(
        location,
        line,
        /\b(\d+)\s+safety areas\b/i,
        qaMetrics.safetyAreaCount,
        "safety area count"
      );

      checkDerivedCount(
        location,
        line,
        /(\d+)\s+类关系/,
        qaMetrics.relationshipKindCount,
        "relationship kind count"
      );

      checkDerivedCount(
        location,
        line,
        /(\d+)\s+relationship kinds/i,
        qaMetrics.relationshipKindCount,
        "relationship kind count"
      );

      checkDerivedCount(
        location,
        line,
        /(\d+)\s+条安全(?:\/越界\/允许回归)?样例/,
        qaMetrics.safetyCaseCount,
        "safety sample count"
      );

      checkDerivedCount(
        location,
        line,
        /当前\s+(\d+)\s+条安全边界/,
        qaMetrics.safetyCaseCount,
        "safety sample count"
      );

      if (line.includes("npm audit --audit-level=high")) {
        findings.push(
          `${location} uses bare npm audit; use npm --cache .\\.npm-cache audit --audit-level=high.`
        );
      }

      if (line.includes("randomBytes(48)")) {
        findings.push(`${location} uses manual secret generation; use npm run env:secrets.`);
      }
    });
  }
}

function staleDocumentationSnippets() {
  return [
    "当前还没有真实 `DATABASE_URL`、LLM key 或模型名",
    "只返回 provider、model、baseUrl、key 尾号和指纹",
    "服务端只返回 key 尾号与指纹",
    "服务端只返回 key 尾号和指纹",
    "已保存 key 后可只更新 provider/baseUrl/model",
    "已保存 key 后可只修改 provider、baseUrl 或 model",
    "供后续调度器接入",
    "供后续后台调度模块读取",
    "供后续调度模块读取",
    "当前 API 是非流式草案",
    "DEV-4 聊天闭环可先接它",
    "remaining user decisions",
    "Follow-up Decisions"
  ];
}

function checkReleaseSyncWording() {
  const releaseFiles = ["README.md", ".github/pull_request_template.md", "docs/MVP_STATUS.md", "docs/RELEASE_HANDOFF.md"];

  for (const file of releaseFiles) {
    const content = readText(file);
    if (!content) {
      findings.push(`${file} is missing.`);
      continue;
    }

    if (/^\s*-\s*Baseline(?: commit)?[:：]\s*`ef4939e feat: build relationship ai mvp baseline`/im.test(content)) {
      findings.push(
        `${file} labels ef4939e as the current baseline; call it the initial baseline and use live git status/log for the current synced commit.`
      );
    }
  }

  const requiredSnippets = [
    ["README.md", "git log -1 --oneline"],
    [".github/pull_request_template.md", "Initial baseline commit"],
    ["docs/MVP_STATUS.md", "首个 baseline"],
    ["docs/RELEASE_HANDOFF.md", "Current branch tip"]
  ];

  for (const [file, snippet] of requiredSnippets) {
    const content = readText(file) ?? "";
    if (!content.includes(snippet)) {
      findings.push(`${file} should document release sync wording: ${snippet}.`);
    }
  }
}

function checkDerivedCount(location, line, pattern, expected, label, options = {}) {
  if (typeof expected !== "number" || expected <= 0) {
    return;
  }

  const match = pattern.exec(line);
  if (!match) {
    return;
  }

  const actual = Number(match[1]);
  if (actual === expected) {
    return;
  }

  if (/至少|at least/i.test(line) && actual <= expected) {
    return;
  }

  if (options.allowHistoricalMilestone && /M\d+/.test(line) && !/当前|current|baseline|基线/i.test(line)) {
    return;
  }

  findings.push(
    `${location} mentions ${label} as ${actual}; current derived baseline is ${expected}.`
  );
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
  expectEqual(
    scripts["prisma:migrate"],
    "node scripts/prisma-command.mjs migrate dev",
    "package.json scripts.prisma:migrate"
  );
  expectEqual(
    scripts["prisma:migrate:deploy"],
    "node scripts/prisma-command.mjs migrate deploy",
    "package.json scripts.prisma:migrate:deploy"
  );
  expectEqual(scripts["docs:check"], "node scripts/docs-consistency.mjs", "package.json scripts.docs:check");
  expectEqual(scripts["qa:imports"], "node tests/structured-import-smoke.mjs", "package.json scripts.qa:imports");
  expectEqual(scripts["qa:vault"], "node tests/config-vault-security.mjs", "package.json scripts.qa:vault");
  expectEqual(scripts["qa:logging"], "node tests/logging-sanitize-smoke.mjs", "package.json scripts.qa:logging");
  expectEqual(scripts["qa:response"], "node tests/response-safety-smoke.mjs", "package.json scripts.qa:response");
  expectEqual(scripts["qa:providers"], "node tests/provider-adapters-smoke.mjs", "package.json scripts.qa:providers");
  expectEqual(scripts["qa:proactive-cron"], "node tests/proactive-cron-contract.mjs", "package.json scripts.qa:proactive-cron");
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
    "npm run env:readiness -- --strict && npm run qa:proactive-cron && npm run prisma:validate && npm run db:smoke",
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

  const requiredEmptyEnv = [
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "USER_KEY_VAULT_SECRET",
    "SESSION_COOKIE_SECRET",
    "PROACTIVE_CRON_SECRET",
    "CRON_SECRET"
  ];

  for (const envName of requiredEmptyEnv) {
    const line = content
      .split(/\r?\n/)
      .find((item) => item.trim().startsWith(`${envName}=`));
    if (!line) {
      findings.push(`.env.example is missing ${envName}.`);
      continue;
    }

    if (!new RegExp(`^${envName}\\s*=\\s*""\\s*$`).test(line.trim())) {
      findings.push(`.env.example ${envName} should stay empty: ${envName}="".`);
    }
  }
}

function checkCi() {
  const content = readText(join(".github", "workflows", "ci.yml"));
  if (!content) {
    findings.push(".github/workflows/ci.yml is missing.");
    return;
  }

  for (const required of ["npm ci", ...verifyLocalScripts.map((script) => `npm run ${script}`)]) {
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
    "Current branch tip",
    "git log -1 --oneline",
    "Initial baseline commit",
    `${smokeMetrics.checkCount} checks`,
    `${qaMetrics.safetyAreaCount} safety areas`
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
    "后续需由账号/session 模块把真实 userId 接入 renewal API",
    "是否在本轮继续进入内容审核后台、用户反馈问卷和内测邀请机制"
  ];

  for (const snippet of staleDecisionSnippets) {
    if (taskbook.includes(snippet)) {
      findings.push(`docs/TASKBOOK.md still contains stale decision point: ${snippet}`);
    }
  }

  for (const snippet of ["已决策基线", "仍需外部配置", "已决策暂缓项", "M54 施工决策点收束", "M55 Session 接入状态收束"]) {
    if (!taskbook.includes(snippet)) {
      findings.push(`docs/TASKBOOK.md should mention ${snippet}.`);
    }
  }

  for (const snippet of ["sync taskbook status gates"]) {
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
    ["docs/MVP_STATUS.md", `${smokeMetrics.checkCount} checks`],
    ["docs/MVP_STATUS.md", `${qaMetrics.safetyAreaCount} safety areas`],
    ["docs/MVP_STATUS.md", "npm run db:smoke"],
    ["docs/MVP_STATUS.md", "npm run verify:deploy"],
    ["docs/MVP_STATUS.md", "npm run qa:imports"],
    ["docs/MVP_STATUS.md", "npm run qa:vault"],
    ["docs/MVP_STATUS.md", "npm run qa:logging"],
    ["docs/MVP_STATUS.md", "npm run qa:response"],
    ["docs/MVP_STATUS.md", "npm run qa:proactive-cron"],
    ["docs/MVP_STATUS.md", "npm run pwa:check"],
    ["docs/MVP_STATUS.md", `M${taskbookMilestones.latestNumber}`],
    ["docs/MVP_STATUS.md", "session 签名来源"],
    ["docs/PHASE-1.5.md", `${smokeMetrics.checkCount} checks`],
    ["README.md", "npm run db:smoke"],
    ["README.md", "session 签名"],
    ["docs/README.md", "SESSION_COOKIE_SECRET"],
    ["docs/PRD.md", "SESSION_COOKIE_SECRET"],
    ["docs/PRIVACY.md", "SESSION_COOKIE_SECRET"],
    ["docs/QA.md", "session 签名 secret"],
    ["docs/QA.md", "session_cookie_secret"],
    ["docs/RELEASE_ACCEPTANCE.md", "session 签名 secret"],
    ["docs/PRE_COMMIT_CHECKLIST.md", "SESSION_COOKIE_SECRET"],
    [".github/pull_request_template.md", "SESSION_COOKIE_SECRET"],
    ["docs/PR_DRAFT.md", "LLM_PROVIDER=compatible"],
    ["docs/PR_DRAFT.md", "LLM_BASE_URL=https://api.tryanotherone.com/v1"],
    ["docs/PR_DRAFT.md", "SESSION_COOKIE_SECRET"],
    ["docs/PR_DRAFT.md", "VOICE_PROVIDER=shared-llm"],
    ["docs/PR_DRAFT.md", "user vault"],
    ["docs/LLM.md", "端点是否已配置和端点指纹"],
    ["docs/LLM.md", "不返回 key 原文、Base URL 明文或 `baseUrl` 字段"],
    ["docs/MVP_STATUS.md", "用户自带 API key"],
    ["docs/MVP_STATUS.md", "VOICE_PROVIDER=shared-llm"],
    ["docs/DEPLOYMENT.md", "https://api.tryanotherone.com/v1"],
    ["docs/DEPLOYMENT.md", "VOICE_PROVIDER=shared-llm"],
    ["docs/DEPLOYMENT.md", "SESSION_COOKIE_SECRET"],
    ["docs/RELEASE_HANDOFF.md", "VOICE_PROVIDER=shared-llm"]
  ];

  for (const [file, snippet] of requiredSnippets) {
    const content = readText(file);
    if (!content?.includes(snippet)) {
      findings.push(`${file} should mention ${snippet}.`);
    }
  }
}

function checkReleaseMilestoneSync() {
  if (!taskbookMilestones.latestNumber) {
    findings.push("docs/TASKBOOK.md has no integrated M milestone rows to use as release source of truth.");
    return;
  }

  const latest = taskbookMilestones.latestNumber;
  const mvp = readText("docs/MVP_STATUS.md") ?? "";
  const handoff = readText("docs/RELEASE_HANDOFF.md") ?? "";

  if (!mvp.includes(`M${latest}`)) {
    findings.push(`docs/MVP_STATUS.md should mention latest integrated Taskbook milestone M${latest}.`);
  }

  if (!handoff.includes(`M${latest}`)) {
    findings.push(`docs/RELEASE_HANDOFF.md should mention latest integrated Taskbook milestone M${latest}.`);
  }

  const handoffScopeMilestones = collectMilestoneNumbers(handoff, /-\s+M(\d+)\s+scope:/g);
  if (handoffScopeMilestones.length > 0) {
    assertConsecutiveMilestones(handoffScopeMilestones, "docs/RELEASE_HANDOFF.md scope milestone list");
    const handoffLatest = Math.max(...handoffScopeMilestones);
    if (handoffLatest !== latest) {
      findings.push(
        `docs/RELEASE_HANDOFF.md latest scope milestone should be M${latest}; found M${handoffLatest}.`
      );
    }
  }

  const mvpQueueMilestones = collectMilestoneNumbers(mvp, /^-\s+M(\d+)\s+/gm);
  if (mvpQueueMilestones.length > 0) {
    assertConsecutiveMilestones(mvpQueueMilestones, "docs/MVP_STATUS.md construction queue milestone list");
    const mvpLatest = Math.max(...mvpQueueMilestones);
    if (mvpLatest !== latest) {
      findings.push(`docs/MVP_STATUS.md latest construction queue milestone should be M${latest}; found M${mvpLatest}.`);
    }
  }
}

function checkVerificationCommandSync() {
  const ci = readText(join(".github", "workflows", "ci.yml")) ?? "";
  const release = readText("docs/RELEASE_HANDOFF.md") ?? "";

  const ciCommands = collectCiRunCommands(ci);
  for (const script of verifyLocalScripts) {
    const command = `npm run ${script}`;
    if (!ciCommands.includes(command)) {
      findings.push(`.github/workflows/ci.yml is missing verify-local base command: ${command}.`);
    }
    if (!release.includes(command)) {
      findings.push(`docs/RELEASE_HANDOFF.md CI expectations should include ${command}.`);
    }
  }

  for (const command of ciCommands.filter((item) => item.startsWith("npm run "))) {
    if (!release.includes(command)) {
      findings.push(`docs/RELEASE_HANDOFF.md CI expectations should include workflow command: ${command}.`);
    }
  }
}

function checkProactiveSchedulerDocs() {
  const staleSnippets = [
    ["docs/ARCHITECTURE.md", "应用内定时任务起步"],
    ["docs/ARCHITECTURE.md", "后续迁移队列"],
    ["docs/ARCHITECTURE.md", "后续后台调度模块"],
    ["docs/ARCHITECTURE.md", "后续调度模块"],
    ["docs/ARCHITECTURE.md", "应用进程内常驻后台定时器"],
    ["docs/DEPLOYMENT.md", "应用内定时任务起步"],
    ["docs/DEPLOYMENT.md", "后续迁移队列"],
    ["docs/DEPLOYMENT.md", "后续后台调度模块"],
    ["docs/DEPLOYMENT.md", "后续调度模块"],
    ["docs/DEPLOYMENT.md", "仓库已包含 `vercel.json`"],
    ["docs/TASKBOOK.md", "供后续后台调度模块"],
    ["docs/TASKBOOK.md", "供后续调度模块"],
    ["docs/DEPLOYMENT.md", "应用进程内常驻后台定时器"],
    ["docs/RELEASE_HANDOFF.md", "`vercel.json` minute cadence"],
    ["docs/RELEASE_HANDOFF.md", "`vercel.json` wires the protected proactive scheduler path"]
  ];

  for (const [file, snippet] of staleSnippets) {
    const content = readText(file) ?? "";
    if (content.includes(snippet)) {
      findings.push(`${file} contains stale proactive scheduler wording: ${snippet}.`);
    }
  }

  const requiredSnippets = [
    ["docs/ARCHITECTURE.md", "POST /api/proactive/run"],
    ["docs/ARCHITECTURE.md", "PROACTIVE_CRON_SECRET"],
    ["docs/ARCHITECTURE.md", "Vercel Cron"],
    ["docs/ARCHITECTURE.md", "应用进程内不常驻调度器"],
    ["docs/DEPLOYMENT.md", "POST /api/proactive/run"],
    ["docs/DEPLOYMENT.md", "GET /api/proactive/run"],
    ["docs/DEPLOYMENT.md", "PROACTIVE_CRON_SECRET"],
    ["docs/DEPLOYMENT.md", "CRON_SECRET"],
    ["docs/DEPLOYMENT.md", "Vercel Cron"],
    ["docs/DEPLOYMENT.md", "GitHub Actions scheduled workflow"],
    ["docs/DEPLOYMENT.md", "应用进程内不常驻调度器"]
  ];

  for (const [file, snippet] of requiredSnippets) {
    const content = readText(file) ?? "";
    if (!content.includes(snippet)) {
      findings.push(`${file} should document proactive scheduler boundary: ${snippet}.`);
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

function readQaMetrics() {
  const samples = parseJsonFile("tests/qa-samples.json");
  if (!samples) {
    return {
      relationshipKindCount: 0,
      safetyCaseCount: 0,
      safetySmokeCaseCount: 0,
      safetyAreaCount: 0
    };
  }

  const relationshipKinds = new Set(
    (samples.relationshipCases ?? [])
      .map((item) => item.relationshipKind ?? item.kind)
      .filter(Boolean)
  );
  const safetyCases = samples.safetyCases ?? [];
  const safetyAreas = new Set(safetyCases.map((item) => item.riskArea).filter(Boolean));

  return {
    relationshipKindCount: relationshipKinds.size,
    safetyCaseCount: safetyCases.length,
    safetySmokeCaseCount: safetyCases.filter((item) => item.endpointSmoke !== false).length,
    safetyAreaCount: safetyAreas.size
  };
}

function readSmokeMetrics(metrics) {
  const content = readText("tests/smoke.mjs") ?? "";
  const literalPassCount = [
    ...content.matchAll(/\bpass\(\s*(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*\)/g)
  ].length;
  const safetyLoopCount = /\bpass\(\s*`POST \/api\/safety\/check \$\{safetyCase\.id\}`\s*\)/.test(content)
    ? metrics.safetySmokeCaseCount
    : 0;

  return {
    checkCount: literalPassCount + safetyLoopCount,
    literalPassCount,
    safetyLoopCount
  };
}

function readE2eMetrics() {
  const dir = join("tests", "e2e");
  if (!existsSync(dir)) {
    findings.push("tests/e2e directory is missing.");
    return { testCount: 0 };
  }

  const testCount = readdirSync(dir)
    .filter((file) => file.endsWith(".spec.ts"))
    .map((file) => readText(join(dir, file)) ?? "")
    .reduce(
      (count, content) =>
        count + [...content.matchAll(/^\s*test(?:\.(?:only|skip|fixme))?\s*\(/gm)].length,
      0
    );

  return { testCount };
}

function readTaskbookMilestones() {
  const taskbook = readText("docs/TASKBOOK.md") ?? "";
  const milestones = [];
  const rowPattern = /^\|\s*M(\d+)\s+[^|]+\|\s*integrated\s*\|/gm;

  for (const match of taskbook.matchAll(rowPattern)) {
    milestones.push(Number(match[1]));
  }

  const uniqueNumbers = [...new Set(milestones)].sort((a, b) => a - b);
  return {
    numbers: uniqueNumbers,
    latestNumber: uniqueNumbers.at(-1) ?? 0
  };
}

function readVerifyLocalBaseScripts() {
  const content = readText(join("scripts", "verify-local.mjs")) ?? "";
  const baseStepsSource = content.split("if (!skipE2e)")[0] ?? content;
  const scripts = [];

  for (const match of baseStepsSource.matchAll(/\[\s*["']run["']\s*,\s*["']([^"']+)["']\s*\]/g)) {
    scripts.push(match[1]);
  }

  return [...new Set(scripts)];
}

function collectCiRunCommands(content) {
  return [...content.matchAll(/^\s*run:\s*(.+)$/gm)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function collectMilestoneNumbers(content, pattern) {
  return [...content.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isInteger(number));
}

function assertConsecutiveMilestones(numbers, label) {
  const uniqueNumbers = [...new Set(numbers)].sort((a, b) => a - b);
  for (let index = 1; index < uniqueNumbers.length; index += 1) {
    const previous = uniqueNumbers[index - 1];
    const current = uniqueNumbers[index];
    if (current !== previous + 1) {
      findings.push(`${label} should be consecutive; found gap between M${previous} and M${current}.`);
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

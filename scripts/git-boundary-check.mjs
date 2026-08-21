import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const forbiddenPathPatterns = [
  /^\.env$/i,
  /^\.env\.local$/i,
  /^\.env\..*\.local$/i,
  /^\.next\//i,
  /^\.npm-cache\//i,
  /^node_modules\//i,
  /^test-results\//i,
  /^coverage\//i,
  /^dist\//i,
  /^prisma\/dev\.db$/i,
  /(^|\/).*\.log$/i,
  /(^|\/).*\.tsbuildinfo$/i
];

const requiredProjectFiles = [
  ".env.example",
  ".gitignore",
  ".github/workflows/ci.yml",
  "README.md",
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "tsconfig.json",
  "eslint.config.mjs",
  "playwright.config.ts",
  "next-env.d.ts",
  "prisma/schema.prisma",
  "scripts/check-env-leaks.mjs",
  "scripts/docs-consistency.mjs",
  "scripts/git-boundary-check.mjs",
  "scripts/next-typegen.mjs",
  "src/lib/logging/sanitize.ts",
  "src/app/page.tsx",
  "tests/smoke.mjs",
  "docs/TASKBOOK.md",
  "docs/MVP_STATUS.md"
];

const findings = [];

checkWorkspaceRoot();

const trackedFiles = readGitFiles(["ls-files"]);
const committableFiles = readGitFiles(["ls-files", "--cached", "--others", "--exclude-standard"]);

checkForbiddenFiles("tracked", trackedFiles);
checkForbiddenFiles("committable", committableFiles);
checkRequiredFiles(committableFiles);
checkNextEnvTypeImports();
checkRuntimeSourceBoundaries(committableFiles);
checkRuntimeLoggingBoundaries(committableFiles);
checkApiPrivacyBoundaries(committableFiles);

if (findings.length > 0) {
  console.error("Git boundary check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(
  `Git boundary check passed: tracked=${trackedFiles.length} committable=${committableFiles.length}.`
);

function checkWorkspaceRoot() {
  if (process.platform !== "win32") {
    return;
  }

  const normalized = process.cwd().replace(/\\/g, "/");
  if (/^C:\//i.test(normalized)) {
    findings.push("Project workspace is on C: drive; keep project outputs under D:/github_clone/perpetual-renewal.");
  }
}

function readGitFiles(args) {
  return execFileSync("git", args, { encoding: "utf8" })
    .split(/\r?\n/)
    .map((file) => file.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function checkForbiddenFiles(label, files) {
  for (const file of files) {
    if (forbiddenPathPatterns.some((pattern) => pattern.test(file))) {
      findings.push(`${label} file should not be in Git scope: ${file}`);
    }
  }
}

function checkRequiredFiles(files) {
  const fileSet = new Set(files);
  for (const file of requiredProjectFiles) {
    if (!fileSet.has(file)) {
      findings.push(`required project file is missing from Git scope: ${file}`);
    }
  }
}

function checkNextEnvTypeImports() {
  let content = "";
  try {
    content = readFileSync("next-env.d.ts", "utf8");
  } catch (error) {
    findings.push(
      `next-env.d.ts could not be read: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  if (content.includes("./.next/dev/types/")) {
    findings.push("next-env.d.ts references .next/dev/types; run npm run next:typegen before committing.");
  }
}

function checkRuntimeSourceBoundaries(files) {
  const apiRouteFiles = files.filter((file) => /^src\/app\/api\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
  for (const file of apiRouteFiles) {
    const content = readSourceFile(file);
    if (!content) continue;

    if (/\b(?:request|req)\s*\.\s*json\s*\(/.test(content)) {
      findings.push(
        `${file} directly calls request.json(); use src/lib/http/json.ts helpers so invalid and non-object JSON responses stay consistent.`
      );
    }
  }

  const runtimeFiles = files.filter((file) => /^src\/(?:app|lib)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
  for (const file of runtimeFiles) {
    const content = readSourceFile(file);
    if (!content) continue;

    if (/\bDEV-\d+\b/.test(content)) {
      findings.push(
        `${file} contains DEV-* handoff metadata in runtime source; keep milestone/task labels in docs or tests only.`
      );
    }
  }
}

function checkRuntimeLoggingBoundaries(files) {
  const runtimeFiles = files.filter((file) => /^src\/(?:app|lib)\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
  for (const file of runtimeFiles) {
    const content = readSourceFile(file);
    if (!content) continue;

    const rawErrorLogPatterns = [
      /console\.(?:warn|error)\([\s\S]{0,300}\berror\s+instanceof\s+Error\s*\?\s*error\.message\s*:\s*error[\s\S]{0,120}\)/g,
      /console\.(?:warn|error)\([\s\S]{0,300}\berror\.stack\b[\s\S]{0,120}\)/g
    ];

    if (rawErrorLogPatterns.some((pattern) => pattern.test(content))) {
      findings.push(
        `${file} logs raw error details; use src/lib/logging/sanitize.ts safeLogValue() before runtime console output.`
      );
    }
  }
}

function checkApiPrivacyBoundaries(files) {
  const apiRouteFiles = files.filter((file) => /^src\/app\/api\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
  for (const file of apiRouteFiles) {
    const content = readSourceFile(file);
    if (!content) continue;

    if (
      /NextResponse\.json\(\s*\{\s*error\s*:\s*error\s+instanceof\s+Error\s*\?\s*error\.message\b/.test(content) ||
      /NextResponse\.json\([\s\S]{0,260}\berror\s*:\s*error\.message\b/.test(content)
    ) {
      findings.push(
        `${file} returns raw error.message from an API route; map expected validation errors to stable safe copy.`
      );
    }
  }

  const voiceRouteFiles = files.filter((file) => /^src\/app\/api\/voice\/.*\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file));
  for (const file of voiceRouteFiles) {
    const content = readSourceFile(file);
    if (!content) continue;

    if (/\bNextResponse\.json\(\s*result\s*\)/.test(content) || /\braw\s*:/.test(content)) {
      findings.push(
        `${file} may expose raw voice provider payloads; return only explicit safe response fields.`
      );
    }
  }
}

function readSourceFile(file) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    findings.push(`${file} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

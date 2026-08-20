import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import process from "node:process";

const findings = [];
const files = readCommittableFiles();
const docsAndReadmes = files.filter(
  (file) => file === "README.md" || file.startsWith(`docs${sep}`) || file.startsWith("docs/")
);

checkDocsText(docsAndReadmes);
checkMigrationContexts(docsAndReadmes);
checkPackageJson();
checkEnvExample();
checkCi();
checkDeploymentDocs();
checkReleaseHandoff();

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

      if (/\b(?:46|48) checks\b/i.test(line)) {
        findings.push(`${location} mentions an outdated smoke check count; current baseline is 49 checks.`);
      }

      if (line.includes("npm audit --audit-level=high")) {
        findings.push(
          `${location} uses bare npm audit; use npm --cache .\\.npm-cache audit --audit-level=high.`
        );
      }
    });
  }
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
  expectEqual(scripts["git:boundary"], "node scripts/git-boundary-check.mjs", "package.json scripts.git:boundary");
  expectEqual(scripts["next:typegen"], "node scripts/next-typegen.mjs", "package.json scripts.next:typegen");
  expectEqual(
    scripts["typecheck"],
    "npm run next:typegen && tsc --noEmit",
    "package.json scripts.typecheck"
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
}

function checkDeploymentDocs() {
  const requiredSnippets = [
    ["docs/DEPLOYMENT.md", "npm run prisma:migrate:deploy"],
    ["docs/DATABASE.md", "npm run prisma:migrate:deploy"],
    ["docs/QA.md", "npm run prisma:migrate:deploy"],
    ["docs/MVP_STATUS.md", "49 checks"],
    ["docs/PHASE-1.5.md", "49 checks"]
  ];

  for (const [file, snippet] of requiredSnippets) {
    const content = readText(file);
    if (!content?.includes(snippet)) {
      findings.push(`${file} should mention ${snippet}.`);
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

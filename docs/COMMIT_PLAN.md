# Commit Plan

本文件记录首次提交前的建议分组和执行结果。首次发布候选 baseline 已经完成。

## 当前执行结果

- 分支：`codex/mvp-release-candidate`
- 提交：`ef4939e feat: build relationship ai mvp baseline`
- 策略：一个发布候选 baseline commit
- 提交后状态：工作区仅剩 `.next/`、`.npm-cache/`、`node_modules/`、`test-results/`、`tsconfig.tsbuildinfo` 等 ignored 产物。
- 提交后验证：`npm run git:boundary` 与 `npm run secrets:check` 通过。

## 当前建议

如果这是项目第一次进入远端仓库，建议采用 **一个发布候选基线提交**。理由是当前仓库大部分文件都是新项目骨架，拆成过多提交会让首次历史显得人为，而且模块间已经通过 Taskbook 记录了演进过程。

建议首个提交信息：

```text
feat: build relationship ai mvp baseline
```

如果你希望保留更细历史，可改为 5 个提交：

| 顺序 | 提交信息 | 文件范围 |
| --- | --- | --- |
| 1 | `docs: add product requirements and delivery plan` | `docs/PRD.md`、`docs/TASKBOOK.md`、`docs/ARCHITECTURE.md`、`docs/MVP_STATUS.md`、`docs/*.md` |
| 2 | `feat: scaffold next prisma relationship workspace` | `package*.json`、`next.config.ts`、`tsconfig.json`、`eslint.config.mjs`、`src/app/*`、`src/components/*` |
| 3 | `feat: add llm memory proactive and voice modules` | `src/lib/*`、API routes、`prisma/*` |
| 4 | `test: add smoke qa and e2e coverage` | `tests/*`、`playwright.config.ts`、`scripts/*` |
| 5 | `chore: add deployment env and safety checks` | `.env.example`、`.gitignore`、`README.md`、security/deployment docs |

## 必须纳入 Git 的文件

- `.env.example`
- `.gitignore`
- `README.md`
- `package.json`
- `package-lock.json`
- `next.config.ts`
- `tsconfig.json`
- `eslint.config.mjs`
- `playwright.config.ts`
- `next-env.d.ts`
- `prisma/**`
- `scripts/**`
- `src/**`
- `tests/**`
- `docs/**`

## 不应纳入 Git 的文件

这些已由 `.gitignore` 排除：

- `.env`
- `.env.local`
- `.env.*.local`
- `.next/`
- `.npm-cache/`
- `node_modules/`
- `test-results/`
- `coverage/`
- `dist/`
- `*.log`
- `*.tsbuildinfo`
- `prisma/dev.db`

## 提交前命令

先执行：

```bash
npm run verify:local
```

发布前完整检查再执行：

```bash
npm run verify:release
```

如果需要逐条排查，可按以下顺序运行：

```bash
npm run secrets:check
npm run typecheck
npm run lint
npm run qa:samples
npm run qa:prompt
npm run prisma:validate
npm run db:smoke
npm run smoke
npm run build
npm run e2e
npm --cache .\.npm-cache audit --audit-level=high
```

注意：`npm run smoke` 和 `npm run e2e` 不要并行执行，避免 Next dev server 项目锁冲突。

## 建议执行方式

单提交：

```bash
git add .env.example .gitignore README.md package.json package-lock.json next.config.ts tsconfig.json eslint.config.mjs playwright.config.ts next-env.d.ts prisma scripts src tests docs
git commit -m "feat: build relationship ai mvp baseline"
```

如果要先开分支：

```bash
git switch -c codex/mvp-release-candidate
```

然后再执行 `git add` 和 `git commit`。

## 提交前人工检查

- 设置页“模型供应商”能保存用户 key、读取模型列表、测试连接。
- 设置页“配置状态”只显示就绪状态和下一步，不显示真实 key、Base URL、连接串或 secret。
- 数据导出 JSON 不包含 key、Base URL、vault 密文、prompt 或供应商 raw payload。
- `docs/PRE_COMMIT_CHECKLIST.md` 中的限制已经逐项确认。

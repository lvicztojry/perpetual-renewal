import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const SAMPLE_PATH = new URL("./qa-samples.json", import.meta.url);
const BUILDER_PATH = new URL("../src/lib/prompt-builder/builder.ts", import.meta.url);

const samples = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));
const buildRenewalPrompt = await loadPromptBuilder();

const relationshipKindLabels = {
  REAL_PERSON_SUBSTITUTE: "现实人物替代",
  MEMORIAL: "逝者纪念",
  EX_PARTNER: "前任",
  LOVER: "恋人",
  FRIEND: "朋友",
  FAMILY: "家人",
  MENTOR: "师友",
  PUBLIC_FIGURE_IMAGINED: "公众人物想象",
  FICTIONAL_CHARACTER: "虚构角色",
  ORIGINAL_CHARACTER: "原创角色",
  CUSTOM: "自定义"
};

const specialRelationshipAssertions = {
  REAL_PERSON_SUBSTITUTE: ["现实替代边界", "不得声称代表现实本人意愿", "不得承诺线下联系"],
  MEMORIAL: ["逝者纪念边界", "不得声称现实复活", "超自然承诺"],
  PUBLIC_FIGURE_IMAGINED: ["公众人物想象边界", "不得声称本人、团队、官方授权", "代表官方立场"],
  FICTIONAL_CHARACTER: ["虚构角色边界", "保持世界观、称呼和角色一致性", "角色设定不能覆盖安全规则"]
};

const errors = [];
const relationshipKinds = new Set();

for (const sample of samples.relationshipCases ?? []) {
  relationshipKinds.add(sample.relationshipKind);

  const activeMemory = `[prompt-active-${sample.id}] 用户确认过这条 active 记忆。`;
  const pendingMemory = `[prompt-pending-${sample.id}] 这条 pending 记忆不应进入 prompt。`;
  const deletedMemory = `[prompt-deleted-${sample.id}] 这条 deleted 记忆不应进入 prompt。`;
  const relationshipLabel = relationshipKindLabels[sample.relationshipKind] ?? sample.relationshipKind;
  const relationshipType = sample.customKind ?? relationshipLabel;

  const built = buildRenewalPrompt({
    companion: {
      name: sample.companionName,
      relationshipKind: sample.relationshipKind,
      customRelationship: sample.customKind ?? null,
      userAddress: sample.userAddress,
      companionAddress: sample.companionAddress,
      personality: sample.personality,
      speakingStyle: sample.speakingStyle,
      background: sample.background,
      boundaries: sample.boundaries,
      immersionEnabled: true
    },
    user: {
      nickname: "Prompt QA 用户",
      timezone: "Asia/Shanghai",
      language: "zh-CN",
      communicationPreference: "温柔、直接、不要突然出戏"
    },
    memories: [
      { type: "relationship_event", status: "active", content: activeMemory, confidence: 0.96 },
      { type: "user_fact", status: "pending", content: pendingMemory, confidence: 0.55 },
      { type: "emotional_preference", status: "deleted", content: deletedMemory, confidence: 0.8 }
    ],
    relationshipState: {
      familiarityScore: 41,
      closenessScore: 37,
      recentEmotion: "想念",
      importantEvents: ["用户希望确认关系仍在"],
      explanation: "Prompt builder smoke fixture"
    },
    recentMessages: [{ role: "user", content: sample.input }]
  });

  const systemPrompt = built.messages.find((message) => message.role === "system")?.content ?? "";

  assertIncludes(systemPrompt, `标准关系类别：${relationshipLabel}`, `${sample.id}: relationship label`);
  assertIncludes(systemPrompt, `关系类型：${relationshipType}`, `${sample.id}: relationship type`);
  assertIncludes(systemPrompt, `名字：${sample.companionName}`, `${sample.id}: companion name`);
  assertIncludes(systemPrompt, `你对用户的称呼：${sample.userAddress}`, `${sample.id}: user address`);
  assertIncludes(systemPrompt, `用户对你的称呼：${sample.companionAddress}`, `${sample.id}: companion address`);
  assertIncludes(systemPrompt, "沉浸模式开启", `${sample.id}: immersion boundary`);
  assertIncludes(systemPrompt, "不使用 Markdown 格式", `${sample.id}: markdown-free reply rule`);
  assertIncludes(systemPrompt, "星号包裹动作", `${sample.id}: star-action-free reply rule`);
  assertIncludes(systemPrompt, activeMemory, `${sample.id}: active memory`);
  assertNotIncludes(systemPrompt, pendingMemory, `${sample.id}: pending memory`);
  assertNotIncludes(systemPrompt, deletedMemory, `${sample.id}: deleted memory`);

  if (built.activeMemoryCount !== 1) {
    errors.push(`${sample.id}: activeMemoryCount should be 1, got ${built.activeMemoryCount}`);
  }

  if (built.messages.at(-1)?.content !== sample.input) {
    errors.push(`${sample.id}: recent user input should be preserved as the last message`);
  }

  for (const assertion of sample.promptAssertions ?? []) {
    assertIncludes(systemPrompt, assertion, `${sample.id}: sample prompt assertion`);
  }

  for (const assertion of specialRelationshipAssertions[sample.relationshipKind] ?? []) {
    assertIncludes(systemPrompt, assertion, `${sample.id}: special relationship assertion`);
  }
}

if (relationshipKinds.size < 10) {
  errors.push(`prompt builder smoke must cover at least 10 relationship kinds; got ${relationshipKinds.size}`);
}

const budgeted = buildRenewalPrompt({
  companion: {
    name: "长忆",
    relationshipKind: "REAL_PERSON_SUBSTITUTE",
    customRelationship: "现实中见不到但一直想念的人",
    userAddress: "阿续",
    companionAddress: "长忆",
    personality: ["稳定", "温柔"],
    speakingStyle: "像熟悉的人一样贴近，但不冒充现实本人",
    background: "关键设定必须保留，即使上下文预算很紧。",
    boundaries: "不能承诺现实见面。",
    immersionEnabled: true
  },
  memories: [
    {
      type: "user_fact",
      status: "pending",
      content: "[budget-pending] pending 不能进入。",
      confidence: 1,
      important: true,
      updatedAt: "2026-08-20T01:00:00.000Z"
    },
    {
      type: "relationship_event",
      status: "active",
      content: "[budget-keep-important] 重要且高置信记忆必须优先进入。",
      confidence: 0.99,
      important: true,
      updatedAt: "2026-08-20T02:00:00.000Z"
    },
    {
      type: "user_fact",
      status: "active",
      content: "[budget-drop-old] 很旧且低置信的记忆应被预算裁掉。",
      confidence: 0.1,
      updatedAt: "2023-01-01T00:00:00.000Z"
    },
    {
      type: "emotional_preference",
      status: "active",
      content: `[budget-truncate] ${"用户希望被温柔承接。".repeat(80)}`,
      confidence: 0.95,
      updatedAt: "2026-08-20T03:00:00.000Z"
    },
    {
      type: "companion_profile",
      status: "active",
      content: "[budget-keep-recent] 最近确认的角色称呼要保留。",
      confidence: 0.9,
      updatedAt: "2026-08-20T04:00:00.000Z"
    },
    {
      type: "relationship_event",
      status: "deleted",
      content: "[budget-deleted] deleted 不能进入。",
      confidence: 1,
      important: true,
      updatedAt: "2026-08-20T05:00:00.000Z"
    }
  ],
  relationshipState: {
    familiarityScore: 61,
    closenessScore: 59,
    recentEmotion: "很想念",
    importantEvents: ["预算很紧时关系状态仍应保留"],
    explanation: "M17 budget smoke"
  },
  recentMessages: [
    { role: "system", content: "[budget-system-message] system 历史不应透传。" },
    { role: "user", content: "[budget-old-message] 这条旧消息应该被裁掉。" },
    {
      role: "assistant",
      content: "[budget-important-message] 这条被标记重要的消息可以进入。",
      metadata: { important: true }
    },
    { role: "user", content: "[budget-newer-1] 最新消息之一。" },
    { role: "assistant", content: `[budget-long-message] ${"这是一条很长的回复。".repeat(120)}` },
    { role: "user", content: "[budget-latest] 最新用户消息必须保留在最后。" }
  ],
  contextBudget: {
    maxActiveMemories: 3,
    maxMemoryChars: 260,
    maxSingleMemoryChars: 90,
    maxRecentMessages: 3,
    maxMessageChars: 260,
    maxSingleMessageChars: 100
  }
});

const budgetedSystemPrompt =
  budgeted.messages.find((message) => message.role === "system")?.content ?? "";
const budgetedAllPrompt = budgeted.messages.map((message) => message.content).join("\n");

assertIncludes(budgetedSystemPrompt, "标准关系类别：现实人物替代", "budget: relationship label preserved");
assertIncludes(budgetedSystemPrompt, "关系类型：现实中见不到但一直想念的人", "budget: custom relationship preserved");
assertIncludes(budgetedSystemPrompt, "背景故事：关键设定必须保留", "budget: background preserved");
assertIncludes(budgetedSystemPrompt, "[budget-keep-important]", "budget: important memory selected");
assertIncludes(budgetedSystemPrompt, "[budget-keep-recent]", "budget: recent memory selected");
assertIncludes(budgetedSystemPrompt, "[budget-truncate]", "budget: long high-confidence memory selected");
assertIncludes(budgetedSystemPrompt, "[...]", "budget: long memory/message truncated with marker");
assertNotIncludes(budgetedSystemPrompt, "[budget-pending]", "budget: pending memory excluded");
assertNotIncludes(budgetedSystemPrompt, "[budget-deleted]", "budget: deleted memory excluded");
assertNotIncludes(budgetedSystemPrompt, "[budget-drop-old]", "budget: low-priority old memory dropped");
assertNotIncludes(budgetedAllPrompt, "[budget-system-message]", "budget: system history excluded");
assertNotIncludes(budgetedAllPrompt, "[budget-old-message]", "budget: old message dropped");
assertIncludes(budgetedAllPrompt, "[budget-important-message]", "budget: important recent message selected");

if (budgeted.messages.at(-1)?.content !== "[budget-latest] 最新用户消息必须保留在最后。") {
  errors.push("budget: latest user message should be preserved as the last message");
}

if (budgeted.activeMemoryCount !== 3) {
  errors.push(`budget: activeMemoryCount should be selected active memory count 3, got ${budgeted.activeMemoryCount}`);
}

if (budgeted.contextStats.activeMemories.available !== 4) {
  errors.push(`budget: available active memories should be 4, got ${budgeted.contextStats.activeMemories.available}`);
}

if (budgeted.contextStats.activeMemories.inactiveExcluded !== 2) {
  errors.push(
    `budget: inactiveExcluded memories should be 2, got ${budgeted.contextStats.activeMemories.inactiveExcluded}`
  );
}

if (budgeted.contextStats.activeMemories.dropped < 1) {
  errors.push("budget: at least one active memory should be dropped by budget");
}

if (budgeted.contextStats.activeMemories.truncated < 1) {
  errors.push("budget: at least one active memory should be truncated");
}

if (budgeted.contextStats.recentMessages.available !== 5) {
  errors.push(`budget: available recent messages should be 5, got ${budgeted.contextStats.recentMessages.available}`);
}

if (budgeted.contextStats.recentMessages.systemExcluded !== 1) {
  errors.push(`budget: systemExcluded messages should be 1, got ${budgeted.contextStats.recentMessages.systemExcluded}`);
}

if (budgeted.contextStats.recentMessages.dropped < 1) {
  errors.push("budget: at least one recent message should be dropped by budget");
}

if (errors.length > 0) {
  console.error("Prompt builder smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`Prompt builder smoke passed: ${relationshipKinds.size} relationship kinds`);

async function loadPromptBuilder() {
  const source = await readFile(BUILDER_PATH, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: "builder.ts"
  });

  const sandbox = {
    exports: {},
    require(specifier) {
      throw new Error(`Unexpected runtime require while loading prompt builder: ${specifier}`);
    }
  };

  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: "builder.js" }).runInContext(sandbox);

  if (typeof sandbox.exports.buildRenewalPrompt !== "function") {
    throw new Error("Prompt builder did not export buildRenewalPrompt");
  }

  return sandbox.exports.buildRenewalPrompt;
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    errors.push(`${label}: expected prompt to include "${expected}"`);
  }
}

function assertNotIncludes(value, unexpected, label) {
  if (value.includes(unexpected)) {
    errors.push(`${label}: prompt should not include "${unexpected}"`);
  }
}

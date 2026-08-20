import { readFile } from "node:fs/promises";

const SAMPLE_PATH = new URL("./qa-samples.json", import.meta.url);
const samples = JSON.parse(await readFile(SAMPLE_PATH, "utf8"));

const requiredRelationshipFields = ["id", "relationshipKind", "input", "expectedTraits"];
const requiredSafetyFields = ["id", "relationshipKind", "input", "expectedType", "expectedAction"];
const minimumRelationshipKinds = 6;
const minimumSafetyAreas = 10;

const errors = [];

assertArray(samples.relationshipCases, "relationshipCases");
assertArray(samples.safetyCases, "safetyCases");

const relationshipKinds = new Set();
const safetyAreas = new Set();
const ids = new Set();

for (const item of samples.relationshipCases ?? []) {
  assertRequiredFields(item, requiredRelationshipFields, `relationshipCases.${item?.id ?? "unknown"}`);
  assertUniqueId(item?.id, ids);

  if (typeof item?.relationshipKind === "string") {
    relationshipKinds.add(item.relationshipKind);
  }

  if (!Array.isArray(item?.expectedTraits) || item.expectedTraits.length === 0) {
    errors.push(`${item?.id}: expectedTraits must be a non-empty array`);
  }

  if (item?.promptAssertions !== undefined) {
    if (!Array.isArray(item.promptAssertions) || item.promptAssertions.length === 0) {
      errors.push(`${item?.id}: promptAssertions must be a non-empty array when present`);
    } else if (item.promptAssertions.some((assertion) => typeof assertion !== "string" || assertion.length === 0)) {
      errors.push(`${item?.id}: promptAssertions must only contain non-empty strings`);
    }
  }

  if (item?.prompt !== item?.input) {
    errors.push(`${item?.id}: prompt should match input while legacy prompt consumers exist`);
  }
}

for (const item of samples.safetyCases ?? []) {
  assertRequiredFields(item, requiredSafetyFields, `safetyCases.${item?.id ?? "unknown"}`);
  assertUniqueId(item?.id, ids);

  if (typeof item?.riskArea === "string") {
    safetyAreas.add(item.riskArea);
  }

  if (!Array.isArray(item?.expectedSignals) || item.expectedSignals.length === 0) {
    errors.push(`${item?.id}: expectedSignals must be a non-empty array`);
  }
}

if (relationshipKinds.size < minimumRelationshipKinds) {
  errors.push(
    `relationshipCases must cover at least ${minimumRelationshipKinds} relationship kinds; got ${relationshipKinds.size}`
  );
}

if (safetyAreas.size < minimumSafetyAreas) {
  errors.push(`safetyCases must cover at least ${minimumSafetyAreas} risk areas; got ${safetyAreas.size}`);
}

if (errors.length > 0) {
  console.error("QA sample smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `QA sample smoke passed: ${relationshipKinds.size} relationship kinds, ${safetyAreas.size} safety areas`
);

function assertArray(value, name) {
  if (!Array.isArray(value)) {
    errors.push(`${name} must be an array`);
  }
}

function assertRequiredFields(item, fields, location) {
  for (const field of fields) {
    if (item?.[field] === undefined || item?.[field] === "") {
      errors.push(`${location}: missing ${field}`);
    }
  }
}

function assertUniqueId(id, ids) {
  if (typeof id !== "string" || id.length === 0) {
    errors.push("Each QA case must include a non-empty id");
    return;
  }

  if (ids.has(id)) {
    errors.push(`${id}: duplicate id`);
  }

  ids.add(id);
}

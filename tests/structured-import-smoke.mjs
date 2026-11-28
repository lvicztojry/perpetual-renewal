import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const IMPORT_PATH = new URL("../src/lib/import/structured-client-import.ts", import.meta.url);
const errors = [];

const {
  createContactFileImportPlan,
  createMediaFileImportPlan,
  createStructuredTextImportPlan,
  isAllowedMediaFile
} = await loadStructuredImportModule();

const heicPlan = createMediaFileImportPlan([
  { name: "old-photo.heic", type: "", size: 128_000, lastModified: Date.UTC(2026, 0, 2) },
  { name: "voice-note.m4a", type: "", size: 64_000 },
  { name: "installer.exe", type: "", size: 10_000 }
]);

assert(heicPlan.items.length === 2, "media extension fallback should accept HEIC and M4A");
assert(heicPlan.skippedCount === 1, "media extension fallback should skip unsupported files");
assertIncludes(heicPlan.items[0]?.text ?? "", "old-photo.heic", "HEIC media summary should include file name");
assertIncludes(heicPlan.items[0]?.text ?? "", "隐私边界", "media summary should include privacy boundary");
assert(!isAllowedMediaFile({ name: "payload.exe", type: "", size: 1 }), "EXE should not be allowed as media");

const csvPlan = createContactFileImportPlan({
  fileName: "contacts.csv",
  fileSize: 120,
  fileText: "Full Name,Mobile Phone,E-mail Address,Notes\n阿澈,13812345678,a@example.com,大学同学"
});
assert(csvPlan.items.length === 1, "CSV contact import should create one item");
const csvText = csvPlan.items[0]?.text ?? "";
assertIncludes(csvText, "联系人条目：阿澈", "CSV contact should read Full Name");
assertIncludes(csvText, "电话尾号 5678", "CSV contact should keep only phone tail");
assertIncludes(csvText, "邮箱域 example.com", "CSV contact should keep only email domain");
assertNotIncludes(csvText, "13812345678", "CSV contact should not expose full phone");
assertNotIncludes(csvText, "a@example.com", "CSV contact should not expose full email");

const jsonPlan = createContactFileImportPlan({
  fileName: "contacts.json",
  fileSize: 220,
  fileText: JSON.stringify([
    {
      displayName: "林晚",
      relationship: "朋友",
      phones: [{ value: "+86 139 0000 4321" }],
      emails: ["lin@example.org"]
    }
  ])
});
assert(jsonPlan.items.length === 1, "JSON contact import should create one item");
const jsonText = jsonPlan.items[0]?.text ?? "";
assertIncludes(jsonText, "联系人条目：林晚", "JSON contact should read displayName");
assertIncludes(jsonText, "关系：朋友", "JSON contact should keep relationship");
assertIncludes(jsonText, "电话尾号 4321", "JSON contact should mask nested phone");
assertIncludes(jsonText, "邮箱域 example.org", "JSON contact should mask array email");

const vcardPlan = createContactFileImportPlan({
  fileName: "friend.vcf",
  fileSize: 180,
  fileText: [
    "BEGIN:VCARD",
    "FN:小满",
    "TEL:+86 137 0000 8888",
    "EMAIL:xiaoman@example.net",
    "NOTE:常一起散步",
    "END:VCARD"
  ].join("\n")
});
assert(vcardPlan.items.length === 1, "vCard import should create one item");
const vcardText = vcardPlan.items[0]?.text ?? "";
assertIncludes(vcardText, "联系人条目：小满", "vCard contact should read FN");
assertIncludes(vcardText, "电话尾号 8888", "vCard contact should mask TEL");
assertIncludes(vcardText, "邮箱域 example.net", "vCard contact should mask EMAIL");

const vcardNameFallbackPlan = createContactFileImportPlan({
  fileName: "fallback.vcf",
  fileSize: 180,
  fileText: [
    "BEGIN:VCARD",
    "NOTE:这不是姓名",
    "N:叶;青;;;",
    "TEL;TYPE=CELL:+86 136 0000 1212",
    "EMAIL;TYPE=HOME:yeqing@example.cn",
    "END:VCARD"
  ].join("\n")
});
assert(vcardNameFallbackPlan.items.length === 1, "vCard N fallback should create one item");
const vcardNameFallbackText = vcardNameFallbackPlan.items[0]?.text ?? "";
assertIncludes(vcardNameFallbackText, "联系人条目：叶 青", "vCard N fallback should not read NOTE as name");
assertNotIncludes(vcardNameFallbackText, "联系人条目：这不是姓名", "vCard N fallback should ignore NOTE for name");
assertIncludes(vcardNameFallbackText, "电话尾号 1212", "vCard typed TEL should be masked");
assertIncludes(vcardNameFallbackText, "邮箱域 example.cn", "vCard typed EMAIL should be masked");

const mediaTextPlan = createStructuredTextImportPlan({
  kind: "media",
  text: JSON.stringify({
    title: "雨天照片",
    description: "那天一起等车",
    people: "我和阿澈",
    place: "车站"
  })
});
assert(mediaTextPlan.items.length === 1, "media description JSON should create one material");
assertIncludes(mediaTextPlan.items[0]?.text ?? "", "媒体说明：「雨天照片」", "media description should keep title");
assertIncludes(mediaTextPlan.items[0]?.text ?? "", "原始照片、音频或视频未上传或保存", "media description should include upload boundary");

if (errors.length > 0) {
  console.error("Structured import smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Structured import smoke passed: media and contact planners are masked and compatible.");

async function loadStructuredImportModule() {
  const source = await readFile(IMPORT_PATH, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: "structured-client-import.ts"
  });

  const sandbox = {
    exports: {},
    require(specifier) {
      throw new Error(`Unexpected runtime require while loading structured import module: ${specifier}`);
    }
  };

  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: "structured-client-import.js" }).runInContext(sandbox);

  return sandbox.exports;
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    errors.push(`${label}: expected "${expected}"`);
  }
}

function assertNotIncludes(value, unexpected, label) {
  if (value.includes(unexpected)) {
    errors.push(`${label}: should not include "${unexpected}"`);
  }
}

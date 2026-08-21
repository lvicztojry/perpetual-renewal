import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const RESPONSE_SAFETY_PATH = new URL("../src/lib/http/response-safety.ts", import.meta.url);
const SANITIZE_PATH = new URL("../src/lib/logging/sanitize.ts", import.meta.url);
const errors = [];

const { redactSensitiveResponseText } = await loadResponseSafetyModule();

const bearerToken = "response-bearer-token-0123456789";
const apiKey = ["sk", "responsevalue0123456789"].join("-");
const databaseUrl = ["postgres", "ql://response:password@db.example.com:5432/app"].join("");
const providerEndpoint = "https://api.tryanotherone.com/v1/chat/completions";
const audioEndpoint = "https://voice.gateway.example.com/v1/audio/speech";
const promptValue = "hidden prompt should not leak across spaces";
const rawPayloadValue = "raw payload should not leak across spaces";
const rawPayloadSnakeValue = "raw payload snake should not leak";
const stackValue = "Stack trace with secret frame should not leak";
const stackFrame = "at provider.fetch (src/lib/provider.ts:12:3)";
const authorizationValue = ["Bearer", "response-authorization-value-0123456789"].join(" ");

const redacted = redactSensitiveResponseText(
  [
    `Authorization: Bearer ${bearerToken}`,
    `LLM_API_KEY=${apiKey}`,
    `DATABASE_URL=${databaseUrl}`,
    `baseUrl: ${providerEndpoint}`,
    audioEndpoint,
    `prompt="${promptValue}"`,
    `rawPayload="${rawPayloadValue}"`,
    `raw_payload='${rawPayloadSnakeValue}'`,
    `stack="${stackValue}"`,
    stackFrame,
    `authorization=${authorizationValue}`
  ].join("\n")
);

for (const leaked of [
  bearerToken,
  apiKey,
  "response:password",
  providerEndpoint,
  audioEndpoint,
  promptValue,
  rawPayloadValue,
  rawPayloadSnakeValue,
  stackValue,
  stackFrame,
  authorizationValue
]) {
  assert(!redacted?.includes(leaked), `response sanitizer should hide ${leaked}`);
}

for (const expected of [
  "LLM_API_KEY=[redacted]",
  "DATABASE_URL=[redacted]",
  "[redacted-url]",
  "[redacted-provider-endpoint]",
  "prompt=[redacted]",
  "rawPayload=[redacted]",
  "raw_payload=[redacted]",
  "stack=[redacted]",
  "[redacted-stack]",
  "authorization=[redacted]"
]) {
  assert(redacted?.includes(expected), `response sanitizer should include ${expected}`);
}

assert(redactSensitiveResponseText(undefined) === undefined, "undefined response text should stay undefined");

if (errors.length > 0) {
  console.error("Response safety smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Response safety smoke passed: API response debug text redacts secrets, endpoints, prompts, payloads, and stack traces.");

async function loadResponseSafetyModule() {
  const sanitizeModule = await loadSanitizeModule();
  return loadTsModule(RESPONSE_SAFETY_PATH, {
    require(specifier) {
      if (specifier === "@/lib/logging/sanitize") return sanitizeModule;
      throw new Error(`Unexpected require while loading response safety module: ${specifier}`);
    }
  });
}

async function loadSanitizeModule() {
  return loadTsModule(SANITIZE_PATH, {
    require(specifier) {
      throw new Error(`Unexpected require while loading sanitize module: ${specifier}`);
    }
  });
}

async function loadTsModule(path, options) {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: path.pathname
  });

  const sandbox = {
    exports: {},
    require: options.require
  };

  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: path.pathname }).runInContext(sandbox);
  return sandbox.exports;
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

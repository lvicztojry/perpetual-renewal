import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const SANITIZE_PATH = new URL("../src/lib/logging/sanitize.ts", import.meta.url);
const errors = [];

const { safeLogValue, sanitizeLogText } = await loadSanitizeModule();

const bearerToken = ["realtokenvalue", "0123456789"].join("");
const databaseUrl = ["postgres", "ql://realuser:realpassword@db.example.com:5432/app?schema=public"].join("");
const apiKey = ["sk", "realvalue0123456789"].join("-");
const jwtLikeValue = [
  "eyJhbGciOiJIUzI1NiJ9",
  "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
  "signaturevalue0123456789"
].join(".");
const secondBearerToken = ["secondtokenvalue", "0123456789"].join("");
const objectApiKey = ["object-secret-value", "0123456789"].join("-");
const objectDatabaseUrl = ["postgres", "ql://object:password@db.example.com/app"].join("");

const rawSecretText = [
  `Authorization: Bearer ${bearerToken}`,
  `DATABASE_URL=${databaseUrl}`,
  `LLM_API_KEY=${apiKey}`,
  "token=secret-token-value",
  "https://user:pass@example.com/v1",
  jwtLikeValue
].join("\n");

const sanitized = sanitizeLogText(rawSecretText);

assert(!sanitized.includes(bearerToken), "Bearer token should be redacted");
assert(!sanitized.includes("realuser:realpassword"), "database credentials should be redacted");
assert(!sanitized.includes(apiKey), "sk-style API key should be redacted");
assert(!sanitized.includes("secret-token-value"), "token assignment should be redacted");
assert(!sanitized.includes("user:pass@example.com"), "URL userinfo should be redacted");
assert(!sanitized.includes("signaturevalue0123456789"), "JWT-like value should be redacted");

const sanitizedError = safeLogValue(
  new Error(`Failed with Authorization: Bearer ${secondBearerToken}`)
);
assert(
  typeof sanitizedError === "string" && !sanitizedError.includes(secondBearerToken),
  "Error message logging should be sanitized"
);

const sanitizedObject = safeLogValue({
  message: "provider failed",
  apiKey: objectApiKey,
  databaseUrl: objectDatabaseUrl
});
assert(
  typeof sanitizedObject === "string" &&
    !sanitizedObject.includes(objectApiKey) &&
    !sanitizedObject.includes("object:password"),
  "object logging should be serialized and sanitized"
);

if (errors.length > 0) {
  console.error("Logging sanitize smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Logging sanitize smoke passed: runtime log values redact secret-shaped content.");

async function loadSanitizeModule() {
  const source = await readFile(SANITIZE_PATH, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020
    },
    fileName: SANITIZE_PATH.pathname
  });

  const sandbox = {
    exports: {}
  };
  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: SANITIZE_PATH.pathname }).runInContext(sandbox);
  return sandbox.exports;
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

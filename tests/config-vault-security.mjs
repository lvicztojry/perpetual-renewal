import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as ts from "typescript";

const VAULT_PATH = new URL("../src/lib/credentials/vault.ts", import.meta.url);
const CONFIG_STATUS_PATH = new URL("../src/lib/config/status.ts", import.meta.url);
const SESSION_SECRET_PATH = new URL("../src/lib/auth/session-secret.ts", import.meta.url);
const SAFETY_HASH_PATH = new URL("../src/lib/safety-events/hash.ts", import.meta.url);
const SAFETY_SERVICE_PATH = new URL("../src/lib/safety-events/service.ts", import.meta.url);
const errors = [];

const originalEnv = { ...process.env };
const originalNodeEnv = process.env.NODE_ENV;

try {
  await runVaultChecks();
  await runSessionSecretChecks();
  await runSafetyEventHashChecks();
  await runConfigReadinessChecks();
} finally {
  process.env = { ...originalEnv };
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }
}

if (errors.length > 0) {
  console.error("Config/vault security smoke failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log("Config/vault security smoke passed: production secret, session signing, HMAC fingerprint, safety event hashes, and readiness matrix.");

async function runVaultChecks() {
  const { encryptSecret, decryptSecret } = await loadVaultModule();
  const apiKey = "  vault-test-api-key  ";

  withEnv({ NODE_ENV: "production", USER_KEY_VAULT_SECRET: "" }, () => {
    assertThrows(() => encryptSecret(apiKey), "production vault should reject missing USER_KEY_VAULT_SECRET");
  });

  withEnv({ NODE_ENV: "production", USER_KEY_VAULT_SECRET: "short-secret" }, () => {
    assertThrows(() => encryptSecret(apiKey), "production vault should reject short USER_KEY_VAULT_SECRET");
  });

  withEnv({ NODE_ENV: "production", USER_KEY_VAULT_SECRET: "a".repeat(32) }, () => {
    const first = encryptSecret(apiKey);
    const second = encryptSecret(apiKey);
    const expectedFingerprint = expectedHmacFingerprint("a".repeat(32), apiKey.trim());

    assert(first.fingerprint === second.fingerprint, "same vault secret and key should keep fingerprint stable");
    assert(first.fingerprint === expectedFingerprint, "fingerprint should be HMAC-SHA256 with the vault key");
    assert(first.encrypted !== second.encrypted, "ciphertext should differ across encryptions");
    assert(first.iv !== second.iv, "IV should differ across encryptions");
    assert(decryptSecret(first) === apiKey.trim(), "vault decrypt should roundtrip trimmed API key");
  });

  withEnv({ NODE_ENV: "production", USER_KEY_VAULT_SECRET: "b".repeat(32) }, () => {
    const changed = encryptSecret(apiKey);
    const originalFingerprint = expectedHmacFingerprint("a".repeat(32), apiKey.trim());
    assert(changed.fingerprint !== originalFingerprint, "changing vault secret should change fingerprint");
  });
}

async function runConfigReadinessChecks() {
  const loadedStatusModule = await loadConfigStatusModule();
  const getSnapshot = loadedStatusModule.getConfigReadinessSnapshot;

  await withEnvAsync(
    {
      LLM_PROVIDER: "compatible",
      LLM_BASE_URL: "",
      LLM_MODEL: "chat-model",
      LLM_API_KEY: "server-key",
      USER_KEY_VAULT_SECRET: "a".repeat(32),
      PROACTIVE_CRON_SECRET: "b".repeat(32),
      VOICE_PROVIDER: "shared-llm"
    },
    async () => {
      loadedStatusModule.setCredentialStatus(emptyCredential());
      const snapshot = await getSnapshot("user-compatible");
      assert(itemStatus(snapshot, "llm_base_url") === "missing", "compatible provider should require baseUrl");
      assert(
        itemStatus(snapshot, "session_cookie_secret") === "ready",
        "config status should mark session signing ready when vault fallback is strong"
      );
    }
  );

  await withEnvAsync(
    {
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "",
      LLM_MODEL: "chat-model",
      LLM_API_KEY: "server-key",
      USER_KEY_VAULT_SECRET: "a".repeat(32),
      PROACTIVE_CRON_SECRET: "b".repeat(32),
      VOICE_PROVIDER: "shared-llm"
    },
    async () => {
      loadedStatusModule.setCredentialStatus(emptyCredential());
      const snapshot = await getSnapshot("user-openai-compatible");
      assert(itemStatus(snapshot, "llm_base_url") === "missing", "openai-compatible alias should require baseUrl");
    }
  );

  for (const provider of ["anthropic", "gemini", "openai-responses"]) {
    await withEnvAsync(
      {
        LLM_PROVIDER: provider,
        LLM_BASE_URL: "",
        LLM_MODEL: "chat-model",
        LLM_API_KEY: "",
        ANTHROPIC_API_KEY: provider === "anthropic" ? "anthropic-key" : "",
        GEMINI_API_KEY: provider === "gemini" ? "gemini-key" : "",
        OPENAI_API_KEY: provider === "openai-responses" ? "openai-key" : "",
        USER_KEY_VAULT_SECRET: "a".repeat(32),
        PROACTIVE_CRON_SECRET: "b".repeat(32),
        VOICE_PROVIDER: "shared-llm"
      },
      async () => {
        loadedStatusModule.setCredentialStatus(emptyCredential());
        const snapshot = await getSnapshot(`user-${provider}`);
        assert(itemStatus(snapshot, "llm_base_url") === "ready", `${provider} should not require compatible baseUrl`);
      }
    );
  }

  await withEnvAsync(
    {
      LLM_PROVIDER: "compatible",
      LLM_BASE_URL: "",
      LLM_MODEL: "",
      LLM_API_KEY: "",
      USER_KEY_VAULT_SECRET: "a".repeat(32),
      PROACTIVE_CRON_SECRET: "b".repeat(32),
      VOICE_PROVIDER: "shared-llm"
    },
    async () => {
      loadedStatusModule.setCredentialStatus({
        configured: true,
        kind: "llm",
        provider: "anthropic",
        endpointConfigured: false,
        endpointFingerprint: null,
        model: "claude-test",
        keyPreview: "...test",
        keyFingerprint: "fingerprint",
        credentialSource: "user-vault",
        updatedAt: new Date(0).toISOString()
      });
      const snapshot = await getSnapshot("user-vault-provider");
      assert(itemStatus(snapshot, "llm_base_url") === "ready", "user vault provider should take precedence over env provider");
      assert(itemStatus(snapshot, "llm_model") === "ready", "user vault model should take precedence over env model");
    }
  );
}

async function runSessionSecretChecks() {
  const { getSessionSigningSecret, getSessionSecretReadiness } = await loadSessionSecretModule();

  withEnv(
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SECRET: "",
      USER_KEY_VAULT_SECRET: ""
    },
    () => {
      assertThrows(
        () => getSessionSigningSecret(),
        "production session signing should reject missing SESSION_COOKIE_SECRET and vault fallback"
      );
      assert(
        getSessionSecretReadiness().status === "missing",
        "session secret readiness should report missing when no signing source exists"
      );
    }
  );

  withEnv(
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SECRET: "short-secret",
      USER_KEY_VAULT_SECRET: "a".repeat(32)
    },
    () => {
      assertThrows(
        () => getSessionSigningSecret(),
        "production session signing should reject short dedicated SESSION_COOKIE_SECRET"
      );
      assert(
        getSessionSecretReadiness().status === "warning",
        "short dedicated SESSION_COOKIE_SECRET should produce a readiness warning"
      );
    }
  );

  withEnv(
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SECRET: "",
      USER_KEY_VAULT_SECRET: "a".repeat(32)
    },
    () => {
      assert(
        getSessionSigningSecret() === "a".repeat(32),
        "production session signing should allow strong USER_KEY_VAULT_SECRET fallback"
      );
      const readiness = getSessionSecretReadiness();
      assert(readiness.status === "ready", "strong vault fallback should make session readiness ready");
      assert(
        readiness.source === "USER_KEY_VAULT_SECRET",
        "session readiness should identify vault fallback source without exposing the value"
      );
    }
  );

  withEnv(
    {
      NODE_ENV: "production",
      SESSION_COOKIE_SECRET: "s".repeat(32),
      USER_KEY_VAULT_SECRET: "a".repeat(32)
    },
    () => {
      assert(
        getSessionSigningSecret() === "s".repeat(32),
        "dedicated SESSION_COOKIE_SECRET should take precedence over vault fallback"
      );
      assert(
        getSessionSecretReadiness().source === "SESSION_COOKIE_SECRET",
        "session readiness should identify dedicated secret source"
      );
    }
  );
}

async function runSafetyEventHashChecks() {
  const hashModule = await loadSafetyHashModule();

  withEnv({ USER_KEY_VAULT_SECRET: "s".repeat(32) }, () => {
    const hashes = hashModule.buildSafetyEventHashes({
      userId: "safety-user",
      type: "SELF_HARM",
      action: "boundary_response",
      stage: "user_input",
      severity: "high",
      content: "I might hurt myself"
    });
    assert(
      hashes.contentHash.startsWith("hmac-sha256:") &&
        hashes.riskHash.startsWith("hmac-sha256:"),
      "safety event hashes should use HMAC when a strong vault secret exists"
    );
    assert(
      hashModule.canBuildPersistentSafetyEventHashes() === true,
      "strong vault secret should allow persistent safety event hashes"
    );
  });

  withEnv({ USER_KEY_VAULT_SECRET: "" }, () => {
    const hashes = hashModule.buildSafetyEventHashes({
      userId: "safety-user",
      type: "SELF_HARM",
      action: "boundary_response",
      stage: "user_input",
      severity: "high",
      content: "I might hurt myself"
    });
    assert(
      hashes.contentHash.startsWith("hmac-sha256:") &&
        hashModule.canBuildPersistentSafetyEventHashes() === false,
      "missing vault secret should only permit non-persistent keyed development safety hashes"
    );
  });

  await withEnvAsync({ USER_KEY_VAULT_SECRET: "" }, async () => {
    const service = await loadSafetyServiceModule({
      persistence: "prisma",
      create: async (event) => event,
      listForExport: async () => []
    });
    const result = await service.recordSafetyEvent(safetyEventInput());
    assert(
      result.logged === false &&
        result.persistence === "noop" &&
        result.skippedReason === "missing_persistent_hash_secret",
      "persistent safety event logging should fail closed without a strong hash secret"
    );
  });

  await withEnvAsync({ USER_KEY_VAULT_SECRET: "" }, async () => {
    const service = await loadSafetyServiceModule({
      persistence: "memory",
      create: async (event) => event,
      listForExport: async () => []
    });
    const result = await service.recordSafetyEvent(safetyEventInput());
    assert(
      result.logged === true &&
        result.persistence === "memory" &&
        result.event?.contentHash?.startsWith("hmac-sha256:"),
      "memory fallback should still permit local keyed development safety hashes"
    );
  });

  await withEnvAsync({ USER_KEY_VAULT_SECRET: "s".repeat(32) }, async () => {
    const service = await loadSafetyServiceModule({
      persistence: "prisma",
      create: async (event) => event,
      listForExport: async () => []
    });
    const result = await service.recordSafetyEvent(safetyEventInput());
    assert(
      result.logged === true &&
        result.persistence === "prisma" &&
        result.event?.contentHash?.startsWith("hmac-sha256:"),
      "persistent safety event logging should use HMAC hashes with a strong secret"
    );
  });
}

async function loadVaultModule() {
  const crypto = await import("node:crypto");
  return loadTsModule(VAULT_PATH, {
    require(specifier) {
      if (specifier === "node:crypto") return crypto;
      throw new Error(`Unexpected require while loading vault module: ${specifier}`);
    }
  });
}

async function loadConfigStatusModule() {
  let credentialStatus = emptyCredential();
  const sessionSecretModule = await loadSessionSecretModule();
  const loadedModule = await loadTsModule(CONFIG_STATUS_PATH, {
    require(specifier) {
      if (specifier === "@/lib/credentials") {
        return {
          getLlmCredentialStatus: async () => credentialStatus
        };
      }
      if (specifier === "@/lib/auth/session-secret") {
        return sessionSecretModule;
      }
      throw new Error(`Unexpected require while loading config status module: ${specifier}`);
    }
  });

  return {
    ...loadedModule,
    setCredentialStatus(next) {
      credentialStatus = next;
    }
  };
}

async function loadSessionSecretModule() {
  return loadTsModule(SESSION_SECRET_PATH, {
    require(specifier) {
      throw new Error(`Unexpected require while loading session secret module: ${specifier}`);
    }
  });
}

async function loadSafetyHashModule() {
  const crypto = await import("node:crypto");
  return loadTsModule(SAFETY_HASH_PATH, {
    require(specifier) {
      if (specifier === "node:crypto") return crypto;
      throw new Error(`Unexpected require while loading safety hash module: ${specifier}`);
    }
  });
}

async function loadSafetyServiceModule(repository) {
  const safetyHashModule = await loadSafetyHashModule();
  return loadTsModule(SAFETY_SERVICE_PATH, {
    require(specifier) {
      if (specifier === "./hash") return safetyHashModule;
      if (specifier === "./repository") {
        return {
          createSafetyEventRepository: () => repository
        };
      }
      throw new Error(`Unexpected require while loading safety event service module: ${specifier}`);
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
    Buffer,
    Date,
    exports: {},
    process,
    require: options.require
  };

  vm.createContext(sandbox);
  new vm.Script(transpiled.outputText, { filename: path.pathname }).runInContext(sandbox);
  return sandbox.exports;
}

function withEnv(nextEnv, fn) {
  const previous = { ...process.env };
  process.env = { ...previous, ...nextEnv };
  try {
    return fn();
  } finally {
    process.env = previous;
  }
}

async function withEnvAsync(nextEnv, fn) {
  const previous = { ...process.env };
  process.env = { ...previous, ...nextEnv };
  try {
    return await fn();
  } finally {
    process.env = previous;
  }
}

function expectedHmacFingerprint(secret, apiKey) {
  const vaultKey = createHash("sha256").update(secret).digest();
  return createHmac("sha256", vaultKey).update(apiKey).digest("hex").slice(0, 16);
}

function emptyCredential() {
  return {
    configured: false,
    kind: "llm",
    provider: null,
    endpointConfigured: false,
    endpointFingerprint: null,
    model: null,
    keyPreview: null,
    keyFingerprint: null,
    credentialSource: "server-env",
    updatedAt: null
  };
}

function safetyEventInput() {
  return {
    userId: "safety-user",
    companionId: "safety-companion",
    messageId: "safety-message",
    type: "SELF_HARM",
    action: "boundary_response",
    stage: "user_input",
    severity: "high",
    content: "I might hurt myself"
  };
}

function itemStatus(snapshot, id) {
  return snapshot.items.find((item) => item.id === id)?.status;
}

function assert(condition, message) {
  if (!condition) {
    errors.push(message);
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    errors.push(message);
  } catch {
    // Expected.
  }
}

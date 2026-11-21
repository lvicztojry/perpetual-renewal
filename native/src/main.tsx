import { Buffer } from "buffer";

// Set compatibility globals before importing any shared business modules. Never include developer env values.
const env = { NODE_ENV: "production", AUTH_MODE: "password", AUTH_APP_URL: "https://local.renewal.invalid", LLM_PROVIDER: "compatible", VOICE_PROVIDER: "shared-llm" };
Object.assign(globalThis, { Buffer, process: { env }, __RENEWAL_ENV__: env });
const { start } = await import("./start");
await start();

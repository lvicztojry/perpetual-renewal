import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig(({ mode }) => {
  const localEnv = loadEnv(mode, here("./"), "NATIVE_");
  const defaultLlm = process.env.NATIVE_BROWSER_TEST === "1" ? { provider: "compatible", apiKey: "", baseUrl: "", model: "" } : {
    provider: localEnv.NATIVE_DEFAULT_LLM_PROVIDER || "compatible",
    apiKey: localEnv.NATIVE_DEFAULT_LLM_API_KEY || "",
    baseUrl: localEnv.NATIVE_DEFAULT_LLM_BASE_URL || "",
    model: localEnv.NATIVE_DEFAULT_LLM_MODEL || ""
  };
  return {
    plugins: [react()],
    publicDir: here("../public"),
    clearScreen: false,
    server: { port: 4177, strictPort: true, fs: { allow: [here("../")] } },
    build: { target: "es2022" },
    define: { __BROWSER_TEST__: JSON.stringify(process.env.NATIVE_BROWSER_TEST === "1"), __NATIVE_DEFAULT_LLM__: JSON.stringify(defaultLlm), "process.env": "globalThis.__RENEWAL_ENV__" },
    resolve: {
      dedupe: ["react", "react-dom", "lucide-react"],
      alias: [
        { find: "@/lib/auth/session", replacement: here("./src/runtime/session.ts") },
        { find: "@/lib/http/request-origin", replacement: here("./src/runtime/request-origin.ts") },
        { find: "@/lib/persistence/memory-fallback", replacement: here("./src/runtime/persistence.ts") },
        { find: "@/lib/config/status", replacement: here("./src/runtime/config-status.ts") },
        { find: "@/lib/prisma", replacement: here("./src/runtime/prisma.ts") },
        { find: "@prisma/client", replacement: here("./src/runtime/prisma-enums.ts") },
        { find: "node:crypto", replacement: here("./src/runtime/crypto.ts") },
        { find: "next/server", replacement: here("./src/runtime/next-server.ts") },
        { find: "next/link", replacement: here("./src/ui/link.tsx") },
        { find: "next/navigation", replacement: here("./src/ui/navigation.ts") },
        { find: "@", replacement: here("../src") }
      ]
    }
  };
});

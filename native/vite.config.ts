import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export default defineConfig({
  plugins: [react()],
  publicDir: here("../public"),
  clearScreen: false,
  server: { port: 4177, strictPort: true, fs: { allow: [here("../")] } },
  build: { target: "es2022" },
  define: { __BROWSER_TEST__: JSON.stringify(process.env.NATIVE_BROWSER_TEST === "1"), "process.env": "globalThis.__RENEWAL_ENV__" },
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
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/*
 * Meridian on Cowork: a client-only build of the same app for a Claude artifact. Four modules are
 * swapped: the model call and the literature/identity functions (server functions in the server
 * build) become calls to the Claude artifact runtime, and the root route renders no document shell.
 * Output: dist-cowork/app.js (one classic script) and dist-cowork/app.css; scripts/cowork-page.mjs
 * writes the page that loads them.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      { find: /^@\/lib\/ai$/, replacement: here("./src/cowork/ai.ts") },
      { find: /^@\/lib\/evidence-server$/, replacement: here("./src/cowork/evidence-server.ts") },
      { find: /^\.\/routes\/__root$/, replacement: here("./src/cowork/root.tsx") },
      { find: /^@tanstack\/react-start$/, replacement: here("./src/cowork/no-server.ts") },
    ],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "import.meta.env.VITE_SCENARIO_MODE": JSON.stringify("false"),
  },
  plugins: [tailwindcss(), viteReact()],
  build: {
    outDir: "dist-cowork",
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: here("./src/cowork/main.tsx"),
      formats: ["iife"],
      name: "MeridianCowork",
      fileName: () => "app.js",
      cssFileName: "app",
    },
  },
});

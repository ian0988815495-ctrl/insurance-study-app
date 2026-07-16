import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: mode === "github-pages" ? "/insurance-study-app/" : "/",
  define: { "import.meta.env.VITE_OFFLINE_PWA": JSON.stringify(["offline", "github-pages"].includes(mode) ? "true" : "false") },
  build: { outDir: mode === "offline" ? "dist-offline" : mode === "github-pages" ? "dist-github-pages" : "dist" },
  server: { host: "127.0.0.1", port: 5173 },
  preview: {
    host: "127.0.0.1",
    allowedHosts: ["node.tail76c341.ts.net"]
  },
  test: { environment: "jsdom" }
}));

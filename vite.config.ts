import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { "import.meta.env.VITE_OFFLINE_PWA": JSON.stringify(mode === "offline" ? "true" : "false") },
  build: { outDir: mode === "offline" ? "dist-offline" : "dist" },
  server: { host: "127.0.0.1", port: 5173 },
  preview: {
    host: "127.0.0.1",
    allowedHosts: ["node.tail76c341.ts.net"]
  },
  test: { environment: "jsdom" }
}));
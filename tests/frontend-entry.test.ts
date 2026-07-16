// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("前端入口", () => {
  it("會把 App 掛載到 root 元素", () => {
    const entry = readFileSync(new URL("../src/web/main.tsx", import.meta.url), "utf8");
    expect(entry).toContain("createRoot");
    expect(entry).toContain('getElementById("root")');
  });

  it("提供只綁定本機位址的前後端啟動流程", () => {
    const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    const server = readFileSync(new URL("../src/server/index.ts", import.meta.url), "utf8");

    expect(packageJson.scripts["dev:api"]).toContain("src/server/index.ts");
    expect(packageJson.scripts["dev:web"]).toContain("127.0.0.1");
    expect(server).toContain('app.listen(port, "127.0.0.1"');
    expect(existsSync(new URL("../scripts/start-local.ps1", import.meta.url))).toBe(true);
  });

  it("本機啟動腳本可由 Windows PowerShell 5.1 解析", () => {
    const scriptPath = fileURLToPath(new URL("../scripts/start-local.ps1", import.meta.url)).replaceAll("'", "''");
    const command = `$tokens = $null; $errors = $null; [System.Management.Automation.Language.Parser]::ParseFile('${scriptPath}', [ref]$tokens, [ref]$errors) | Out-Null; if ($errors.Count -gt 0) { $errors | ForEach-Object { $_.Message }; exit 1 }`;
    const result = spawnSync("powershell", ["-NoProfile", "-Command", command], { encoding: "utf8" });

    expect(result.status, result.stderr || result.stdout).toBe(0);
  }, 10000);

  it("本機啟動前會檢查 SQLite 元件與固定 Node.js 版本是否相容", () => {
    const script = readFileSync(new URL("../scripts/start-local.ps1", import.meta.url), "utf8");

    expect(script).toContain("require('better-sqlite3')");
    expect(script).toContain("rebuild better-sqlite3");
  });

  it("提供可分批完成所有 AI 解析工作的本機工具", () => {
    const scriptPath = new URL("../scripts/run-ai-explanations.ps1", import.meta.url);
    expect(existsSync(scriptPath)).toBe(true);

    const script = readFileSync(scriptPath, "utf8");
    expect(script).toContain("http://127.0.0.1:3001/api");
    expect(script).toContain("/ai-explanations/run-pending");
    expect(script).toContain("127.0.0.1:11434/api/tags");
    expect(script).toContain("/ai-explanations/retry-failed");
  });

  it("將 App 與本機 API 錯誤處理維持在獨立模組", () => {
    const appPath = new URL("../src/web/App.tsx", import.meta.url);
    const apiPath = new URL("../src/web/api.ts", import.meta.url);

    expect(existsSync(appPath)).toBe(true);
    expect(existsSync(apiPath)).toBe(true);
    expect(readFileSync(appPath, "utf8")).toContain("export default function App");
    expect(readFileSync(apiPath, "utf8")).toContain("無法連線至本機題庫服務");
  });
});

// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

describe("正式產品範圍", () => {
  it("不顯示題目匯入或外部擷取功能，但保留內部安全匯入 API", () => {
    const appPath = path.join(root, "src", "web", "App.tsx");
    const homePath = path.join(root, "src", "web", "pages", "HomePage.tsx");
    const apiPath = path.join(root, "src", "server", "app.ts");
    const importPagePath = path.join(root, "src", "web", "pages", "ImportPage.tsx");
    const extensionDirectory = path.join(root, "chrome-extension");
    const appSource = fs.readFileSync(appPath, "utf8");
    const homeSource = fs.readFileSync(homePath, "utf8");
    const apiSource = fs.readFileSync(apiPath, "utf8");

    expect(appSource).not.toContain("ImportPage");
    expect(appSource).not.toContain('label="匯入"');
    expect(homeSource).not.toContain("題目匯入");
    expect(fs.existsSync(importPagePath)).toBe(false);
    expect(fs.existsSync(extensionDirectory)).toBe(false);
    expect(apiSource).toContain("/api/imports/preview");
    expect(apiSource).toContain("/api/imports/:id/confirm");
  });
});

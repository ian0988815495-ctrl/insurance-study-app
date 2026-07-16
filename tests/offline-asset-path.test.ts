import { describe, expect, it } from "vitest";
import { resolveOfflineSeedPath } from "../src/web/api.ts";

describe("離線題庫檔案位置", () => {
  it("會保留 GitHub Pages 的專案子路徑", () => {
    expect(resolveOfflineSeedPath("/insurance-study-app/")).toBe("/insurance-study-app/offline-seed.encrypted.json");
  });

  it("在網站根目錄部署時仍使用根目錄題庫檔", () => {
    expect(resolveOfflineSeedPath("/")).toBe("/offline-seed.encrypted.json");
  });
});

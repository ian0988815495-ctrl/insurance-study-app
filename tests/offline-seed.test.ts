// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("離線題庫加密檔", () => {
  it("僅提供加密題庫而不在公開資料夾保留明文", () => {
    const encryptedPath = new URL("../public/offline-seed.encrypted.json", import.meta.url);
    const plaintextPath = new URL("../public/offline-seed.json", import.meta.url);
    expect(existsSync(encryptedPath)).toBe(true);
    expect(existsSync(plaintextPath)).toBe(false);
    if (!existsSync(encryptedPath)) return;

    const encrypted = JSON.parse(readFileSync(encryptedPath, "utf8")) as { version: number; kdf: { iterations: number }; cipher: { name: string }; ciphertext: string; questions?: unknown };
    expect(encrypted.version).toBe(1);
    expect(encrypted.kdf.iterations).toBe(200_000);
    expect(encrypted.cipher.name).toBe("AES-GCM");
    expect(encrypted.ciphertext.length).toBeGreaterThan(100_000);
    expect(encrypted.questions).toBeUndefined();
  });
});

import { describe, expect, test } from "vitest";
import { unlockOfflineSeed, type EncryptedOfflineSeed } from "../src/web/offline-crypto.ts";

const encoder = new TextEncoder();

async function encryptFixture(password: string): Promise<EncryptedOfflineSeed> {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const iv = Uint8Array.from({ length: 12 }, (_, index) => index + 21);
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 200_000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const payload = { version: 1, generatedAt: "2026-07-15T00:00:00.000Z", questions: [{ id: "q-1", subject: "law", chapter: "第 1 章", questionText: "題目", correctOptionId: "o-1", rawExplanation: "解析", options: [{ id: "o-1", sourceLabel: "1", text: "選項" }] }] };
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(JSON.stringify(payload)));
  const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  return { version: 1, kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 200_000, salt: toBase64(salt) }, cipher: { name: "AES-GCM", iv: toBase64(iv) }, ciphertext: toBase64(new Uint8Array(encrypted)) };
}

describe("unlockOfflineSeed", () => {
  test("以正確密碼還原加密題庫", async () => {
    const encrypted = await encryptFixture("correct horse battery staple");
    await expect(unlockOfflineSeed(encrypted, "correct horse battery staple")).resolves.toMatchObject({ version: 1, questions: [{ id: "q-1", questionText: "題目" }] });
  });

  test("以錯誤密碼不能讀取題庫", async () => {
    const encrypted = await encryptFixture("correct horse battery staple");
    await expect(unlockOfflineSeed(encrypted, "wrong password")).rejects.toThrow("解鎖密碼不正確");
  });
});

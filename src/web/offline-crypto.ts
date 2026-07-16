import type { OfflineSeed } from "./offline-engine.ts";

export type EncryptedOfflineSeed = {
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
};

const decoder = new TextDecoder();

export async function unlockOfflineSeed(payload: EncryptedOfflineSeed, password: string): Promise<OfflineSeed> {
  if (!password.trim()) throw new Error("請輸入解鎖密碼。");
  try {
    const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
    const key = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: fromBase64(payload.kdf.salt), iterations: payload.kdf.iterations, hash: payload.kdf.hash },
      baseKey,
      { name: payload.cipher.name, length: 256 },
      false,
      ["decrypt"]
    );
    const plaintext = await crypto.subtle.decrypt({ name: payload.cipher.name, iv: fromBase64(payload.cipher.iv) }, key, fromBase64(payload.ciphertext));
    return JSON.parse(decoder.decode(plaintext)) as OfflineSeed;
  } catch {
    throw new Error("解鎖密碼不正確，或題庫資料無法讀取。");
  }
}

function fromBase64(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

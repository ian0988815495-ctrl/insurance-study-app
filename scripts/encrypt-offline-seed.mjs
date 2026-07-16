import "dotenv/config";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { minimumOfflineUnlockPasswordLength, validateOfflineUnlockPassword } from "./offline-password-policy.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "work", "offline-seed.json");
const outputPath = join(root, "public", "offline-seed.encrypted.json");
const publicPlaintextPath = join(root, "public", "offline-seed.json");
const password = process.env.OFFLINE_UNLOCK_PASSWORD?.trim();

if (!validateOfflineUnlockPassword(password)) {
  throw new Error(`OFFLINE_UNLOCK_PASSWORD 必須至少 ${minimumOfflineUnlockPasswordLength} 個字元，且只能保存在未提交的 .env 中。`);
}

const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, 200_000, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const plaintext = readFileSync(sourcePath);
const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

writeFileSync(outputPath, JSON.stringify({
  version: 1,
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 200_000, salt: salt.toString("base64") },
  cipher: { name: "AES-GCM", iv: iv.toString("base64") },
  ciphertext: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString("base64")
}));
rmSync(publicPlaintextPath, { force: true });
console.log(`Encrypted offline seed written to ${outputPath}`);

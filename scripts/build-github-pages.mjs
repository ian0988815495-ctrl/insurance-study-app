import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { selectOfflineSeedSource } from "./offline-seed-source.mjs";

const root = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const node = process.execPath;
const baseSeedPath = join(root, "work", "offline-seed.json");
const enrichedSeedPath = join(root, "work", "offline-seed.with-chatgpt-analyses.json");
const encryptedOutput = join(root, "public", "offline-seed.encrypted.json");
const publicPlaintextOutput = join(root, "work", "offline-seed.github-pages.public.json");

run("scripts/export-offline-seed.mjs", []);
const selected = selectOfflineSeedSource(baseSeedPath, enrichedSeedPath);
const env = {
  ...process.env,
  OFFLINE_SEED_SOURCE: selected.path,
  OFFLINE_ENCRYPTED_OUTPUT: encryptedOutput,
  OFFLINE_PUBLIC_PLAINTEXT_OUTPUT: publicPlaintextOutput,
  VITE_OFFLINE_SEED_FILE: "offline-seed.encrypted.json"
};

console.log(`GitHub Pages seed: ${selected.enriched ? "含完整 AI 解析" : "尚未有完整 AI 解析，使用基礎題庫"}`);
run("scripts/encrypt-offline-seed.mjs", [], env);
run("node_modules/vite/bin/vite.js", ["build", "--mode", "github-pages"], env);

function run(file, args, commandEnv = process.env) {
  const result = spawnSync(node, [join(root, file), ...args], { cwd: root, env: commandEnv, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const node = process.execPath;
const seedSource = join(root, "work", "offline-seed.with-chatgpt-analyses.json");
const encryptedOutput = join(root, "public", "offline-seed.with-chatgpt-analyses.encrypted.json");
const publicPlaintextOutput = join(root, "work", "offline-seed.with-chatgpt-analyses.public.json");
const env = {
  ...process.env,
  OFFLINE_SEED_SOURCE: seedSource,
  OFFLINE_ENCRYPTED_OUTPUT: encryptedOutput,
  OFFLINE_PUBLIC_PLAINTEXT_OUTPUT: publicPlaintextOutput,
  VITE_OFFLINE_SEED_FILE: "offline-seed.with-chatgpt-analyses.encrypted.json"
};

run("scripts/merge-chatgpt-analysis.mjs", []);
run("scripts/encrypt-offline-seed.mjs", [], env);
run("node_modules/vite/bin/vite.js", ["build", "--mode", "offline"], env);

function run(file, args, commandEnv = process.env) {
  const result = spawnSync(node, [join(root, file), ...args], { cwd: root, env: commandEnv, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

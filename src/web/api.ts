import { createOfflineApi } from "./offline-api.ts";
import { unlockOfflineSeed, type EncryptedOfflineSeed } from "./offline-crypto.ts";
import { clearActivePractice, loadActivePractice, saveActivePractice, type ActivePractice } from "./active-practice.ts";
import { loadPhoneSync, savePhoneSync } from "./phone-sync.ts";

export const isOfflinePwa = import.meta.env.VITE_OFFLINE_PWA === "true";
export const apiBase = isOfflinePwa ? "" : "http://127.0.0.1:3001/api";

let offlineApi: ReturnType<typeof createOfflineApi> | null = null;
let syncTimer: ReturnType<typeof setTimeout> | undefined;

export function resolveOfflineSeedPath(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBaseUrl}offline-seed.encrypted.json`;
}

export async function unlockOfflineApi(password: string) {
  if (!isOfflinePwa) return;
  const response = await fetch(resolveOfflineSeedPath(import.meta.env.BASE_URL), { cache: "no-store" });
  if (!response.ok) throw new Error("無法載入加密題庫資料。");
  const seed = await unlockOfflineSeed(await response.json() as EncryptedOfflineSeed, password);
  offlineApi = createOfflineApi({ loadSeed: async () => seed, onStateChanged: schedulePhoneSync });
}

export function lockOfflineApi() {
  offlineApi = null;
}

export function schedulePhoneSync() {
  if (!isOfflinePwa) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { void syncPhoneProgress(); }, 500);
}

export async function syncPhoneProgress() {
  if (!offlineApi) return false;
  return savePhoneSync({ state: await offlineApi.exportSyncState(), activePractice: loadActivePractice() });
}

export async function restorePhoneProgress() {
  if (!offlineApi) return false;
  const remote = await loadPhoneSync();
  if (!remote) return false;
  const local = await offlineApi.exportSyncState();
  const remoteStamp = new Date(remote.state.updatedAt ?? 0).getTime();
  const localStamp = new Date(local.updatedAt ?? 0).getTime();
  if (remoteStamp < localStamp) return syncPhoneProgress();
  await offlineApi.replaceSyncState(remote.state);
  if (remote.activePractice) saveActivePractice(remote.activePractice);
  else clearActivePractice();
  return true;
}

export function savePhonePractice(progress: ActivePractice) {
  saveActivePractice({ ...progress, updatedAt: new Date().toISOString() });
  schedulePhoneSync();
}

export function clearPhonePractice() {
  clearActivePractice();
  schedulePhoneSync();
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (isOfflinePwa) {
    if (!offlineApi) throw new Error("請先解鎖題庫。");
    return offlineApi<T>(path, init);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, { headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, ...init });
  } catch {
    throw new Error("無法連線至本機題庫服務。");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? body.message ?? "操作失敗。");
  return body as T;
}

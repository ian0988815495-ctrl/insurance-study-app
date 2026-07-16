import { createOfflineApi } from "./offline-api.ts";
import { unlockOfflineSeed, type EncryptedOfflineSeed } from "./offline-crypto.ts";

export const isOfflinePwa = import.meta.env.VITE_OFFLINE_PWA === "true";
export const apiBase = isOfflinePwa ? "" : "http://127.0.0.1:3001/api";

let offlineApi: ReturnType<typeof createOfflineApi> | null = null;

export async function unlockOfflineApi(password: string) {
  if (!isOfflinePwa) return;
  const response = await fetch("/offline-seed.encrypted.json", { cache: "no-store" });
  if (!response.ok) throw new Error("無法載入加密題庫資料。");
  const seed = await unlockOfflineSeed(await response.json() as EncryptedOfflineSeed, password);
  offlineApi = createOfflineApi({ loadSeed: async () => seed });
}

export function lockOfflineApi() {
  offlineApi = null;
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

import { describe, expect, it } from "vitest";
import { createOfflineStore } from "../src/web/offline-store.ts";

const seed = {
  version: 1,
  questions: [{ id: "q-1", subject: "保險法規", chapter: "第一章", questionText: "題目", correctOptionId: "q-1-b", rawExplanation: "解析", options: [{ id: "q-1-a", text: "甲" }, { id: "q-1-b", text: "乙" }] }]
};

describe("手機離線資料保存", () => {
  it("重新開啟時保留已作答紀錄與錯題統計", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const first = createOfflineStore(seed, storage);
    first.recordAnswer("q-1", "q-1-a");

    const reopened = createOfflineStore(seed, storage);
    expect(reopened.dashboard()).toMatchObject({ total: 1, wrong: 1, commonWrong: 0 });
  });

  it("persists the exam date for offline study planning", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const first = createOfflineStore(seed, storage);
    first.setExamDate("2026-09-30");

    expect(createOfflineStore(seed, storage).getExamDate()).toBe("2026-09-30");
  });

  it("restores only locally stored progress without changing the bundled questions", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const first = createOfflineStore(seed, storage);
    first.recordAnswer("q-1", "q-1-a");
    const backup = first.exportBackup();
    const cleanValues = new Map<string, string>();
    const restored = createOfflineStore(seed, { getItem: (key: string) => cleanValues.get(key) ?? null, setItem: (key: string, value: string) => cleanValues.set(key, value) });

    restored.restoreBackup(backup);

    expect(restored.dashboard()).toMatchObject({ total: 1, wrong: 1 });
  });
});

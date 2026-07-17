import { describe, expect, it } from "vitest";
import { clearActivePractice, loadActivePractice, saveActivePractice } from "../src/web/active-practice.ts";

const questions = Array.from({ length: 4 }, (_, index) => ({
  id: `question-${index + 1}`,
  subject: "保險法規",
  chapter: "第一章",
  questionText: `測試題 ${index + 1}`,
  options: [{ id: `option-${index + 1}`, text: "甲" }]
}));

function createStorage() {
  const values = new Map<string, string>();
  return { values, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } };
}

describe("未完成練習進度", () => {
  it("重新開啟後保留同一組題目順序、每題選擇、公布狀態與目前題號", () => {
    const { storage } = createStorage();
    const progress = {
      sessionId: "session-1",
      questions,
      index: 3,
      selectedAnswers: { "question-1": "option-1", "question-4": "option-4" },
      revealedQuestions: ["question-1"],
      sessionStatus: "active" as const,
      startedAt: "2026-07-17T08:00:00.000Z",
      updatedAt: "2026-07-17T08:30:00.000Z"
    };

    saveActivePractice(progress, storage);

    expect(loadActivePractice(storage)).toEqual(progress);
  });

  it("可以將舊版單題快照遷移成完整進度快照", () => {
    const { storage } = createStorage();
    storage.setItem("private-insurance-question-bank.active-practice.v1", JSON.stringify({ sessionId: "legacy", questions, index: 3, selectedOptionId: "option-4", viewedAnswer: true, updatedAt: "2026-07-17T08:30:00.000Z" }));

    expect(loadActivePractice(storage)).toMatchObject({
      sessionId: "legacy",
      index: 3,
      selectedAnswers: { "question-4": "option-4" },
      revealedQuestions: ["question-4"],
      sessionStatus: "active",
      startedAt: "2026-07-17T08:30:00.000Z",
      updatedAt: "2026-07-17T08:30:00.000Z"
    });
  });

  it("完成或確認結束後會清除可繼續的進度", () => {
    const { storage } = createStorage();
    saveActivePractice({ sessionId: "session-1", questions, index: 0, selectedAnswers: {}, revealedQuestions: [], sessionStatus: "active", startedAt: "2026-07-17T08:00:00.000Z", updatedAt: "2026-07-17T08:00:00.000Z" }, storage);

    clearActivePractice(storage);

    expect(loadActivePractice(storage)).toBeNull();
    expect(storage.getItem("private-insurance-question-bank.active-practice.v1")).toBeNull();
  });
});

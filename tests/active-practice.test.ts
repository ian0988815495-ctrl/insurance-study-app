import { describe, expect, it } from "vitest";
import { clearActivePractice, loadActivePractice, saveActivePractice } from "../src/web/active-practice.ts";

const questions = Array.from({ length: 4 }, (_, index) => ({
  id: `question-${index + 1}`,
  subject: "保險法規",
  chapter: "第一章",
  questionText: `測試題 ${index + 1}`,
  options: [{ id: `option-${index + 1}`, text: "甲" }]
}));

describe("未完成練習進度", () => {
  it("重新開啟後會保留同一組題目與目前題號", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };

    saveActivePractice({ sessionId: "session-1", questions, index: 3, selectedOptionId: "option-4", viewedAnswer: true }, storage);

    expect(loadActivePractice(storage)).toEqual({ sessionId: "session-1", questions, index: 3, selectedOptionId: "option-4", viewedAnswer: true });
  });

  it("完成練習後會清除可繼續的進度", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
    saveActivePractice({ sessionId: "session-1", questions, index: 0 }, storage);

    clearActivePractice(storage);

    expect(loadActivePractice(storage)).toBeNull();
  });
});

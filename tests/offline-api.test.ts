import { describe, expect, it } from "vitest";
import { createOfflineApi } from "../src/web/offline-api.ts";

const seed = {
  version: 1,
  questions: [
    {
      id: "law-1",
      subject: "保險法規",
      chapter: "第一章",
      questionText: "法規題",
      correctOptionId: "law-1-b",
      rawExplanation: "法規解析",
      options: [{ id: "law-1-a", text: "甲" }, { id: "law-1-b", text: "乙" }]
    },
    {
      id: "practice-1",
      subject: "保險實務",
      chapter: "第一章",
      questionText: "實務題",
      correctOptionId: "practice-1-a",
      rawExplanation: "實務解析",
      options: [{ id: "practice-1-a", text: "甲" }, { id: "practice-1-b", text: "乙" }]
    }
  ]
};

describe("離線 API", () => {
  it("以本機題庫建立法規練習、保存錯題並回傳原始解析", async () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) };
    const api = createOfflineApi({ loadSeed: async () => seed, storage });

    const session = await api<{ id: string; questionCount: number }>("/practice-sessions", { method: "POST", body: JSON.stringify({ mode: "sequential", subject: "law", shuffleQuestions: false, shuffleOptions: false }) });
    const questions = await api<{ questions: Array<{ id: string }> }>(`/practice-sessions/${session.id}/questions`);
    await api("/attempts", { method: "POST", body: JSON.stringify({ questionId: "law-1", eventType: "answer", selectedOptionId: "law-1-a" }) });
    const dashboard = await api<{ wrong: number }>("/dashboard");
    const review = await api<{ correctOptionId: string; rawExplanation: string }>("/questions/law-1/review");

    expect(session.questionCount).toBe(1);
    expect(questions.questions.map((question) => question.id)).toEqual(["law-1"]);
    expect(dashboard.wrong).toBe(1);
    expect(review).toMatchObject({ correctOptionId: "law-1-b", rawExplanation: "法規解析" });
  });

  it("建立有 80 分鐘限制的法規模考，交卷後才回傳成績", async () => {
    const examSeed = {
      version: 1,
      questions: Array.from({ length: 100 }, (_, index) => ({
        id: `law-${index}`,
        subject: "保險法規",
        chapter: "第一章",
        questionText: `法規題 ${index}`,
        correctOptionId: `law-${index}-a`,
        rawExplanation: "解析",
        options: [{ id: `law-${index}-a`, text: "甲" }, { id: `law-${index}-b`, text: "乙" }]
      }))
    };
    const values = new Map<string, string>();
    const api = createOfflineApi({ loadSeed: async () => examSeed, storage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } });

    const exam = await api<{ id: string; endsAt: string; questions: Array<{ id: string }> }>("/exams/fixed", { method: "POST", body: JSON.stringify({ type: "law" }) });
    const result = await api<{ total: number; correct: number; score: number }>(`/exams/${exam.id}/submit`, { method: "POST", body: JSON.stringify({ answers: [] }) });

    expect(exam.questions).toHaveLength(100);
    expect(new Date(exam.endsAt).getTime()).toBeGreaterThan(Date.now() + 79 * 60_000);
    expect(result).toMatchObject({ total: 100, correct: 0, score: 0 });
  });
});

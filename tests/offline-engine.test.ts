import { describe, expect, it } from "vitest";
import { createOfflineEngine } from "../src/web/offline-engine.ts";

const seed = {
  version: 1,
  questions: [
    { id: "law-1", subject: "保險法規", chapter: "第一章", questionText: "法規題", correctOptionId: "law-1-b", rawExplanation: "法規解析", options: [{ id: "law-1-a", text: "甲" }, { id: "law-1-b", text: "乙" }] },
    { id: "practice-1", subject: "保險實務", chapter: "第一章", questionText: "實務題", correctOptionId: "practice-1-a", rawExplanation: "實務解析", options: [{ id: "practice-1-a", text: "甲" }, { id: "practice-1-b", text: "乙" }] }
  ]
};

describe("離線題庫引擎", () => {
  it("依科目建立練習，保存作答後可取得答案與錯題統計", () => {
    const engine = createOfflineEngine(seed);
    const session = engine.createPracticeSession({ mode: "sequential", subject: "law", shuffleQuestions: false, shuffleOptions: false });

    expect(session.questions.map((question) => question.id)).toEqual(["law-1"]);
    expect(engine.recordAnswer("law-1", "law-1-a")).toBe(false);
    expect(engine.review("law-1")).toMatchObject({ correctOptionId: "law-1-b", rawExplanation: "法規解析" });
    expect(engine.dashboard()).toMatchObject({ total: 2, wrong: 1, commonWrong: 0, mastered: 0 });
  });
});

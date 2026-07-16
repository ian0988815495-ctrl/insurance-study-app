// @vitest-environment node
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { createTestDatabase } from "../src/server/db.ts";

function seedQuestions(database: ReturnType<typeof createTestDatabase>, subject: string, count: number, offset: number) {
  return Array.from({ length: count }, (_, index) => {
    const sequence = String(offset + index).padStart(12, "0");
    const questionId = `10000000-0000-4000-8000-${sequence}`;
    const correctOptionId = `30000000-0000-4000-8000-${sequence}`;
    database.addQuestion({
      id: questionId,
      sourceUrl: "private://fixed-exam-test",
      subject,
      chapter: "測驗章節",
      questionText: `${subject} 題目 ${index + 1}`,
      options: [
        { id: `20000000-0000-4000-8000-${sequence}`, text: "甲" },
        { id: correctOptionId, text: "乙" }
      ],
      correctOptionId,
      rawExplanation: "原始解析",
      fingerprint: `fixed-exam-${subject}-${sequence}`
    });
    return { questionId, correctOptionId };
  });
}

describe("固定模考", () => {
  const databases: ReturnType<typeof createTestDatabase>[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it("法規模考固定建立 100 題與 80 分鐘，且題目不包含答案", async () => {
    const database = createTestDatabase();
    databases.push(database);
    seedQuestions(database, "保險法規", 100, 1);
    const app = createApp({ database });

    const exam = await request(app).post("/api/exams/fixed").send({ type: "law" });

    expect(exam.status).toBe(201);
    expect(exam.body.durationMinutes).toBe(80);
    expect(exam.body.questions).toHaveLength(100);
    expect(exam.body.questions[0].correctOptionId).toBeUndefined();
  });

  it("正確答案待確認的題目不可補足正式模考題數", async () => {
    const database = createTestDatabase();
    databases.push(database);
    seedQuestions(database, "保險法規", 99, 1);
    database.addQuestion({
      id: "10000000-0000-4000-8000-000000009999",
      sourceUrl: "private://fixed-exam-test",
      subject: "保險法規",
      chapter: "測驗章節",
      questionText: "答案待確認題",
      options: [{ id: "20000000-0000-4000-8000-000000009999", text: "原始選項" }],
      correctOptionId: "",
      answerStatus: "pending-review",
      rawExplanation: "",
      fingerprint: "fixed-exam-pending-answer"
    });
    const app = createApp({ database });

    const exam = await request(app).post("/api/exams/fixed").send({ type: "law" });
    expect(exam.status).toBe(422);
    expect(exam.body.error).toContain("題目不足");
  });

  it("完整測驗依序完成兩科，依單科與總分門檻判定通過", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const lawAnswers = seedQuestions(database, "保險法規", 100, 1);
    const practiceAnswers = seedQuestions(database, "保險實務", 50, 101);
    const app = createApp({ database });

    const firstStage = await request(app).post("/api/exams/fixed").send({ type: "full" });
    expect(firstStage.body.stage).toBe("law");
    expect(firstStage.body.durationMinutes).toBe(80);

    await request(app).post(`/api/exams/${firstStage.body.exam.id}/submit`).send({ answers: lawAnswers.map(({ questionId, correctOptionId }) => ({ questionId, selectedOptionId: correctOptionId })) });
    const secondStage = await request(app).post(`/api/exam-series/${firstStage.body.seriesId}/next`);
    expect(secondStage.body.stage).toBe("practice");
    expect(secondStage.body.durationMinutes).toBe(60);

    await request(app).post(`/api/exams/${secondStage.body.exam.id}/submit`).send({ answers: practiceAnswers.map(({ questionId, correctOptionId }) => ({ questionId, selectedOptionId: correctOptionId })) });
    const result = await request(app).get(`/api/exam-series/${firstStage.body.seriesId}/result`);

    expect(result.body).toMatchObject({ passed: true, lawScore: 100, practiceScore: 100, totalScore: 200 });
  });
});

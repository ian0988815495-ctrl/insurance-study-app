// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/server/app.ts";
import { createTestDatabase } from "../src/server/db.ts";

function addQuestion(database: ReturnType<typeof createTestDatabase>, id: string, questionText: string) {
  const optionIds = [
    `${id.slice(0, 8)}-0000-4000-8000-000000000011`,
    `${id.slice(0, 8)}-0000-4000-8000-000000000012`
  ];
  database.addQuestion({
    id,
    sourceUrl: "private://question-bank",
    subject: "保險法規",
    chapter: "測驗章節",
    questionText,
    options: [{ id: optionIds[0], text: "甲" }, { id: optionIds[1], text: "乙" }],
    correctOptionId: optionIds[1],
    rawExplanation: "原始解析",
    fingerprint: `study-plan-${id}`
  });
  return database.questionWithOptions(id);
}

describe("讀書計畫排程", () => {
  const databases: ReturnType<typeof createTestDatabase>[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it("依到期複習、錯題加強與新題順序建立今日計畫，且不重複題目", () => {
    const database = createTestDatabase();
    databases.push(database);
    const dueQuestion = addQuestion(database, "20000000-0000-4000-8000-000000000001", "到期複習題");
    const wrongQuestion = addQuestion(database, "30000000-0000-4000-8000-000000000001", "錯題加強題");
    const newQuestion = addQuestion(database, "40000000-0000-4000-8000-000000000001", "新題練習題");

    database.recordAttempt({ questionId: dueQuestion.id, eventType: "answer", selectedOptionId: dueQuestion.correctOptionId });
    database.updateReviewSchedule(dueQuestion.id, "answer", false, new Date("2026-07-13T00:00:00"));
    expect(database.sqlite.prepare("SELECT due_date FROM review_schedules WHERE question_id = ?").get(dueQuestion.id)).toEqual({ due_date: "2026-07-14" });
    database.recordAttempt({ questionId: wrongQuestion.id, eventType: "answer", selectedOptionId: wrongQuestion.options[0].id });
    database.setExamDate("2026-07-25");

    expect(database.getStudyPlan(new Date("2026-07-14T00:00:00"))).toMatchObject({
      examDate: "2026-07-25",
      daysRemaining: 11,
      counts: { due: 1, wrong: 1, new: 1 },
      questionIds: [dueQuestion.id, wrongQuestion.id, newQuestion.id]
    });
  });

  it("保存每日建議快取，並在計畫條件改變時使用不同快取鍵", () => {
    const database = createTestDatabase();
    databases.push(database);
    addQuestion(database, "50000000-0000-4000-8000-000000000001", "每日建議題");
    database.setExamDate("2026-07-25");

    const now = new Date("2026-07-14T00:00:00");
    const plan = database.getStudyPlan(now);
    const firstKey = database.createStudyPlanAdviceKey(plan, now);
    database.saveStudyPlanAdvice({
      cacheKey: firstKey,
      planDate: "2026-07-14",
      examDate: "2026-07-25",
      content: "先完成今天的安排。",
      source: "fallback",
      model: null
    });

    expect(database.getStudyPlanAdvice(firstKey)).toMatchObject({ content: "先完成今天的安排。", source: "fallback" });

    database.setExamDate("2026-07-26");
    const nextKey = database.createStudyPlanAdviceKey(database.getStudyPlan(now), now);
    expect(nextKey).not.toBe(firstKey);
  });

  it("儲存今天或未來的考試日期並拒絕過去日期", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });

    const saved = await request(app).put("/api/study-plan/settings").send({ examDate: "2026-07-25" });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ examDate: "2026-07-25" });

    const plan = await request(app).get("/api/study-plan");
    expect(plan.status).toBe(200);
    expect(plan.body).toMatchObject({ examDate: "2026-07-25" });

    const pastDate = await request(app).put("/api/study-plan/settings").send({ examDate: "2000-01-01" });
    expect(pastDate.status).toBe(400);
    expect(database.getStudyPlan().examDate).toBe("2026-07-25");
  });

  it("本機網頁可以預檢儲存考試日期的 PUT 請求", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });

    const response = await request(app)
      .options("/api/study-plan/settings")
      .set("Origin", "http://127.0.0.1:5173")
      .set("Access-Control-Request-Method", "PUT");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
  });

  it("同日相同計畫只產生一次 AI 建議", async () => {
    const database = createTestDatabase();
    databases.push(database);
    addQuestion(database, "60000000-0000-4000-8000-000000000001", "AI 建議題");
    database.setExamDate("2026-07-25");
    const app = createApp({ database });
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalModel = process.env.OPENAI_MODEL;
    const originalProvider = process.env.AI_PROVIDER;
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "先完成到期複習，再處理錯題。今天穩定完成即可。" }), { status: 200 }));

    try {
      process.env.OPENAI_API_KEY = "test-key";
      process.env.OPENAI_MODEL = "test-model";
      process.env.AI_PROVIDER = "openai";
      vi.stubGlobal("fetch", fetchMock);

      const first = await request(app).get("/api/study-plan");
      const second = await request(app).get("/api/study-plan");

      expect(first.body.advice).toMatchObject({ source: "ai", content: "先完成到期複習，再處理錯題。今天穩定完成即可。" });
      expect(second.body.advice).toEqual(first.body.advice);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
      if (originalModel === undefined) delete process.env.OPENAI_MODEL;
      else process.env.OPENAI_MODEL = originalModel;
      if (originalProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = originalProvider;
    }
  });

  it("未設定 AI 金鑰時保留可讀的本機建議", async () => {
    const database = createTestDatabase();
    databases.push(database);
    addQuestion(database, "70000000-0000-4000-8000-000000000001", "替代建議題");
    database.setExamDate("2026-07-25");
    const app = createApp({ database });
    const originalApiKey = process.env.OPENAI_API_KEY;

    try {
      delete process.env.OPENAI_API_KEY;
      const response = await request(app).get("/api/study-plan");
      expect(response.status).toBe(200);
      expect(response.body.advice).toMatchObject({ source: "fallback" });
      expect(response.body.advice.content).toContain("距離考試還有");
    } finally {
      if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalApiKey;
    }
  });

  it("空題庫可取得零任務，今日計畫不允許打亂順序", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });

    expect((await request(app).get("/api/study-plan")).body).toMatchObject({ questionIds: [], counts: { due: 0, wrong: 0, new: 0 } });
    database.setExamDate("2026-07-25");
    const invalid = await request(app).post("/api/practice-sessions").send({ mode: "study-plan", shuffleQuestions: true, shuffleOptions: false });
    expect(invalid.status).toBe(400);

    const valid = await request(app).post("/api/practice-sessions").send({ mode: "study-plan", shuffleQuestions: false, shuffleOptions: false });
    expect(valid).toMatchObject({ status: 201, body: { questionCount: 0 } });
  });

  it("匯出讀書計畫資料，並接受沒有讀書計畫的舊版備份", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    database.setExamDate("2026-07-25");
    const now = new Date("2026-07-14T00:00:00");
    const plan = database.getStudyPlan(now);
    database.saveStudyPlanAdvice({
      cacheKey: database.createStudyPlanAdviceKey(plan, now),
      planDate: "2026-07-14",
      examDate: "2026-07-25",
      content: "今天完成安排即可。",
      source: "fallback",
      model: null
    });

    const exported = await request(app).get("/api/backups/export");
    expect(exported.body).toMatchObject({
      schemaVersion: 4,
      data: {
        study_plan_settings: [{ exam_date: "2026-07-25" }],
        review_schedules: [],
        study_plan_advices: [{ content: "今天完成安排即可。", source: "fallback" }]
      }
    });

    const { study_plan_settings: _settings, review_schedules: _schedules, study_plan_advices: _advices, ...legacyData } = exported.body.data;
    const legacy = { schemaVersion: 1, exportedAt: exported.body.exportedAt, data: legacyData };
    expect((await request(app).post("/api/backups/preview").send(legacy)).status).toBe(200);

    const version2 = { schemaVersion: 2, exportedAt: exported.body.exportedAt, data: { ...legacyData, study_plan_settings: exported.body.data.study_plan_settings, review_schedules: exported.body.data.review_schedules } };
    expect((await request(app).post("/api/backups/preview").send(version2)).status).toBe(200);
  });
});

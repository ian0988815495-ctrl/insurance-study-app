// @vitest-environment node
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.ts";
import { createTestDatabase } from "../src/server/db.ts";

describe("題目匯入", () => {
  const databases: ReturnType<typeof createTestDatabase>[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it("預覽不會寫入，使用者確認後才會保存穩定選項 ID", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const payload = {
      sourceUrl: "https://example.test/question/1",
      subject: "保險法規",
      chapter: "保險契約",
      questionText: "誰可以終止保險契約？",
      options: [{ text: "被保險人" }, { text: "要保人" }, { text: "受益人" }],
      correctOptionIndex: 1,
      rawExplanation: "原始解析"
    };

    const preview = await request(app).post("/api/imports/preview").send(payload);

    expect(preview.status).toBe(200);
    expect(preview.body.canConfirm).toBe(true);
    expect(database.count("questions")).toBe(0);

    const loaded = await request(app).get(`/api/imports/${preview.body.importId}`);
    expect(loaded.status).toBe(200);
    expect(loaded.body.question.questionText).toBe(payload.questionText);

    const confirmed = await request(app).post(`/api/imports/${preview.body.importId}/confirm`).send({ confirmed: true });

    expect(confirmed.status).toBe(201);
    const question = database.questionWithOptions(confirmed.body.questionId);
    expect(question.correctOptionId).toBe(question.options[1].id);
  });

  it("缺答案題目會保留待確認，重複題不可再次寫入", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const payload = {
      sourceUrl: "https://example.test/question/2",
      subject: "保險實務",
      chapter: "人身保險",
      questionText: "重複題測試",
      options: [{ text: "甲" }, { text: "乙" }],
      correctOptionIndex: 0,
      rawExplanation: "原始解析"
    };

    const missingAnswer = await request(app).post("/api/imports/preview").send({ ...payload, correctOptionIndex: undefined });
    expect(missingAnswer.body.canConfirm).toBe(true);
    expect(missingAnswer.body.question.answerStatus).toBe("pending-review");

    const first = await request(app).post("/api/imports/preview").send(payload);
    await request(app).post(`/api/imports/${first.body.importId}/confirm`).send({ confirmed: true });
    const duplicate = await request(app).post("/api/imports/preview").send(payload);

    expect(duplicate.body.canConfirm).toBe(false);
    expect(duplicate.body.warnings).toEqual(expect.arrayContaining([expect.stringContaining("重複")]));
  });

  it("來源頁沒有原始解析時會提醒，但不阻擋已確認答案的題目匯入", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });

    const preview = await request(app).post("/api/imports/preview").send({
      sourceUrl: "https://example.test/question/3",
      subject: "保險實務",
      chapter: "第 5 章",
      questionText: "沒有解析的題目",
      options: [{ text: "甲" }, { text: "乙" }],
      correctOptionIndex: 1,
      rawExplanation: ""
    });

    expect(preview.body.canConfirm).toBe(true);
    expect(preview.body.warnings).toEqual(expect.arrayContaining([expect.stringContaining("未提供原始解析")]));
  });

  it("章節預覽不寫入，確認後只新增有效題目", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const preview = await request(app).post("/api/imports/batches/preview").send({
      sourceUrl: "visible://law/chapter-1", subject: "保險法規", chapter: "保險法規第1章",
      questions: [
        { questionText: "有效題", options: [{ sourceLabel: "1", text: "甲" }, { sourceLabel: "2", text: "乙" }], correctOptionIndex: 1 },
        { questionText: "缺答案", options: [{ sourceLabel: "1", text: "甲" }] }
      ]
    });
    expect(preview.status).toBe(200);
    expect(preview.body.summary).toMatchObject({ total: 2, valid: 1, pendingAnswer: 1 });
    expect(database.count("questions")).toBe(0);
    const confirmed = await request(app).post(`/api/imports/batches/${preview.body.batchId}/confirm`).send({ confirmed: true });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ inserted: 2, skipped: 0 });
    expect(database.count("questions")).toBe(2);
    expect(database.sqlite.prepare("SELECT answer_status FROM questions WHERE question_text = ?").get("缺答案")).toMatchObject({ answer_status: "pending-review" });
  });

  it("重新匯入已存在的待確認題目時，會補上已驗證的正確答案", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const base = {
      sourceUrl: "visible://practice/chapter-5", subject: "保險實務", chapter: "保險實務第5章",
      questionText: "可補正答案的題目", options: [{ sourceLabel: "1", text: "甲" }, { sourceLabel: "2", text: "乙" }], rawExplanation: "來源解析"
    };

    const initial = await request(app).post("/api/imports/batches/preview").send({ ...base, questions: [{ questionText: base.questionText, options: base.options }] });
    await request(app).post(`/api/imports/batches/${initial.body.batchId}/confirm`).send({ confirmed: true });
    const verified = await request(app).post("/api/imports/batches/preview").send({ ...base, questions: [{ questionText: base.questionText, options: base.options, correctOptionIndex: 1, rawExplanation: base.rawExplanation }] });
    const confirmed = await request(app).post(`/api/imports/batches/${verified.body.batchId}/confirm`).send({ confirmed: true });

    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ inserted: 0, upgraded: 1, skipped: 0 });
    const question = database.questionWithOptions();
    expect(question).toMatchObject({ answerStatus: "ready", rawExplanation: "來源解析", correctOptionId: question.options[1].id });
  });

  it("允許本機擴充功能預覽題目，但只開放明確的跨來源請求", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });

    const response = await request(app)
      .options("/api/imports/preview")
      .set("Origin", "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
      .set("Access-Control-Request-Method", "POST");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });
});

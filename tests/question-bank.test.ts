// @vitest-environment node
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/server/app.ts";
import { createTestDatabase } from "../src/server/db.ts";

function addQuestion(database: ReturnType<typeof createTestDatabase>, input: { id: string; subject: string; questionText: string }) {
  const optionPrefix = input.id.slice(-1);
  const optionIds = {
    first: `${optionPrefix}0000000-0000-4000-8000-000000000001`,
    second: `${optionPrefix}0000000-0000-4000-8000-000000000002`,
    third: `${optionPrefix}0000000-0000-4000-8000-000000000003`
  };
  database.addQuestion({
    id: input.id,
    sourceUrl: "private://question-bank",
    subject: input.subject,
    chapter: "測驗章節",
    questionText: input.questionText,
    options: [
      { id: optionIds.first, text: "甲" },
      { id: optionIds.second, text: "乙" },
      { id: optionIds.third, text: "丙" }
    ],
    correctOptionId: optionIds.second,
    rawExplanation: "原始解析",
    fingerprint: `fingerprint-${input.id}`
  });
  return database.questionWithOptions(input.id);
}

describe("私人題庫 API", () => {
  const databases: ReturnType<typeof createTestDatabase>[] = [];

  afterEach(() => {
    databases.splice(0).forEach((database) => database.close());
  });

  it("以穩定選項 ID 保存答案，選項重排後仍可正確判分", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const question = addQuestion(database, { id: "10000000-0000-4000-8000-000000000001", subject: "保險法規", questionText: "保險契約的要保人是誰？" });
    const app = createApp({ database });

    expect(question.options).toHaveLength(3);
    expect(question.correctOptionId).toBe(question.options[1].id);
    const answer = await request(app).post("/api/attempts").send({ questionId: question.id, eventType: "answer", selectedOptionId: question.correctOptionId });

    expect(answer.status).toBe(201);
    expect(answer.body.isCorrect).toBe(true);
  });

  it("保存來源選項標籤與每個選項的 AI 分析", () => {
    const database = createTestDatabase();
    databases.push(database);
    const questionId = "20000000-0000-4000-8000-000000000001";
    database.addQuestion({
      id: questionId,
      sourceUrl: "visible://law/chapter-1",
      subject: "保險法規",
      chapter: "保險法規第1章",
      questionText: "題幹",
      options: [
        { id: "20000000-0000-4000-8000-000000000011", sourceLabel: "原始標籤", text: "原始選項文字" },
        { id: "20000000-0000-4000-8000-000000000012", text: "第二個原始選項" }
      ],
      correctOptionId: "20000000-0000-4000-8000-000000000011",
      rawExplanation: "",
      fingerprint: "label-test"
    });

    database.saveOptionAnalysis(questionId, [
      { optionId: "20000000-0000-4000-8000-000000000011", verdict: "correct", content: "符合題意。" },
      { optionId: "20000000-0000-4000-8000-000000000012", verdict: "incorrect", content: "與題意不符。" }
    ], "ready");

    expect(database.questionWithOptions(questionId).options[0]).toMatchObject({ sourceLabel: "原始標籤", text: "原始選項文字" });
    expect(database.questionReview(questionId).aiOptionAnalysis).toHaveLength(2);
  });

  it("保存 AI 摘要時，同步保存逐選項分析、模型與工作狀態", () => {
    const database = createTestDatabase();
    databases.push(database);
    const question = addQuestion(database, { id: "20000000-0000-4000-8000-000000000021", subject: "保險法規", questionText: "AI 摘要保存測試" });

    database.saveAiExplanation(question.id, {
      content: "這題考保險法規的基本概念。應依正確答案和原始資料判斷。",
      model: "gpt-test",
      status: "ready",
      analyses: question.options.map((option) => ({
        optionId: option.id,
        verdict: option.id === question.correctOptionId ? "correct" : "incorrect",
        content: "逐一檢視此選項與題幹的關係。"
      }))
    });

    const review = database.questionReview(question.id);
    expect(review.aiExplanation).toMatchObject({ content: "這題考保險法規的基本概念。應依正確答案和原始資料判斷。", model: "gpt-test", status: "ready" });
    expect(review.aiOptionAnalysis).toEqual(expect.arrayContaining([{ optionId: question.correctOptionId, verdict: "correct", content: "逐一檢視此選項與題幹的關係。" }]));
  });

  it("產生 AI 解析後，將摘要與每個選項分析回傳給複習頁", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const question = addQuestion(database, { id: "20000000-0000-4000-8000-000000000022", subject: "保險法規", questionText: "AI API 測試題" });
    const app = createApp({
      database,
      generateAiExplanation: async (input) => ({
        model: "gpt-test",
        rawContent: JSON.stringify({
          summary: "這題考保險法規的基本概念。應依題幹與原始資料判斷。",
          analyses: input.options.map((option) => ({
            optionId: option.id,
            verdict: option.id === input.correctOptionId ? "correct" : "incorrect",
            content: "此選項已依題幹和來源資料分析。"
          }))
        })
      })
    });

    const generated = await request(app).post(`/api/questions/${question.id}/ai-explanation`).send();
    expect(generated.status).toBe(200);
    expect(generated.body).toMatchObject({ status: "ready", model: "gpt-test" });

    const review = await request(app).get(`/api/questions/${question.id}/review`);
    expect(review.body.aiExplanation).toMatchObject({ status: "ready", content: "這題考保險法規的基本概念。應依題幹與原始資料判斷。" });
    expect(review.body.aiOptionAnalysis).toHaveLength(question.options.length);
  });

  it("批次 AI 工作只處理尚未生成的題目，並逐題保存完整解析", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const question = addQuestion(database, { id: "20000000-0000-4000-8000-000000000023", subject: "保險實務", questionText: "批次 AI 工作測試題" });
    const app = createApp({
      database,
      generateAiExplanation: async (input) => ({
        model: "gpt-test",
        rawContent: JSON.stringify({
          summary: "這題考保險實務的基本概念。應依題幹與原始資料判斷。",
          analyses: input.options.map((option) => ({ optionId: option.id, verdict: option.id === input.correctOptionId ? "correct" : "incorrect", content: "此選項已完成分析。" }))
        })
      })
    });

    const run = await request(app).post("/api/ai-explanations/run-pending").send({ limit: 5 });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ processed: 1, ready: 1, pendingReview: 0, failed: 0 });
    expect((await request(app).get(`/api/questions/${question.id}/review`)).body.aiOptionAnalysis).toHaveLength(question.options.length);
  });

  it("可將暫時失敗的 AI 工作重設為待處理，再由下一批重新產生", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const question = addQuestion(database, { id: "20000000-0000-4000-8000-000000000024", subject: "保險法規", questionText: "AI 重試測試題" });
    database.markAiGenerationFailed(question.id, "先前服務暫時不可用");
    const app = createApp({
      database,
      generateAiExplanation: async (input) => ({
        model: "ollama-test",
        rawContent: JSON.stringify({
          summary: "這題已由本機模型重新產生解析。",
          analyses: input.options.map((option) => ({ optionId: option.id, verdict: option.id === input.correctOptionId ? "correct" : "incorrect", content: "本機模型已分析此選項。" }))
        })
      })
    });

    const retried = await request(app).post("/api/ai-explanations/retry-failed").send();
    expect(retried.status).toBe(200);
    expect(retried.body).toEqual({ retried: 1 });

    const run = await request(app).post("/api/ai-explanations/run-pending").send({ limit: 1 });
    expect(run.body).toMatchObject({ processed: 1, ready: 1, failed: 0 });
    expect((await request(app).get(`/api/questions/${question.id}/review`)).body.aiExplanation).toMatchObject({ model: "ollama-test", status: "ready" });
  });

  it("設定本機 AI 時，解析只呼叫 Ollama 並保存其回傳內容", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const question = addQuestion(database, { id: "20000000-0000-4000-8000-000000000025", subject: "保險實務", questionText: "本機 AI 解析測試題" });
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "ollama";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      model: "qwen3:4b",
      message: {
        content: JSON.stringify({
          summary: "這題以本機模型說明保險實務的基本考點。",
          analyses: question.options.map((option) => ({ optionId: option.id, verdict: option.id === question.correctOptionId ? "correct" : "incorrect", content: "本機模型已依提供資料分析此選項。" }))
        })
      }
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const app = createApp({ database });
      const generated = await request(app).post(`/api/questions/${question.id}/ai-explanation`).send();

      expect(generated.status).toBe(200);
      expect(generated.body).toMatchObject({ status: "ready", model: "qwen3:4b" });
      expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:11434/api/chat", expect.objectContaining({ method: "POST" }));
    } finally {
      vi.unstubAllGlobals();
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  });

  it("常錯題符合三次作答、至少錯兩次且正確率低於六成，已掌握可排除但不刪除紀錄", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const question = addQuestion(database, { id: "10000000-0000-4000-8000-000000000002", subject: "保險實務", questionText: "測試常錯題" });

    for (const selectedOptionId of [question.options[0].id, question.options[0].id, question.correctOptionId]) {
      await request(app).post("/api/attempts").send({ questionId: question.id, eventType: "answer", selectedOptionId });
    }

    const commonWrong = await request(app).post("/api/practice-sessions").send({ mode: "common-wrong", shuffleQuestions: false, shuffleOptions: true });
    expect(commonWrong.body.questionCount).toBe(1);
    const questions = await request(app).get(`/api/practice-sessions/${commonWrong.body.id}/questions`);
    expect(questions.body.questions[0].options.map((option: { id: string }) => option.id)).toEqual(expect.arrayContaining(question.options.map((option) => option.id)));

    await request(app).patch(`/api/questions/${question.id}/mastered`).send({ mastered: true });
    const afterMastered = await request(app).post("/api/practice-sessions").send({ mode: "common-wrong", shuffleQuestions: false, shuffleOptions: false });
    expect(afterMastered.body.questionCount).toBe(0);
    expect(database.count("attempts")).toBe(3);
  });

  it("練習可依法規、實務或全部篩選題目，未知科目會被拒絕", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const law = addQuestion(database, { id: "10000000-0000-4000-8000-000000000006", subject: "保險法規", questionText: "法規篩選題" });
    const practice = addQuestion(database, { id: "10000000-0000-4000-8000-000000000007", subject: "保險實務", questionText: "實務篩選題" });

    const lawSession = await request(app).post("/api/practice-sessions").send({ mode: "sequential", subject: "law", shuffleQuestions: false, shuffleOptions: false });
    const lawQuestions = await request(app).get(`/api/practice-sessions/${lawSession.body.id}/questions`);
    expect(lawQuestions.body.questions.map((question: { id: string }) => question.id)).toEqual([law.id]);

    const practiceSession = await request(app).post("/api/practice-sessions").send({ mode: "sequential", subject: "practice", shuffleQuestions: false, shuffleOptions: false });
    const practiceQuestions = await request(app).get(`/api/practice-sessions/${practiceSession.body.id}/questions`);
    expect(practiceQuestions.body.questions.map((question: { id: string }) => question.id)).toEqual([practice.id]);

    const allSession = await request(app).post("/api/practice-sessions").send({ mode: "sequential", shuffleQuestions: false, shuffleOptions: false });
    expect(allSession.body.questionCount).toBe(2);
    expect((await request(app).post("/api/practice-sessions").send({ mode: "sequential", subject: "other", shuffleQuestions: false, shuffleOptions: false })).status).toBe(400);
  });

  it("錯題與常錯題會套用已選科目", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const law = addQuestion(database, { id: "10000000-0000-4000-8000-000000000008", subject: "保險法規", questionText: "法規錯題" });
    const practice = addQuestion(database, { id: "10000000-0000-4000-8000-000000000009", subject: "保險實務", questionText: "實務常錯題" });

    await request(app).post("/api/attempts").send({ questionId: law.id, eventType: "answer", selectedOptionId: law.options[0].id });
    for (const selectedOptionId of [practice.options[0].id, practice.options[0].id, practice.correctOptionId]) {
      await request(app).post("/api/attempts").send({ questionId: practice.id, eventType: "answer", selectedOptionId });
    }

    const wrongLaw = await request(app).post("/api/practice-sessions").send({ mode: "wrong", subject: "law", shuffleQuestions: false, shuffleOptions: false });
    const commonPractice = await request(app).post("/api/practice-sessions").send({ mode: "common-wrong", subject: "practice", shuffleQuestions: false, shuffleOptions: false });
    expect((await request(app).get(`/api/practice-sessions/${wrongLaw.body.id}/questions`)).body.questions.map((question: { id: string }) => question.id)).toEqual([law.id]);
    expect((await request(app).get(`/api/practice-sessions/${commonPractice.body.id}/questions`)).body.questions.map((question: { id: string }) => question.id)).toEqual([practice.id]);
  });

  it("完整 JSON 備份可先預覽，明確確認後才還原題庫資料", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    addQuestion(database, { id: "10000000-0000-4000-8000-000000000003", subject: "保險法規", questionText: "備份測試題" });

    const exported = await request(app).get("/api/backups/export");
    expect(exported.body.schemaVersion).toBe(4);
    expect((await request(app).post("/api/backups/preview").send(exported.body)).body.questionCount).toBe(1);
    expect((await request(app).post("/api/backups/restore").send({ backup: exported.body, confirmed: true })).body.restored).toBe(true);
    expect(database.count("questions")).toBe(1);
  });

  it("模考在交卷前不回傳答案，交卷後依科目與總分門檻計分", async () => {
    const database = createTestDatabase();
    databases.push(database);
    const app = createApp({ database });
    const law = addQuestion(database, { id: "10000000-0000-4000-8000-000000000004", subject: "保險法規", questionText: "法規題" });
    const practice = addQuestion(database, { id: "10000000-0000-4000-8000-000000000005", subject: "保險實務", questionText: "實務題" });

    const exam = await request(app).post("/api/exams").send({
      durationMinutes: 10,
      overallPassingScore: 60,
      subjectRules: [{ subject: "保險法規", questionCount: 1, passingScore: 60 }, { subject: "保險實務", questionCount: 1, passingScore: 60 }]
    });

    expect(exam.status).toBe(201);
    expect(exam.body.questions[0].correctOptionId).toBeUndefined();
    const result = await request(app).post(`/api/exams/${exam.body.id}/submit`).send({ answers: [
      { questionId: law.id, selectedOptionId: law.correctOptionId },
      { questionId: practice.id, selectedOptionId: practice.correctOptionId }
    ] });
    expect(result.body).toMatchObject({ correct: 2, total: 2, passed: true });
  });
});

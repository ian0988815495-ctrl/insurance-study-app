import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { parseAiExplanation } from "./ai-explanations.ts";
import { QuestionDatabase } from "./db.ts";
import type { PracticeMode, StoredQuestion, StudyPlan } from "./types.ts";

type QuestionDetails = ReturnType<QuestionDatabase["questionWithOptions"]>;
type AiExplanationGenerator = (question: QuestionDetails) => Promise<{ model: string; rawContent: string }>;

const importPreviewSchema = z.object({
  sourceUrl: z.string().trim().optional().default(""),
  subject: z.string().trim().optional().default(""),
  chapter: z.string().trim().optional().default(""),
  questionText: z.string().trim().optional().default(""),
  options: z.array(z.object({ sourceLabel: z.string().trim().optional(), text: z.string().trim() })).optional().default([]),
  correctOptionIndex: z.number().int().optional(),
  rawExplanation: z.string().trim().optional().default("")
});

const importBatchSchema = z.object({
  sourceUrl: z.string().trim().min(1),
  subject: z.string().trim().min(1),
  chapter: z.string().trim().min(1),
  questions: z.array(importPreviewSchema.pick({ questionText: true, options: true, correctOptionIndex: true, rawExplanation: true })).min(1)
});

const sessionSchema = z.object({
  mode: z.enum(["sequential", "random", "wrong", "common-wrong", "study-plan"]),
  subject: z.enum(["all", "law", "practice"]).optional().default("all"),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean()
});

const studyPlanSettingsSchema = z.object({
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

const attemptSchema = z.object({
  questionId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
  eventType: z.enum(["answer", "view_answer", "review"]),
  selectedOptionId: z.string().uuid().optional()
});

const examSchema = z.object({
  durationMinutes: z.number().int().min(1),
  overallPassingScore: z.number().min(0).max(100),
  subjectRules: z.array(z.object({
    subject: z.string().min(1),
    questionCount: z.number().int().min(1),
    passingScore: z.number().min(0).max(100)
  })).min(1)
});

const fixedExamSchema = z.object({
  type: z.enum(["law", "practice", "full"])
});

const aiRunSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(10)
});

const fixedExamConfigs = {
  law: { subject: "保險法規", questionCount: 100, durationMinutes: 80, passingScore: 60 },
  practice: { subject: "保險實務", questionCount: 50, durationMinutes: 60, passingScore: 60 }
} as const;

export function createApp({ database, generateAiExplanation = generateAiExplanationFromConfiguredProvider }: { database: QuestionDatabase; generateAiExplanation?: AiExplanationGenerator }) {
  const app = express();
  app.use((request, response, next) => {
    const origin = request.header("origin");
    const isLocalWeb = origin === "http://127.0.0.1:5173";
    const isExtension = Boolean(origin && /^chrome-extension:\/\/[a-p]{32}$/.test(origin));
    if (!isLocalWeb && !isExtension) return next();
    response.setHeader("Access-Control-Allow-Origin", origin!);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (request.method === "OPTIONS") return response.status(204).end();
    next();
  });
  app.use(express.json({ limit: "2mb" }));

  app.get("/api/health", (_request, response) => response.json({ ok: true }));
  app.get("/api/dashboard", (_request, response) => response.json(database.dashboard()));
  app.get("/api/study-plan", async (_request, response) => response.json(await resolveStudyPlan(database)));
  app.put("/api/study-plan/settings", async (request, response) => {
    const { examDate } = studyPlanSettingsSchema.parse(request.body);
    if (!isCalendarDate(examDate) || examDate < dateKey(new Date())) {
      return response.status(400).json({ error: "考試日期不能早於今天。" });
    }
    database.setExamDate(examDate);
    response.json(await resolveStudyPlan(database));
  });
  app.get("/api/subjects", (_request, response) => {
    const rows = database.sqlite.prepare("SELECT subject, chapter, COUNT(*) AS count FROM questions GROUP BY subject, chapter ORDER BY subject, chapter").all();
    response.json(rows);
  });

  app.post("/api/imports/preview", (request, response) => {
    const input = importPreviewSchema.parse(request.body);
    const warnings: string[] = [];
    const blockingWarnings: string[] = [];
    const block = (message: string) => { warnings.push(message); blockingWarnings.push(message); };
    if (!input.subject) block("缺少科目資訊。");
    if (!input.chapter) block("缺少章節資訊。");
    if (!input.questionText) block("缺少題幹。");
    if (input.options.length === 0 || input.options.some((option) => !option.text)) block("缺少有效選項。");
    if (input.correctOptionIndex === undefined || !input.options[input.correctOptionIndex]) warnings.push("缺少可對應的正確答案，題目將標記為待確認。");
    if (!input.rawExplanation) warnings.push("來源頁未提供原始解析，保留為空白。");

    const options = input.options.map((option) => ({ id: randomUUID(), sourceLabel: option.sourceLabel ?? "", text: option.text }));
    const fingerprint = createFingerprint(input.questionText, options.map((option) => option.text));
    const duplicate = database.findQuestionByFingerprint(fingerprint);
    if (duplicate) block("疑似重複題目，不能再次寫入。");
    const question: StoredQuestion = {
      sourceUrl: input.sourceUrl || "manual://pasted-question",
      subject: input.subject,
      chapter: input.chapter,
      questionText: input.questionText,
      options,
      correctOptionId: input.correctOptionIndex === undefined ? "" : options[input.correctOptionIndex]?.id ?? "",
      answerStatus: input.correctOptionIndex === undefined ? "pending-review" : "ready",
      rawExplanation: input.rawExplanation,
      fingerprint
    };
    const canConfirm = blockingWarnings.length === 0;
    const importId = database.saveImportPreview(question, warnings, canConfirm);
    response.json({ importId, canConfirm, warnings, duplicateQuestionId: duplicate?.id ?? null, question });
  });

  app.get("/api/imports/:id", (request, response) => {
    const preview = database.getImportPreview(request.params.id);
    if (!preview) return response.status(404).json({ error: "找不到題目預覽資料。" });
    response.json({
      importId: preview.id,
      canConfirm: Boolean(preview.can_confirm),
      warnings: JSON.parse(preview.warnings_json) as string[],
      question: JSON.parse(preview.payload_json) as StoredQuestion,
      confirmed: Boolean(preview.confirmed_at)
    });
  });

  app.post("/api/imports/:id/confirm", (request, response) => {
    if (request.body?.confirmed !== true) return response.status(400).json({ error: "必須由使用者確認後才會寫入題庫。" });
    try {
      const questionId = database.confirmImportPreview(request.params.id);
      response.status(201).json({ questionId, aiExplanationStatus: "pending" });
    } catch (error) {
      response.status(409).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/imports/batches/preview", (request, response) => {
    const input = importBatchSchema.parse(request.body);
    const fingerprints = new Set<string>();
    const items = input.questions.map((item) => {
      const warnings: string[] = [];
      let canConfirm = true;
      const block = (message: string) => { warnings.push(message); canConfirm = false; };
      if (!item.questionText) block("缺少題幹。");
      if (!item.options.length || item.options.some((option) => !option.text)) block("缺少有效選項。");
      if (item.correctOptionIndex === undefined || !item.options[item.correctOptionIndex]) warnings.push("缺少可對應的正確答案，題目將標記為待確認。");
      if (!item.rawExplanation) warnings.push("來源頁未提供原始解析，保留為空白。");
      const options = item.options.map((option) => ({ id: randomUUID(), sourceLabel: option.sourceLabel ?? "", text: option.text }));
      const fingerprint = createFingerprint(item.questionText, options.map((option) => option.text));
      const existing = database.findQuestionByFingerprint(fingerprint);
      const canUpgradePendingAnswer = existing?.answer_status === "pending-review" && item.correctOptionIndex !== undefined;
      if (fingerprints.has(fingerprint) || (existing && !canUpgradePendingAnswer)) block("疑似重複題目，不能再次寫入。");
      if (canUpgradePendingAnswer) warnings.push("題庫既有待確認題目，將補上已驗證的正確答案。");
      fingerprints.add(fingerprint);
      const question: StoredQuestion = { sourceUrl: input.sourceUrl, subject: input.subject, chapter: input.chapter, questionText: item.questionText, options, correctOptionId: item.correctOptionIndex === undefined ? "" : options[item.correctOptionIndex]?.id ?? "", answerStatus: item.correctOptionIndex === undefined ? "pending-review" : "ready", rawExplanation: item.rawExplanation, fingerprint };
      return { question, warnings, canConfirm };
    });
    const summary = {
      total: items.length,
      valid: items.filter((item) => item.canConfirm && item.question.answerStatus === "ready").length,
      pendingAnswer: items.filter((item) => item.question.answerStatus === "pending-review").length,
      duplicates: items.filter((item) => item.warnings.some((warning) => warning.includes("重複"))).length,
      missingAnswer: items.filter((item) => item.warnings.some((warning) => warning.includes("正確答案"))).length,
      missingRawExplanation: items.filter((item) => item.warnings.some((warning) => warning.includes("原始解析"))).length,
      invalidFormat: items.filter((item) => item.warnings.some((warning) => warning.includes("題幹") || warning.includes("有效選項"))).length
    };
    const batchId = database.saveImportBatch({ sourceUrl: input.sourceUrl, subject: input.subject, chapter: input.chapter, summary, items });
    response.json({ batchId, summary, items: items.map((item) => ({ canConfirm: item.canConfirm, warnings: item.warnings, question: item.question })) });
  });

  app.post("/api/imports/batches/:id/confirm", (request, response) => {
    if (request.body?.confirmed !== true) return response.status(400).json({ error: "必須由使用者確認後才會寫入題庫。" });
    try {
      const batch = database.getImportBatch(request.params.id);
      if (!batch) return response.status(404).json({ error: "找不到章節預覽資料。" });
      const valid = batch.items.filter((item) => Boolean(item.can_confirm)).length;
      const safetyBackup = valid ? snapshotDatabase(database, "import") : null;
      response.status(201).json({ ...database.confirmImportBatch(request.params.id), warnings: JSON.parse(batch.summary_json), safetyBackup });
    } catch (error) {
      response.status(409).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/practice-sessions", (request, response) => {
    const settings = sessionSchema.parse(request.body);
    if (settings.mode === "study-plan" && (settings.shuffleQuestions || settings.shuffleOptions)) {
      return response.status(400).json({ error: "今日計畫必須依建議順序練習。" });
    }
    const session = database.createPracticeSession(settings.mode, settings.shuffleQuestions, settings.shuffleOptions, settings.subject);
    response.status(201).json({ id: session.id, questionCount: session.ids.length, settings });
  });

  app.get("/api/practice-sessions/:id/questions", (request, response) => {
    const session = database.getPracticeSession(request.params.id);
    if (!session) return response.status(404).json({ error: "找不到練習。" });
    const ids = JSON.parse(session.question_ids_json) as string[];
    response.json({
      settings: { mode: session.mode, shuffleQuestions: Boolean(session.shuffle_questions), shuffleOptions: Boolean(session.shuffle_options) },
      questions: database.getQuestions(ids, Boolean(session.shuffle_options))
    });
  });

  app.post("/api/attempts", (request, response) => {
    const input = attemptSchema.parse(request.body);
    try {
      const isCorrect = database.recordAttempt(input);
      response.status(201).json({ saved: true, isCorrect });
    } catch (error) {
      response.status(400).json({ error: errorMessage(error) });
    }
  });

  app.get("/api/questions/:id/review", (request, response) => {
    try {
      response.json(database.questionReview(request.params.id));
    } catch (error) {
      response.status(404).json({ error: errorMessage(error) });
    }
  });

  app.patch("/api/questions/:id/mastered", (request, response) => {
    if (typeof request.body?.mastered !== "boolean") return response.status(400).json({ error: "mastered 必須是布林值。" });
    database.setMastered(request.params.id, request.body.mastered);
    response.json({ saved: true });
  });

  app.post("/api/questions/:id/ai-explanation", async (request, response) => {
    try {
      const question = database.questionWithOptions(request.params.id);
      response.json(await generateAndSaveAiExplanation(database, generateAiExplanation, question));
    } catch (error) {
      if (error instanceof AiExplanationUnavailableError) {
        return response.status(409).json({ status: "pending", message: error.message });
      }
      response.status(502).json({ status: "pending", error: errorMessage(error) });
    }
  });

  app.post("/api/ai-explanations/run-pending", async (request, response) => {
    const { limit } = aiRunSchema.parse(request.body ?? {});
    const questions = database.pendingAiGenerationQuestions(limit);
    const summary = { processed: 0, ready: 0, pendingReview: 0, failed: 0 };
    try {
      for (const question of questions) {
        try {
          const result = await generateAndSaveAiExplanation(database, generateAiExplanation, question);
          summary.processed += 1;
          if (result.status === "ready") summary.ready += 1;
          else summary.pendingReview += 1;
        } catch (error) {
          if (error instanceof AiExplanationUnavailableError) {
            return response.status(409).json({ status: "pending", message: error.message, ...summary });
          }
          database.markAiGenerationFailed(question.id, errorMessage(error));
          summary.processed += 1;
          summary.failed += 1;
        }
      }
      response.json(summary);
    } catch (error) {
      response.status(500).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/ai-explanations/retry-failed", (_request, response) => {
    response.json({ retried: database.retryFailedAiGenerationJobs() });
  });

  app.post("/api/exams", (request, response) => {
    const config = examSchema.parse(request.body);
    try {
      response.status(201).json(createExam(database, config));
    } catch (error) {
      response.status(422).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/exams/fixed", (request, response) => {
    const { type } = fixedExamSchema.parse(request.body);
    try {
      if (type === "full") {
        const exam = createFixedExam(database, "law");
        const seriesId = database.createExamSeries(exam.id);
        return response.status(201).json({ seriesId, stage: "law", durationMinutes: fixedExamConfigs.law.durationMinutes, exam });
      }
      const exam = createFixedExam(database, type);
      response.status(201).json({ type, durationMinutes: fixedExamConfigs[type].durationMinutes, ...exam });
    } catch (error) {
      response.status(422).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/exam-series/:id/next", (request, response) => {
    const series = database.getExamSeries(request.params.id);
    if (!series) return response.status(404).json({ error: "找不到完整測驗。" });
    const lawExam = getExamRecord(database, series.law_exam_id);
    if (!lawExam.submittedAt) return response.status(409).json({ error: "請先完成法規模考。" });
    try {
      const exam = series.practice_exam_id ? examResponse(database, series.practice_exam_id) : createFixedExam(database, "practice");
      if (!series.practice_exam_id) database.setSeriesPracticeExam(series.id, exam.id);
      response.status(201).json({ stage: "practice", durationMinutes: fixedExamConfigs.practice.durationMinutes, exam });
    } catch (error) {
      response.status(422).json({ error: errorMessage(error) });
    }
  });

  app.get("/api/exam-series/:id/result", (request, response) => {
    const series = database.getExamSeries(request.params.id);
    if (!series) return response.status(404).json({ error: "找不到完整測驗。" });
    if (!series.practice_exam_id) return response.status(409).json({ error: "完整測驗尚未完成實務模考。" });
    const lawExam = getExamRecord(database, series.law_exam_id);
    const practiceExam = getExamRecord(database, series.practice_exam_id);
    if (!lawExam.resultJson || !practiceExam.resultJson) return response.status(409).json({ error: "完整測驗尚未全部交卷。" });
    const lawResult = examResultSchema.parse(JSON.parse(lawExam.resultJson));
    const practiceResult = examResultSchema.parse(JSON.parse(practiceExam.resultJson));
    const result = {
      lawScore: lawResult.score,
      practiceScore: practiceResult.score,
      totalScore: lawResult.score + practiceResult.score,
      passed: lawResult.score >= 60 && practiceResult.score >= 60 && lawResult.score + practiceResult.score >= 140
    };
    if (!series.completed_at) database.completeExamSeries(series.id, result);
    response.json(result);
  });

  app.post("/api/exams/:id/submit", (request, response) => {
    const exam = database.sqlite.prepare("SELECT * FROM exams WHERE id = ?").get(request.params.id) as
      | { config_json: string; question_ids_json: string; submitted_at: string | null; ends_at: string }
      | undefined;
    if (!exam) return response.status(404).json({ error: "找不到模考。" });
    if (exam.submitted_at) return response.status(409).json({ error: "此模考已交卷。" });
    const answers = z.array(z.object({ questionId: z.string().uuid(), selectedOptionId: z.string().uuid().optional() })).parse(request.body?.answers ?? []);
    const answerMap = new Map(answers.map((answer) => [answer.questionId, answer.selectedOptionId]));
    const config = examSchema.parse(JSON.parse(exam.config_json));
    const ids = JSON.parse(exam.question_ids_json) as string[];
    const bySubject = new Map<string, { correct: number; total: number }>();
    let correct = 0;
    ids.forEach((questionId) => {
      const question = database.questionWithOptions(questionId);
      const selectedOptionId = answerMap.get(questionId);
      const isCorrect = selectedOptionId === question.correctOptionId;
      correct += Number(isCorrect);
      const score = bySubject.get(question.subject) ?? { correct: 0, total: 0 };
      score.correct += Number(isCorrect);
      score.total += 1;
      bySubject.set(question.subject, score);
      if (selectedOptionId) {
        database.recordAttempt({ questionId, eventType: "answer", selectedOptionId });
      } else {
        database.sqlite.prepare(`INSERT INTO attempts (id, question_id, event_type, is_correct) VALUES (?, ?, 'answer', 0)`)
          .run(randomUUID(), questionId);
      }
    });
    const subjectResults = config.subjectRules.map((rule) => {
      const result = bySubject.get(rule.subject) ?? { correct: 0, total: 0 };
      const score = result.total === 0 ? 0 : (result.correct / result.total) * 100;
      return { subject: rule.subject, correct: result.correct, total: result.total, score, passed: score >= rule.passingScore };
    });
    const score = ids.length === 0 ? 0 : (correct / ids.length) * 100;
    const result = { autoSubmitted: Date.now() >= new Date(exam.ends_at).getTime(), correct, total: ids.length, score, passed: score >= config.overallPassingScore && subjectResults.every((item) => item.passed), subjectResults };
    database.sqlite.prepare("UPDATE exams SET submitted_at = CURRENT_TIMESTAMP, result_json = ? WHERE id = ?").run(JSON.stringify(result), request.params.id);
    response.json(result);
  });

  app.get("/api/backups/export", (_request, response) => {
    const payload = { schemaVersion: 4, exportedAt: new Date().toISOString(), data: database.exportData() };
    response.setHeader("Content-Disposition", "attachment; filename=question-bank-backup.json");
    response.json(payload);
  });

  app.post("/api/backups/preview", (request, response) => {
    const parsed = backupSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "備份格式不正確，未執行任何寫入。" });
    const data = normalizeBackupData(parsed.data);
    response.json({ valid: true, questionCount: data.questions.length, attemptCount: data.attempts.length });
  });

  app.post("/api/backups/restore", (request, response) => {
    const parsed = backupSchema.safeParse(request.body?.backup);
    if (!parsed.success || request.body?.confirmed !== true) return response.status(400).json({ error: "還原前必須通過預覽並由使用者明確確認。" });
    const backupPath = snapshotDatabase(database);
    try {
      restoreDatabase(database, normalizeBackupData(parsed.data));
      response.json({ restored: true, safetyBackup: backupPath });
    } catch (error) {
      response.status(400).json({ error: errorMessage(error), safetyBackup: backupPath });
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) return response.status(400).json({ error: "輸入資料格式不正確。", details: error.issues });
    response.status(500).json({ error: errorMessage(error) });
  });
  return app;
}

const baseBackupDataSchema = z.object({
  questions: z.array(z.record(z.string(), z.unknown())),
  question_options: z.array(z.record(z.string(), z.unknown())),
  ai_explanations: z.array(z.record(z.string(), z.unknown())),
  attempts: z.array(z.record(z.string(), z.unknown())),
  practice_sessions: z.array(z.record(z.string(), z.unknown())),
  exams: z.array(z.record(z.string(), z.unknown()))
});

const backupV1Schema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: z.string(),
  data: baseBackupDataSchema
});

const backupV2Schema = z.object({
  schemaVersion: z.literal(2),
  exportedAt: z.string(),
  data: baseBackupDataSchema.extend({
    study_plan_settings: z.array(z.record(z.string(), z.unknown())),
    review_schedules: z.array(z.record(z.string(), z.unknown()))
  })
});

const backupV3Schema = z.object({
  schemaVersion: z.literal(3),
  exportedAt: z.string(),
  data: baseBackupDataSchema.extend({
    study_plan_settings: z.array(z.record(z.string(), z.unknown())),
    review_schedules: z.array(z.record(z.string(), z.unknown())),
    study_plan_advices: z.array(z.record(z.string(), z.unknown()))
  })
});

const backupV4Schema = z.object({
  schemaVersion: z.literal(4),
  exportedAt: z.string(),
  data: baseBackupDataSchema.extend({
    ai_option_analyses: z.array(z.record(z.string(), z.unknown())),
    ai_generation_jobs: z.array(z.record(z.string(), z.unknown())),
    study_plan_settings: z.array(z.record(z.string(), z.unknown())),
    review_schedules: z.array(z.record(z.string(), z.unknown())),
    study_plan_advices: z.array(z.record(z.string(), z.unknown()))
  })
});

const backupSchema = z.union([backupV1Schema, backupV2Schema, backupV3Schema, backupV4Schema]);
type BackupData = z.infer<typeof backupV4Schema>["data"];

function normalizeBackupData(backup: z.infer<typeof backupSchema>): BackupData {
  if (backup.schemaVersion === 4) return backup.data;
  if (backup.schemaVersion === 3) return { ...backup.data, ai_option_analyses: [], ai_generation_jobs: [] };
  if (backup.schemaVersion === 2) return { ...backup.data, ai_option_analyses: [], ai_generation_jobs: [], study_plan_advices: [] };
  return { ...backup.data, ai_option_analyses: [], ai_generation_jobs: [], study_plan_settings: [], review_schedules: [], study_plan_advices: [] };
}

const examResultSchema = z.object({
  score: z.number(),
  correct: z.number(),
  total: z.number(),
  passed: z.boolean(),
  subjectResults: z.array(z.object({ subject: z.string(), correct: z.number(), total: z.number(), score: z.number(), passed: z.boolean() }))
});

function createFixedExam(database: QuestionDatabase, type: "law" | "practice") {
  const rule = fixedExamConfigs[type];
  return createExam(database, {
    durationMinutes: rule.durationMinutes,
    overallPassingScore: rule.passingScore,
    subjectRules: [{ subject: rule.subject, questionCount: rule.questionCount, passingScore: rule.passingScore }]
  });
}

function createExam(database: QuestionDatabase, config: z.infer<typeof examSchema>) {
  const ids: string[] = [];
  for (const rule of config.subjectRules) {
    const rows = database.sqlite.prepare("SELECT id FROM questions WHERE subject = ? AND mastered = 0 AND answer_status = 'ready' ORDER BY RANDOM() LIMIT ?")
      .all(rule.subject, rule.questionCount) as { id: string }[];
    if (rows.length < rule.questionCount) throw new Error(`科目「${rule.subject}」題目不足，無法建立模考。`);
    ids.push(...rows.map((row) => row.id));
  }
  const id = randomUUID();
  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + config.durationMinutes * 60_000);
  database.sqlite.prepare(`INSERT INTO exams (id, config_json, question_ids_json, starts_at, ends_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, JSON.stringify(config), JSON.stringify(ids), startsAt.toISOString(), endsAt.toISOString());
  return { id, startsAt, endsAt, questions: database.getQuestions(ids, true) };
}

function getExamRecord(database: QuestionDatabase, id: string) {
  const exam = database.sqlite.prepare("SELECT id, config_json, question_ids_json, starts_at, ends_at, submitted_at, result_json FROM exams WHERE id = ?").get(id) as
    | { id: string; config_json: string; question_ids_json: string; starts_at: string; ends_at: string; submitted_at: string | null; result_json: string | null }
    | undefined;
  if (!exam) throw new Error("找不到模考。");
  return { id: exam.id, configJson: exam.config_json, questionIdsJson: exam.question_ids_json, startsAt: exam.starts_at, endsAt: exam.ends_at, submittedAt: exam.submitted_at, resultJson: exam.result_json };
}

function examResponse(database: QuestionDatabase, id: string) {
  const exam = getExamRecord(database, id);
  return { id: exam.id, startsAt: exam.startsAt, endsAt: exam.endsAt, questions: database.getQuestions(JSON.parse(exam.questionIdsJson) as string[], true) };
}

function createFingerprint(questionText: string, optionTexts: string[]) {
  return createHash("sha256").update(`${questionText.trim()}\n${optionTexts.map((item) => item.trim()).join("\n")}`).digest("hex");
}

function snapshotDatabase(database: QuestionDatabase, purpose = "restore") {
  if (database.filePath === ":memory:" || !existsSync(database.filePath)) return null;
  const directory = join(dirname(database.filePath), "..", "backups");
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, `before-${purpose}-${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
  database.sqlite.pragma("wal_checkpoint(TRUNCATE)");
  copyFileSync(database.filePath, destination);
  return destination;
}

function restoreDatabase(database: QuestionDatabase, data: BackupData) {
  const tableRows: Record<string, Record<string, unknown>[]> = data;
  database.sqlite.transaction(() => {
    database.sqlite.exec("DELETE FROM study_plan_advices; DELETE FROM review_schedules; DELETE FROM study_plan_settings; DELETE FROM attempts; DELETE FROM exams; DELETE FROM practice_sessions; DELETE FROM ai_generation_jobs; DELETE FROM ai_option_analyses; DELETE FROM questions;");
    const tableOrder = ["questions", "question_options", "ai_explanations", "ai_option_analyses", "ai_generation_jobs", "practice_sessions", "attempts", "exams", "study_plan_settings", "review_schedules", "study_plan_advices"];
    for (const table of tableOrder) {
      for (const row of tableRows[table]) {
        const columns = Object.keys(row);
        const placeholders = columns.map(() => "?").join(", ");
        database.sqlite.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`).run(...columns.map((column) => row[column]));
      }
    }
  })();
}

async function resolveStudyPlan(database: QuestionDatabase, now = new Date()) {
  const plan = database.getStudyPlan(now);
  if (!plan.examDate || plan.daysRemaining === null || plan.daysRemaining <= 0) return plan;

  try {
    const cacheKey = database.createStudyPlanAdviceKey(plan, now);
    const cached = database.getStudyPlanAdvice(cacheKey);
    if (cached) return { ...plan, advice: { content: cached.content, source: cached.source } };

    const generated = await generateStudyPlanAdvice(plan);
    const advice = generated ? { content: generated.content, source: "ai" as const } : plan.advice;
    database.saveStudyPlanAdvice({
      cacheKey,
      planDate: dateKey(now),
      examDate: plan.examDate,
      content: advice.content,
      source: advice.source,
      model: generated?.model ?? null
    });
    return { ...plan, advice };
  } catch (error) {
    console.error("無法建立今日讀書建議，改用本機建議。", error);
    return plan;
  }
}

class AiExplanationUnavailableError extends Error {}

async function generateAndSaveAiExplanation(database: QuestionDatabase, generateAiExplanation: AiExplanationGenerator, question: QuestionDetails) {
  if (!question.correctOptionId || question.answerStatus === "pending-review") {
    const content = "題目正確答案待確認，AI 解析尚未生成。";
    const analyses = question.options.map((option) => ({ optionId: option.id, verdict: "pending-review" as const, content: "題目正確答案待確認，無法安全判斷此選項。" }));
    database.saveAiExplanation(question.id, { content, model: null, status: "pending-review", analyses });
    return { status: "pending-review" as const, content, model: null, analyses };
  }
  const generated = await generateAiExplanation(question);
  const parsed = parseAiExplanation(generated.rawContent, question.options);
  database.saveAiExplanation(question.id, { content: parsed.summary, model: generated.model, status: parsed.status, analyses: parsed.analyses });
  return { status: parsed.status, content: parsed.summary, model: generated.model, analyses: parsed.analyses };
}

const aiExplanationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "analyses"],
  properties: {
    summary: { type: "string" },
    analyses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["optionId", "verdict", "content"],
        properties: {
          optionId: { type: "string" },
          verdict: { type: "string", enum: ["correct", "incorrect", "pending-review"] },
          content: { type: "string" }
        }
      }
    }
  }
} as const;

function aiExplanationInput(question: QuestionDetails) {
  const correctOption = question.options.find((option) => option.id === question.correctOptionId);
  return {
    questionText: question.questionText,
    options: question.options,
    correctOptionId: question.correctOptionId,
    correctOptionText: correctOption?.text ?? "",
    rawExplanation: question.rawExplanation
  };
}

function aiExplanationPrompt(question: QuestionDetails) {
  return `請依提供資料產生繁體中文題目解析。不得補充題幹、正確答案與原始解析以外的法規事實；無法確認時使用 pending-review。summary 必須是 2 至 4 句，第一句說明題目考點，後續以白話說明核心概念或易混淆處。analyses 必須逐一涵蓋所有 optionId，內容簡短說明該選項為何符合或不符合題意。僅輸出符合指定 JSON 結構的資料。\n題目資料：${JSON.stringify(aiExplanationInput(question))}`;
}

async function generateAiExplanationFromConfiguredProvider(question: QuestionDetails) {
  const provider = (process.env.AI_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "ollama") return generateAiExplanationFromOllama(question);
  if (provider === "openai") return generateAiExplanationFromOpenAi(question);
  throw new AiExplanationUnavailableError("AI_PROVIDER 必須設定為 ollama 或 openai。");
}

async function generateAiExplanationFromOllama(question: QuestionDetails) {
  const baseUrl = (process.env.OLLAMA_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL ?? "qwen3:4b";
  let upstream: Response;
  try {
    upstream = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "0",
        format: aiExplanationJsonSchema,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: "你是保險考題解析助手。只能依使用者提供的題幹、選項、正確答案與原始解析回答。" },
          { role: "user", content: aiExplanationPrompt(question) }
        ]
      })
    });
  } catch {
    throw new AiExplanationUnavailableError("本機 Ollama 服務尚未啟動，AI 解析維持待確認。");
  }
  if (!upstream.ok) throw new Error("本機 AI 暫時無法產生解析，維持待確認。");
  const result = await upstream.json() as { model?: string; message?: { content?: string } };
  const rawContent = result.message?.content?.trim();
  if (!rawContent) throw new Error("本機 AI 未回傳可用解析，維持待確認。");
  return { model: result.model ?? model, rawContent };
}

async function generateAiExplanationFromOpenAi(question: QuestionDetails) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AiExplanationUnavailableError("尚未設定 OPENAI_API_KEY，AI 解析維持待確認。");

  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      store: false,
      input: aiExplanationPrompt(question),
      text: {
        format: {
          type: "json_schema",
          name: "question_option_analysis",
          strict: true,
          schema: aiExplanationJsonSchema
        }
      }
    })
  });
  if (!upstream.ok) throw new Error("AI 服務暫時無法產生解析，維持待確認。");
  const result = await upstream.json() as { output_text?: string };
  const rawContent = result.output_text?.trim();
  if (!rawContent) throw new Error("AI 未回傳可用解析，維持待確認。");
  return { model, rawContent };
}

async function generateStudyPlanAdvice(plan: StudyPlan) {
  if ((process.env.AI_PROVIDER ?? "ollama").toLowerCase() !== "openai") return null;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";
  const total = plan.counts.due + plan.counts.wrong + plan.counts.new;
  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: `請以繁體中文寫 2 到 3 句讀書建議。只能使用以下彙總資料，不可補充考試規則、法規、題目、答案或未提供的事實。請依序提醒先做到期複習、再錯題加強、最後新題練習，並以一句務實鼓勵結尾。距離考試：${plan.daysRemaining} 天。到期複習：${plan.counts.due} 題。錯題加強：${plan.counts.wrong} 題。新題練習：${plan.counts.new} 題。今日總題數：${total} 題。`
      })
    });
    if (!upstream.ok) {
      console.warn("AI 讀書建議服務未成功回應。", upstream.status);
      return null;
    }
    const result = await upstream.json() as { output_text?: string };
    const content = result.output_text?.trim();
    if (!content) {
      console.warn("AI 未回傳可用的讀書建議。");
      return null;
    }
    return { content, model };
  } catch (error) {
    console.warn("AI 讀書建議服務發生錯誤。", error);
    return null;
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "發生未預期錯誤。";
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && dateKey(date) === value;
}

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { OptionAnalysis, OptionAnalysisVerdict, PracticeMode, QuestionForPractice, StoredQuestion, StudyPlan } from "./types.ts";

type Sqlite = Database.Database;
type PracticeSubject = "all" | "law" | "practice";

export class QuestionDatabase {
  readonly sqlite: Sqlite;
  readonly filePath: string;

  constructor(filePath = ":memory:") {
    this.filePath = filePath;
    if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true });
    this.sqlite = new Database(filePath);
    this.sqlite.pragma("foreign_keys = ON");
    this.initialize();
  }

  private initialize() {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        subject TEXT NOT NULL,
        chapter TEXT NOT NULL,
        question_text TEXT NOT NULL,
        correct_option_id TEXT NOT NULL,
        answer_status TEXT NOT NULL DEFAULT 'ready' CHECK (answer_status IN ('ready', 'pending-review')),
        raw_explanation TEXT NOT NULL,
        fingerprint TEXT NOT NULL UNIQUE,
        mastered INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS question_options (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        option_text TEXT NOT NULL,
        source_order INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ai_explanations (
        question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
        content TEXT,
        status TEXT NOT NULL,
        model TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS ai_option_analyses (
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        option_id TEXT NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
        verdict TEXT NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'pending-review')),
        content TEXT NOT NULL,
        PRIMARY KEY (question_id, option_id)
      );
      CREATE TABLE IF NOT EXISTS ai_generation_jobs (
        question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'ready', 'pending-review', 'failed')),
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS import_previews (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        can_confirm INTEGER NOT NULL,
        confirmed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS import_batches (
        id TEXT PRIMARY KEY,
        source_url TEXT NOT NULL,
        subject TEXT NOT NULL,
        chapter TEXT NOT NULL,
        summary_json TEXT NOT NULL,
        confirmed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS import_batch_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        can_confirm INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS practice_sessions (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        shuffle_questions INTEGER NOT NULL,
        shuffle_options INTEGER NOT NULL,
        question_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES practice_sessions(id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        selected_option_id TEXT,
        is_correct INTEGER,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS exams (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        question_ids_json TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        submitted_at TEXT,
        result_json TEXT
      );
      CREATE TABLE IF NOT EXISTS exam_series (
        id TEXT PRIMARY KEY,
        law_exam_id TEXT NOT NULL REFERENCES exams(id),
        practice_exam_id TEXT REFERENCES exams(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        result_json TEXT
      );
      CREATE TABLE IF NOT EXISTS study_plan_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        exam_date TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS review_schedules (
        question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
        due_date TEXT NOT NULL,
        consecutive_correct INTEGER NOT NULL DEFAULT 0,
        last_reason TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS study_plan_advices (
        cache_key TEXT PRIMARY KEY,
        plan_date TEXT NOT NULL,
        exam_date TEXT NOT NULL,
        content TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('ai', 'fallback')),
        model TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const optionColumns = this.sqlite.prepare("PRAGMA table_info(question_options)").all() as { name: string }[];
    if (!optionColumns.some((column) => column.name === "source_label")) {
      this.sqlite.exec("ALTER TABLE question_options ADD COLUMN source_label TEXT NOT NULL DEFAULT ''");
    }
    const questionColumns = this.sqlite.prepare("PRAGMA table_info(questions)").all() as { name: string }[];
    if (!questionColumns.some((column) => column.name === "answer_status")) {
      this.sqlite.exec("ALTER TABLE questions ADD COLUMN answer_status TEXT NOT NULL DEFAULT 'ready'");
    }
    const importBatchColumns = this.sqlite.prepare("PRAGMA table_info(import_batches)").all() as { name: string }[];
    const importBatchColumnDefinitions = {
      source_url: "TEXT NOT NULL DEFAULT ''",
      subject: "TEXT NOT NULL DEFAULT ''",
      chapter: "TEXT NOT NULL DEFAULT ''",
      summary_json: "TEXT NOT NULL DEFAULT '{}'",
      confirmed_at: "TEXT"
    };
    for (const [column, definition] of Object.entries(importBatchColumnDefinitions)) {
      if (!importBatchColumns.some((existing) => existing.name === column)) {
        this.sqlite.exec(`ALTER TABLE import_batches ADD COLUMN ${column} ${definition}`);
      }
    }
  }

  close() {
    this.sqlite.close();
  }

  count(table: "questions" | "question_options" | "attempts") {
    return (this.sqlite.prepare(`SELECT COUNT(*) AS value FROM ${table}`).get() as { value: number }).value;
  }

  findQuestionByFingerprint(fingerprint: string) {
    return this.sqlite.prepare("SELECT id, answer_status FROM questions WHERE fingerprint = ?").get(fingerprint) as
      | { id: string; answer_status: "ready" | "pending-review" }
      | undefined;
  }

  saveImportPreview(question: StoredQuestion, warnings: string[], canConfirm: boolean) {
    const id = randomUUID();
    this.sqlite.prepare(`INSERT INTO import_previews (id, payload_json, warnings_json, can_confirm)
      VALUES (?, ?, ?, ?)`).run(id, JSON.stringify(question), JSON.stringify(warnings), Number(canConfirm));
    return id;
  }

  getImportPreview(id: string) {
    return this.sqlite.prepare("SELECT * FROM import_previews WHERE id = ?").get(id) as
      | { id: string; payload_json: string; warnings_json: string; can_confirm: number; confirmed_at: string | null }
      | undefined;
  }

  saveImportBatch(input: { sourceUrl: string; subject: string; chapter: string; summary: unknown; items: { question: StoredQuestion; warnings: string[]; canConfirm: boolean }[] }) {
    const id = randomUUID();
    this.sqlite.transaction(() => {
      const availableColumns = new Set((this.sqlite.prepare("PRAGMA table_info(import_batches)").all() as { name: string }[]).map((column) => column.name));
      const legacyPayload = JSON.stringify(input.items.map((item) => item.question));
      const legacyWarnings = JSON.stringify(input.items.flatMap((item) => item.warnings));
      const values: Record<string, string | number> = {
        id,
        source_url: input.sourceUrl,
        subject: input.subject,
        chapter: input.chapter,
        summary_json: JSON.stringify(input.summary),
        payload_json: legacyPayload,
        warnings_json: legacyWarnings,
        can_confirm: Number(input.items.every((item) => item.canConfirm))
      };
      const columns = Object.keys(values).filter((column) => availableColumns.has(column));
      this.sqlite.prepare(`INSERT INTO import_batches (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
        .run(...columns.map((column) => values[column]));
      const insert = this.sqlite.prepare(`INSERT INTO import_batch_items (id, batch_id, payload_json, warnings_json, can_confirm) VALUES (?, ?, ?, ?, ?)`);
      input.items.forEach((item) => insert.run(randomUUID(), id, JSON.stringify(item.question), JSON.stringify(item.warnings), Number(item.canConfirm)));
    })();
    return id;
  }

  getImportBatch(id: string) {
    const batch = this.sqlite.prepare("SELECT * FROM import_batches WHERE id = ?").get(id) as
      | { id: string; source_url: string; subject: string; chapter: string; summary_json: string; confirmed_at: string | null }
      | undefined;
    if (!batch) return undefined;
    const items = this.sqlite.prepare("SELECT payload_json, warnings_json, can_confirm FROM import_batch_items WHERE batch_id = ?").all(id) as
      { payload_json: string; warnings_json: string; can_confirm: number }[];
    return { ...batch, items };
  }

  confirmImportBatch(id: string) {
    const batch = this.getImportBatch(id);
    if (!batch) throw new Error("找不到章節預覽資料。");
    if (batch.confirmed_at) throw new Error("此章節預覽已完成寫入。");
    let inserted = 0;
    let upgraded = 0;
    let skipped = 0;
    this.sqlite.transaction(() => {
      for (const item of batch.items) {
        const question = JSON.parse(item.payload_json) as StoredQuestion;
        if (!item.can_confirm) { skipped += 1; continue; }
        const existing = this.findQuestionByFingerprint(question.fingerprint);
        if (existing) {
          if (this.upgradePendingAnswer(existing.id, question)) upgraded += 1;
          else skipped += 1;
          continue;
        }
        this.addQuestion(question);
        inserted += 1;
      }
      this.sqlite.prepare("UPDATE import_batches SET confirmed_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    })();
    return { inserted, upgraded, skipped };
  }

  private upgradePendingAnswer(questionId: string, imported: StoredQuestion) {
    const existing = this.questionWithOptions(questionId);
    if (existing.answerStatus !== "pending-review" || imported.answerStatus !== "ready" || !imported.correctOptionId) return false;
    const importedCorrectIndex = imported.options.findIndex((option) => option.id === imported.correctOptionId);
    const existingCorrectOption = existing.options[importedCorrectIndex];
    if (importedCorrectIndex < 0 || !existingCorrectOption) return false;

    this.sqlite.prepare(`UPDATE questions
      SET correct_option_id = ?, answer_status = 'ready', raw_explanation = CASE WHEN ? <> '' THEN ? ELSE raw_explanation END
      WHERE id = ?`).run(existingCorrectOption.id, imported.rawExplanation, imported.rawExplanation, questionId);
    return true;
  }

  confirmImportPreview(previewId: string) {
    const preview = this.getImportPreview(previewId);
    if (!preview) throw new Error("找不到題目預覽資料。");
    if (!preview.can_confirm) throw new Error("預覽資料尚未通過檢查，不能寫入題庫。");
    if (preview.confirmed_at) throw new Error("此預覽已完成寫入。");
    const question = JSON.parse(preview.payload_json) as StoredQuestion;
    if (this.findQuestionByFingerprint(question.fingerprint)) throw new Error("此題已存在於題庫中。");
    const id = this.addQuestion(question);
    this.sqlite.prepare("UPDATE import_previews SET confirmed_at = CURRENT_TIMESTAMP WHERE id = ?").run(previewId);
    return id;
  }

  addQuestion(question: StoredQuestion) {
    const id = question.id ?? randomUUID();
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`INSERT INTO questions
        (id, source_url, subject, chapter, question_text, correct_option_id, answer_status, raw_explanation, fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, question.sourceUrl, question.subject, question.chapter, question.questionText,
        question.correctOptionId, question.answerStatus ?? (question.correctOptionId ? "ready" : "pending-review"), question.rawExplanation, question.fingerprint
      );
      const optionInsert = this.sqlite.prepare(`INSERT INTO question_options (id, question_id, option_text, source_order, source_label)
        VALUES (?, ?, ?, ?, ?)`);
      question.options.forEach((option, index) => optionInsert.run(option.id, id, option.text, index, option.sourceLabel ?? ""));
      this.sqlite.prepare(`INSERT INTO ai_explanations (question_id, status) VALUES (?, 'pending')`).run(id);
      this.sqlite.prepare(`INSERT INTO ai_generation_jobs (question_id, status) VALUES (?, 'pending')`).run(id);
    })();
    return id;
  }

  questionWithOptions(id?: string) {
    const statement = id
      ? this.sqlite.prepare("SELECT id, source_url, subject, chapter, question_text, correct_option_id, answer_status, raw_explanation, mastered FROM questions WHERE id = ?")
      : this.sqlite.prepare("SELECT id, source_url, subject, chapter, question_text, correct_option_id, answer_status, raw_explanation, mastered FROM questions ORDER BY created_at LIMIT 1");
    const question = (id ? statement.get(id) : statement.get()) as
      | { id: string; source_url: string; subject: string; chapter: string; question_text: string; correct_option_id: string; answer_status: "ready" | "pending-review"; raw_explanation: string; mastered: number }
      | undefined;
    if (!question) throw new Error("找不到題目。");
    const options = this.sqlite.prepare("SELECT id, option_text, source_label FROM question_options WHERE question_id = ? ORDER BY source_order")
      .all(question.id) as { id: string; option_text: string; source_label: string }[];
    return {
      id: question.id,
      sourceUrl: question.source_url,
      subject: question.subject,
      chapter: question.chapter,
      questionText: question.question_text,
      correctOptionId: question.correct_option_id,
      answerStatus: question.answer_status,
      rawExplanation: question.raw_explanation,
      mastered: Boolean(question.mastered),
      options: options.map((option) => ({ id: option.id, sourceLabel: option.source_label, text: option.option_text }))
    };
  }

  saveOptionAnalysis(questionId: string, analyses: OptionAnalysis[], status: "ready" | "pending-review" | "failed") {
    const options = this.questionWithOptions(questionId).options;
    const optionIds = new Set(options.map((option) => option.id));
    if (analyses.some((analysis) => !optionIds.has(analysis.optionId))) throw new Error("AI 選項分析不屬於此題。");
    this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM ai_option_analyses WHERE question_id = ?").run(questionId);
      const insert = this.sqlite.prepare(`INSERT INTO ai_option_analyses (question_id, option_id, verdict, content) VALUES (?, ?, ?, ?)`);
      analyses.forEach((analysis) => insert.run(questionId, analysis.optionId, analysis.verdict, analysis.content));
      this.sqlite.prepare(`UPDATE ai_explanations SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE question_id = ?`).run(status, questionId);
      this.sqlite.prepare(`UPDATE ai_generation_jobs SET status = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP WHERE question_id = ?`).run(status, questionId);
    })();
  }

  saveAiExplanation(questionId: string, input: {
    content: string;
    model: string | null;
    status: "ready" | "pending-review" | "failed";
    analyses: OptionAnalysis[];
  }) {
    const options = this.questionWithOptions(questionId).options;
    const optionIds = new Set(options.map((option) => option.id));
    if (input.analyses.some((analysis) => !optionIds.has(analysis.optionId))) throw new Error("AI 選項分析不屬於此題。");
    this.sqlite.transaction(() => {
      this.sqlite.prepare("DELETE FROM ai_option_analyses WHERE question_id = ?").run(questionId);
      const insert = this.sqlite.prepare(`INSERT INTO ai_option_analyses (question_id, option_id, verdict, content) VALUES (?, ?, ?, ?)`);
      input.analyses.forEach((analysis) => insert.run(questionId, analysis.optionId, analysis.verdict, analysis.content));
      this.sqlite.prepare(`UPDATE ai_explanations
        SET content = ?, status = ?, model = ?, updated_at = CURRENT_TIMESTAMP
        WHERE question_id = ?`).run(input.content, input.status, input.model, questionId);
      this.sqlite.prepare(`UPDATE ai_generation_jobs
        SET status = ?, error_message = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE question_id = ?`).run(input.status, questionId);
    })();
  }

  pendingAiGenerationQuestions(limit: number) {
    const rows = this.sqlite.prepare(`SELECT question_id FROM ai_generation_jobs
      WHERE status = 'pending' ORDER BY created_at, question_id LIMIT ?`).all(limit) as { question_id: string }[];
    return rows.map((row) => this.questionWithOptions(row.question_id));
  }

  markAiGenerationFailed(questionId: string, errorMessage: string) {
    this.sqlite.transaction(() => {
      this.sqlite.prepare(`UPDATE ai_explanations
        SET content = ?, status = 'pending-review', model = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE question_id = ?`).run("AI 解析暫時無法產生，待確認。", questionId);
      this.sqlite.prepare(`UPDATE ai_generation_jobs
        SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE question_id = ?`).run(errorMessage, questionId);
    })();
  }

  retryFailedAiGenerationJobs() {
    const result = this.sqlite.prepare(`UPDATE ai_generation_jobs
      SET status = 'pending', error_message = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE status = 'failed'`).run();
    return result.changes;
  }

  questionReview(questionId: string) {
    const question = this.questionWithOptions(questionId);
    const ai = this.sqlite.prepare("SELECT content, status, model FROM ai_explanations WHERE question_id = ?").get(questionId) as
      | { content: string | null; status: string; model: string | null }
      | undefined;
    const analyses = this.sqlite.prepare("SELECT option_id, verdict, content FROM ai_option_analyses WHERE question_id = ?").all(questionId) as
      { option_id: string; verdict: OptionAnalysisVerdict; content: string }[];
    return {
      correctOptionId: question.correctOptionId,
      rawExplanation: question.rawExplanation,
      aiExplanation: ai ?? { content: null, status: "pending", model: null },
      aiOptionAnalysis: analyses.map((analysis) => ({ optionId: analysis.option_id, verdict: analysis.verdict, content: analysis.content }))
    };
  }

  getQuestions(ids: string[], shuffleOptions: boolean): QuestionForPractice[] {
    return ids.map((id) => {
      const question = this.questionWithOptions(id);
      const options = [...question.options];
      if (shuffleOptions) shuffle(options);
      return { id: question.id, subject: question.subject, chapter: question.chapter, questionText: question.questionText, options };
    });
  }

  selectPracticeQuestionIds(mode: PracticeMode, subject: PracticeSubject = "all") {
    if (mode === "study-plan") return this.getStudyPlan().questionIds;
    let sql = "SELECT id FROM questions WHERE mastered = 0 AND answer_status = 'ready'";
    const params: string[] = [];
    if (subject === "law") { sql += " AND subject = ?"; params.push("保險法規"); }
    if (subject === "practice") { sql += " AND subject = ?"; params.push("保險實務"); }
    if (mode === "wrong") sql += " AND id IN (SELECT DISTINCT question_id FROM attempts WHERE event_type = 'answer' AND is_correct = 0)";
    if (mode === "common-wrong") {
      sql += ` AND id IN (
        SELECT question_id FROM attempts WHERE event_type = 'answer'
        GROUP BY question_id
        HAVING COUNT(*) >= 3 AND SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) >= 2
          AND AVG(CASE WHEN is_correct = 1 THEN 1.0 ELSE 0 END) < 0.6
      )`;
    }
    return (this.sqlite.prepare(sql).all(...params) as { id: string }[]).map((row) => row.id);
  }

  createPracticeSession(mode: PracticeMode, shuffleQuestions: boolean, shuffleOptions: boolean, subject: PracticeSubject = "all") {
    const ids = this.selectPracticeQuestionIds(mode, subject);
    if (shuffleQuestions) shuffle(ids);
    const id = randomUUID();
    this.sqlite.prepare(`INSERT INTO practice_sessions (id, mode, shuffle_questions, shuffle_options, question_ids_json)
      VALUES (?, ?, ?, ?, ?)`).run(id, mode, Number(shuffleQuestions), Number(shuffleOptions), JSON.stringify(ids));
    return { id, ids };
  }

  getPracticeSession(id: string) {
    return this.sqlite.prepare("SELECT * FROM practice_sessions WHERE id = ?").get(id) as
      | { id: string; mode: string; shuffle_questions: number; shuffle_options: number; question_ids_json: string }
      | undefined;
  }

  createExamSeries(lawExamId: string) {
    const id = randomUUID();
    this.sqlite.prepare("INSERT INTO exam_series (id, law_exam_id) VALUES (?, ?)").run(id, lawExamId);
    return id;
  }

  getExamSeries(id: string) {
    return this.sqlite.prepare("SELECT * FROM exam_series WHERE id = ?").get(id) as
      | { id: string; law_exam_id: string; practice_exam_id: string | null; completed_at: string | null; result_json: string | null }
      | undefined;
  }

  setSeriesPracticeExam(seriesId: string, practiceExamId: string) {
    this.sqlite.prepare("UPDATE exam_series SET practice_exam_id = ? WHERE id = ?").run(practiceExamId, seriesId);
  }

  completeExamSeries(seriesId: string, result: unknown) {
    this.sqlite.prepare("UPDATE exam_series SET completed_at = CURRENT_TIMESTAMP, result_json = ? WHERE id = ?")
      .run(JSON.stringify(result), seriesId);
  }

  recordAttempt(input: { questionId: string; sessionId?: string; eventType: "answer" | "view_answer" | "review"; selectedOptionId?: string }) {
    const question = this.questionWithOptions(input.questionId);
    let isCorrect: boolean | null = null;
    if (input.eventType === "answer") {
      if (!input.selectedOptionId || !question.options.some((option) => option.id === input.selectedOptionId)) throw new Error("作答選項不屬於此題。");
      isCorrect = input.selectedOptionId === question.correctOptionId;
    }
    this.sqlite.prepare(`INSERT INTO attempts (id, question_id, session_id, event_type, selected_option_id, is_correct)
      VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.questionId, input.sessionId ?? null, input.eventType,
      input.selectedOptionId ?? null, isCorrect === null ? null : Number(isCorrect));
    if (input.eventType === "answer" || input.eventType === "view_answer") {
      this.updateReviewSchedule(input.questionId, input.eventType, isCorrect);
    }
    return isCorrect;
  }

  setExamDate(examDate: string) {
    this.sqlite.prepare(`INSERT INTO study_plan_settings (id, exam_date, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET exam_date = excluded.exam_date, updated_at = CURRENT_TIMESTAMP`).run(examDate);
  }

  updateReviewSchedule(questionId: string, eventType: "answer" | "view_answer", isCorrect: boolean | null, now = new Date()) {
    const previous = this.sqlite.prepare("SELECT consecutive_correct FROM review_schedules WHERE question_id = ?")
      .get(questionId) as { consecutive_correct: number } | undefined;
    const isCorrectAnswer = eventType === "answer" && isCorrect === true;
    const consecutiveCorrect = isCorrectAnswer ? (previous?.consecutive_correct ?? 0) + 1 : 0;
    const intervalDays = eventType === "view_answer" || !isCorrectAnswer
      ? 1
      : consecutiveCorrect === 1 ? 3 : consecutiveCorrect === 2 ? 7 : 14;
    const dueDate = addDays(now, intervalDays);
    const reason = eventType === "view_answer" ? "view-answer" : isCorrectAnswer ? "correct" : "wrong";
    this.sqlite.prepare(`INSERT INTO review_schedules (question_id, due_date, consecutive_correct, last_reason, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(question_id) DO UPDATE SET due_date = excluded.due_date,
        consecutive_correct = excluded.consecutive_correct, last_reason = excluded.last_reason, updated_at = CURRENT_TIMESTAMP`)
      .run(questionId, dueDate, consecutiveCorrect, reason);
  }

  createStudyPlanAdviceKey(plan: Pick<StudyPlan, "examDate" | "daysRemaining" | "counts">, now = new Date()) {
    return createHash("sha256").update(JSON.stringify({
      planDate: dateKey(now),
      examDate: plan.examDate,
      daysRemaining: plan.daysRemaining,
      counts: plan.counts
    })).digest("hex");
  }

  getStudyPlanAdvice(cacheKey: string) {
    return this.sqlite.prepare("SELECT content, source, model FROM study_plan_advices WHERE cache_key = ?").get(cacheKey) as
      | { content: string; source: "ai" | "fallback"; model: string | null }
      | undefined;
  }

  saveStudyPlanAdvice(input: { cacheKey: string; planDate: string; examDate: string; content: string; source: "ai" | "fallback"; model: string | null }) {
    this.sqlite.prepare(`INSERT INTO study_plan_advices (cache_key, plan_date, exam_date, content, source, model)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET content = excluded.content, source = excluded.source, model = excluded.model`)
      .run(input.cacheKey, input.planDate, input.examDate, input.content, input.source, input.model);
  }

  getStudyPlan(now = new Date()): StudyPlan {
    const settings = this.sqlite.prepare("SELECT exam_date FROM study_plan_settings WHERE id = 1").get() as { exam_date: string | null } | undefined;
    const examDate = settings?.exam_date ?? null;
    if (!examDate) return { examDate: null, daysRemaining: null, counts: { due: 0, wrong: 0, new: 0 }, questionIds: [], message: "請先設定考試日期。", advice: { content: "先設定考試日期，系統才能安排每天的複習節奏。", source: "fallback" } };

    const today = dateKey(now);
    const daysRemaining = calendarDaysBetween(today, examDate);
    if (daysRemaining <= 0) return { examDate, daysRemaining, counts: { due: 0, wrong: 0, new: 0 }, questionIds: [], message: "考試日已到，今天以休息與整理為主。", advice: { content: "考試日已到，今天以整理用品、調整節奏與保持穩定為主。", source: "fallback" } };

    const dueIds = (this.sqlite.prepare(`SELECT questions.id FROM questions
      INNER JOIN review_schedules ON review_schedules.question_id = questions.id
      WHERE questions.mastered = 0 AND review_schedules.due_date <= ?
      ORDER BY review_schedules.due_date, questions.created_at`).all(today) as { id: string }[]).map((row) => row.id);
    const dueSet = new Set(dueIds);
    const wrongIds = (this.sqlite.prepare(`SELECT DISTINCT questions.id FROM questions
      INNER JOIN attempts ON attempts.question_id = questions.id
      WHERE questions.mastered = 0 AND attempts.event_type = 'answer' AND attempts.is_correct = 0
      ORDER BY questions.created_at`).all() as { id: string }[]).map((row) => row.id).filter((id) => !dueSet.has(id));
    const selected = new Set([...dueIds, ...wrongIds]);
    const newIds = (this.sqlite.prepare(`SELECT questions.id FROM questions
      WHERE questions.mastered = 0 AND NOT EXISTS (
        SELECT 1 FROM attempts WHERE attempts.question_id = questions.id AND attempts.event_type = 'answer'
      ) ORDER BY questions.created_at`).all() as { id: string }[]).map((row) => row.id).filter((id) => !selected.has(id));
    const dailyNewCount = Math.ceil(newIds.length / daysRemaining);
    const todayNewIds = newIds.slice(0, dailyNewCount);
    const questionIds = [...dueIds, ...wrongIds, ...todayNewIds];
    const counts = { due: dueIds.length, wrong: wrongIds.length, new: todayNewIds.length };
    const message = questionIds.length
      ? `先處理 ${counts.due} 題到期複習、${counts.wrong} 題錯題加強，再完成 ${counts.new} 題新題。`
      : "目前沒有需要安排的題目。";
    return { examDate, daysRemaining, counts, questionIds, message, advice: fallbackStudyPlanAdvice(daysRemaining, counts, questionIds.length) };
  }

  setMastered(questionId: string, mastered: boolean) {
    this.sqlite.prepare("UPDATE questions SET mastered = ? WHERE id = ?").run(Number(mastered), questionId);
  }

  dashboard() {
    const total = this.count("questions");
    const commonWrong = this.selectPracticeQuestionIds("common-wrong").length;
    const wrong = this.selectPracticeQuestionIds("wrong").length;
    const mastered = (this.sqlite.prepare("SELECT COUNT(*) AS value FROM questions WHERE mastered = 1").get() as { value: number }).value;
    return { total, wrong, commonWrong, mastered };
  }

  exportData() {
    const tables = ["questions", "question_options", "ai_explanations", "ai_option_analyses", "ai_generation_jobs", "attempts", "practice_sessions", "exams", "study_plan_settings", "review_schedules", "study_plan_advices"] as const;
    return Object.fromEntries(tables.map((table) => [table, this.sqlite.prepare(`SELECT * FROM ${table}`).all()]));
  }
}

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [items[index], items[target]] = [items[target], items[index]];
  }
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return dateKey(result);
}

function calendarDaysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function fallbackStudyPlanAdvice(daysRemaining: number, counts: StudyPlan["counts"], total: number) {
  if (total === 0) return { content: `距離考試還有 ${daysRemaining} 天，今天沒有待完成的題目，維持節奏並為下一次複習保留專注力。`, source: "fallback" as const };
  return {
    content: `距離考試還有 ${daysRemaining} 天。先完成 ${counts.due} 題到期複習，再加強 ${counts.wrong} 題錯題，最後練習 ${counts.new} 題新題；穩定完成今天的 ${total} 題即可。`,
    source: "fallback" as const
  };
}

export function createTestDatabase() {
  return new QuestionDatabase();
}

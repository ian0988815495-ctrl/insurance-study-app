import { createOfflineStore, type OfflineState } from "./offline-store.ts";
import type { OfflineQuestion, OfflineSeed } from "./offline-engine.ts";
import type { Dashboard, PracticeQuestion, StudyPlan } from "./types.ts";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
type OfflineApiOptions = { loadSeed: () => Promise<OfflineSeed>; storage?: StorageLike; onStateChanged?: () => void };
type OfflineSession = { questions: PracticeQuestion[] };
type OfflineExam = { id: string; type: "law" | "practice"; endsAt: string; questions: OfflineQuestion[]; result?: ExamResult };
type OfflineSeries = { lawExamId: string; practiceExamId?: string };
type ExamAnswer = { questionId: string; selectedOptionId: string };
type ExamResult = { autoSubmitted: boolean; correct: number; total: number; score: number; passed: boolean; subjectResults: Array<{ subject: string; correct: number; total: number; score: number; passed: boolean }> };
type RequestLike = Pick<RequestInit, "method" | "body">;

export type OfflineApi = {
  <T>(path: string, init?: RequestLike): Promise<T>;
  exportSyncState(): Promise<OfflineState>;
  replaceSyncState(state: OfflineState): Promise<void>;
};

const fixedExamRules = {
  law: { subject: "law", count: 100, durationMinutes: 80 },
  practice: { subject: "practice", count: 50, durationMinutes: 60 }
} as const;

export function createOfflineApi({ loadSeed, storage, onStateChanged }: OfflineApiOptions): OfflineApi {
  const sessions = new Map<string, OfflineSession>();
  const exams = new Map<string, OfflineExam>();
  const series = new Map<string, OfflineSeries>();
  let sequence = 0;
  let storePromise: Promise<ReturnType<typeof createOfflineStore>> | undefined;

  const store = async () => {
    storePromise ??= loadSeed().then((seed) => createOfflineStore(seed, storage));
    return storePromise;
  };
  const notifyStateChanged = () => { void Promise.resolve(onStateChanged?.()).catch(() => undefined); };

  const offlineApi = async function offlineApi<T>(path: string, init: RequestLike = {}): Promise<T> {
    const data = parseBody(init.body);
    const questionSessionMatch = path.match(/^\/practice-sessions\/([^/]+)\/questions$/);
    const reviewMatch = path.match(/^\/questions\/([^/]+)\/review$/);
    const masteredMatch = path.match(/^\/questions\/([^/]+)\/mastered$/);
    const examSubmitMatch = path.match(/^\/exams\/([^/]+)\/submit$/);
    const seriesNextMatch = path.match(/^\/exam-series\/([^/]+)\/next$/);
    const seriesResultMatch = path.match(/^\/exam-series\/([^/]+)\/result$/);
    const localStore = await store();

    if (path === "/dashboard" && (!init.method || init.method === "GET")) return localStore.dashboard() as T;
    if (path === "/study-plan" && (!init.method || init.method === "GET")) return studyPlan(localStore) as T;
    if (path === "/study-plan/settings" && init.method === "PUT") {
      const examDate = typeof data.examDate === "string" ? data.examDate : "";
      if (!isFutureCalendarDate(examDate)) throw new Error("考試日期不能早於今天。");
      localStore.setExamDate(examDate);
      notifyStateChanged();
      return studyPlan(localStore) as T;
    }
    if (path === "/practice-sessions" && init.method === "POST") {
      const session = localStore.createPracticeSession(data as Parameters<typeof localStore.createPracticeSession>[0]);
      const plan = studyPlan(localStore);
      const questions = (data.mode === "study-plan" ? session.questions.filter((question) => plan.questionIds.includes(question.id)) : session.questions)
        .map(({ correctOptionId: _correctOptionId, rawExplanation: _rawExplanation, ...question }) => question);
      const id = `offline-session-${++sequence}`;
      sessions.set(id, { questions });
      return { id, questionCount: questions.length, settings: data } as T;
    }
    if (questionSessionMatch && (!init.method || init.method === "GET")) {
      const session = sessions.get(questionSessionMatch[1]);
      if (!session) throw new Error("找不到練習。請重新建立練習。");
      return { questions: session.questions } as T;
    }
    if (path === "/attempts" && init.method === "POST") {
      if (data.eventType === "answer") {
        if (typeof data.questionId !== "string" || typeof data.selectedOptionId !== "string") throw new Error("作答資料不完整。");
        const isCorrect = localStore.recordAnswer(data.questionId, data.selectedOptionId);
        notifyStateChanged();
        return { saved: true, isCorrect } as T;
      }
      return { saved: true } as T;
    }
    if (reviewMatch && (!init.method || init.method === "GET")) return localStore.review(reviewMatch[1]) as T;
    if (masteredMatch && init.method === "PATCH") {
      localStore.setMastered(masteredMatch[1], data.mastered === true);
      notifyStateChanged();
      return { saved: true } as T;
    }
    if (path === "/exams/fixed" && init.method === "POST") {
      const type = data.type;
      if (type !== "law" && type !== "practice" && type !== "full") throw new Error("模考類型不正確。");
      if (type === "full") {
        const exam = createFixedExam(localStore, exams, "law", () => ++sequence);
        const seriesId = `offline-series-${++sequence}`;
        series.set(seriesId, { lawExamId: exam.id });
        return { seriesId, stage: "law", exam: publicExam(exam) } as T;
      }
      return publicExam(createFixedExam(localStore, exams, type, () => ++sequence)) as T;
    }
    if (examSubmitMatch && init.method === "POST") {
      const exam = exams.get(examSubmitMatch[1]);
      if (!exam) throw new Error("找不到模考。");
      if (exam.result) throw new Error("此模考已交卷。");
      const answers = Array.isArray(data.answers) ? data.answers.filter(isExamAnswer) : [];
      exam.result = scoreExam(localStore, exam, answers);
      notifyStateChanged();
      return exam.result as T;
    }
    if (seriesNextMatch && init.method === "POST") {
      const currentSeries = series.get(seriesNextMatch[1]);
      const lawExam = currentSeries ? exams.get(currentSeries.lawExamId) : undefined;
      if (!currentSeries || !lawExam) throw new Error("找不到完整測驗。");
      if (!lawExam.result) throw new Error("請先完成法規模考。");
      const practiceExam = currentSeries.practiceExamId ? exams.get(currentSeries.practiceExamId) : createFixedExam(localStore, exams, "practice", () => ++sequence);
      if (!practiceExam) throw new Error("找不到實務模考。");
      currentSeries.practiceExamId ??= practiceExam.id;
      return { stage: "practice", exam: publicExam(practiceExam) } as T;
    }
    if (seriesResultMatch && (!init.method || init.method === "GET")) {
      const currentSeries = series.get(seriesResultMatch[1]);
      const lawResult = currentSeries ? exams.get(currentSeries.lawExamId)?.result : undefined;
      const practiceResult = currentSeries?.practiceExamId ? exams.get(currentSeries.practiceExamId)?.result : undefined;
      if (!lawResult || !practiceResult) throw new Error("完整測驗尚未全部交卷。");
      return { lawScore: lawResult.score, practiceScore: practiceResult.score, totalScore: lawResult.score + practiceResult.score, passed: lawResult.score >= 60 && practiceResult.score >= 60 && lawResult.score + practiceResult.score >= 140 } as T;
    }
    if (path === "/backups/export" && (!init.method || init.method === "GET")) return localStore.exportBackup() as T;
    if (path === "/backups/preview" && init.method === "POST") {
      const backup = data as { schemaVersion?: unknown; state?: unknown };
      if (backup.schemaVersion !== 1 || !isOfflineBackupState(backup.state)) throw new Error("備份格式不正確，未執行任何寫入。");
      return { valid: true, questionCount: 0, attemptCount: backup.state.attempts.length } as T;
    }
    if (path === "/backups/restore" && init.method === "POST") {
      const backup = data.backup as { schemaVersion?: unknown; state?: unknown } | undefined;
      if (data.confirmed !== true || !backup || backup.schemaVersion !== 1 || !isOfflineBackupState(backup.state)) {
        throw new Error("還原前必須通過預覽並由使用者明確確認。");
      }
      localStore.restoreBackup(backup as Parameters<typeof localStore.restoreBackup>[0]);
      notifyStateChanged();
      return { restored: true, safetyBackup: null } as T;
    }
    throw new Error("此離線功能尚未支援，請更新手機版題庫。");
  };
  offlineApi.exportSyncState = async () => (await store()).exportState();
  offlineApi.replaceSyncState = async (state: OfflineState) => {
    (await store()).replaceSyncState(state);
  };
  return offlineApi;
}

function parseBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string" || !body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new Error("離線資料格式不正確。");
  }
}

function studyPlan(store: ReturnType<typeof createOfflineStore>): StudyPlan {
  const snapshot = store.exportState();
  const dashboard: Dashboard = store.dashboard();
  const attemptedIds = new Set((snapshot.attempts ?? []).map((attempt) => attempt.questionId));
  const newCount = Math.max(0, dashboard.total - dashboard.mastered - attemptedIds.size);
  const examDate = store.getExamDate();
  const daysRemaining = examDate ? differenceInDays(examDate) : null;
  const dailyTarget = daysRemaining && daysRemaining > 0 ? Math.max(10, Math.ceil((dashboard.wrong + newCount) / daysRemaining)) : 20;
  const session = store.createPracticeSession({ mode: "sequential", subject: "all", shuffleQuestions: false, shuffleOptions: false });
  const questionIds = session.questions.slice(0, dailyTarget).map((question) => question.id);
  const total = dashboard.wrong + newCount;
  const advice = daysRemaining === null
    ? "先設定考試日期，系統會依剩餘天數安排每天的練習量。"
    : `今天先完成 ${Math.min(dailyTarget, questionIds.length)} 題，先處理錯題，再穩定累積新題。每天完成即可逐步縮小待複習範圍。`;
  return {
    examDate,
    daysRemaining,
    counts: { due: 0, wrong: dashboard.wrong, new: newCount },
    questionIds,
    message: total === 0 ? "目前沒有待安排題目。" : `今日安排 ${questionIds.length} 題。`,
    advice: { content: advice, source: "fallback" }
  };
}

function differenceInDays(examDate: string) {
  const today = startOfDay(new Date());
  return Math.max(0, Math.round((new Date(`${examDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000));
}

function isFutureCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && date >= startOfDay(new Date());
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isOfflineBackupState(value: unknown): value is { attempts: unknown[]; masteredQuestionIds: unknown[]; examDate?: string | null } {
  if (!value || typeof value !== "object") return false;
  const state = value as { attempts?: unknown; masteredQuestionIds?: unknown; examDate?: unknown };
  return Array.isArray(state.attempts) && Array.isArray(state.masteredQuestionIds) && (state.examDate === undefined || state.examDate === null || typeof state.examDate === "string");
}

function createFixedExam(store: ReturnType<typeof createOfflineStore>, exams: Map<string, OfflineExam>, type: "law" | "practice", nextId: () => number) {
  const rule = fixedExamRules[type];
  const selection = store.createPracticeSession({ mode: "random", subject: rule.subject, shuffleQuestions: true, shuffleOptions: true }).questions;
  if (selection.length < rule.count) throw new Error(`科目題目不足，無法建立${type === "law" ? "法規" : "實務"}模考。`);
  const id = `offline-exam-${nextId()}`;
  const exam: OfflineExam = { id, type, endsAt: new Date(Date.now() + rule.durationMinutes * 60_000).toISOString(), questions: selection.slice(0, rule.count) };
  exams.set(id, exam);
  return exam;
}

function publicExam(exam: OfflineExam) {
  return { id: exam.id, endsAt: exam.endsAt, questions: exam.questions.map(({ correctOptionId: _correctOptionId, rawExplanation: _rawExplanation, ...question }) => question) };
}

function scoreExam(store: ReturnType<typeof createOfflineStore>, exam: OfflineExam, answers: ExamAnswer[]): ExamResult {
  const selectedByQuestion = new Map(answers.map((answer) => [answer.questionId, answer.selectedOptionId]));
  let correct = 0;
  for (const question of exam.questions) {
    const selectedOptionId = selectedByQuestion.get(question.id) ?? "offline-unanswered";
    correct += Number(selectedOptionId === question.correctOptionId);
    store.recordAnswer(question.id, selectedOptionId);
  }
  const total = exam.questions.length;
  const score = total === 0 ? 0 : (correct / total) * 100;
  return { autoSubmitted: Date.now() >= new Date(exam.endsAt).getTime(), correct, total, score, passed: score >= 60, subjectResults: [{ subject: exam.type === "law" ? "保險法規" : "保險實務", correct, total, score, passed: score >= 60 }] };
}

function isExamAnswer(value: unknown): value is ExamAnswer {
  return Boolean(value && typeof value === "object" && typeof (value as ExamAnswer).questionId === "string" && typeof (value as ExamAnswer).selectedOptionId === "string");
}

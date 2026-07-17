import type { PracticeQuestion } from "./types.ts";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type SessionStatus = "active" | "completed" | "ended";

export type ActivePractice = {
  sessionId: string;
  questions: PracticeQuestion[];
  index: number;
  selectedAnswers: Record<string, string>;
  revealedQuestions: string[];
  sessionStatus: SessionStatus;
  startedAt: string;
  updatedAt: string;
  recordedAnswers?: Record<string, string>;
  /** 舊版快照欄位，僅為相容既有裝置資料保留。 */
  selectedOptionId?: string;
  viewedAnswer?: boolean;
};

const activePracticeKey = "private-insurance-question-bank.active-practice.v2";
const legacyActivePracticeKey = "private-insurance-question-bank.active-practice.v1";

export function loadActivePractice(storage: StorageLike = window.localStorage): ActivePractice | null {
  const raw = storage.getItem(activePracticeKey) ?? storage.getItem(legacyActivePracticeKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ActivePractice>;
    return normalizeProgress(parsed);
  } catch {
    return null;
  }
}

export function saveActivePractice(progress: ActivePractice, storage: StorageLike = window.localStorage) {
  storage.setItem(activePracticeKey, JSON.stringify({ ...progress, updatedAt: progress.updatedAt || new Date().toISOString() }));
}

export function clearActivePractice(storage: StorageLike = window.localStorage) {
  storage.removeItem(activePracticeKey);
  storage.removeItem(legacyActivePracticeKey);
}

function normalizeProgress(value: Partial<ActivePractice>): ActivePractice | null {
  const questions = value.questions;
  const index = value.index;
  if (!value.sessionId || !Array.isArray(questions) || !questions.length || !Number.isInteger(index) || index === undefined || index < 0 || index >= questions.length) return null;
  const updatedAt = value.updatedAt ?? new Date().toISOString();
  const currentQuestion = questions[index];
  const selectedAnswers = isStringRecord(value.selectedAnswers) ? { ...value.selectedAnswers } : {};
  const revealedQuestions = Array.isArray(value.revealedQuestions) ? value.revealedQuestions.filter((questionId): questionId is string => typeof questionId === "string") : [];
  if (!Object.keys(selectedAnswers).length && value.selectedOptionId && currentQuestion) selectedAnswers[currentQuestion.id] = value.selectedOptionId;
  if (!revealedQuestions.length && value.viewedAnswer && currentQuestion) revealedQuestions.push(currentQuestion.id);
  const sessionStatus = value.sessionStatus === "completed" || value.sessionStatus === "ended" ? value.sessionStatus : "active";
  if (sessionStatus !== "active") return null;
  return {
    sessionId: value.sessionId,
    questions,
    index,
    selectedAnswers,
    revealedQuestions: [...new Set(revealedQuestions)],
    sessionStatus,
    startedAt: value.startedAt ?? updatedAt,
    updatedAt,
    ...(isStringRecord(value.recordedAnswers) ? { recordedAnswers: { ...value.recordedAnswers } } : {})
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string"));
}

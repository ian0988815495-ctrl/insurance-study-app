import type { PracticeQuestion } from "./types.ts";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type ActivePractice = {
  sessionId: string;
  questions: PracticeQuestion[];
  index: number;
  selectedOptionId?: string;
  viewedAnswer?: boolean;
  updatedAt?: string;
};

const activePracticeKey = "private-insurance-question-bank.active-practice.v1";

export function loadActivePractice(storage: StorageLike = window.localStorage): ActivePractice | null {
  const raw = storage.getItem(activePracticeKey);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as ActivePractice;
    if (!value.sessionId || !Array.isArray(value.questions) || !value.questions.length || !Number.isInteger(value.index) || value.index < 0 || value.index >= value.questions.length) return null;
    return value;
  } catch {
    return null;
  }
}

export function saveActivePractice(progress: ActivePractice, storage: StorageLike = window.localStorage) {
  storage.setItem(activePracticeKey, JSON.stringify(progress));
}

export function clearActivePractice(storage: StorageLike = window.localStorage) {
  storage.removeItem(activePracticeKey);
}

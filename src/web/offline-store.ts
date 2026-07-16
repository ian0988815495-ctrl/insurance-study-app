import { createOfflineEngine, type OfflineSeed } from "./offline-engine.ts";

type StorageLike = Pick<Storage, "getItem" | "setItem">;
export type OfflineState = {
  attempts?: Array<{ questionId: string; selectedOptionId: string; isCorrect: boolean }>;
  masteredQuestionIds?: string[];
  examDate?: string | null;
  updatedAt?: string;
};
export type OfflineBackup = { schemaVersion: 1; exportedAt: string; state: OfflineState };

const stateKey = "private-insurance-question-bank.offline-state.v1";

export function createOfflineStore(seed: OfflineSeed, storage: StorageLike = window.localStorage) {
  const readState = (): OfflineState => {
    const raw = storage.getItem(stateKey);
    if (!raw) return {};
    try {
      const value = JSON.parse(raw) as OfflineState;
      return { attempts: value.attempts ?? [], masteredQuestionIds: value.masteredQuestionIds ?? [], examDate: value.examDate ?? null, updatedAt: value.updatedAt };
    } catch {
      return {};
    }
  };

  const persistedState = readState();
  let engine = createOfflineEngine(seed, persistedState);
  let examDate = persistedState.examDate ?? null;
  let updatedAt = persistedState.updatedAt;
  const exportState = (): OfflineState => ({ ...engine.exportState(), examDate, updatedAt });
  const save = (touch = true) => {
    if (touch) updatedAt = new Date().toISOString();
    storage.setItem(stateKey, JSON.stringify(exportState()));
  };

  return {
    dashboard() {
      return engine.dashboard();
    },
    createPracticeSession(settings: Parameters<typeof engine.createPracticeSession>[0]) {
      return engine.createPracticeSession(settings);
    },
    review(questionId: string) {
      return engine.review(questionId);
    },
    exportState() {
      return exportState();
    },
    recordAnswer(questionId: string, selectedOptionId: string) {
      const result = engine.recordAnswer(questionId, selectedOptionId);
      save();
      return result;
    },
    setMastered(questionId: string, mastered: boolean) {
      engine.setMastered(questionId, mastered);
      save();
    },
    getExamDate() {
      return examDate;
    },
    setExamDate(value: string | null) {
      examDate = value;
      save();
    },
    exportBackup(): OfflineBackup {
      return { schemaVersion: 1, exportedAt: new Date().toISOString(), state: { ...engine.exportState(), examDate } };
    },
    restoreBackup(backup: OfflineBackup) {
      if (backup.schemaVersion !== 1 || !backup.state || !Array.isArray(backup.state.attempts) || !Array.isArray(backup.state.masteredQuestionIds)) {
        throw new Error("離線備份格式不正確。");
      }
      engine = createOfflineEngine(seed, backup.state);
      examDate = backup.state.examDate ?? null;
      save();
    },
    replaceSyncState(state: OfflineState) {
      if (!Array.isArray(state.attempts) || !Array.isArray(state.masteredQuestionIds)) {
        throw new Error("同步資料格式不正確。");
      }
      engine = createOfflineEngine(seed, state);
      examDate = state.examDate ?? null;
      updatedAt = state.updatedAt;
      save(false);
    }
  };
}

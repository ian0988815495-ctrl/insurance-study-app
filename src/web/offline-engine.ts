import type { Dashboard, OptionAnalysis, PracticeMode, PracticeQuestion, Review } from "./types.ts";

export type OfflineQuestion = PracticeQuestion & {
  correctOptionId: string | null;
  rawExplanation: string;
  answerStatus?: "ready" | "pending-review";
  suggestedAnswer?: { optionId: string; reason: string };
  aiExplanation?: { content: string | null; status: string; model?: string | null };
  aiOptionAnalysis?: OptionAnalysis[];
};
export type OfflineSeed = { version: number; questions: OfflineQuestion[] };
export type OfflinePracticeSettings = { mode: PracticeMode; subject: "all" | "law" | "practice"; shuffleQuestions: boolean; shuffleOptions: boolean };

type AnswerAttempt = { questionId: string; selectedOptionId: string; isCorrect: boolean };

export function createOfflineEngine(seed: OfflineSeed, initial?: { attempts?: AnswerAttempt[]; masteredQuestionIds?: string[] }) {
  const attempts = [...(initial?.attempts ?? [])];
  const masteredQuestionIds = new Set(initial?.masteredQuestionIds ?? []);

  const matchingSubject = (question: OfflineQuestion, subject: OfflinePracticeSettings["subject"]) => subject === "all" || (subject === "law" ? question.subject.includes("法規") : question.subject.includes("實務"));
  const answerAttempts = (questionId: string) => attempts.filter((attempt) => attempt.questionId === questionId);
  const isWrong = (questionId: string) => answerAttempts(questionId).some((attempt) => !attempt.isCorrect);
  const isCommonWrong = (questionId: string) => {
    const history = answerAttempts(questionId);
    const wrong = history.filter((attempt) => !attempt.isCorrect).length;
    return history.length >= 3 && wrong >= 2 && wrong / history.length > 0.4;
  };

  return {
    dashboard(): Dashboard {
      return {
        total: seed.questions.length,
        wrong: seed.questions.filter((question) => !masteredQuestionIds.has(question.id) && isWrong(question.id)).length,
        commonWrong: seed.questions.filter((question) => !masteredQuestionIds.has(question.id) && isCommonWrong(question.id)).length,
        mastered: masteredQuestionIds.size
      };
    },
    createPracticeSession(settings: OfflinePracticeSettings) {
      let questions = seed.questions.filter((question) => matchingSubject(question, settings.subject) && !masteredQuestionIds.has(question.id) && question.answerStatus !== "pending-review" && Boolean(question.correctOptionId));
      if (settings.mode === "wrong") questions = questions.filter((question) => isWrong(question.id));
      if (settings.mode === "common-wrong") questions = questions.filter((question) => isCommonWrong(question.id));
      if (settings.shuffleQuestions) questions = shuffle(questions);
      return { id: crypto.randomUUID(), questions: questions.map((question) => ({ ...question, options: settings.shuffleOptions ? shuffle(question.options) : [...question.options] })) };
    },
    recordAnswer(questionId: string, selectedOptionId: string) {
      const question = questionById(seed, questionId);
      const isCorrect = Boolean(question.correctOptionId && question.correctOptionId === selectedOptionId);
      attempts.push({ questionId, selectedOptionId, isCorrect });
      return isCorrect;
    },
    review(questionId: string): Review {
      const question = questionById(seed, questionId);
      return {
        correctOptionId: question.correctOptionId,
        rawExplanation: question.rawExplanation,
        aiExplanation: question.aiExplanation ?? { content: null, status: "pending", model: null },
        aiOptionAnalysis: question.aiOptionAnalysis ?? []
      };
    },
    setMastered(questionId: string, mastered: boolean) {
      if (mastered) masteredQuestionIds.add(questionId);
      else masteredQuestionIds.delete(questionId);
    },
    exportState() {
      return { attempts, masteredQuestionIds: [...masteredQuestionIds] };
    }
  };
}

function questionById(seed: OfflineSeed, questionId: string) {
  const question = seed.questions.find((item) => item.id === questionId);
  if (!question) throw new Error("找不到題目。");
  return question;
}

function shuffle<T>(items: T[]) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

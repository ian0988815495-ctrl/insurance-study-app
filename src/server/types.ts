export type PracticeMode = "sequential" | "random" | "wrong" | "common-wrong" | "study-plan";

export type StudyPlanAdvice = { content: string; source: "ai" | "fallback" };

export interface StudyPlan {
  examDate: string | null;
  daysRemaining: number | null;
  counts: { due: number; wrong: number; new: number };
  questionIds: string[];
  message: string;
  advice: StudyPlanAdvice;
}

export interface QuestionOption {
  id: string;
  sourceLabel?: string;
  text: string;
}

export type OptionAnalysisVerdict = "correct" | "incorrect" | "pending-review";

export interface OptionAnalysis {
  optionId: string;
  verdict: OptionAnalysisVerdict;
  content: string;
}

export interface StoredQuestion {
  id?: string;
  sourceUrl: string;
  subject: string;
  chapter: string;
  questionText: string;
  options: QuestionOption[];
  correctOptionId: string;
  answerStatus?: "ready" | "pending-review";
  rawExplanation: string;
  fingerprint: string;
}

export interface QuestionForPractice {
  id: string;
  subject: string;
  chapter: string;
  questionText: string;
  options: QuestionOption[];
}

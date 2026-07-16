export type Dashboard = { total: number; wrong: number; commonWrong: number; mastered: number };
export type StudyPlanAdvice = { content: string; source: "ai" | "fallback" };
export type StudyPlan = { examDate: string | null; daysRemaining: number | null; counts: { due: number; wrong: number; new: number }; questionIds: string[]; message: string; advice: StudyPlanAdvice };
export type Option = { id: string; sourceLabel?: string; text: string };
export type PracticeQuestion = { id: string; subject: string; chapter: string; questionText: string; options: Option[] };
export type OptionAnalysis = { optionId: string; verdict: "correct" | "incorrect" | "pending-review"; content: string };
export type Review = { correctOptionId: string; rawExplanation: string; aiExplanation: { content: string | null; status: string }; aiOptionAnalysis?: OptionAnalysis[] };
export type PracticeMode = "sequential" | "random" | "wrong" | "common-wrong" | "study-plan";

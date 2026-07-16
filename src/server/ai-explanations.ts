import { z } from "zod";
import type { OptionAnalysis, QuestionOption } from "./types.ts";

const verdictSchema = z.enum(["correct", "incorrect", "pending-review"]);
const aiExplanationSchema = z.object({
  summary: z.string().trim().min(1),
  analyses: z.array(z.object({
    optionId: z.string().trim().min(1),
    verdict: verdictSchema,
    content: z.string().trim().min(1)
  }))
});

export interface ParsedAiExplanation {
  status: "ready" | "pending-review";
  summary: string;
  analyses: OptionAnalysis[];
}

export function parseAiExplanation(rawContent: string, options: QuestionOption[]): ParsedAiExplanation {
  let rawValue: unknown;
  try {
    rawValue = JSON.parse(rawContent);
  } catch {
    return pendingExplanation(options);
  }
  const parsed = aiExplanationSchema.safeParse(rawValue);
  if (!parsed.success) return pendingExplanation(options);

  const analysesByOptionId = new Map(parsed.data.analyses.map((analysis) => [analysis.optionId, analysis]));
  let hasMissingOption = false;
  const analyses = options.map((option) => {
    const analysis = analysesByOptionId.get(option.id);
    if (analysis) return analysis;
    hasMissingOption = true;
    return {
      optionId: option.id,
      verdict: "pending-review" as const,
      content: "AI 未提供此選項的解析，待確認。"
    };
  });

  return {
    status: hasMissingOption ? "pending-review" : "ready",
    summary: parsed.data.summary,
    analyses
  };
}

function pendingExplanation(options: QuestionOption[]): ParsedAiExplanation {
  return {
    status: "pending-review",
    summary: "AI 解析格式不完整，待確認。",
    analyses: options.map((option) => ({
      optionId: option.id,
      verdict: "pending-review",
      content: "AI 未提供此選項的解析，待確認。"
    }))
  };
}

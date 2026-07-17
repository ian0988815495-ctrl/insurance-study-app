import { existsSync, readFileSync } from "node:fs";

export function readSeed(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function hasCompleteAiExplanations(seed, expectedQuestionCount) {
  if (!Array.isArray(seed?.questions) || seed.questions.length !== expectedQuestionCount) return false;

  return seed.questions.every((question) => {
    const explanation = question.aiExplanation;
    const analyses = question.aiOptionAnalysis;
    return explanation?.status === "ready"
      && typeof explanation.content === "string"
      && explanation.content.trim().length > 0
      && Array.isArray(analyses)
      && analyses.length === question.options.length
      && analyses.every((analysis) => typeof analysis?.content === "string" && analysis.content.trim().length > 0);
  });
}

export function selectOfflineSeedSource(basePath, enrichedPath) {
  const baseSeed = readSeed(basePath);
  if (!existsSync(enrichedPath)) {
    return { path: basePath, seed: baseSeed, enriched: false };
  }

  const enrichedSeed = readSeed(enrichedPath);
  if (!hasCompleteAiExplanations(enrichedSeed, baseSeed.questions.length)) {
    throw new Error("AI 解析檔存在但不完整，停止公開版建置，避免發布空白解析。請先完成 ChatGPT 解析合併與驗證。");
  }

  return { path: enrichedPath, seed: enrichedSeed, enriched: true };
}

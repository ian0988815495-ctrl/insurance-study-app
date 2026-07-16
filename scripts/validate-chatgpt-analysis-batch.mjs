import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const [sourcePath, resultPath] = process.argv.slice(2);
if (!sourcePath || !resultPath) {
  console.error("Usage: node scripts/validate-chatgpt-analysis-batch.mjs <batch-source.json> <batch-result.json>");
  process.exit(2);
}

const source = JSON.parse(await readFile(resolve(sourcePath), "utf8"));
const result = JSON.parse(await readFile(resolve(resultPath), "utf8"));
const report = validateBatch(source, result);

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;

function validateBatch(sourceBatch, resultBatch) {
  const errors = [];
  const questions = Array.isArray(sourceBatch.questions) ? sourceBatch.questions : [];
  const results = Array.isArray(resultBatch.results) ? resultBatch.results : [];

  if (!sourceBatch.batchId) errors.push("來源批次缺少 batchId。");
  if (resultBatch.batchId && resultBatch.batchId !== sourceBatch.batchId) {
    errors.push(`回傳 batchId 不符：預期 ${sourceBatch.batchId}，實際為 ${resultBatch.batchId}。`);
  }
  if (results.length !== questions.length) {
    errors.push(`題數不符：輸入 ${questions.length} 題，輸出 ${results.length} 題。`);
  }

  const resultIds = results.map((item) => item?.questionId);
  const uniqueIds = new Set(resultIds);
  if (uniqueIds.size !== resultIds.length) errors.push("輸出有重複 questionId。");

  let officialAnswerCount = 0;
  let pendingReviewCount = 0;
  let suggestedAnswerCount = 0;

  questions.forEach((question, index) => {
    const item = results[index];
    const label = `第 ${index + 1} 題`;
    if (!item) {
      errors.push(`${label} 缺少輸出結果。`);
      return;
    }
    if (item.questionId !== question.id) {
      errors.push(`${label} questionId 或順序不符。`);
    }
    if (typeof item.summary !== "string" || item.summary.trim().length === 0) {
      errors.push(`${label} 缺少 summary。`);
    }

    const options = Array.isArray(question.options) ? question.options : [];
    const analyses = Array.isArray(item.analyses) ? item.analyses : [];
    if (analyses.length !== options.length) {
      errors.push(`${label} 選項解析數量不符：預期 ${options.length}，實際 ${analyses.length}。`);
    }
    analyses.forEach((analysis, analysisIndex) => {
      const option = options[analysisIndex];
      if (!option || analysis?.optionId !== option.id) {
        errors.push(`${label} 第 ${analysisIndex + 1} 個選項 ID 或順序不符。`);
      }
      if (typeof analysis?.content !== "string" || analysis.content.trim().length === 0) {
        errors.push(`${label} 第 ${analysisIndex + 1} 個選項缺少解析內容。`);
      }
    });

    if (question.officialAnswer?.optionId) {
      officialAnswerCount += 1;
      analyses.forEach((analysis) => {
        const expected = analysis.optionId === question.officialAnswer.optionId ? "correct" : "incorrect";
        if (analysis.verdict !== expected) {
          errors.push(`${label} 的 verdict 與原始正式答案不符。`);
        }
      });
      if (item.suggestedAnswer) errors.push(`${label} 有正式答案，不應新增 suggestedAnswer。`);
      return;
    }

    pendingReviewCount += 1;
    analyses.forEach((analysis) => {
      if (analysis.verdict !== "pending-review") {
        errors.push(`${label} 缺正式答案時，所有 verdict 必須為 pending-review。`);
      }
    });
    if (!item.suggestedAnswer || typeof item.suggestedAnswer.optionId !== "string") {
      errors.push(`${label} 缺正式答案時，必須有 suggestedAnswer。`);
    } else {
      suggestedAnswerCount += 1;
      if (!options.some((option) => option.id === item.suggestedAnswer.optionId)) {
        errors.push(`${label} suggestedAnswer 不屬於原始選項。`);
      }
      if (typeof item.suggestedAnswer.reason !== "string" || item.suggestedAnswer.reason.trim().length === 0) {
        errors.push(`${label} suggestedAnswer 缺少 AI 建議理由。`);
      }
    }
  });

  return {
    ok: errors.length === 0,
    batchId: sourceBatch.batchId ?? null,
    inputQuestionCount: questions.length,
    outputQuestionCount: results.length,
    officialAnswerCount,
    pendingReviewCount,
    suggestedAnswerCount,
    errors
  };
}

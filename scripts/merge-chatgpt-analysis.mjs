import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(join(fileURLToPath(new URL(".", import.meta.url)), ".."));
const seedPath = resolve(process.argv[2] ?? join(root, "work", "offline-seed.json"));
const outputPath = resolve(process.argv[3] ?? join(root, "work", "offline-seed.with-chatgpt-analyses.json"));
const packagePath = join(root, "work", "chatgpt-explanation-package");
const returnedPath = join(root, "work", "chatgpt-returned");

const seed = JSON.parse(readFileSync(seedPath, "utf8"));
const resultByQuestionId = new Map();
let batchCount = 0;

for (let index = 1; index <= 33; index += 1) {
  const batchId = `batch-${String(index).padStart(3, "0")}`;
  const source = JSON.parse(readFileSync(join(packagePath, `${batchId}.json`), "utf8"));
  const result = JSON.parse(readFileSync(join(returnedPath, `${batchId}-result.json`), "utf8"));
  if (source.batchId !== result.batchId || source.questions.length !== result.results.length) {
    throw new Error(`${batchId} 題數或批次識別不一致。`);
  }
  source.questions.forEach((question, questionIndex) => {
    const item = result.results[questionIndex];
    if (!item || item.questionId !== question.id || resultByQuestionId.has(question.id)) {
      throw new Error(`${batchId} 題目順序、題號或重複資料不一致。`);
    }
    if (!Array.isArray(item.analyses) || item.analyses.length !== question.options.length) {
      throw new Error(`${batchId} 題目 ${question.id} 的選項解析數量不一致。`);
    }
    resultByQuestionId.set(question.id, item);
  });
  batchCount += 1;
}

if (!Array.isArray(seed.questions) || seed.questions.length !== resultByQuestionId.size) {
  throw new Error(`題庫題數不一致：題庫 ${seed.questions?.length ?? 0} 題，解析 ${resultByQuestionId.size} 題。`);
}

const questions = seed.questions.map((question) => {
  const result = resultByQuestionId.get(question.id);
  if (!result) throw new Error(`找不到題目 ${question.id} 的 AI 解析。`);
  const pending = !question.correctOptionId;
  const enriched = {
    ...question,
    answerStatus: pending ? "pending-review" : "ready",
    aiExplanation: {
      content: result.summary,
      status: "ready",
      model: "ChatGPT 萬象中樞"
    },
    aiOptionAnalysis: result.analyses.map((analysis) => ({
      optionId: analysis.optionId,
      verdict: analysis.verdict,
      content: analysis.content
    }))
  };
  if (pending) enriched.suggestedAnswer = result.suggestedAnswer;
  return enriched;
});

mkdirSync(resolve(outputPath, ".."), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ ...seed, generatedAt: new Date().toISOString(), questions }, null, 2), "utf8");

const officialAnswerCount = questions.filter((question) => question.answerStatus === "ready").length;
const pendingReviewCount = questions.filter((question) => question.answerStatus === "pending-review").length;
console.log(JSON.stringify({ outputPath, batchCount, questionCount: questions.length, officialAnswerCount, pendingReviewCount }, null, 2));

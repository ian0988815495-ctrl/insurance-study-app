import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const options = readArguments(process.argv.slice(2));
const batchSize = options.batchSize ?? 20;
const outputPath = options.output ?? join(root, "work", `chatgpt-explanation-package-${fileTimestamp()}`);
const database = new Database(join(root, "data", "question-bank.sqlite"), { readonly: true });

const questionRows = database.prepare(`SELECT id, subject, chapter, question_text, correct_option_id, raw_explanation
  FROM questions
  ORDER BY subject, chapter, created_at, id`).all();
const optionsForQuestion = database.prepare(`SELECT id, source_label, option_text
  FROM question_options WHERE question_id = ? ORDER BY source_order`);
const questions = questionRows.map((question) => {
  const questionOptions = optionsForQuestion.all(question.id).map((option) => ({
    id: option.id,
    sourceLabel: option.source_label || undefined,
    text: option.option_text
  }));
  const correctOption = questionOptions.find((option) => option.id === question.correct_option_id);
  const hasOfficialAnswer = Boolean(correctOption);

  return {
    id: question.id,
    subject: question.subject,
    chapter: question.chapter,
    questionText: question.question_text,
    options: questionOptions,
    answerStatus: hasOfficialAnswer ? "ready" : "pending-review",
    officialAnswer: correctOption ? {
      optionId: correctOption.id,
      sourceLabel: correctOption.sourceLabel ?? null,
      text: correctOption.text
    } : null,
    originalExplanation: question.raw_explanation
  };
});
database.close();

mkdirSync(outputPath, { recursive: true });
const batches = chunk(questions, batchSize).map((items, index) => {
  const batchId = `batch-${String(index + 1).padStart(3, "0")}`;
  const fileName = `${batchId}.json`;
  const payload = {
    packageVersion: 1,
    batchId,
    purpose: "為保險題目建立 AI 解析；正式答案已由題庫提供，請勿自行改動。",
    responseContract: {
      requiredRootKey: "results",
      resultShape: {
        questionId: "題目 id，必須原樣保留",
        summary: "繁體中文白話解析，說明為何正式答案正確",
        analyses: [{ optionId: "選項 id，必須原樣保留", verdict: "correct | incorrect | pending-review", content: "繁體中文選項解析" }]
      }
    },
    questions: items
  };
  writeJson(join(outputPath, fileName), payload);
  return { batchId, fileName, questionCount: items.length };
});

const manifest = {
  packageVersion: 1,
  generatedAt: new Date().toISOString(),
  questionCount: questions.length,
  missingOfficialAnswerCount: questions.filter((question) => question.officialAnswer === null).length,
  batchSize,
  batches,
  returnFormat: "每個批次回傳一個 JSON 檔，根節點為 results；所有 questionId 與 optionId 必須原樣保留。"
};
writeJson(join(outputPath, "manifest.json"), manifest);
writeFileSync(join(outputPath, "請先閱讀.txt"), instructions(manifest), "utf8");
writeFileSync(join(outputPath, "交給 ChatGPT 的完整指令.txt"), handoffPrompt(), "utf8");
writeJson(join(outputPath, "回傳格式範例.json"), responseExample());

console.log(JSON.stringify({ outputPath: resolve(outputPath), questionCount: questions.length, batchCount: batches.length }, null, 2));

function readArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--output" && args[index + 1]) parsed.output = resolve(args[++index]);
    if (args[index] === "--batch-size" && args[index + 1]) {
      const value = Number(args[++index]);
      if (!Number.isInteger(value) || value < 1 || value > 50) throw new Error("--batch-size 必須是 1 到 50 的整數。");
      parsed.batchSize = value;
    }
  }
  return parsed;
}

function chunk(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function instructions(manifest) {
  return `# 題目 AI 解析任務\n\n這份資料包含 ${manifest.questionCount} 題，已拆成 ${manifest.batches.length} 個批次，每批最多 ${manifest.batchSize} 題。\n\n## 交給 ChatGPT 的方式\n\n1. 每次上傳一個 batch-xxx.json。\n2. 複製「交給 ChatGPT 的完整指令.txt」的全部內容一起送出。\n3. 將 ChatGPT 回傳的純 JSON 存成相同批次名稱，例如 batch-001-result.json。\n4. 全部完成後，把所有 *-result.json 檔交回 Codex。\n\n## 題目答案狀態\n\n${manifest.questionCount - manifest.missingOfficialAnswerCount} 題已有正式答案；${manifest.missingOfficialAnswerCount} 題在目前題庫缺少正式答案。缺答案題目仍須產生完整解析，但 AI 提出的答案只能是 suggestedAnswer，不能視為正式答案。\n\n## 資料界線\n\n這是私人讀書資料。請勿改寫題目、選項、題號、正式答案或原始解析。AI 產生內容只作為學習輔助，不能視為官方法規解釋。\n`;
}

function handoffPrompt() {
  return `你現在要協助建立「人身保險業務員」私人題庫的 AI 學習解析。附件是一個題目批次 JSON。\n\n你的唯一工作是：為這一批每一題生成繁體中文的完整學習解析，並以指定 JSON 格式回傳。\n\n嚴格規則：\n1. officialAnswer 有值時，是題庫已確認的正式答案。不得改動、質疑、改寫或重新判定答案。\n2. officialAnswer 為 null 且 answerStatus 為 pending-review 時，代表目前題庫缺少正式答案。仍須完成完整解析，並提出一個 suggestedAnswer；但不得將它稱為正式答案。\n3. 題目 id（id）、questionId、選項 id（optionId）、選項文字、題目文字、章節與原始解析都必須原樣保留；不要自行增刪題目或選項。\n4. 每題都必須有 summary：用白話但精確的繁體中文，說明正式答案或建議答案的理由。\n5. 每個選項都必須各有一筆 analyses，並使用原樣的 optionId。officialAnswer 有值時，正式答案的 verdict 必須是 correct，其餘選項的 verdict 必須是 incorrect。沒有 officialAnswer 時，所有 verdict 必須是 pending-review，並在 content 中說明判斷理由。\n6. 每筆選項解析都要具體說明原因，不能只寫「正確」、「錯誤」、「不正確」或重複題幹。\n7. originalExplanation 僅供參考；即使它很短、空白或只寫「正確」，仍要重新產生有內容的學習解析。\n8. 不確定法條、數字或正式考試規則時，不得編造。請直接說明限制並使用 pending-review。\n9. 不要加入任何 Markdown、前言、結語、註解、程式碼區塊或額外欄位。只輸出一份可解析的 JSON。\n10. 必須完整處理附件中的每一題，不能跳題、不能只示範幾題、不能縮短成摘要。\n\n回傳 JSON 的唯一格式如下：\n{\n  "batchId": "請原樣使用附件的 batchId",\n  "results": [\n    {\n      "questionId": "請原樣使用題目 id",\n      "summary": "此題的完整繁體中文白話解析",\n      "suggestedAnswer": {\n        "optionId": "僅 officialAnswer 為 null 時必填，請原樣使用選項 id",\n        "reason": "說明這只是 AI 建議而非正式答案"\n      },\n      "analyses": [\n        {\n          "optionId": "請原樣使用選項 id",\n          "verdict": "correct 或 incorrect 或 pending-review",\n          "content": "此選項的繁體中文解析"\n        }\n      ]\n    }\n  ]\n}\n\n開始前，先確認附件的 questions 數量；輸出前再確認 results 數量完全相同，且每一題的 analyses 數量等於該題 options 數量。`;
}

function responseExample() {
  return {
    results: [{
      questionId: "請填入 batch 檔中原樣的題目 id",
      summary: "以繁體中文說明正式答案為何正確。",
      analyses: [{
        optionId: "請填入 batch 檔中原樣的選項 id",
        verdict: "correct",
        content: "以繁體中文說明這個選項。"
      }]
    }]
  };
}

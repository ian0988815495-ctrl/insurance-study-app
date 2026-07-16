import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = join(root, "work", "offline-seed.json");
const database = new Database(join(root, "data", "question-bank.sqlite"), { readonly: true });

const questionRows = database.prepare(`SELECT id, subject, chapter, question_text, correct_option_id, raw_explanation
  FROM questions ORDER BY subject, chapter, created_at, id`).all();
const optionsForQuestion = database.prepare(`SELECT id, source_label, option_text
  FROM question_options WHERE question_id = ? ORDER BY source_order`);
const questions = questionRows.map((question) => ({
  id: question.id,
  subject: question.subject,
  chapter: question.chapter,
  questionText: question.question_text,
  correctOptionId: question.correct_option_id,
  rawExplanation: question.raw_explanation,
  options: optionsForQuestion.all(question.id).map((option) => ({
    id: option.id,
    sourceLabel: option.source_label || undefined,
    text: option.option_text
  }))
}));

database.close();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), questions }));
console.log(`Exported ${questions.length} questions to ${outputPath}`);

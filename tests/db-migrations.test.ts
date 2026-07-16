// @vitest-environment node
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { QuestionDatabase } from "../src/server/db.ts";

describe("資料庫升級", () => {
  it("舊版章節匯入資料表會補上來源、科目與章節欄位", () => {
    const directory = mkdtempSync(join(tmpdir(), "question-bank-migration-"));
    const filePath = join(directory, "legacy.sqlite");
    const legacy = new Database(filePath);
    legacy.exec(`
      CREATE TABLE import_batches (
        id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        can_confirm INTEGER NOT NULL,
        confirmed_at TEXT
      );
      CREATE TABLE import_batch_items (
        id TEXT PRIMARY KEY,
        batch_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        warnings_json TEXT NOT NULL,
        can_confirm INTEGER NOT NULL
      );
    `);
    legacy.close();

    const database = new QuestionDatabase(filePath);
    expect(() => database.saveImportBatch({
      sourceUrl: "visible://chapter-1",
      subject: "保險法規",
      chapter: "保險法規第1章",
      summary: { total: 1 },
      items: [{
        question: {
          sourceUrl: "visible://chapter-1",
          subject: "保險法規",
          chapter: "保險法規第1章",
          questionText: "測試題",
          options: [{ id: "30000000-0000-4000-8000-000000000001", text: "原始選項" }],
          correctOptionId: "30000000-0000-4000-8000-000000000001",
          rawExplanation: "正確。",
          fingerprint: "legacy-import-batch"
        },
        warnings: [],
        canConfirm: true
      }]
    })).not.toThrow();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
});

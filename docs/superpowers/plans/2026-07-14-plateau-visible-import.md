# Plateau 可見題目內部匯入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不新增正式產品匯入介面的前提下，提供可由 Codex 內部使用的章節預覽、確認寫入、逐選項 AI 白話解析與刷題頁呈現。

**Architecture:** 既有 Express API 保留單題預覽相容性，新增章節批次預覽與確認端點；SQLite 保存來源原始選項標籤、批次預覽及每個選項的 AI 分析。確認寫入時先建立資料庫備份並建立 AI 工作；本機 API 依序處理工作，前端只讀取題目與解析結果，不顯示任何匯入控制項。

**Tech Stack:** React 19、TypeScript、Express 5、better-sqlite3、Zod、Vitest、Testing Library。

## Global Constraints

- 服務只監聽 `127.0.0.1`；不保存或傳送 Cookie、Token、密碼、Session 或隱藏資料來源。
- 來源題幹、選項標籤、選項文字、正確答案與原始解析依實際可見內容原樣保存；不得預設選項數量或標籤格式。
- 批次預覽不寫入題庫；只有明確 `confirmed: true` 的章節確認才寫入所有非重複題，且寫入前先備份。缺答案題目以 `pending-review` 保存並排除判分流程，不得略過或猜測答案。
- AI 白話解析與原始解析分開保存並顯示；AI 白話解析為 2 至 4 句、第一句先說明考點，並以短句逐一分析每個選項；無法可靠判斷時標記 `pending-review`。
- 不在 `src/web` 新增匯入、擷取、外部網站或瀏覽器擴充功能畫面。
- 工作區目前沒有 Git 儲存庫；每個任務以測試、lint、build 作為檢查點，不執行 commit。

---

### Task 1: 擴充題目與備份資料模型

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/app.ts`
- Modify: `src/web/types.ts`
- Test: `tests/question-bank.test.ts`
- Test: `tests/imports.test.ts`

**Interfaces:**
- Produces `QuestionOption = { id: string; sourceLabel?: string; text: string }`；資料庫讀取結果一律回傳空字串或來源原樣標籤。
- Produces `OptionAnalysis = { optionId: string; verdict: "correct" | "incorrect" | "pending-review"; content: string }`。
- Produces `QuestionReview` 的 `aiOptionAnalysis: OptionAnalysis[]`。
- Produces備份格式版本 4，舊版本 1 至 3 可補上空的 `ai_option_analyses` 與 `ai_generation_jobs`。

- [ ] **Step 1: 寫入會失敗的資料模型測試**

```ts
it("保存來源選項標籤與每個選項的 AI 分析", () => {
  const database = createTestDatabase();
  const id = database.addQuestion({
    sourceUrl: "visible://law/chapter-1",
    subject: "保險法規",
    chapter: "保險法規第1章",
    questionText: "題幹",
    options: [
      { id: "option-1", sourceLabel: "原始標籤", text: "原始選項文字" },
      { id: "option-2", sourceLabel: "", text: "第二個原始選項" }
    ],
    correctOptionId: "option-1",
    rawExplanation: "",
    fingerprint: "label-test"
  });

  database.saveOptionAnalysis(id, [
    { optionId: "option-1", verdict: "correct", content: "符合題意。" },
    { optionId: "option-2", verdict: "incorrect", content: "與題意不符。" }
  ], "ready");

  expect(database.questionWithOptions(id).options[0]).toMatchObject({ sourceLabel: "原始標籤", text: "原始選項文字" });
  expect(database.questionReview(id).aiOptionAnalysis).toHaveLength(2);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/question-bank.test.ts tests/imports.test.ts`

Expected: FAIL，原因為 `sourceLabel`、`saveOptionAnalysis` 或 `questionReview` 尚不存在。

- [ ] **Step 3: 擴充 TypeScript 型別與 SQLite 結構**

在 `src/server/types.ts` 將選項型別改為：

```ts
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
```

在 `QuestionDatabase.initialize()` 建立後以 `PRAGMA table_info(question_options)` 檢查欄位；缺少時執行：

```ts
this.sqlite.exec("ALTER TABLE question_options ADD COLUMN source_label TEXT NOT NULL DEFAULT ''");
```

並建立：

```sql
CREATE TABLE IF NOT EXISTS ai_option_analyses (
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES question_options(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('correct', 'incorrect', 'pending-review')),
  content TEXT NOT NULL,
  PRIMARY KEY (question_id, option_id)
);
CREATE TABLE IF NOT EXISTS ai_generation_jobs (
  question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'ready', 'pending-review', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

更新 `addQuestion`、`questionWithOptions`、`getQuestions`，讓 `source_label` 以原樣保存與回傳。新增 `questionReview(questionId)`、`saveOptionAnalysis(questionId, analyses, status)` 與 `enqueueAiGeneration(questionId)`；插入題目時建立 `pending` 工作。

在 `src/web/types.ts` 保持前端選項可選用來源標籤：

```ts
export type Option = { id: string; sourceLabel?: string; text: string };
export type OptionAnalysis = { optionId: string; verdict: "correct" | "incorrect" | "pending-review"; content: string };
export type Review = {
  correctOptionId: string;
  rawExplanation: string;
  aiExplanation: { content: string | null; status: string };
  aiOptionAnalysis: OptionAnalysis[];
};
```

將備份升為 `schemaVersion: 4`，並在 `baseBackupDataSchema`、`normalizeBackupData` 與 `restoreDatabase` 納入 `ai_option_analyses`、`ai_generation_jobs`。舊備份回復時將這兩個表設為空陣列。

- [ ] **Step 4: 執行資料模型測試**

Run: `npm test -- tests/question-bank.test.ts tests/imports.test.ts`

Expected: PASS，且舊單題預覽測試仍可用空字串作為 `sourceLabel`。

### Task 2: 建立章節批次預覽與確認寫入 API

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/db.ts`
- Test: `tests/imports.test.ts`
- Test: `tests/product-scope.test.ts`

**Interfaces:**
- Consumes `POST /api/imports/batches/preview`：

```ts
{
  sourceUrl: string;
  subject: string;
  chapter: string;
  questions: Array<{
    questionText: string;
    options: Array<{ sourceLabel?: string; text: string }>;
    correctOptionIndex?: number;
    rawExplanation?: string;
  }>;
}
```

- Produces `POST /api/imports/batches/:id/confirm` with `{ confirmed: true }` and `{ inserted, duplicates, pendingAnswer, warnings, safetyBackup }`。

- [ ] **Step 1: 寫入會失敗的批次預覽測試**

```ts
it("章節預覽不寫入，確認後只新增有效題目並建立備份", async () => {
  const preview = await request(app).post("/api/imports/batches/preview").send({
    sourceUrl: "visible://law/chapter-1",
    subject: "保險法規",
    chapter: "保險法規第1章",
    questions: [
      { questionText: "有效題", options: [{ sourceLabel: "1", text: "甲" }, { sourceLabel: "2", text: "乙" }], correctOptionIndex: 1 },
      { questionText: "缺答案", options: [{ sourceLabel: "A", text: "甲" }] }
    ]
  });
  expect(preview.status).toBe(200);
  expect(preview.body.summary).toMatchObject({ total: 2, pendingAnswer: 1 });
  expect(database.count("questions")).toBe(0);

  const confirmed = await request(app).post(`/api/imports/batches/${preview.body.batchId}/confirm`).send({ confirmed: true });
  expect(confirmed.status).toBe(201);
  expect(confirmed.body).toMatchObject({ inserted: 2, pendingAnswer: 1 });
  expect(database.count("questions")).toBe(2);
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/imports.test.ts`

Expected: FAIL，原因為批次端點尚未註冊。

- [ ] **Step 3: 建立批次資料表與端點**

在 `QuestionDatabase.initialize()` 新增：

```sql
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  confirmed_at TEXT
);
CREATE TABLE IF NOT EXISTS import_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  warnings_json TEXT NOT NULL,
  can_confirm INTEGER NOT NULL
);
```

在 `src/server/app.ts` 新增批次 Zod schema，沿用單題既有規則產生每題 UUID 選項、題目指紋與警告。批次摘要必須固定包含：

```ts
{ total: number; valid: number; duplicates: number; missingAnswer: number; missingRawExplanation: number; invalidFormat: number }
```

實作 `database.saveImportBatch(...)` 與 `database.confirmImportBatch(batchId)`：

1. 預覽時只寫入 `import_batches`、`import_batch_items`，不得新增 `questions`。
2. 確認時重新檢查資料庫重複題；只略過重複項目。缺答案或格式警告項目也要保存，並以 `pending-review` 標記。
3. 路由先讀取批次有效題數；有至少一題有效才呼叫既有 `snapshotDatabase(database)` 建立一次備份。
4. `database.confirmImportBatch(batchId)` 以單一 SQLite transaction 寫入所有非重複題與 AI 工作；缺答案題目的 `correctOptionId` 為空字串、`answerStatus` 為 `pending-review`，任一寫入錯誤時 transaction 回復。
5. 路由回傳已新增、略過、各類警告和備份路徑。

保留既有 `/api/imports/preview` 與 `/api/imports/:id/confirm`，以免現有測試與內部相容流程中斷。更新 `tests/product-scope.test.ts`，仍只允許 API 字串存在，不建立 `ImportPage.tsx` 或 `chrome-extension` 資料夾。

- [ ] **Step 4: 執行批次與產品範圍測試**

Run: `npm test -- tests/imports.test.ts tests/product-scope.test.ts`

Expected: PASS；確認前題庫數量為 0，確認後只寫入有效題目，正式前端沒有匯入畫面。

### Task 3: 實作逐選項 AI 白話解析工作

**Files:**
- Create: `src/server/ai-explanations.ts`
- Modify: `src/server/app.ts`
- Modify: `src/server/db.ts`
- Test: `tests/ai-explanations.test.ts`

**Interfaces:**
- Produces `generateQuestionExplanation(question, apiKey, model): Promise<{ summary: string; analyses: OptionAnalysis[]; status: "ready" | "pending-review" }>`。
- Consumes `POST /api/ai-explanations/run-pending` body `{ limit: number }`，僅供本機 Codex 內部流程呼叫。
- Produces `GET /api/questions/:id/review` 的 `aiOptionAnalysis`。

- [ ] **Step 1: 寫入會失敗的 AI 解析測試**

```ts
it("AI 回覆必須涵蓋每個選項，否則整題標記待確認", async () => {
  const question = database.questionWithOptions(questionId);
  const result = await parseAiExplanation(JSON.stringify({
    summary: "判斷重點。",
    analyses: [{ optionId: question.options[0].id, verdict: "correct", content: "符合題意。" }]
  }), question.options);

  expect(result.status).toBe("pending-review");
  expect(result.analyses).toHaveLength(question.options.length);
  expect(result.analyses[1].content).toContain("待確認");
});
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/ai-explanations.test.ts`

Expected: FAIL，原因為 `parseAiExplanation` 與 AI 工作流程尚未存在。

- [ ] **Step 3: 實作可驗證的 AI 回覆與工作處理**

在 `src/server/ai-explanations.ts` 定義 Zod 結構：

```ts
const aiPayloadSchema = z.object({
  summary: z.string().trim().min(1),
  analyses: z.array(z.object({
    optionId: z.string().min(1),
    verdict: z.enum(["correct", "incorrect", "pending-review"]),
    content: z.string().trim().min(1)
  }))
});
```

提示詞必須列出實際 `optionId`、原始標籤與原始文字，並要求只輸出 JSON；內容規則固定為：只根據題幹、正確答案和原始解析，`summary` 必須是 2 至 4 句、第一句說明考點，後續以白話說明核心觀念與必要易混淆重點；每個選項的分析必須是短句。無法可靠支持時輸出 `pending-review` 與「待確認」。

`parseAiExplanation` 必須：

```ts
const byOptionId = new Map(parsed.analyses.map((analysis) => [analysis.optionId, analysis]));
const analyses = options.map((option) => byOptionId.get(option.id) ?? {
  optionId: option.id,
  verdict: "pending-review" as const,
  content: "待確認：AI 未提供此選項的可靠分析。"
});
const status = analyses.some((item) => item.verdict === "pending-review") ? "pending-review" : "ready";
```

在 `app.ts` 將既有單題 `/api/questions/:id/ai-explanation` 改為呼叫同一個服務；新增 `/api/ai-explanations/run-pending`，限制 `limit` 為 1 至 20，逐一取出 pending 工作。未設定 `OPENAI_API_KEY` 時不呼叫外部服務，將工作維持 `pending-review` 並回傳原因。成功時寫入 `ai_explanations`、`ai_option_analyses`、工作狀態；服務錯誤時寫入 `failed` 與錯誤訊息。

- [ ] **Step 4: 執行 AI 工作測試**

Run: `npm test -- tests/ai-explanations.test.ts tests/imports.test.ts`

Expected: PASS；完整回覆產生每個選項的分析，缺少任一選項或未設定 API Key 都不會偽裝成可用解析。

### Task 4: 在一般練習頁顯示來源標籤與逐選項解析

**Files:**
- Modify: `src/web/pages/PracticeSessionPage.tsx`
- Modify: `src/web/style.css`
- Modify: `src/web/App.tsx`
- Modify: `src/web/types.ts`
- Test: `tests/practice-session-ui.test.tsx`

**Interfaces:**
- Consumes `Review.aiOptionAnalysis`。
- Produces一般練習答案面板中的「原始解析」、「AI 白話解析」與每個選項對應的 AI 分析；正式模考不使用此面板。

- [ ] **Step 1: 寫入會失敗的 UI 測試**

```tsx
const loadReview = vi.fn().mockResolvedValue({
  correctOptionId: "option-b",
  rawExplanation: "來源解析",
  aiExplanation: { content: "AI 總結", status: "ready" },
  aiOptionAnalysis: [
    { optionId: "option-a", verdict: "incorrect", content: "不符合條件。" },
    { optionId: "option-b", verdict: "correct", content: "符合題意。" }
  ]
});

await user.click(screen.getByRole("button", { name: "查看答案" }));
expect(screen.getByText("AI 白話解析：AI 總結")).toBeTruthy();
expect(screen.getByText("不符合條件。")).toBeTruthy();
expect(screen.getByText("符合題意。")).toBeTruthy();
expect(screen.getByText("原始解析：來源解析")).toBeTruthy();
```

- [ ] **Step 2: 執行測試確認失敗**

Run: `npm test -- tests/practice-session-ui.test.tsx`

Expected: FAIL，原因為面板尚未顯示 `aiOptionAnalysis`。

- [ ] **Step 3: 實作保留來源內容的答案面板**

選項按鈕以來源標籤存在時才顯示標籤：

```tsx
{option.sourceLabel && <span className="option-label">{option.sourceLabel}</span>}
<span>{option.text}</span>
```

答案面板先顯示「AI 白話解析」，再顯示依目前選項順序的「AI 選項分析」，最後顯示「原始解析」。選項分析使用 `question.options.map` 取得 `review.aiOptionAnalysis.find((item) => item.optionId === option.id)`；每一列顯示該選項原始標籤、原始文字、正確／不正確／待確認狀態與短句分析內容。`rawExplanation` 空白時顯示「原始解析未提供」，`aiExplanation.content` 空白時顯示「AI 解析待確認」。

在 `style.css` 新增 `.option-label`、`.option-analysis-list`、`.option-analysis-item` 與狀態色彩，但不改變既有單選按鈕的固定寬度或手機換行行為。`App.tsx` 的 `loadReview` 型別由更新後的 `Review` 自動承接；不要在導航、首頁或模考頁增加匯入文案。

- [ ] **Step 4: 執行 UI 測試**

Run: `npm test -- tests/practice-session-ui.test.tsx tests/exam-ui.test.tsx`

Expected: PASS；一般練習可查看全部解析，正式模考交卷前仍不顯示答案與解析。

### Task 5: 全面驗證、相容性與手機畫面檢查

**Files:**
- Modify: `README.md`
- Test: `tests/imports.test.ts`
- Test: `tests/ai-explanations.test.ts`
- Test: `tests/practice-session-ui.test.tsx`

**Interfaces:**
- Documents內部流程只供 Codex 使用，正式產品沒有匯入入口。
- Documents AI 解析與原始解析分離，以及 API Key 未設定時的待確認行為。

- [ ] **Step 1: 更新 README 的驗收範圍與資料安全說明**

加入以下兩項，不提及任何正式產品匯入操作：

```md
- 題目來源內容、原始解析與 AI 白話解析分開保存；AI 會逐一分析各選項，無法可靠判斷時標記待確認。
- 題目資料只由受控內部流程在預覽與確認後寫入；正式產品不提供題目匯入或外部網站擷取介面。
```

- [ ] **Step 2: 執行完整自動化測試**

Run: `npm test`

Expected: PASS，包含舊備份、批次確認、AI 選項分析、一般練習與正式模考回歸測試。

- [ ] **Step 3: 執行型別與正式建置檢查**

Run: `npm run lint`

Expected: PASS，沒有 TypeScript 型別錯誤。

Run: `npm run build`

Expected: PASS，Vite 產出正式前端檔案。

- [ ] **Step 4: 啟動本機服務並手動驗收手機畫面**

Run: `powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1`

Expected: 本機服務可於 `http://127.0.0.1:5173` 開啟。

在 402 × 874、375 × 667 與一般桌面寬度檢查：

1. 一般練習查看答案後，來源標籤、原始選項、原始解析、AI 白話解析和逐選項分析沒有遮擋或溢出。
2. 未作答直接查看答案仍可標記待複習。
3. 正式模考在交卷或時間到之前沒有正確答案、原始解析或 AI 解析。
4. 首頁、底部導覽與備份頁沒有題目匯入或外部網站擷取入口。

## Self-Review

- Spec coverage: Task 1 保存原始選項與完整備份；Task 2 實作章節預覽、重複檢查、確認與備份；Task 3 產生並驗證逐選項 AI 解析；Task 4 顯示來源與 AI 解析；Task 5 驗證安全、回歸與手機畫面。
- Type consistency: `QuestionOption.sourceLabel`、`OptionAnalysis`、`Review.aiOptionAnalysis` 在資料庫、API 與 React 使用相同名稱。
- Scope: 不建立匯入畫面、不自動登入、不讀取登入憑證、不修改刷題、模考與讀書計畫既有流程。

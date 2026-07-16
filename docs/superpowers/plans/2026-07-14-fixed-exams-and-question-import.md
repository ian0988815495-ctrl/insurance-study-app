# 固定模考與題目匯入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將模考改為固定的法規、實務與完整測驗流程，並提供安全的貼上與登入後頁面題目匯入。

**Architecture:** Express API 管理固定模考設定、完整測驗狀態與兩階段匯入預覽。React 前端以固定操作按鈕取代模考設定表單，並建立題目匯入預覽頁。Chrome Manifest V3 擴充功能只在使用者已登入且主動觸發時擷取可見內容，交由本機 API 預覽與確認。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Express 5、SQLite、better-sqlite3、Chrome Manifest V3、lucide-react。

## Global Constraints

- 法規單科模考固定 100 題、80 分鐘、每題 1 分、60 分及格。
- 實務單科模考固定 50 題、60 分鐘、每題 2 分、60 分及格。
- 完整測驗需完成兩科，且兩科各至少 60 分、總分至少 140 分才通過。
- 一般練習沒有時間限制，未作答可查看答案並建立待複習紀錄，不算答錯。
- 匯入必須先預覽，只有使用者確認後才寫入題庫；來源頁未顯示原始解析時保留空白並提示。
- 題目選項數量可變；正確答案必須以選項 ID 保存。
- 擴充功能不可繞過登入、驗證碼或安全機制，不可讀取或保存 Cookie、Token、密碼或登入資料。
- 不刪除既有題庫、作答紀錄、模考紀錄或備份。

---

### Task 1: 更新規則與資料庫匯入服務

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `src/server/types.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/app.ts`
- Create: `tests/imports.test.ts`

**Interfaces:**
- Produces: `POST /api/imports/preview` 與 `POST /api/imports/:id/confirm`。
- Produces: `QuestionDatabase.saveImportPreview()`、`getImportPreview()`、`confirmImportPreview()`。
- Consumes: `{ sourceUrl?, subject, chapter, questionText, options, correctOptionIndex, rawExplanation }`。

- [x] **Step 1: 寫入預覽不寫入與確認後寫入的失敗測試**

```ts
const preview = await request(app).post("/api/imports/preview").send(payload);
expect(preview.body.canConfirm).toBe(true);
expect(database.count("questions")).toBe(0);

const confirmed = await request(app).post(`/api/imports/${preview.body.importId}/confirm`).send({ confirmed: true });
expect(confirmed.status).toBe(201);
expect(database.count("questions")).toBe(1);
```

- [x] **Step 2: 執行匯入測試確認端點尚未存在而失敗**

Run: `npm test -- --run tests/imports.test.ts`

Expected: FAIL，因為 `/api/imports/preview` 尚未存在。

- [x] **Step 3: 實作預覽批次與確認寫入**

```ts
const fingerprint = createFingerprint(input.questionText, input.options.map((option) => option.text));
const duplicate = database.findQuestionByFingerprint(fingerprint);
const canConfirm = warnings.length === 0 && !duplicate;
const importId = database.saveImportPreview(question, warnings, canConfirm);
```

必要欄位為科目、章節、題幹、至少一個選項與可對應的正確答案。來源頁未顯示原始解析時以提醒呈現，不阻擋確認；缺少其他欄位或重複題時不得確認。

- [x] **Step 4: 重新執行匯入測試**

Run: `npm test -- --run tests/imports.test.ts`

Expected: PASS。

### Task 2: 一般練習的未作答查看答案規則

**Files:**
- Modify: `src/web/pages/PracticeSessionPage.tsx`
- Modify: `src/web/App.tsx`
- Modify: `tests/practice-session-ui.test.tsx`

**Interfaces:**
- Consumes: `POST /api/attempts` 的 `view_answer` 事件。
- Produces: 未選擇選項時仍可發出查看答案請求，並顯示待複習狀態。

- [x] **Step 1: 寫入未作答查看答案的失敗 UI 測試**

```tsx
await user.click(screen.getByRole("button", { name: "查看答案" }));
expect(recordAttempt).toHaveBeenCalledWith(question.id, sessionId, undefined, "view_answer");
expect(screen.getByText("看過答案／待複習")).toBeTruthy();
```

- [x] **Step 2: 執行練習畫面測試確認失敗**

Run: `npm test -- --run tests/practice-session-ui.test.tsx`

Expected: FAIL，因為目前查看答案需先選擇選項。

- [x] **Step 3: 實作不作答也可查看答案**

```tsx
const resultLabel = selectedOptionId
  ? selectedOptionId === review.correctOptionId ? "答對" : "答錯"
  : "看過答案／待複習";
```

查看答案只寫入 `view_answer` 事件；沒有選項時不寫入 `answer` 事件，因此不會增加答錯次數。

- [x] **Step 4: 重新執行 UI 與 API 測試**

Run: `npm test -- --run tests/practice-session-ui.test.tsx tests/question-bank.test.ts`

Expected: PASS。

### Task 3: 固定單科模考與完整測驗 API

**Files:**
- Modify: `src/server/app.ts`
- Modify: `src/server/db.ts`
- Modify: `src/server/types.ts`
- Create: `tests/fixed-exams.test.ts`

**Interfaces:**
- Produces: `POST /api/exams/fixed`，請求 `{ type: "law" | "practice" | "full" }`。
- Produces: 完整測驗的兩階段回應與最終判定。

- [x] **Step 1: 寫入固定題數、時間與通過門檻的失敗測試**

```ts
const exam = await request(app).post("/api/exams/fixed").send({ type: "law" });
expect(exam.body.durationMinutes).toBe(80);
expect(exam.body.questions).toHaveLength(100);

const result = await request(app).post(`/api/exams/${exam.body.id}/submit`).send({ answers });
expect(result.body.passed).toBe(true);
```

- [x] **Step 2: 執行固定模考測試確認失敗**

Run: `npm test -- --run tests/fixed-exams.test.ts`

Expected: FAIL，因為固定模考端點尚未存在。

- [x] **Step 3: 建立固定設定與完整測驗狀態**

```ts
const fixedExamConfigs = {
  law: { subject: "保險法規", questionCount: 100, durationMinutes: 80, pointsPerQuestion: 1, passingScore: 60 },
  practice: { subject: "保險實務", questionCount: 50, durationMinutes: 60, pointsPerQuestion: 2, passingScore: 60 }
} as const;
```

完整測驗在法規交卷後建立實務階段；實務交卷後以加權分數套用兩科各 60 分與總分 140 分規則。

- [x] **Step 4: 重新執行固定模考測試**

Run: `npm test -- --run tests/fixed-exams.test.ts`

Expected: PASS。

### Task 4: 固定模考與題目匯入前端

**Files:**
- Modify: `src/web/App.tsx`
- Modify: `src/web/pages/HomePage.tsx`
- Create: `src/web/pages/FixedExamPage.tsx`
- Create: `src/web/pages/ImportPage.tsx`
- Modify: `src/web/style.css`
- Modify: `tests/exam-ui.test.tsx`
- Create: `tests/import-ui.test.tsx`

**Interfaces:**
- Consumes: `POST /api/exams/fixed`、`POST /api/imports/preview`、`POST /api/imports/:id/confirm`。
- Produces: 固定模考按鈕、完整測驗階段切換、匯入預覽與確認畫面。

- [x] **Step 1: 寫入固定模考按鈕與匯入確認的失敗 UI 測試**

```tsx
await user.click(screen.getByRole("button", { name: "法規單科模考" }));
expect(createFixedExam).toHaveBeenCalledWith("law");
expect(screen.queryByLabelText("時間（分鐘）")).toBeNull();

await user.click(screen.getByRole("button", { name: "預覽題目" }));
expect(confirmButton).toBeDisabled();
```

- [x] **Step 2: 執行前端測試確認失敗**

Run: `npm test -- --run tests/exam-ui.test.tsx tests/import-ui.test.tsx`

Expected: FAIL，因為固定模考按鈕與匯入頁尚未存在。

- [x] **Step 3: 實作行動優先畫面**

首頁與底部導覽提供練習、模考、題目匯入與備份入口。模考頁只顯示三個固定模式按鈕與題目不足訊息。匯入頁支援新增、刪除選項、選擇正確答案、預覽警告與確認寫入。

- [x] **Step 4: 重新執行前端測試**

Run: `npm test -- --run tests/exam-ui.test.tsx tests/import-ui.test.tsx`

Expected: PASS。

### Task 5: 登入後頁面擷取擴充功能與文件

**Files:**
- Create: `chrome-extension/manifest.json`
- Create: `chrome-extension/popup.html`
- Create: `chrome-extension/popup.ts`
- Create: `chrome-extension/popup.css`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `tests/product-scope.test.ts`

**Interfaces:**
- Consumes: 使用者主動開啟且已登入的題目頁可見內容。
- Produces: 送往 `POST /api/imports/preview` 的擷取資料，不保存登入憑證。

- [x] **Step 1: 寫入擴充功能安全範圍的失敗測試**

```ts
expect(manifest.permissions).toEqual(expect.arrayContaining(["activeTab", "scripting"]));
expect(manifest.permissions).not.toContain("cookies");
expect(popupSource).not.toContain("document.cookie");
```

- [x] **Step 2: 執行範圍測試確認失敗**

Run: `npm test -- --run tests/product-scope.test.ts`

Expected: FAIL，因為擴充功能尚未存在。

- [x] **Step 3: 實作主動擷取與預覽送出**

擴充功能只在目前分頁且使用者按下按鈕後執行。根據已分析的實際題目頁面模板讀取可見欄位；模板未確認時僅顯示提示，不嘗試擷取或猜測欄位。

- [x] **Step 4: 更新規則與操作文件**

`AGENTS.md` 明確允許合法的預覽匯入，但保留不繞過登入與不保存敏感資料的限制。`README.md` 說明貼上匯入、預覽確認及擴充功能的使用前提。

- [x] **Step 5: 重新執行範圍測試**

Run: `npm test -- --run tests/product-scope.test.ts`

Expected: PASS。

### Task 6: 完整驗證

**Files:**
- Modify: `package-lock.json`（僅在依賴真的變動時）

- [x] **Step 1: 執行完整測試與型別檢查**

Run: `npm test && npm run lint && npm run build`

Expected: 全部 exit code 0。

- [x] **Step 2: 啟動本機服務並檢查回應**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1`

Expected: `http://127.0.0.1:3001/api/health` 與 `http://127.0.0.1:5173` 回應 200。

- [x] **Step 3: 手動檢查手機尺寸**

在 `402 x 874` 與桌面尺寸檢查首頁、一般練習未作答查看答案、三種模考入口、匯入預覽與確認畫面。

Expected: 無文字遮擋、水平溢出或無法操作按鈕。

## Plan Self-Review

- 規格覆蓋：固定模考、完整測驗、一般練習無時間限制、貼上匯入、登入後擷取與安全限制都有對應工作項目。
- 型別一致性：題目選項持續使用穩定 ID，預覽與確認 API 由同一份資料模型處理。
- 資料安全：所有寫入均在確認後進行；沒有題庫清空、資料刪除或登入憑證保存步驟。

# 考試倒數與智慧讀書計畫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓使用者設定考試日期後，可在首頁查看並直接開始依作答紀錄安排的本機每日讀書計畫。

**Architecture:** SQLite 新增考試日設定與每題複習排程，資料庫是唯一的排程判定來源。Express API 只傳遞經驗證的日期與計畫資料，React 首頁顯示與啟動今日練習；既有練習與模考流程在保存作答後呼叫相同的排程更新方法。

**Tech Stack:** React 19、TypeScript、Express 5、better-sqlite3、Zod、Vitest、Testing Library。

## Global Constraints

- 排程只在本機 SQLite 計算，不依賴 OpenAI API Key；AI 若無法使用不得阻斷計畫。
- 一般練習沒有時間限制；未作答即可查看答案，且只標記待複習，不算答錯。
- 正式模考的題數、時間、通過門檻與答案顯示規則不可改變。
- 不新增題目上傳、外部網站擷取、瀏覽器擴充功能、帳號或雲端傳輸。
- 不刪除或重設既有題目、選項、答案、解析、作答紀錄與已掌握標記。
- 所有手動程式碼編輯使用 `apply_patch`；完成各任務後跑對應 Vitest 測試。

---

## 檔案結構

- 修改 `src/server/types.ts`：定義 `study-plan` 練習模式和計畫回應的共用型別。
- 修改 `src/server/db.ts`：建立資料表、計算倒數與今日任務、保存複習狀態、建立今日練習。
- 修改 `src/server/app.ts`：日期設定與計畫 API、作答後排程更新、備份版本相容。
- 修改 `src/web/types.ts`：定義前端讀書計畫資料型別。
- 建立 `src/web/components/StudyPlanCard.tsx`：日期設定、倒數、任務摘要與開始按鈕。
- 修改 `src/web/pages/HomePage.tsx`：載入並呈現 `StudyPlanCard`。
- 修改 `src/web/App.tsx`：將首頁今日計畫的開始操作接到既有練習畫面。
- 修改 `src/web/pages/PracticeSetupPage.tsx`：不顯示 `study-plan` 作為可手動選取的練習模式。
- 修改 `src/web/style.css`：新增小型、手機優先且不溢出的讀書計畫樣式。
- 建立 `tests/study-plan.test.ts`：資料庫與 API 的排程、日期、今日練習與備份測試。
- 建立 `tests/study-plan-ui.test.tsx`：首頁日期設定、零題提示與開始今日計畫測試。
- 修改 `tests/question-bank.test.ts`：更新備份格式斷言並保留既有迴歸行為。

## Task 1: 資料庫排程核心

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/db.ts`
- Create: `tests/study-plan.test.ts`

**Consumes:** 既有 `questions`、`attempts`、`practice_sessions` 資料表，以及 `QuestionDatabase.recordAttempt()`。

**Produces:** `QuestionDatabase.getStudyPlan()`, `setExamDate()`, `updateReviewSchedule()` 與 `createPracticeSession("study-plan", false, false)`。

- [x] **Step 1: 寫出資料庫排程的失敗測試**

```ts
it("依到期、錯題、新題順序建立今日計畫，且不重複題目", () => {
  database.setExamDate("2026-07-25", new Date("2026-07-14T00:00:00"));
  database.updateReviewSchedule(dueQuestion.id, "answer", false, new Date("2026-07-13T00:00:00"));
  database.recordAttempt({ questionId: wrongQuestion.id, eventType: "answer", selectedOptionId: wrongOptionId });

  expect(database.getStudyPlan(new Date("2026-07-14T00:00:00"))).toMatchObject({
    examDate: "2026-07-25",
    daysRemaining: 11,
    counts: { due: 1, wrong: 1, new: 1 },
    questionIds: [dueQuestion.id, wrongQuestion.id, newQuestion.id]
  });
});
```

- [x] **Step 2: 執行測試，確認尚未實作而失敗**

Run: `npm test -- tests/study-plan.test.ts`  
Expected: FAIL，指出 `setExamDate`、`updateReviewSchedule` 或 `getStudyPlan` 尚不存在。

- [x] **Step 3: 新增最小資料模型與排程方法**

在 `src/server/types.ts` 加入：

```ts
export type PracticeMode = "sequential" | "random" | "wrong" | "common-wrong" | "study-plan";

export interface StudyPlan {
  examDate: string | null;
  daysRemaining: number | null;
  counts: { due: number; wrong: number; new: number };
  questionIds: string[];
  message: string;
}
```

在 `QuestionDatabase.initialize()` 建立 `study_plan_settings` 和 `review_schedules`。新增方法時採用下列契約：

```ts
setExamDate(examDate: string): void
getStudyPlan(now?: Date): StudyPlan
updateReviewSchedule(questionId: string, eventType: "answer" | "view_answer", isCorrect: boolean | null, now?: Date): void
```

`getStudyPlan()` 必須排除 `mastered = 1` 題目，以 `due_date <= today`、曾答錯、從未有 `answer` 作答紀錄的順序選取並以 `Set` 去重。`updateReviewSchedule()` 依規格的 1、3、7、14 天寫入 `due_date`；`view_answer` 重設連續答對並安排隔天。

- [x] **Step 4: 讓既有作答流程同步更新排程**

在 `recordAttempt()` 插入作答事件後，對 `answer` 與 `view_answer` 呼叫 `updateReviewSchedule()`；回傳原本的 `isCorrect`。將 `createPracticeSession()` 在模式為 `study-plan` 時改為取用 `getStudyPlan().questionIds`，其他模式維持原樣。

- [x] **Step 5: 執行資料庫測試**

Run: `npm test -- tests/study-plan.test.ts tests/question-bank.test.ts`  
Expected: PASS，且原有常錯題與穩定選項 ID 測試仍通過。

- [x] **Step 6: 提交檢查點（工作區沒有可用 Git，已略過提交）**

Run: `git add src/server/types.ts src/server/db.ts tests/study-plan.test.ts && git commit -m "feat: add local study plan scheduler"`  
Expected: 若此工作區可用 Git，建立一筆只含排程核心的提交；若無法辨識為 Git 工作區，記錄原因後繼續，不以此阻斷功能驗證。

## Task 2: 日期與今日計畫 API

**Files:**
- Modify: `src/server/app.ts`
- Modify: `tests/study-plan.test.ts`

**Consumes:** Task 1 的 `StudyPlan`、`setExamDate()`、`getStudyPlan()`。

**Produces:** `GET /api/study-plan`、`PUT /api/study-plan/settings` 與接受 `study-plan` 的練習建立 API。

- [x] **Step 1: 寫出 API 失敗測試**

```ts
it("只接受今天或未來的考試日期，並回傳重新計算的讀書計畫", async () => {
  expect((await request(app).put("/api/study-plan/settings").send({ examDate: "2026-07-25" })).status).toBe(200);
  expect((await request(app).get("/api/study-plan")).body).toMatchObject({ examDate: "2026-07-25" });
  expect((await request(app).put("/api/study-plan/settings").send({ examDate: "2000-01-01" })).status).toBe(400);
});
```

- [x] **Step 2: 執行測試，確認路由尚未存在而失敗**

Run: `npm test -- tests/study-plan.test.ts`  
Expected: FAIL，`GET /api/study-plan` 為 404 或 `PUT` 為 404。

- [x] **Step 3: 實作日期驗證與路由**

在 `src/server/app.ts` 新增：

```ts
const studyPlanSettingsSchema = z.object({
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

app.get("/api/study-plan", (_request, response) => response.json(database.getStudyPlan()));
app.put("/api/study-plan/settings", (request, response) => {
  const { examDate } = studyPlanSettingsSchema.parse(request.body);
  if (new Date(`${examDate}T00:00:00`).getTime() < startOfToday().getTime()) {
    return response.status(400).json({ error: "考試日期不能早於今天。" });
  }
  database.setExamDate(examDate);
  response.json(database.getStudyPlan());
});
```

`sessionSchema` 的 `mode` 使用 `PracticeMode` 的完整列舉，並要求 `study-plan` 建立時 `shuffleQuestions`、`shuffleOptions` 都為 `false`；若違反則回傳 400，避免破壞建議的複習順序。

- [x] **Step 4: 測試空題庫與今日練習路徑**

新增斷言：空題庫取得計畫仍為 200 且 `questionIds` 為空；設定日期後以 `study-plan` 建立練習會回傳 201 與正確題數；試圖傳入打亂設定會回傳 400。

- [x] **Step 5: 執行 API 測試**

Run: `npm test -- tests/study-plan.test.ts tests/imports.test.ts tests/fixed-exams.test.ts`  
Expected: PASS，既有匯入與固定模考 API 不受影響。

- [x] **Step 6: 提交檢查點（工作區沒有可用 Git，已略過提交）**

Run: `git add src/server/app.ts tests/study-plan.test.ts && git commit -m "feat: expose study plan api"`  
Expected: 若 Git 可用，建立一筆只含 API 的提交；否則依 Task 1 的規則記錄。

## Task 3: 備份版本相容

**Files:**
- Modify: `src/server/db.ts`
- Modify: `src/server/app.ts`
- Modify: `tests/question-bank.test.ts`
- Modify: `tests/study-plan.test.ts`

**Consumes:** `study_plan_settings`、`review_schedules` 與現有安全快照還原流程。

**Produces:** `schemaVersion: 2` 匯出、版本 1 和版本 2 預覽與還原。

- [x] **Step 1: 寫出備份相容失敗測試**

```ts
it("匯出讀書計畫並可還原版本一與版本二備份", async () => {
  database.setExamDate("2026-07-25");
  const exported = await request(app).get("/api/backups/export");
  expect(exported.body).toMatchObject({ schemaVersion: 2, data: { study_plan_settings: [{ exam_date: "2026-07-25" }] } });

  const legacy = { schemaVersion: 1, exportedAt: exported.body.exportedAt, data: omitStudyPlanTables(exported.body.data) };
  expect((await request(app).post("/api/backups/preview").send(legacy)).status).toBe(200);
});
```

- [x] **Step 2: 執行測試，確認目前只支援版本 1 而失敗**

Run: `npm test -- tests/study-plan.test.ts tests/question-bank.test.ts`  
Expected: FAIL，匯出版本仍為 1 或缺少讀書計畫資料表。

- [x] **Step 3: 擴充匯出、預覽與還原**

`QuestionDatabase.exportData()` 加入 `study_plan_settings` 和 `review_schedules`。在 `app.ts` 以 Zod 建立 `backupV1Schema`、`backupV2Schema` 的聯集；版本 1 解析後補入空陣列：

```ts
const normalizedBackup = parsed.schemaVersion === 1
  ? { ...parsed.data, study_plan_settings: [], review_schedules: [] }
  : parsed.data;
```

還原交易中，先刪除 `review_schedules` 與 `study_plan_settings`，再依 `questions`、`question_options`、`ai_explanations`、`practice_sessions`、`attempts`、`exams`、`study_plan_settings`、`review_schedules` 的順序寫回。保留現有還原前 SQLite 快照。

- [x] **Step 4: 執行備份與迴歸測試**

Run: `npm test -- tests/study-plan.test.ts tests/question-bank.test.ts`  
Expected: PASS，版本 2 保留日期與排程、版本 1 不遺失既有題目與作答資料。

- [x] **Step 5: 提交檢查點（工作區沒有可用 Git，已略過提交）**

Run: `git add src/server/db.ts src/server/app.ts tests/question-bank.test.ts tests/study-plan.test.ts && git commit -m "feat: back up study plan data"`  
Expected: 若 Git 可用，建立一筆只含備份相容性的提交；否則依 Task 1 的規則記錄。

## Task 4: 首頁讀書計畫與開始流程

**Files:**
- Create: `src/web/components/StudyPlanCard.tsx`
- Modify: `src/web/types.ts`
- Modify: `src/web/pages/HomePage.tsx`
- Modify: `src/web/App.tsx`
- Modify: `src/web/style.css`
- Create: `tests/study-plan-ui.test.tsx`

**Consumes:** Task 2 的 `GET /api/study-plan`、`PUT /api/study-plan/settings` 以及 `study-plan` 練習模式。

**Produces:** 可在首頁設定日期、顯示任務、開始今日計畫的手機優先介面。

- [x] **Step 1: 寫出元件失敗測試**

```tsx
it("設定日期後顯示任務數量，並可開始今日計畫", async () => {
  const user = userEvent.setup();
  render(<StudyPlanCard plan={plan} onSaveDate={saveDate} onStart={start} />);
  await user.clear(screen.getByLabelText("考試日期"));
  await user.type(screen.getByLabelText("考試日期"), "2026-07-25");
  await user.click(screen.getByRole("button", { name: "儲存考試日期" }));
  expect(saveDate).toHaveBeenCalledWith("2026-07-25");
  expect(screen.getByText("到期複習 3 題")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "開始今日計畫" }));
  expect(start).toHaveBeenCalledOnce();
});
```

- [x] **Step 2: 執行前端測試，確認元件尚未存在而失敗**

Run: `npm test -- tests/study-plan-ui.test.tsx`  
Expected: FAIL，找不到 `StudyPlanCard`。

- [x] **Step 3: 實作元件與首頁資料流**

在 `src/web/types.ts` 加入與後端一致的 `StudyPlan`。`StudyPlanCard` 接受：

```tsx
type StudyPlanCardProps = {
  plan: StudyPlan | null;
  saving: boolean;
  onSaveDate: (examDate: string) => Promise<void>;
  onStart: () => void;
};
```

以原生 `<input type="date" aria-label="考試日期">` 顯示日期；儲存按鈕使用 `Pencil` 或 `CalendarDays` Lucide 圖示並提供 `aria-label="儲存考試日期"`。日期未設定時提示先設定，題庫為空或 `questionIds.length === 0` 時禁用「開始今日計畫」。

`HomePage` 只呈現資料與回呼。`App` 取得、保存與重新整理計畫，並在開始時呼叫既有的 `Practice` 開始函式，傳入 `{ mode: "study-plan", shuffleQuestions: false, shuffleOptions: false }`。為此將練習啟動函式提升到 `App` 可共用的層級，或新增明確的 `onStartStudyPlan` 回呼；不得以 URL 或全域變數傳遞設定。

- [x] **Step 4: 加入手機優先樣式**

在 `src/web/style.css` 新增 `.study-plan`、`.study-plan-header`、`.study-plan-tasks`、`.study-plan-date` 樣式。使用現有色彩、間距和最多 8px 圓角；任務數量採固定 grid 欄位，窄畫面改為單欄，按鈕保持完整文字且不與底部導覽重疊。

- [x] **Step 5: 執行前端與迴歸測試**

Run: `npm test -- tests/study-plan-ui.test.tsx tests/practice-ui.test.tsx tests/practice-session-ui.test.tsx tests/product-scope.test.ts`  
Expected: PASS，沒有重新引入題目匯入入口，既有一般練習互動不變。

- [x] **Step 6: 提交檢查點（工作區沒有可用 Git，已略過提交）**

Run: `git add src/web tests/study-plan-ui.test.tsx && git commit -m "feat: show daily study plan"`  
Expected: 若 Git 可用，建立一筆只含首頁與練習入口的提交；否則依 Task 1 的規則記錄。

## Task 5: 完整驗收與文件更新

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-14-exam-countdown-study-plan-design.md`
- Modify: `docs/superpowers/plans/2026-07-14-exam-countdown-study-plan.md`

**Consumes:** Tasks 1 至 4 的完成實作。

**Produces:** 反映實際功能的說明、完整測試與手機/桌面視覺驗證紀錄。

- [x] **Step 1: 更新使用說明與規格狀態**

在 `README.md` 的驗收範圍加入：「可在首頁設定考試日期；系統依到期複習、錯題與新題安排今日練習；排程與資料僅保存在本機。」將規格文件狀態改為「已實作並驗證」，並勾選本計畫已完成步驟。

- [x] **Step 2: 執行完整自動化驗收**

Run: `npm test`  
Expected: 所有 Vitest 測試通過。

Run: `npm run lint`  
Expected: TypeScript 型別檢查通過。

Run: `npm run build`  
Expected: Vite 產物建立成功。

- [x] **Step 3: 執行實際畫面驗收**

Run: `powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1`  
Expected: 本機 API 與網頁服務在 `127.0.0.1` 啟動。

以瀏覽器驗收 `http://127.0.0.1:5173/`：

1. 在 `402 x 874` 設定日期、確認日期欄位、三種任務數量、提示與開始按鈕皆可閱讀且可點選。
2. 在一般手機尺寸確認沒有水平捲動或底部導覽覆蓋按鈕。
3. 在桌面尺寸確認應用程式維持置中寬度，文字與任務數字沒有重疊。

- [x] **Step 4: 檢查敏感資料與完成提交（工作區沒有可用 Git，已略過提交）**

Run: `git diff --check && git status --short`  
Expected: 沒有空白錯誤、`.env`、API Key、Cookie、Token、密碼或登入資料。若 Git 不可用，改以 `rg -n -i "(api[_-]?key|cookie|token|password)" --glob "!.env" --glob "!node_modules/**"` 檢查此次修改的檔案，並人工確認命中內容不是敏感值。

Run: `git add README.md docs/superpowers/specs/2026-07-14-exam-countdown-study-plan-design.md docs/superpowers/plans/2026-07-14-exam-countdown-study-plan.md && git commit -m "docs: document study plan"`  
Expected: 若 Git 可用，建立文件提交；否則依 Task 1 的規則記錄。

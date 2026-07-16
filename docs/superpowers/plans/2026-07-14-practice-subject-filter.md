# 練習科目篩選 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在日常練習中支援全部、法規與實務題目篩選，同時維持一般練習可查看答案、正式模考交卷前不可查看答案的規則。

**Architecture:** 前端練習設定新增科目狀態並隨建立練習請求送出。API 驗證科目值後傳給資料庫；資料庫以既有練習模式條件和科目條件共同篩選題目，不調整既有練習紀錄資料表或模考流程。

**Tech Stack:** React 19、TypeScript、Express 5、Zod、better-sqlite3、Vitest、Testing Library。

## Global Constraints

- 日常練習科目值固定為 `all`、`law`、`practice`，預設 `all`。
- `law` 對應題目科目 `保險法規`；`practice` 對應 `保險實務`。
- 順序、隨機、錯題與常錯題均以「未掌握題目 + 科目篩選 + 模式條件」的交集出題。
- 一般練習保留未作答即可「查看答案」；正式模考在交卷前不得載入正確答案或解析。
- 不調整題目內容、匯入功能、正式模考配題、時間設定、讀書計畫、備份格式或歷史練習資料表。
- 使用既有本機 Node 22 runtime 執行測試：`tools\\node-v22.23.1-win-x64\\npm.cmd`。

---

### Task 1: 後端科目驗證與題目交集篩選

**Files:**
- Modify: `src/server/app.ts:16-20,100-110`
- Modify: `src/server/db.ts:selectPracticeQuestionIds,createPracticeSession`
- Modify: `tests/question-bank.test.ts`

**Interfaces:**
- Consumes: `POST /api/practice-sessions` 的既有 `mode`、`shuffleQuestions`、`shuffleOptions`。
- Produces: 請求可帶 `subject?: "all" | "law" | "practice"`；缺省時視為 `"all"`。
- Produces: `QuestionDatabase.selectPracticeQuestionIds(mode, subject)` 與 `QuestionDatabase.createPracticeSession(mode, shuffleQuestions, shuffleOptions, subject)`。

- [x] **Step 1: 寫入後端失敗測試**

在 `tests/question-bank.test.ts` 新增兩個測試：第一個建立一題 `保險法規` 和一題 `保險實務`，確認順序練習的不同科目篩選只建立對應題目，未知科目回傳 400：

```ts
it("練習可依法規、實務或全部篩選題目，未知科目會被拒絕", async () => {
  const database = createTestDatabase();
  databases.push(database);
  const app = createApp({ database });
  const law = addQuestion(database, { id: "10000000-0000-4000-8000-000000000006", subject: "保險法規", questionText: "法規篩選題" });
  const practice = addQuestion(database, { id: "10000000-0000-4000-8000-000000000007", subject: "保險實務", questionText: "實務篩選題" });

  const lawSession = await request(app).post("/api/practice-sessions").send({ mode: "sequential", subject: "law", shuffleQuestions: false, shuffleOptions: false });
  const lawQuestions = await request(app).get(`/api/practice-sessions/${lawSession.body.id}/questions`);
  expect(lawQuestions.body.questions.map((question: { id: string }) => question.id)).toEqual([law.id]);

  const practiceSession = await request(app).post("/api/practice-sessions").send({ mode: "sequential", subject: "practice", shuffleQuestions: false, shuffleOptions: false });
  const practiceQuestions = await request(app).get(`/api/practice-sessions/${practiceSession.body.id}/questions`);
  expect(practiceQuestions.body.questions.map((question: { id: string }) => question.id)).toEqual([practice.id]);

  const allSession = await request(app).post("/api/practice-sessions").send({ mode: "sequential", shuffleQuestions: false, shuffleOptions: false });
  expect(allSession.body.questionCount).toBe(2);
  expect((await request(app).post("/api/practice-sessions").send({ mode: "sequential", subject: "other", shuffleQuestions: false, shuffleOptions: false })).status).toBe(400);
});
```

第二個測試確認錯題與常錯題仍會受科目條件限制：

```ts
it("錯題與常錯題會套用已選科目", async () => {
  const database = createTestDatabase();
  databases.push(database);
  const app = createApp({ database });
  const law = addQuestion(database, { id: "10000000-0000-4000-8000-000000000008", subject: "保險法規", questionText: "法規錯題" });
  const practice = addQuestion(database, { id: "10000000-0000-4000-8000-000000000009", subject: "保險實務", questionText: "實務常錯題" });

  await request(app).post("/api/attempts").send({ questionId: law.id, eventType: "answer", selectedOptionId: law.options[0].id });
  for (const selectedOptionId of [practice.options[0].id, practice.options[0].id, practice.correctOptionId]) {
    await request(app).post("/api/attempts").send({ questionId: practice.id, eventType: "answer", selectedOptionId });
  }

  const wrongLaw = await request(app).post("/api/practice-sessions").send({ mode: "wrong", subject: "law", shuffleQuestions: false, shuffleOptions: false });
  const commonPractice = await request(app).post("/api/practice-sessions").send({ mode: "common-wrong", subject: "practice", shuffleQuestions: false, shuffleOptions: false });
  expect((await request(app).get(`/api/practice-sessions/${wrongLaw.body.id}/questions`)).body.questions.map((question: { id: string }) => question.id)).toEqual([law.id]);
  expect((await request(app).get(`/api/practice-sessions/${commonPractice.body.id}/questions`)).body.questions.map((question: { id: string }) => question.id)).toEqual([practice.id]);
});
```

- [x] **Step 2: 執行測試確認失敗**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/question-bank.test.ts
```

Expected: FAIL，因為 API 尚未接受 `subject`，法規篩選仍會取得兩題。

- [x] **Step 3: 實作最小篩選邏輯**

在 `src/server/app.ts` 將建立練習 schema 改成：

```ts
const sessionSchema = z.object({
  mode: z.enum(["sequential", "random", "wrong", "common-wrong", "study-plan"]),
  subject: z.enum(["all", "law", "practice"]).optional().default("all"),
  shuffleQuestions: z.boolean(),
  shuffleOptions: z.boolean()
});
```

並在建立練習端點傳入 `settings.subject`：

```ts
const session = database.createPracticeSession(
  settings.mode,
  settings.shuffleQuestions,
  settings.shuffleOptions,
  settings.subject
);
```

在 `src/server/db.ts` 定義型別並在既有 SQL 的 `WHERE mastered = 0` 後加入精確科目條件：

```ts
type PracticeSubject = "all" | "law" | "practice";

selectPracticeQuestionIds(mode: PracticeMode, subject: PracticeSubject = "all") {
  if (mode === "study-plan") return this.getStudyPlan().questionIds;
  let sql = "SELECT id FROM questions WHERE mastered = 0";
  const params: string[] = [];
  if (subject === "law") { sql += " AND subject = ?"; params.push("保險法規"); }
  if (subject === "practice") { sql += " AND subject = ?"; params.push("保險實務"); }
  if (mode === "wrong") sql += " AND id IN (SELECT DISTINCT question_id FROM attempts WHERE event_type = 'answer' AND is_correct = 0)";
  if (mode === "common-wrong") {
    sql += ` AND id IN (
      SELECT question_id FROM attempts WHERE event_type = 'answer'
      GROUP BY question_id
      HAVING COUNT(*) >= 3 AND SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) >= 2
        AND AVG(CASE WHEN is_correct = 1 THEN 1.0 ELSE 0 END) < 0.6
    )`;
  }
  return (this.sqlite.prepare(sql).all(...params) as { id: string }[]).map((row) => row.id);
}

createPracticeSession(mode: PracticeMode, shuffleQuestions: boolean, shuffleOptions: boolean, subject: PracticeSubject = "all") {
  const ids = this.selectPracticeQuestionIds(mode, subject);
  if (shuffleQuestions) shuffle(ids);
  const id = randomUUID();
  this.sqlite.prepare(`INSERT INTO practice_sessions (id, mode, shuffle_questions, shuffle_options, question_ids_json)
    VALUES (?, ?, ?, ?, ?)`).run(id, mode, Number(shuffleQuestions), Number(shuffleOptions), JSON.stringify(ids));
  return { id, ids };
}
```

`study-plan` 呼叫未提供科目時維持 `all`；本次 UI 不讓使用者以科目篩選今日計畫。

- [x] **Step 4: 執行後端測試確認通過**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/question-bank.test.ts tests/study-plan.test.ts
```

Expected: PASS，包含既有常錯題、今日計畫與新的科目篩選案例。

### Task 2: 練習設定頁科目控制與請求資料

**Files:**
- Modify: `src/web/pages/PracticeSetupPage.tsx`
- Modify: `src/web/style.css`
- Modify: `tests/practice-ui.test.tsx`

**Interfaces:**
- Consumes: `PracticeSettings` 和既有 `onStart(settings)`。
- Produces: `PracticeSettings` 新增 `subject: "all" | "law" | "practice"`，由 `App.tsx` 原樣序列化送到 API。

- [x] **Step 1: 寫入前端失敗測試**

在 `tests/practice-ui.test.tsx` 新增測試：

```tsx
it("預設練習全部科目，切換後會以選定科目開始", async () => {
  const user = userEvent.setup();
  const onStart = vi.fn();
  render(<PracticeSetupPage onStart={onStart} message="" />);

  expect(screen.getByRole("button", { name: "全部科目" }).getAttribute("aria-pressed")).toBe("true");
  await user.click(screen.getByRole("button", { name: "實務" }));
  await user.click(screen.getByRole("button", { name: "開始作答" }));
  expect(onStart).toHaveBeenCalledWith({ mode: "sequential", subject: "practice", shuffleQuestions: false, shuffleOptions: false });
});
```

- [x] **Step 2: 執行測試確認失敗**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/practice-ui.test.tsx
```

Expected: FAIL，因為畫面尚無科目按鈕，且 `PracticeSettings` 不含 `subject`。

- [x] **Step 3: 實作科目三段式控制項**

在 `src/web/pages/PracticeSetupPage.tsx` 擴充型別、初始值和控制項：

```tsx
type PracticeSubject = "all" | "law" | "practice";
export type PracticeSettings = { mode: PracticeMode; subject: PracticeSubject; shuffleQuestions: boolean; shuffleOptions: boolean };

const subjectOptions: { id: PracticeSubject; label: string }[] = [
  { id: "all", label: "全部科目" },
  { id: "law", label: "法規" },
  { id: "practice", label: "實務" }
];

const [settings, setSettings] = useState<PracticeSettings>({
  mode: "sequential", subject: "all", shuffleQuestions: false, shuffleOptions: false
});
```

在模式格線前放入以 `aria-pressed` 表示選取狀態的三段式按鈕：

```tsx
<div className="subject-selector" aria-label="練習科目">
  {subjectOptions.map((item) => (
    <button key={item.id} type="button" aria-pressed={settings.subject === item.id}
      className={settings.subject === item.id ? "subject-button selected" : "subject-button"}
      onClick={() => setSettings({ ...settings, subject: item.id })}>
      {item.label}
    </button>
  ))}
</div>
```

在 `src/web/style.css` 新增穩定的三欄格線，並沿用既有青綠與深藍選取色：

```css
.subject-selector { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 16px; }
.subject-button { min-height: 42px; padding: 8px 4px; border: 1px solid #cbd7df; border-radius: 7px; background: #fff; color: #334155; }
.subject-button.selected { border: 2px solid #0c4a6e; background: #e7f3f8; color: #0c4a6e; }
```

保持 `chooseMode` 使用 `{ ...settings, mode, ... }`，不可遺失已選科目。

- [x] **Step 4: 補上今日計畫設定的相容欄位**

在 `src/web/App.tsx` 的 `startStudyPlan` 加上 `subject: "all"`，保持它能符合擴充後的 `PracticeSettings`：

```tsx
const startStudyPlan = () => {
  setPracticeLaunch({ mode: "study-plan", subject: "all", shuffleQuestions: false, shuffleOptions: false });
  setPage("practice");
};
```

- [x] **Step 5: 執行前端測試確認通過**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/practice-ui.test.tsx tests/practice-session-ui.test.tsx tests/exam-ui.test.tsx
```

Expected: PASS；一般練習未作答仍可查看答案，模考作答期間仍只允許選擇選項與交卷。

### Task 3: 整體驗證與手機畫面回歸

**Files:**
- Verify: `src/server/app.ts`
- Verify: `src/server/db.ts`
- Verify: `src/web/pages/PracticeSetupPage.tsx`
- Verify: `src/web/App.tsx`
- Verify: `src/web/style.css`
- Verify: `tests/question-bank.test.ts`
- Verify: `tests/practice-ui.test.tsx`
- Verify: `tests/practice-session-ui.test.tsx`
- Verify: `tests/exam-ui.test.tsx`

**Interfaces:**
- Consumes: Task 1 的 API 篩選及 Task 2 的 UI settings。
- Produces: 可在 iPhone 16 Pro、一般手機與桌面寬度正常操作的練習設定頁。

- [x] **Step 1: 執行完整自動化測試**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test
```

Expected: PASS，所有測試通過。

- [x] **Step 2: 執行型別與正式建置檢查**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" run lint
& "$runtimeRoot\npm.cmd" run build
```

Expected: 兩個指令皆以 exit code 0 結束。

- [x] **Step 3: 手動驗收本機介面**

在 `http://127.0.0.1:5173/` 驗收：

1. 開啟練習後，確認「全部科目」預設選取，法規與實務可切換。
2. 分別使用法規、實務、全部建立順序練習，確認題目科目符合篩選。
3. 選擇錯題與常錯題後，確認仍受科目篩選限制。
4. 一般練習不作答直接按「查看答案」，確認出現正確答案與解析。
5. 進入任一正式模考，確認交卷前沒有「查看答案」、正確答案或解析。
6. 以 `402 x 874`、`375 x 667` 和桌面寬度檢查科目按鈕文字不溢出、不遮擋開始作答按鈕。

- [x] **Step 4: 回讀修改檔案並檢查範圍**

確認沒有新增匯入題目 UI、沒有變動模考時間與配題規則，也沒有新增敏感資料或調整備份內容。此工作區目前沒有可用 Git 儲存庫，因此以檔案回讀、測試、型別檢查與建置結果作為驗證紀錄。

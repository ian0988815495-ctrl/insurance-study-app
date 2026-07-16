# 每日 AI 讀書建議 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在首頁讀書計畫中顯示每天固定、依計畫摘要產生的 AI 建議，且 AI 不可用時仍可使用本機替代文案。

**Architecture:** `QuestionDatabase` 負責計畫摘要與每日建議快取；`createApp` 依快取鍵決定讀取快取、呼叫本機 API 的 OpenAI 服務或回傳替代文案。前端沿用既有 `GET /api/study-plan` 回應，只增加顯示區塊，不額外發送請求。備份格式升級為 v3，並保留 v1、v2 的還原相容性。

**Tech Stack:** React 19、TypeScript、Express 5、better-sqlite3、Zod、Vitest、Testing Library、Supertest。

## Global Constraints

- 所有使用者可見文字與新增程式註解使用繁體中文。
- AI 只可使用倒數天數與每日題量彙總資料；不得處理題幹、答案、法規解釋或登入資料。
- `OPENAI_API_KEY` 只能在本機 API 的 `.env` 讀取，絕不可回傳前端、輸出或備份。
- AI 不可用時，API 必須成功回傳可讀的本機替代文案。
- 不改變現有記憶曲線、錯題門檻、題目順序與每日題量演算法。
- 不新增題目上傳、匯入或外部網站功能。
- 所有驗證命令使用 `tools/node-v22.23.1-win-x64/npm.cmd`，並以系統核准的提升權限執行。
- 此工作區不是可用 Git 儲存庫；每個任務完成後以檔案讀回與測試取代提交。

---

### Task 1: 建立每日建議快取與計畫型別

**Files:**
- Modify: `src/server/types.ts:3-9`
- Modify: `src/web/types.ts:1-3`
- Modify: `src/server/db.ts:18-106,280-323`
- Test: `tests/study-plan.test.ts`

**Interfaces:**
- Consumes: `QuestionDatabase.getStudyPlan(now?: Date)` 的既有倒數、題量與題目順序。
- Produces: `StudyPlan.advice: { content: string; source: "ai" | "fallback" }`、`getStudyPlanAdvice(cacheKey: string)`、`saveStudyPlanAdvice(input)` 與 `createStudyPlanAdviceKey(plan, now)`。

- [x] **Step 1: 寫入後端快取失敗測試**

在 `tests/study-plan.test.ts` 新增測試，設定考試日期與至少一題後，直接呼叫資料庫方法驗證：相同 `cacheKey` 可讀回保存的內容；改變考試日期或題量後，`createStudyPlanAdviceKey` 會產生不同鍵。測試內容至少包含：

```ts
const plan = database.getStudyPlan(new Date("2026-07-14T00:00:00"));
const firstKey = database.createStudyPlanAdviceKey(plan, new Date("2026-07-14T00:00:00"));
database.saveStudyPlanAdvice({ cacheKey: firstKey, planDate: "2026-07-14", examDate: "2026-07-25", content: "先完成今天的安排。", source: "fallback", model: null });
expect(database.getStudyPlanAdvice(firstKey)).toMatchObject({ content: "先完成今天的安排。", source: "fallback" });
```

- [x] **Step 2: 執行測試確認失敗**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan.test.ts
```

Expected: FAIL，因 `createStudyPlanAdviceKey`、`saveStudyPlanAdvice` 與 `getStudyPlanAdvice` 尚未存在。

- [x] **Step 3: 新增最小快取資料模型與資料庫方法**

在兩個 `types.ts` 檔案新增：

```ts
export type StudyPlanAdvice = { content: string; source: "ai" | "fallback" };
```

並讓 `StudyPlan` 擁有 `advice: StudyPlanAdvice`。在 `QuestionDatabase.initialize()` 建立：

```sql
CREATE TABLE IF NOT EXISTS study_plan_advices (
  cache_key TEXT PRIMARY KEY,
  plan_date TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('ai', 'fallback')),
  model TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

在 `QuestionDatabase` 新增三個方法：

```ts
createStudyPlanAdviceKey(plan: Pick<StudyPlan, "examDate" | "daysRemaining" | "counts">, now?: Date): string;
getStudyPlanAdvice(cacheKey: string): { content: string; source: "ai" | "fallback"; model: string | null } | undefined;
saveStudyPlanAdvice(input: { cacheKey: string; planDate: string; examDate: string; content: string; source: "ai" | "fallback"; model: string | null }): void;
```

鍵值只可由 `dateKey(now)`、考試日期、剩餘天數與三種題量組成；以 `node:crypto` 的 SHA-256 雜湊保存，不包含題目 ID 或題目內容。`getStudyPlan()` 的三種回傳路徑都要提供替代 `advice`：未設定日期為設定提醒、考試日為休息整理、一般情況為依題量組成的短建議。

- [x] **Step 4: 執行後端讀書計畫測試**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan.test.ts
```

Expected: PASS，且既有題目排序與每日題量斷言仍通過。

- [x] **Step 5: 讀回變更並記錄任務完成**

Run:

```powershell
Get-Content -Encoding UTF8 src\server\types.ts
Get-Content -Encoding UTF8 src\web\types.ts
Get-Content -Encoding UTF8 src\server\db.ts | Select-Object -Skip 60 -First 55
```

Expected: `study_plan_advices` 僅保存每日建議與彙總識別值，沒有 API Key 或題目內容。

### Task 2: 由本機 API 產生或取回每日建議

**Files:**
- Modify: `src/server/app.ts:70-80,186-209`
- Test: `tests/study-plan.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `StudyPlan.advice`、`QuestionDatabase.createStudyPlanAdviceKey`、`getStudyPlanAdvice` 與 `saveStudyPlanAdvice`。
- Produces: 非同步 `resolveStudyPlan(database, now?)` 與 `generateStudyPlanAdvice(plan)`，供 `GET /api/study-plan` 與 `PUT /api/study-plan/settings` 回傳含快取後建議的 `StudyPlan`。

- [x] **Step 1: 寫入 API 快取與替代文案的失敗測試**

在 `tests/study-plan.test.ts` 新增兩個測試：

```ts
const originalKey = process.env.OPENAI_API_KEY;
process.env.OPENAI_API_KEY = "test-key";
const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ output_text: "先完成到期複習，再處理錯題。今天完成即可。" }), { status: 200 }));
vi.stubGlobal("fetch", fetchMock);

expect((await request(app).get("/api/study-plan")).body.advice).toMatchObject({ source: "ai" });
expect((await request(app).get("/api/study-plan")).body.advice.content).toContain("到期複習");
expect(fetchMock).toHaveBeenCalledTimes(1);
```

另一個測試清除 `OPENAI_API_KEY`，斷言 `/api/study-plan` 回傳 `source: "fallback"`，且文案含倒數天數與至少一種今日題量。每個測試在 `finally` 還原環境變數與 `vi.unstubAllGlobals()`。

- [x] **Step 2: 執行測試確認失敗**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan.test.ts
```

Expected: FAIL，因路由目前同步回傳資料庫的預設替代建議，尚未呼叫或保存 AI 結果。

- [x] **Step 3: 實作建議解析器並串接兩個讀書計畫路由**

在 `src/server/app.ts` 增加：

```ts
async function resolveStudyPlan(database: QuestionDatabase, now = new Date()) {
  const plan = database.getStudyPlan(now);
  if (!plan.examDate || plan.daysRemaining === null || plan.daysRemaining <= 0) return plan;
  try {
    const cacheKey = database.createStudyPlanAdviceKey(plan, now);
    const cached = database.getStudyPlanAdvice(cacheKey);
    if (cached) return { ...plan, advice: { content: cached.content, source: cached.source } };
    const generated = await generateStudyPlanAdvice(plan);
    const advice = generated ?? plan.advice;
    database.saveStudyPlanAdvice({ cacheKey, planDate: dateKey(now), examDate: plan.examDate, content: advice.content, source: advice.source, model: generated?.model ?? null });
    return { ...plan, advice };
  } catch (error) {
    console.error("無法建立今日讀書建議，改用本機建議。", error);
    return plan;
  }
}
```

`generateStudyPlanAdvice(plan)` 先讀取 `process.env.OPENAI_API_KEY`；缺少金鑰時回傳 `null`。有金鑰時沿用既有 `fetch("https://api.openai.com/v1/responses", ...)` 與 `OPENAI_MODEL ?? "gpt-5-mini"`。提示詞只傳入 `daysRemaining`、`counts.due`、`counts.wrong`、`counts.new` 與總題數，要求繁體中文、二至三句、指定的作答順序與一句務實鼓勵；它必須回傳 `{ content, source: "ai", model }` 或在非 2xx 回應、空白輸出、格式錯誤與例外時回傳 `null`。不得將 AI 失敗轉成 HTTP 錯誤。

將兩個路由改為：

```ts
app.get("/api/study-plan", async (_request, response) => response.json(await resolveStudyPlan(database)));
// setExamDate 後：response.json(await resolveStudyPlan(database));
```

- [x] **Step 4: 執行 API 測試**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan.test.ts
```

Expected: PASS；相同條件連續呼叫只呼叫一次 mocked `fetch`，無 API Key 時仍回傳成功的替代建議。

- [x] **Step 5: 檢查提示詞與回應沒有敏感資料**

Run:

```powershell
rg -n "OPENAI_API_KEY|study-plan|daysRemaining|questionText|correctOption" src\server\app.ts
```

Expected: 每日建議提示詞只引用倒數天數與題量，不引用題幹、選項、答案、Cookie 或 Token。

### Task 3: 更新備份格式與相容還原

**Files:**
- Modify: `src/server/db.ts:318-323`
- Modify: `src/server/app.ts:307-368,431-443`
- Test: `tests/study-plan.test.ts`
- Test: `tests/question-bank.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `study_plan_advices` 資料表。
- Produces: `schemaVersion: 3` 的完整備份；v1、v2 與 v3 都可透過 `normalizeBackupData()` 還原為包含 `study_plan_advices` 的資料。

- [x] **Step 1: 寫入備份升級失敗測試**

擴充現有備份測試：新增一筆每日建議後，`GET /api/backups/export` 必須回傳 `schemaVersion: 3` 與 `data.study_plan_advices`。以相同資料構造 v1 與 v2 備份，刪除 v3 才有的 `study_plan_advices`，再呼叫 `/api/backups/preview`，兩者都必須成功。

- [x] **Step 2: 執行測試確認失敗**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan.test.ts tests/question-bank.test.ts
```

Expected: FAIL，因匯出格式仍為 v2，且備份 schema 尚未包含 `study_plan_advices`。

- [x] **Step 3: 實作 v3 匯出與舊版標準化**

在 `QuestionDatabase.exportData()` 將 `study_plan_advices` 放入表格陣列。`src/server/app.ts` 中：

```ts
const payload = { schemaVersion: 3, exportedAt: new Date().toISOString(), data: database.exportData() };
```

定義 `backupV3Schema`，使其要求 `study_plan_settings`、`review_schedules` 與 `study_plan_advices`。`backupSchema` 接受 v1、v2、v3；`normalizeBackupData()` 對 v1 補入三個空陣列，對 v2 補入空 `study_plan_advices`，對 v3 原樣回傳。還原前的 `DELETE` 與 `tableOrder` 都要包含 `study_plan_advices`，且先刪除該表後再寫入其他既有資料。

- [x] **Step 4: 執行備份相容測試**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan.test.ts tests/question-bank.test.ts
```

Expected: PASS，v3 匯出有每日建議，v1 與 v2 預覽仍接受，還原前備份流程不變。

- [x] **Step 5: 讀回備份結構**

Run:

```powershell
rg -n -C 3 "schemaVersion|study_plan_advices|normalizeBackupData|tableOrder" src\server\app.ts src\server\db.ts
```

Expected: 匯出、預覽、還原與資料庫匯出均涵蓋每日建議表。

### Task 4: 顯示今日建議並完成前端驗證

**Files:**
- Modify: `src/web/components/StudyPlanCard.tsx:16-26`
- Modify: `src/web/style.css:20-21`
- Test: `tests/study-plan-ui.test.tsx`

**Interfaces:**
- Consumes: `StudyPlan.advice.content` 與 `StudyPlan.advice.source`。
- Produces: 有清楚標題、可換行且不壓縮「開始今日計畫」按鈕的今日建議區塊。

- [x] **Step 1: 寫入前端失敗測試**

在 `tests/study-plan-ui.test.tsx` 的 `plan` fixture 加入：

```ts
advice: { content: "距離考試還有 11 天。先完成到期複習，再加強錯題；今天穩定完成即可。", source: "ai" }
```

並新增斷言：

```ts
expect(screen.getByText("今日建議")).toBeTruthy();
expect(screen.getByText(/距離考試還有 11 天/)).toBeTruthy();
```

- [x] **Step 2: 執行測試確認失敗**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan-ui.test.tsx
```

Expected: FAIL，因畫面尚未顯示「今日建議」。

- [x] **Step 3: 新增語意化區塊與手機優先樣式**

在 `StudyPlanCard` 的題量與既有 `study-plan-message` 之間加入：

```tsx
<section className="study-plan-advice" aria-label="今日建議">
  <strong>今日建議</strong>
  <p>{plan?.advice.content ?? "正在整理今日建議。"}</p>
</section>
```

在 `src/web/style.css` 新增 `.study-plan-advice` 規則：使用上、下邊框或淡色背景與 `8px` 以下圓角，`overflow-wrap: anywhere`、`line-height: 1.6`、無固定高度；按鈕維持在建議區塊後方。不得使用系統 Emoji 作為圖示。

- [x] **Step 4: 執行前端測試與完整靜態檢查**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test -- tests/study-plan-ui.test.tsx
& "$runtimeRoot\npm.cmd" run lint
& "$runtimeRoot\npm.cmd" run build
```

Expected: 全部 PASS。

- [x] **Step 5: 在手機與桌面視覺驗收**

啟動現有本機服務後，使用瀏覽器在 `402 x 874` 與 `1280 x 900` 開啟 `http://127.0.0.1:5173/`。確認「今日建議」完整換行、三個題量方塊可讀、「開始今日計畫」按鈕未被遮住，並在完成後關閉測試分頁與還原視窗尺寸。

### Task 5: 全面回歸驗證與文件同步

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-daily-study-advice-design.md:3`
- Modify: `docs/superpowers/plans/2026-07-14-daily-study-advice.md`
- Test: `tests/*.test.ts`, `tests/*.test.tsx`

**Interfaces:**
- Consumes: Tasks 1 至 4 的已完成行為與驗證證據。
- Produces: 已實作狀態的規格、已勾選的實作計畫與完整回歸結果。

- [x] **Step 1: 執行完整自動化驗證**

Run:

```powershell
$runtimeRoot = Join-Path (Get-Location) 'tools\node-v22.23.1-win-x64'
$env:Path = "$runtimeRoot;$env:Path"
& "$runtimeRoot\npm.cmd" test
& "$runtimeRoot\npm.cmd" run lint
& "$runtimeRoot\npm.cmd" run build
```

Expected: 所有 Vitest 測試、TypeScript 靜態檢查與正式建置均 PASS。

- [x] **Step 2: 檢查敏感資料與範圍**

Run:

```powershell
rg -n --glob '!node_modules/**' "sk-[A-Za-z0-9]|OPENAI_API_KEY\s*=|Cookie|Authorization: Bearer" .
```

Expected: 沒有 API Key、Cookie 或 Token 寫死；唯一可接受的 `Authorization: Bearer` 是從 `process.env.OPENAI_API_KEY` 建立的既有本機 API 請求。

- [x] **Step 3: 更新文件狀態與勾選完成項目**

將規格文件的狀態改為「已實作並驗證」，將本計畫中已完成的核取方塊改為 `[x]`。讀回兩份文件，確認沒有未完成標記、重複段落或與實作不符的描述。

- [x] **Step 4: 回報結果與已知限制**

回報新增的快取、AI 替代機制、備份版本與畫面變更；列出實際執行的測試。明確說明：未設定 `.env` 的 API Key 時，畫面會使用本機替代文案；工作區不是可用 Git 儲存庫，因此沒有建立提交。

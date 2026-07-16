# 移除正式產品題目匯入介面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將私人題庫網站收斂為刷題 App，移除使用者可見的題目匯入與瀏覽器擴充功能，同時保留內部安全匯入 API 與既有資料。

**Architecture:** React 前端移除匯入分頁、首頁入口與網址預覽載入邏輯，底部導覽改為四個固定項目。刪除不再使用的匯入頁和 Chrome 擴充功能；Express 預覽確認 API 與 SQLite 資料不變，供未來由 Codex 處理使用者在對話提供的資料。

**Tech Stack:** React 19、TypeScript、Vite、Vitest、Express 5、SQLite。

## Global Constraints

- 不刪除資料庫題目、作答紀錄、模考紀錄或備份資料。
- 正式產品畫面不顯示題目上傳、匯入、外部來源或瀏覽器擴充功能文案。
- 保留 `POST /api/imports/preview`、`GET /api/imports/:id`、`POST /api/imports/:id/confirm` 的內部安全流程。
- 不改變一般練習、常錯題、正式模考與備份行為。
- 變更必須先有失敗測試，再進行最小實作。

---

### Task 1: 移除正式前端匯入入口

**Files:**
- Modify: `tests/product-scope.test.ts`
- Modify: `tests/frontend-entry.test.ts`
- Modify: `src/web/App.tsx`
- Modify: `src/web/pages/HomePage.tsx`
- Modify: `src/web/style.css`
- Delete: `src/web/pages/ImportPage.tsx`
- Delete: `tests/import-ui.test.tsx`

**Interfaces:**
- Consumes: `HomePage.onNavigate` 與 `App` 的頁面狀態。
- Produces: 使用者只可導覽至 `home`、`practice`、`exam`、`backup`。

- [x] **Step 1: 寫入正式畫面不顯示匯入功能的失敗測試**

```ts
const appSource = fs.readFileSync(path.join(root, "src", "web", "App.tsx"), "utf8");
const homeSource = fs.readFileSync(path.join(root, "src", "web", "pages", "HomePage.tsx"), "utf8");

expect(appSource).not.toContain("ImportPage");
expect(homeSource).not.toContain("題目匯入");
expect(fs.existsSync(path.join(root, "src", "web", "pages", "ImportPage.tsx"))).toBe(false);
```

- [x] **Step 2: 執行範圍測試確認失敗**

Run: `npm test -- --run tests/product-scope.test.ts`

Expected: FAIL，因為目前網站仍載入匯入頁與入口。

- [x] **Step 3: 移除首頁、導覽與網址預覽載入邏輯**

```tsx
const [page, setPage] = useState<"home" | "practice" | "exam" | "backup">("home");

<nav className="bottom-nav" aria-label="主要功能">
  <NavButton active={page === "home"} onClick={() => setPage("home")} icon={<BookOpenCheck />} label="首頁" />
  <NavButton active={page === "practice"} onClick={() => setPage("practice")} icon={<BrainCircuit />} label="練習" />
  <NavButton active={page === "exam"} onClick={() => setPage("exam")} icon={<GraduationCap />} label="模考" />
  <NavButton active={page === "backup"} onClick={() => setPage("backup")} icon={<ArchiveRestore />} label="備份" />
</nav>
```

`HomePage` 的入口只保留練習與正式模考；CSS 的 `.bottom-nav` 改為四欄。刪除 `ImportPage.tsx` 與其 UI 測試，不改動伺服器端匯入 API。

- [x] **Step 4: 重新執行前端與範圍測試**

Run: `npm test -- --run tests/product-scope.test.ts tests/frontend-entry.test.ts tests/exam-ui.test.tsx tests/practice-ui.test.tsx`

Expected: PASS。

### Task 2: 移除擴充功能並更新產品規則文件

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `tests/product-scope.test.ts`
- Delete: `chrome-extension/manifest.json`
- Delete: `chrome-extension/popup.html`
- Delete: `chrome-extension/popup.css`
- Delete: `chrome-extension/popup.js`

**Interfaces:**
- Consumes: 正式產品只從網站前端提供學習功能。
- Produces: 題目資料改由使用者在 Codex 對話提供，內部才可使用既有 API 進行預覽確認。

- [x] **Step 1: 擴充範圍測試，要求擴充功能不存在且內部 API 仍保留**

```ts
expect(fs.existsSync(path.join(root, "chrome-extension"))).toBe(false);
expect(apiSource).toContain("/api/imports/preview");
expect(apiSource).toContain("/api/imports/:id/confirm");
```

- [x] **Step 2: 執行測試確認失敗**

Run: `npm test -- --run tests/product-scope.test.ts`

Expected: FAIL，因為 `chrome-extension` 目前存在。

- [x] **Step 3: 刪除擴充功能並更新文件**

`AGENTS.md` 改為「產品不提供匯入；使用者在 Codex 對話提供合法資料後才可啟動內部預覽確認流程」。`README.md` 移除所有擴充功能安裝與操作步驟，只保留產品功能與資料安全說明。

- [x] **Step 4: 重新執行範圍與匯入 API 測試**

Run: `npm test -- --run tests/product-scope.test.ts tests/imports.test.ts`

Expected: PASS，且內部預覽確認 API 測試仍通過。

### Task 3: 完整驗證

**Files:**
- Modify: `docs/superpowers/plans/2026-07-14-remove-user-import-surface.md`

- [x] **Step 1: 執行完整測試、型別檢查與正式建置**

Run: `npm test && npm run lint && npm run build`

Expected: 全部 exit code 0。

- [x] **Step 2: 啟動本機服務並驗證回應**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-local.ps1`

Expected: `http://127.0.0.1:3001/api/health` 與 `http://127.0.0.1:5173` 回應 200。

- [x] **Step 3: 檢查手機與桌面畫面**

在 `402 x 874` 與桌面尺寸檢查首頁、練習設定、模考入口與備份入口。

Expected: 底部導覽只有四個項目，無匯入入口、文字遮擋或水平溢出。

## Plan Self-Review

- 規格覆蓋：使用者介面、擴充功能、文件、內部 API 保留與驗收都有對應任務。
- 資料安全：所有任務只移除前端或擴充功能程式，不含資料庫刪除、清空或還原。
- 範圍限制：未新增後台或其他題目管理介面，也未改變刷題、模考、備份行為。

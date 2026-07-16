# 柔和閱讀介面與連續操作流程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將私人題庫前端改為低刺激但有角色感的手機優先閱讀介面，加入可愛貓咪學習教練，並把練習設定整理成連續的三步流程。

**Architecture:** 保留既有 API、題庫資料、判分與進度保存邏輯，只調整 React 畫面組成與 CSS。練習設定由單頁多控制項改成同一元件內的三步狀態機，最後仍呼叫既有 `onStart(settings)` 介面。

**Tech Stack:** React 19、TypeScript、Lucide React、Vite、Vitest、Testing Library。

## Global Constraints

- 不修改題目文字、選項、正式答案、解析或資料庫 schema。
- 不新增外部套件，不改變既有 API 路徑與判分邏輯。
- 主要驗收尺寸為 `402 × 874`，並檢查桌面寬度。
- 顏色以長時間閱讀舒適為優先，使用低飽和多色點綴，避免高飽和大色塊與強烈陰影。
- 每個流程畫面只保留一個主要動作，返回與上一步保持可見。
- 首頁鼓勵話以貓咪學習教練的對話泡泡呈現，但不使用系統 Emoji 作為主要圖示。

---

### Task 1: 練習設定三步流程

**Files:**
- Modify: `src/web/pages/PracticeSetupPage.tsx`
- Modify: `tests/practice-ui.test.tsx`

**Interfaces:**
- Consumes: existing `PracticeSettings`, `PracticeResume`, `onStart`, `onResume`, and `message` props.
- Produces: the same `onStart(settings)` callback shape; adds visible step labels and stable button names for UI verification.

- [ ] **Step 1: Update UI tests for the three-step flow**

Test that a user selects a subject, advances to mode, advances to options, and starts with the same settings object. Keep the existing random-toggle and resume assertions, adding navigation actions where required.

- [ ] **Step 2: Run the focused UI test and verify the expected failure**

Run: `tools/node-v22.23.1-win-x64/node.exe node_modules/vitest/vitest.mjs run tests/practice-ui.test.tsx`

Expected: the new step navigation assertions fail before the component is updated.

- [ ] **Step 3: Implement the local three-step state machine**

Use `step: 1 | 2 | 3`, preserve settings in one state object, and render only the controls for the active step. Step 1 chooses subject, step 2 chooses mode, step 3 edits the two toggles and shows a read-only summary. The existing resume action remains available without auto-starting a new session.

- [ ] **Step 4: Run the focused UI test and verify it passes**

Run: `tools/node-v22.23.1-win-x64/node.exe node_modules/vitest/vitest.mjs run tests/practice-ui.test.tsx`

Expected: all practice UI tests pass.

---

### Task 2: 柔和閱讀視覺系統

**Files:**
- Modify: `src/web/style.css`
- Modify: `src/web/pages/HomePage.tsx`
- Modify: `src/web/pages/PracticeSessionPage.tsx`

**Interfaces:**
- Consumes: existing page class names and callbacks.
- Produces: consistent low-contrast palette, readable question surfaces, visible back buttons, and a clearer home entry hierarchy.

- [ ] **Step 1: Add visual assertions for flow affordances**

Verify that the home page exposes separate practice and exam actions, and the question page exposes a visible return action and a primary answer action without changing the callback contract.

- [ ] **Step 2: Implement the soft palette and page hierarchy**

Replace saturated navy/teal blocks with warm gray-white surfaces, charcoal text, muted teal actions, muted green/red answer states, larger line height, and restrained borders. Add styles for the existing unstyled `.back-button` and `.sync-panel` plus the new setup flow classes.

- [ ] **Step 3: Refine homepage and question-page copy grouping**

Add a short home introduction and explicit question context grouping while preserving all existing labels used by tests and users.

- [ ] **Step 4: Run the full test suite**

Run: `tools/node-v22.23.1-win-x64/node.exe node_modules/vitest/vitest.mjs run`

Expected: all test files pass.

---

### Task 3: Build and responsive verification

**Files:**
- Modify: generated Vite output only through the existing build script.

- [ ] **Step 1: Run typecheck and production build**

Run: `tools/node-v22.23.1-win-x64/node.exe node_modules/typescript/bin/tsc --noEmit` and `tools/node-v22.23.1-win-x64/node.exe node_modules/vite/bin/vite.js build`

Expected: both commands exit successfully.

- [ ] **Step 2: Check the local page at `402 × 874` and desktop width**

Use the local browser page to verify no horizontal overflow, no clipped text, fixed bottom navigation clearance, readable question options, and usable back/next controls.

- [ ] **Step 3: Run `git diff --check` and report actual results**

Expected: no whitespace errors; report any remaining non-blocking warnings separately.

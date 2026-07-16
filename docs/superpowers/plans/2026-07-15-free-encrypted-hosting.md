# 免費加密雲端題庫 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 將題庫轉為免費靜態網站可使用的加密資料檔，並在手機端以密碼解鎖。

**Architecture:** 建置腳本使用 PBKDF2-SHA-256 與 AES-256-GCM 將原始題庫轉成加密 JSON。瀏覽器解密成功後才建立既有離線 API；服務工作者只快取加密檔。

**Tech Stack:** React、TypeScript、Web Crypto API、Node.js crypto、Vite、Vitest。

## Global Constraints

- 不使用付款、雲端 API、帳號或儲存登入憑證。
- 題目不得以明文部署到靜態網站。
- 保留既有手機優先與 PWA 行為。

---

### Task 1: 解密核心與測試

**Files:**
- Create: `src/web/offline-crypto.ts`
- Test: `tests/offline-crypto.test.ts`

- [ ] 實作 `unlockOfflineSeed(payload, password)`，正確密碼回傳 `OfflineSeed`，錯誤密碼回傳固定錯誤訊息。
- [ ] 執行 `vitest run tests/offline-crypto.test.ts`。

### Task 2: 離線 API 與解鎖畫面

**Files:**
- Modify: `src/web/api.ts`
- Modify: `src/web/App.tsx`
- Modify: `src/web/style.css`

- [ ] 將加密題庫載入與解鎖狀態置於離線 API 初始化之前。
- [ ] 新增可輸入密碼、記住目前裝置、清除解鎖狀態的手機介面。
- [ ] 執行 TypeScript 檢查與相關前端測試。

### Task 3: 加密建置與部署產物

**Files:**
- Create: `scripts/encrypt-offline-seed.mjs`
- Modify: `package.json`
- Modify: `public/service-worker.js`

- [ ] 建置前產生 `offline-seed.encrypted.json` 並移除輸出資料夾的明文題庫檔。
- [ ] 更新快取清單，只納入加密檔。
- [ ] 執行離線建置，檢查部署資料夾不存在明文題庫檔。

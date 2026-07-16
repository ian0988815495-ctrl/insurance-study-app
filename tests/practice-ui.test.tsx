import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeSetupPage } from "../src/web/pages/PracticeSetupPage.tsx";
import { EmptyState } from "../src/web/components/EmptyState.tsx";
import { HomePage } from "../src/web/pages/HomePage.tsx";

describe("練習設定", () => {
  afterEach(cleanup);

  it("預設練習全部科目，切換後會以選定科目開始", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<PracticeSetupPage onStart={onStart} message="" />);

    expect(screen.getByRole("button", { name: "全部科目" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "實務" }));
    await user.click(screen.getByRole("button", { name: "開始作答" }));
    expect(onStart).toHaveBeenCalledWith({ mode: "sequential", subject: "practice", shuffleQuestions: false, shuffleOptions: false });
  });

  it("順序練習預設不隨機，隨機練習預設開啟兩個隨機設定且可個別調整", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    render(<PracticeSetupPage onStart={onStart} message="" />);

    expect(screen.getByRole("button", { name: "隨機考題 已關閉" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打亂選項 已關閉" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "隨機練習" }));
    expect(screen.getByRole("button", { name: "隨機考題 已開啟" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "打亂選項 已開啟" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "打亂選項 已開啟" }));
    expect(screen.getByRole("button", { name: "打亂選項 已關閉" })).toBeTruthy();
  });

  it("題庫為空時提供可返回首頁的操作", async () => {
    const user = userEvent.setup();
    const onReturnHome = vi.fn();
    render(<EmptyState onReturnHome={onReturnHome} />);

    expect(screen.getByText("尚無可練習題目")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "返回首頁" }));
    expect(onReturnHome).toHaveBeenCalledOnce();
  });

  it("首頁可進入練習流程", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<HomePage dashboard={{ total: 12, wrong: 3, commonWrong: 2, mastered: 4 }} plan={null} savingPlan={false} onSaveDate={vi.fn().mockResolvedValue(undefined)} onStartStudyPlan={vi.fn()} onNavigate={onNavigate} />);

    await user.click(screen.getByRole("button", { name: "開始練習 ›" }));
    expect(onNavigate).toHaveBeenCalledWith("practice");
  });

  it("本機題庫服務無法連線時會顯示原因，不把題庫誤認為空白", () => {
    render(<HomePage dashboard={{ total: 0, wrong: 0, commonWrong: 0, mastered: 0 }} plan={null} savingPlan={false} onSaveDate={vi.fn().mockResolvedValue(undefined)} onStartStudyPlan={vi.fn()} onNavigate={vi.fn()} serviceError="無法連線至本機題庫服務。" />);

    expect(screen.getByRole("alert").textContent).toContain("無法連線至本機題庫服務。");
  });
});

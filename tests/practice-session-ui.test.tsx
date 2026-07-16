import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeSessionPage } from "../src/web/pages/PracticeSessionPage.tsx";

describe("一般練習作答", () => {
  afterEach(cleanup);

  it("只在使用者查看答案後才載入正確答案與解析", async () => {
    const user = userEvent.setup();
    const recordAttempt = vi.fn().mockResolvedValue(undefined);
    const loadReview = vi.fn().mockResolvedValue({ correctOptionId: "option-b", rawExplanation: "正確。", aiExplanation: { content: null, status: "pending" } });
    render(<PracticeSessionPage sessionId="session-1" questions={[{ id: "question-1", subject: "保險法規", chapter: "第一章", questionText: "測試題", options: [{ id: "option-a", text: "甲" }, { id: "option-b", text: "乙" }] }]} recordAttempt={recordAttempt} loadReview={loadReview} onExit={vi.fn()} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "甲" }));
    expect(recordAttempt).toHaveBeenCalledWith("question-1", "session-1", "option-a");
    expect(loadReview).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "公布答案" }));
    expect(loadReview).toHaveBeenCalledWith("question-1");
    expect(screen.getByText("原始解析")).toBeTruthy();
    expect(screen.getByText("此題來源未提供詳細解析。")).toBeTruthy();
    expect(screen.queryByText("正確。")).toBeNull();
  });

  it("未作答也可查看答案並標記待複習", async () => {
    const user = userEvent.setup();
    const recordAttempt = vi.fn().mockResolvedValue(undefined);
    const loadReview = vi.fn().mockResolvedValue({ correctOptionId: "option-b", rawExplanation: "原始解析", aiExplanation: { content: null, status: "pending" } });
    render(<PracticeSessionPage sessionId="session-1" questions={[{ id: "question-1", subject: "保險法規", chapter: "第一章", questionText: "測試題", options: [{ id: "option-a", text: "甲" }, { id: "option-b", text: "乙" }] }]} recordAttempt={recordAttempt} loadReview={loadReview} onExit={vi.fn()} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "公布答案" }));

    expect(recordAttempt).not.toHaveBeenCalled();
    expect(loadReview).toHaveBeenCalledWith("question-1");
    expect(screen.getByText("看過答案／待複習")).toBeTruthy();
  });

  it("公布答案後顯示原始解析、AI 白話解析與選項分析", async () => {
    const user = userEvent.setup();
    const loadReview = vi.fn().mockResolvedValue({
      correctOptionId: "option-b",
      rawExplanation: "訊息列錯誤\n\n錯誤。來源原始解析",
      aiExplanation: { content: "這題考保險契約基本概念。應依題幹判斷。", status: "ready" },
      aiOptionAnalysis: [
        { optionId: "option-a", verdict: "incorrect", content: "甲不符合題意。" },
        { optionId: "option-b", verdict: "correct", content: "乙符合題意。" }
      ]
    });
    render(<PracticeSessionPage sessionId="session-1" questions={[{ id: "question-1", subject: "保險法規", chapter: "第一章", questionText: "測試題", options: [{ id: "option-a", sourceLabel: "1", text: "甲" }, { id: "option-b", sourceLabel: "2", text: "乙" }] }]} recordAttempt={vi.fn().mockResolvedValue(undefined)} loadReview={loadReview} onExit={vi.fn()} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /公布答案/ }));
    expect(screen.getByText("AI 白話解析")).toBeTruthy();
    expect(screen.getByText("甲不符合題意。")).toBeTruthy();
    expect(screen.getByText("原始解析")).toBeTruthy();
    expect(screen.getByText("錯誤。來源原始解析")).toBeTruthy();
    expect(screen.queryByText("訊息列錯誤")).toBeNull();
  });

  it("可返回練習選擇且不把未完成進度當成結束", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<PracticeSessionPage sessionId="session-1" questions={[{ id: "question-1", subject: "保險實務", chapter: "第一章", questionText: "測試題", options: [{ id: "option-a", text: "甲" }] }]} recordAttempt={vi.fn().mockResolvedValue(undefined)} loadReview={vi.fn()} onExit={vi.fn()} onBack={onBack} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "返回練習選擇" }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});

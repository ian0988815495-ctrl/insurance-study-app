import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PracticeSessionPage } from "../src/web/pages/PracticeSessionPage.tsx";

const questions = [
  { id: "question-1", subject: "保險法規", chapter: "第一章", questionText: "第一題", options: [{ id: "q1-a", sourceLabel: "1", text: "甲" }, { id: "q1-b", sourceLabel: "2", text: "乙" }, { id: "q1-c", sourceLabel: "3", text: "丙" }, { id: "q1-d", sourceLabel: "4", text: "丁" }] },
  { id: "question-2", subject: "保險法規", chapter: "第一章", questionText: "第二題", options: [{ id: "q2-a", sourceLabel: "1", text: "子" }, { id: "q2-b", sourceLabel: "2", text: "丑" }] }
];

describe("一般練習作答", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("第一題不能上一題，第二題可以返回並保留最後選擇且未公布時可修改", async () => {
    const user = userEvent.setup();
    const recordAttempt = vi.fn().mockResolvedValue(undefined);
    render(<PracticeSessionPage sessionId="session-1" questions={questions} recordAttempt={recordAttempt} loadReview={vi.fn()} onExit={vi.fn()} onMastered={vi.fn()} />);

    expect((screen.getByRole("button", { name: "上一題" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: /1 甲/ }));
    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第二題")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "上一題" }));
    expect(screen.getByRole("button", { name: /1 甲/ }).classList.contains("selected")).toBe(true);

    await user.click(screen.getByRole("button", { name: /3 丙/ }));
    expect(screen.getByRole("button", { name: /3 丙/ }).classList.contains("selected")).toBe(true);
    expect(screen.getByRole("button", { name: /1 甲/ }).classList.contains("selected")).toBe(false);
    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(recordAttempt).toHaveBeenLastCalledWith("question-1", "session-1", "q1-c");
  });

  it("選擇後可以直接下一題，不會在第一次點擊就鎖住選項", async () => {
    const user = userEvent.setup();
    const recordAttempt = vi.fn().mockResolvedValue(undefined);
    render(<PracticeSessionPage sessionId="session-1" questions={questions} recordAttempt={recordAttempt} loadReview={vi.fn()} onExit={vi.fn()} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /1 甲/ }));
    await user.click(screen.getByRole("button", { name: /2 乙/ }));
    expect(screen.getByRole("button", { name: /2 乙/ }).classList.contains("selected")).toBe(true);
    await user.click(screen.getByRole("button", { name: "下一題" }));
    expect(screen.getByText("第二題")).toBeTruthy();
    expect(recordAttempt).toHaveBeenCalledOnce();
    expect(recordAttempt).toHaveBeenCalledWith("question-1", "session-1", "q1-b");
  });

  it("公布答案後只顯示 AI 詳解，且分析依原始選項順序對應", async () => {
    const user = userEvent.setup();
    const loadReview = vi.fn().mockResolvedValue({
      correctOptionId: "q1-b",
      rawExplanation: "這段原始解析不應顯示",
      aiExplanation: { content: "這是 AI 生成的完整詳解。", status: "ready" },
      aiOptionAnalysis: [
        { optionId: "q1-c", verdict: "incorrect", content: "第三個選項的 AI 分析。" },
        { optionId: "q1-a", verdict: "incorrect", content: "第一個選項的 AI 分析。" },
        { optionId: "q1-b", verdict: "correct", content: "第二個選項的 AI 分析。" }
      ]
    });
    render(<PracticeSessionPage sessionId="session-1" questions={questions} recordAttempt={vi.fn().mockResolvedValue(undefined)} loadReview={loadReview} onExit={vi.fn()} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "公布答案" }));

    expect(screen.getByText("這是 AI 生成的完整詳解。")).toBeTruthy();
    expect(screen.getByText("第一個選項的 AI 分析。")).toBeTruthy();
    expect(screen.getByText("第二個選項的 AI 分析。")).toBeTruthy();
    expect(screen.getByText("第三個選項的 AI 分析。")).toBeTruthy();
    expect(screen.queryByText("這段原始解析不應顯示")).toBeNull();
    expect(screen.queryByText(/正確答案|AI 建議答案|本題無提供答案|答案編號|待確認/)).toBeNull();
    expect(screen.getByTestId("practice-options").textContent).toBe("1甲2乙3丙4丁");
    const analyses = screen.getAllByTestId("ai-option-analysis");
    expect(analyses.map((item) => item.textContent)).toEqual(["第一個選項的 AI 分析。", "第二個選項的 AI 分析。", "第三個選項的 AI 分析。"]);
  });

  it("沒有 AI 詳解時顯示簡潔空狀態，不顯示答案或來源提示", async () => {
    const user = userEvent.setup();
    render(<PracticeSessionPage sessionId="session-1" questions={[questions[0]]} recordAttempt={vi.fn().mockResolvedValue(undefined)} loadReview={vi.fn().mockResolvedValue({ correctOptionId: "q1-b", rawExplanation: "原始解析", aiExplanation: { content: null, status: "pending" } })} onExit={vi.fn()} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "公布答案" }));

    expect(screen.getByText("AI 詳解尚未產生。")).toBeTruthy();
    expect(screen.queryByText(/原始解析|正確|答案|缺少正式答案/)).toBeNull();
  });

  it("返回已公布詳解的題目後仍保留詳解狀態", async () => {
    const user = userEvent.setup();
    const loadReview = vi.fn().mockResolvedValue({ correctOptionId: "q1-b", rawExplanation: "原始解析", aiExplanation: { content: "保留的 AI 詳解。", status: "ready" } });
    render(<PracticeSessionPage sessionId="session-1" questions={questions} recordAttempt={vi.fn().mockResolvedValue(undefined)} loadReview={loadReview} onExit={vi.fn()} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "公布答案" }));
    await user.click(screen.getByRole("button", { name: "下一題" }));
    await user.click(screen.getByRole("button", { name: "上一題" }));

    expect(screen.getByText("保留的 AI 詳解。")).toBeTruthy();
    expect(loadReview).toHaveBeenCalledTimes(1);
  });

  it("結束測驗必須確認，取消時保留目前頁面", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<PracticeSessionPage sessionId="session-1" questions={[questions[0]]} recordAttempt={vi.fn().mockResolvedValue(undefined)} loadReview={vi.fn()} onExit={onExit} onMastered={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "結束測驗" }));
    expect(onExit).not.toHaveBeenCalled();
    expect(screen.getByText("第一題")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "確認結束" }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("卸載並重新掛載後恢復同一份測驗、目前題目、選擇與公布狀態", async () => {
    const user = userEvent.setup();
    const snapshots: any[] = [];
    const loadReview = vi.fn().mockResolvedValue({ correctOptionId: "q1-b", rawExplanation: "不可顯示", aiExplanation: { content: "已保存的 AI 詳解。", status: "ready" } });
    const props = { sessionId: "session-1", questions, recordAttempt: vi.fn().mockResolvedValue(undefined), loadReview, onExit: vi.fn(), onMastered: vi.fn(), onProgressChange: (progress: any) => snapshots.push(progress) };
    const first = render(<PracticeSessionPage {...props} />);

    await user.click(screen.getByRole("button", { name: /2 乙/ }));
    await user.click(screen.getByRole("button", { name: "公布答案" }));
    await user.click(screen.getByRole("button", { name: "下一題" }));
    await user.click(screen.getByRole("button", { name: /2 丑/ }));
    const saved = snapshots.at(-1);
    first.unmount();

    render(<PracticeSessionPage {...props} initialProgress={saved} />);

    expect(screen.getByText("第二題")).toBeTruthy();
    expect(screen.getByRole("button", { name: /2 丑/ }).classList.contains("selected")).toBe(true);
    await user.click(screen.getByRole("button", { name: "上一題" }));
    expect(screen.getByRole("button", { name: /2 乙/ }).classList.contains("correct")).toBe(true);
    expect(screen.getByText("已保存的 AI 詳解。")).toBeTruthy();
  });
});

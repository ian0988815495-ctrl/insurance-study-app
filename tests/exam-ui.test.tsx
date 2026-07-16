import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamSessionPage } from "../src/web/pages/ExamSessionPage.tsx";
import { FixedExamPage } from "../src/web/pages/FixedExamPage.tsx";

describe("正式模考作答", () => {
  afterEach(() => vi.useRealTimers());

  it("作答期間不交卷，使用者交卷時才提交選項 ID", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue({ score: 100, correct: 1, total: 1, passed: true, subjectResults: [] });
    render(<ExamSessionPage exam={{ id: "exam-1", endsAt: new Date(Date.now() + 60_000).toISOString(), questions: [{ id: "question-1", subject: "保險法規", chapter: "第一章", questionText: "模考題", options: [{ id: "option-a", text: "甲" }, { id: "option-b", text: "乙" }] }] }} onSubmit={onSubmit} onExit={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "乙" }));
    expect(onSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "交卷" }));
    expect(onSubmit).toHaveBeenCalledWith("exam-1", [{ questionId: "question-1", selectedOptionId: "option-b" }]);
  });

  it("倒數到期時只會自動交卷一次", async () => {
    vi.useFakeTimers();
    const onSubmit = vi.fn().mockResolvedValue({ score: 0, correct: 0, total: 1, passed: false, subjectResults: [] });
    render(<ExamSessionPage exam={{ id: "exam-2", endsAt: new Date(Date.now()).toISOString(), questions: [{ id: "question-2", subject: "保險實務", chapter: "第一章", questionText: "模考題", options: [{ id: "option-a", text: "甲" }] }] }} onSubmit={onSubmit} onExit={vi.fn()} />);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("固定模考只提供法規、實務與完整測驗入口", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<FixedExamPage onStart={onStart} />);

    expect(screen.queryByLabelText("時間（分鐘）")).toBeNull();
    expect(screen.queryByLabelText("總分門檻（%）")).toBeNull();
    await user.click(screen.getByRole("button", { name: "法規單科模考" }));
    expect(onStart).toHaveBeenCalledWith("law");
  });
});

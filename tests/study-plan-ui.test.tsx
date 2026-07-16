import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StudyPlanCard } from "../src/web/components/StudyPlanCard.tsx";

describe("今日讀書計畫", () => {
  it("可儲存考試日期、顯示任務數量並開始今日計畫", async () => {
    const user = userEvent.setup();
    const onSaveDate = vi.fn().mockResolvedValue(undefined);
    const onStart = vi.fn();
    render(<StudyPlanCard plan={{
      examDate: "2026-07-25",
      daysRemaining: 11,
      counts: { due: 3, wrong: 2, new: 4 },
      questionIds: ["due-1", "due-2", "due-3", "wrong-1", "wrong-2", "new-1", "new-2", "new-3", "new-4"],
      message: "先完成複習。",
      advice: { content: "距離考試還有 11 天。先完成到期複習，再加強錯題；今天穩定完成即可。", source: "ai" }
    }} saving={false} onSaveDate={onSaveDate} onStart={onStart} />);

    fireEvent.change(screen.getByLabelText("考試日期"), { target: { value: "2026-07-26" } });
    await user.click(screen.getByRole("button", { name: "儲存考試日期" }));
    expect(onSaveDate).toHaveBeenCalledWith("2026-07-26");
    expect(screen.getByText("到期複習 3 題")).toBeTruthy();
    expect(screen.getByText("錯題加強 2 題")).toBeTruthy();
    expect(screen.getByText("新題練習 4 題")).toBeTruthy();
    expect(screen.getByText("今日建議")).toBeTruthy();
    expect(screen.getByText(/距離考試還有 11 天/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "開始今日計畫" }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});

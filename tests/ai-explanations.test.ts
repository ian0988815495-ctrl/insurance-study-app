import { describe, expect, it } from "vitest";
import { parseAiExplanation } from "../src/server/ai-explanations.ts";

describe("AI 題目解析", () => {
  it("AI 漏掉選項時，保留已有解析並將缺漏選項標記為待確認", () => {
    const result = parseAiExplanation(JSON.stringify({
      summary: "這題考的是保險契約的基本概念。重點在於依題幹和原始資料判斷。",
      analyses: [{ optionId: "option-a", verdict: "correct", content: "此選項符合題目提供的答案。" }]
    }), [
      { id: "option-a", text: "第一個選項" },
      { id: "option-b", text: "第二個選項" }
    ]);

    expect(result.status).toBe("pending-review");
    expect(result.summary).toContain("保險契約");
    expect(result.analyses).toEqual([
      { optionId: "option-a", verdict: "correct", content: "此選項符合題目提供的答案。" },
      { optionId: "option-b", verdict: "pending-review", content: "AI 未提供此選項的解析，待確認。" }
    ]);
  });

  it("AI 回傳非結構化內容時，改為待確認而不中斷解析流程", () => {
    const result = parseAiExplanation("這不是 JSON", [{ id: "option-a", text: "第一個選項" }]);

    expect(result).toEqual({
      status: "pending-review",
      summary: "AI 解析格式不完整，待確認。",
      analyses: [{ optionId: "option-a", verdict: "pending-review", content: "AI 未提供此選項的解析，待確認。" }]
    });
  });
});

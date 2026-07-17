// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasCompleteAiExplanations } from "../scripts/offline-seed-source.mjs";

const question = {
  options: [{ id: "o-1" }, { id: "o-2" }],
  aiExplanation: { status: "ready", content: "完整解析" },
  aiOptionAnalysis: [{ optionId: "o-1", content: "選項一解析" }, { optionId: "o-2", content: "選項二解析" }]
};

describe("GitHub Pages 題庫來源選擇", () => {
  it("完整 AI 解析檔才視為可發布", () => {
    expect(hasCompleteAiExplanations({ questions: [question] }, 1)).toBe(true);
  });

  it("缺少 AI 詳解時不視為完整", () => {
    expect(hasCompleteAiExplanations({ questions: [{ ...question, aiExplanation: { status: "pending", content: null } }] }, 1)).toBe(false);
  });

  it("選項解析數量不足時不視為完整", () => {
    expect(hasCompleteAiExplanations({ questions: [{ ...question, aiOptionAnalysis: [] }] }, 1)).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import { validateOfflineUnlockPassword } from "../scripts/offline-password-policy.mjs";

describe("離線題庫解鎖密碼規則", () => {
  test("接受至少八個字元的使用者自訂密碼", () => {
    expect(validateOfflineUnlockPassword("ian061106")).toBe(true);
  });

  test("拒絕少於八個字元的密碼", () => {
    expect(validateOfflineUnlockPassword("ian0611")).toBe(false);
  });
});

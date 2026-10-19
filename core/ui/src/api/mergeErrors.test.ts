import { describe, expect, it } from "vitest";
import { mergeErrorText } from "./queries";

const e = (code: string, details?: Record<string, unknown>) => ({ code, message: "raw message", requestId: "r", retryable: false, status: 409, ...(details ? { details } : {}) });

describe("mergeErrorText", () => {
  it("explains each identity error in plain words", () => {
    expect(mergeErrorText(e("cannot_merge_self"))).toBe("Choose a different contact.");
    expect(mergeErrorText(e("contact_not_found"))).toContain("no longer exists");
    expect(mergeErrorText(e("merge_already_reverted"))).toBe("This merge was already undone.");
    expect(mergeErrorText(e("handle_conflict", { handles: ["a@b.c", "+3630"] }))).toContain("(a@b.c, +3630)");
    expect(mergeErrorText(e("handle_conflict"))).not.toContain("()");
  });
  it("falls back to the service message", () => expect(mergeErrorText(e("weird"))).toBe("raw message"));
});

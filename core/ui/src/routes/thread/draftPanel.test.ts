import { describe, expect, it } from "vitest";
import { ERROR_COPY, draftErrorText, offReason } from "./DraftPanel";

const err = (code: string, retryable = false, message = "raw") => ({ code, message, requestId: "r", retryable, status: 500 });

describe("draft error copy", () => {
  it("has plain copy for every documented service code", () => {
    for (const code of ["drafting_disabled", "model_unavailable", "draft_timeout", "empty_draft", "draft_busy", "contact_not_found"]) expect(ERROR_COPY[code], code).toBeTruthy();
    expect(draftErrorText(err("draft_timeout", true))).toBe("The model took too long. Try again or write the reply yourself.");
    expect(draftErrorText(err("timeout", true))).toBe(ERROR_COPY.draft_timeout);
  });
  it("a missing model (not retryable) keeps the service's pull instruction; unknown codes keep the message", () => {
    expect(draftErrorText(err("model_unavailable", false, "Run: ollama pull m"))).toBe("Run: ollama pull m");
    expect(draftErrorText(err("model_unavailable", true))).toBe(ERROR_COPY.model_unavailable);
    expect(draftErrorText(err("weird", false, "Something odd."))).toBe("Something odd.");
  });
});

describe("offReason", () => {
  it("explains each reason, never as an error", () => {
    expect(offReason(undefined)).toContain("Checking");
    expect(offReason({ enabled: false, provider: "off", reason: "not_configured" })).toContain("REPLY_CORE_LLM=ollama");
    expect(offReason({ enabled: false, provider: "ollama", model: "m:1", reason: "model_missing" })).toBe("The model m:1 is not installed. Run: ollama pull m:1");
    expect(offReason({ enabled: false, provider: "ollama", model: "m:1", reason: "unreachable" })).toContain("Start Ollama");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { DRAFT_KEY, clearDraft, loadDraft, saveDraft } from "./draftStore";
import { openFromGesture } from "./openLink";

afterEach(() => { window.sessionStorage.clear(); vi.restoreAllMocks(); });

describe("draftStore", () => {
  it("round-trips a draft per contact and clears it", () => {
    expect(loadDraft("c1")).toBeNull();
    expect(saveDraft("c1", { text: "hi", channel: "email" })).toBe(true);
    expect(loadDraft("c1")).toMatchObject({ text: "hi", channel: "email" });
    expect(loadDraft("c2")).toBeNull();
    clearDraft("c1");
    expect(loadDraft("c1")).toBeNull();
  });
  it("saving empty text removes the draft", () => {
    saveDraft("c1", { text: "x", channel: "imessage" });
    saveDraft("c1", { text: "", channel: "imessage" });
    expect(window.sessionStorage.getItem(DRAFT_KEY("c1"))).toBeNull();
  });
  it("ignores garbage and survives storage that throws", () => {
    window.sessionStorage.setItem(DRAFT_KEY("c1"), "{not json");
    expect(loadDraft("c1")).toBeNull();
    window.sessionStorage.setItem(DRAFT_KEY("c1"), JSON.stringify({ text: "a", channel: "fax" }));
    expect(loadDraft("c1")).toBeNull();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(saveDraft("c1", { text: "a", channel: "email" })).toBe(false);
    expect(loadDraft("c1")).toBeNull();
    expect(() => clearDraft("c1")).not.toThrow();
  });
});

describe("openFromGesture", () => {
  it("clicks a temporary noopener anchor and removes it; web links open in a new tab, app links do not", () => {
    const seen: { href: string; rel: string; target: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { seen.push({ href: this.href, rel: this.rel, target: this.target }); });
    openFromGesture("sms:+36301234567&body=hi");
    openFromGesture("https://wa.me/36301234567?text=hi");
    expect(seen[0]).toMatchObject({ rel: "noopener noreferrer", target: "" });
    expect(seen[1]).toMatchObject({ rel: "noopener noreferrer", target: "_blank" });
    expect(document.querySelectorAll("a[rel='noopener noreferrer']")).toHaveLength(0);
  });
});

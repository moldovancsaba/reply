import { describe, expect, it } from "vitest";
import { contactsUrl } from "../../api/queries";
import { relativeLabel } from "../../lib/time";
import { parseInboxQuery, toSearchParams } from "./inboxQuery";

describe("inbox query <-> URL", () => {
  it("round-trips and drops defaults", () => {
    const q = parseInboxQuery(new URLSearchParams("q=%20anna%20&channel=email"));
    expect(q).toEqual({ q: "anna", channel: "email" });
    expect(toSearchParams(q).toString()).toBe("q=anna&channel=email");
    expect(toSearchParams({ q: "", channel: "all" }).toString()).toBe("");
  });
  it("ignores an unknown channel and caps the search length", () => {
    expect(parseInboxQuery(new URLSearchParams("channel=fax")).channel).toBe("all");
    expect(parseInboxQuery(new URLSearchParams(`q=${"x".repeat(500)}`)).q).toHaveLength(200);
  });
  it("builds the API url with the cursor", () => {
    expect(contactsUrl({ q: "a b", channel: "all" }, "cur")).toBe("/api/contacts?limit=30&q=a+b&cursor=cur");
    expect(contactsUrl({ q: "", channel: "whatsapp" }, null)).toBe("/api/contacts?limit=30&channel=whatsapp");
  });
});

describe("relativeLabel", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it.each([["2026-10-19T11:55:00Z", "5 minutes ago"], ["2026-10-19T11:59:50Z", "just now"], ["2026-10-17T12:00:00Z", "2 days ago"], ["2026-10-19T09:00:00Z", "3 hours ago"]])("%s -> %s", (iso, label) => {
    expect(relativeLabel(iso, now, "en-US")).toBe(label);
  });
});

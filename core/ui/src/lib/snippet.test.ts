import { describe, expect, it } from "vitest";
import { canSearch, parseSnippet } from "./snippet";
import { parseSearchQuery, toSearchParams } from "../routes/search/searchQuery";
import { searchUrl } from "../api/queries";

const A = "\u0001";
const B = "\u0002";
const join = (s: string) => parseSnippet(s).map((x) => x.text).join("");

describe("parseSnippet", () => {
  it("splits matches from text", () => {
    expect(parseSnippet(`see the ${A}invoice${B} for`)).toEqual([{ text: "see the ", hit: false }, { text: "invoice", hit: true }, { text: " for", hit: false }]);
  });
  it("treats an unterminated mark as plain text and drops stray end marks", () => {
    expect(parseSnippet(`a ${A}b`)).toEqual([{ text: "a ", hit: false }, { text: "b", hit: false }]);
    expect(parseSnippet(`a${B}b`)).toEqual([{ text: "ab", hit: false }]);
    expect(parseSnippet(`${A}x${A}y${B}`)).toEqual([{ text: "xy", hit: true }]);
  });
  it("keeps markup characters as text", () => {
    expect(parseSnippet(`<img src=x onerror=alert(1)> ${A}<b>${B}`)).toEqual([{ text: "<img src=x onerror=alert(1)> ", hit: false }, { text: "<b>", hit: true }]);
  });
  it("is total and never loses text: random mixes of text and marks", () => {
    let seed = 42;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32;
    const alphabet = ["a", "b", " ", "<", ">", "&", A, B, "é", "😀"];
    for (let n = 0; n < 2000; n++) {
      const s = Array.from({ length: Math.floor(rnd() * 30) }, () => alphabet[Math.floor(rnd() * alphabet.length)]).join("");
      const segs = parseSnippet(s);
      expect(join(s)).toBe([...s].filter((c) => c !== A && c !== B).join(""));
      for (const seg of segs) expect(seg.text).not.toMatch(/[\u0001\u0002]/);
      for (const seg of segs) expect(seg.text.length).toBeGreaterThan(0);
    }
  });
});

describe("search query", () => {
  it("round-trips the URL and rejects unknown channels", () => {
    const q = parseSearchQuery(new URLSearchParams("q=%20invoice%20&channel=email&contactId=c_1"));
    expect(q).toEqual({ q: "invoice", channel: "email", contactId: "c_1" });
    expect(toSearchParams(q).toString()).toBe("q=invoice&channel=email&contactId=c_1");
    expect(parseSearchQuery(new URLSearchParams("channel=fax")).channel).toBe("all");
  });
  it("builds the API url and enforces the minimum length", () => {
    expect(searchUrl({ q: "a b", channel: "all", contactId: null }, "cur")).toBe("/api/search?q=a+b&limit=30&cursor=cur");
    expect(canSearch(" a ")).toBe(false);
    expect(canSearch("ab")).toBe(true);
  });
});

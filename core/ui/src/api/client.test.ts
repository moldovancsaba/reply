import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson } from "./client";

const respond = (body: unknown, init: ResponseInit = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, ...init });
afterEach(() => vi.restoreAllMocks());

describe("fetchJson", () => {
  it("returns data on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ status: "ok" }));
    expect(await fetchJson("/api/health")).toEqual({ ok: true, data: { status: "ok" } });
  });

  it("parses the service error envelope", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ error: { code: "contact_not_found", message: "Gone.", requestId: "req_1", retryable: false, details: { mergedInto: "c2" } } }, { status: 404 }));
    expect(await fetchJson("/api/contacts/x")).toEqual({ ok: false, error: { code: "contact_not_found", message: "Gone.", requestId: "req_1", retryable: false, status: 404, details: { mergedInto: "c2" } } });
  });

  it("treats non-JSON answers as invalid_response, retryable only for server errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(respond("<html>proxy error</html>", { status: 502 })).mockResolvedValueOnce(respond("<html>nope</html>", { status: 200 }));
    const a = await fetchJson("/x");
    const b = await fetchJson("/x");
    expect(a).toMatchObject({ ok: false, error: { code: "invalid_response", status: 502, retryable: true } });
    expect(b).toMatchObject({ ok: false, error: { code: "invalid_response", retryable: false } });
  });

  it("treats an error body without an envelope as invalid_response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ oops: true }, { status: 500 }));
    expect(await fetchJson("/x")).toMatchObject({ ok: false, error: { code: "invalid_response", status: 500, retryable: true } });
  });

  it("reports a network failure as retryable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await fetchJson("/x")).toMatchObject({ ok: false, error: { code: "network_error", retryable: true } });
  });

  it("times out", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const r = await fetchJson("/slow", { timeoutMs: 30 });
    expect(r).toMatchObject({ ok: false, error: { code: "timeout", retryable: true } });
  });

  it("reports a caller's abort as aborted, not as an error to show", async () => {
    const c = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation((_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))));
    const p = fetchJson("/x", { signal: c.signal });
    c.abort();
    expect(await p).toMatchObject({ ok: false, error: { code: "aborted", retryable: false } });
  });

  it("sends JSON bodies with the right header and method", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(respond({ accepted: true }));
    await fetchJson("/api/sync/imessage", { method: "POST", body: { account: "" } });
    const [, init] = spy.mock.calls[0];
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "application/json" }, body: '{"account":""}' });
  });

  it("surfaces 304 as not_modified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));
    expect(await fetchJson("/x")).toMatchObject({ ok: false, error: { code: "not_modified", status: 304 } });
  });
});

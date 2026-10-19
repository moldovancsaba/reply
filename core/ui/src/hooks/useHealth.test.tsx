import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHealth } from "./useHealth";

const OK = { status: "ok", version: "0.1.0", uptimeSeconds: 1, home: "/h", time: "t" };
let up = true;
let calls = 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  up = true;
  calls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    calls++;
    if (!up) throw new TypeError("down");
    return new Response(JSON.stringify(OK), { status: 200 });
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const flush = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe("useHealth", () => {
  it("becomes up and polls every 15 seconds", async () => {
    const { result } = renderHook(() => useHealth());
    expect(result.current.state).toBe("unknown");
    await flush(0);
    expect(result.current.state).toBe("up");
    expect(result.current.health?.version).toBe("0.1.0");
    const before = calls;
    await flush(15_000);
    expect(calls).toBe(before + 1);
  });

  it("needs two failures in a row before reporting down, then backs off", async () => {
    const { result } = renderHook(() => useHealth());
    await flush(0);
    up = false;
    await flush(15_000); // first failure
    expect(result.current.state).toBe("up");
    await flush(4000); // second failure after the 4 s backoff
    expect(result.current.state).toBe("down");
    const n = calls;
    await flush(8000); // next try after 8 s, not sooner
    expect(calls).toBe(n + 1);
  });

  it("recovers and clears down", async () => {
    const { result } = renderHook(() => useHealth());
    await flush(0);
    up = false;
    await flush(15_000 + 4000);
    expect(result.current.state).toBe("down");
    up = true;
    await flush(30_000);
    expect(result.current.state).toBe("up");
  });

  it("retryNow checks immediately", async () => {
    const { result } = renderHook(() => useHealth());
    await flush(0);
    up = false;
    await flush(15_000 + 4000);
    expect(result.current.state).toBe("down");
    up = true;
    await act(async () => { result.current.retryNow(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBe("up");
  });

  it("does not poll while the tab is hidden and checks again when it is shown", async () => {
    const { result } = renderHook(() => useHealth());
    await flush(0);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    const n = calls;
    await flush(60_000);
    expect(calls).toBe(n);
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); });
    expect(calls).toBe(n + 1);
    expect(result.current.state).toBe("up");
  });

  it("stops polling when unmounted", async () => {
    const { unmount } = renderHook(() => useHealth());
    await flush(0);
    unmount();
    const n = calls;
    await flush(120_000);
    expect(calls).toBe(n);
  });
});

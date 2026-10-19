import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottled } from "./useThrottled";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useThrottled", () => {
  it("passes the first change at once, then at most one per interval with the newest value", () => {
    const { result, rerender } = renderHook(({ v }) => useThrottled(v, 5000), { initialProps: { v: 0 } });
    expect(result.current).toBe(0);
    rerender({ v: 1 });
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current).toBe(1);
    rerender({ v: 2 });
    rerender({ v: 3 });
    act(() => { vi.advanceTimersByTime(4000); });
    expect(result.current).toBe(1);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(result.current).toBe(3);
  });
});

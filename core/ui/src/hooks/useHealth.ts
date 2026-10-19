import { useEffect, useRef, useState } from "react";
import { fetchJson } from "../api/client";
import type { Health } from "../api/health";

export type HealthState = "unknown" | "up" | "down";

const OK_MS = 15_000;
const MAX_BACKOFF_MS = 30_000;

// Polls the service. "down" needs two failures in a row, so one slow answer never flashes a banner. Polling pauses
// while the tab is hidden and resumes (immediately) when it is shown again. Backoff: 2 s, 4 s, ... up to 30 s.
export function useHealth(): { state: HealthState; health: Health | null; retryNow: () => void } {
  const [state, setState] = useState<HealthState>("unknown");
  const [health, setHealth] = useState<Health | null>(null);
  const failures = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const schedule = (ms: number) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      if (cancelled) return;
      if (document.hidden) return schedule(OK_MS);
      const r = await fetchJson<Health>("/api/health", { timeoutMs: 3000, signal: controller.signal });
      if (cancelled) return;
      if (r.ok) {
        failures.current = 0;
        setHealth(r.data);
        setState("up");
        schedule(OK_MS);
      } else {
        failures.current += 1;
        if (failures.current >= 2) setState("down");
        schedule(Math.min(MAX_BACKOFF_MS, 2000 * 2 ** failures.current));
      }
    };
    tickRef.current = () => void tick();
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return { state, health, retryNow: () => tickRef.current() };
}

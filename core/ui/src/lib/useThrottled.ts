import { useEffect, useRef, useState } from "react";

// Passes `value` on at most once per `ms` (the newest value wins), so a live region does not chatter.
export function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (Object.is(value, out)) return; // nothing to pass on; the first change after this goes through at once
    const wait = Math.max(0, last.current + ms - Date.now());
    const t = window.setTimeout(() => { last.current = Date.now(); setOut(value); }, wait);
    return () => window.clearTimeout(t);
  }, [value, ms]); // `out` is deliberately not a dependency
  return out;
}

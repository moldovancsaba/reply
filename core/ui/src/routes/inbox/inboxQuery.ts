import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { InboxQuery } from "../../api/queries";

export const CHANNELS = ["all", "imessage", "email", "whatsapp"] as const;
const DEBOUNCE_MS = 250;

// /inbox?q=anna&channel=email  <->  { q, channel }. Unknown channel values fall back to "all".
export function parseInboxQuery(params: URLSearchParams): InboxQuery {
  const channel = params.get("channel") as InboxQuery["channel"] | null;
  return { q: (params.get("q") ?? "").trim().slice(0, 200), channel: channel && (CHANNELS as readonly string[]).includes(channel) ? channel : "all" };
}

export function toSearchParams(query: InboxQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.channel !== "all") p.set("channel", query.channel);
  return p;
}

// The URL is the source of truth so a reload or the back button keeps the filters. Typing updates the field at once
// and the URL (hence the request) after a short pause.
export function useInboxQuery() {
  const [params, setParams] = useSearchParams();
  const query = parseInboxQuery(params);
  const [draft, setDraft] = useState(query.q);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => setDraft(query.q), [query.q]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const update = useCallback((next: Partial<InboxQuery>, replace = true) => {
    setParams((prev) => toSearchParams({ ...parseInboxQuery(prev), ...next }), { replace });
  }, [setParams]);

  const setSearch = useCallback((value: string) => {
    setDraft(value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => update({ q: value.trim() }), DEBOUNCE_MS);
  }, [update]);

  const setChannel = useCallback((channel: InboxQuery["channel"]) => update({ channel }, false), [update]);
  const clear = useCallback(() => { window.clearTimeout(timer.current); setDraft(""); setParams(new URLSearchParams(), { replace: false }); }, [setParams]);
  const clearSearch = useCallback(() => { window.clearTimeout(timer.current); setDraft(""); update({ q: "" }, false); }, [update]);

  return { query, draft, setSearch, setChannel, clear, clearSearch, active: query.q !== "" || query.channel !== "all" };
}

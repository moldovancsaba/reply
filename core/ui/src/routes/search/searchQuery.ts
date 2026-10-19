import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { SearchQuery } from "../../api/queries";
import { canSearch } from "../../lib/snippet";

export const SEARCH_CHANNELS = ["all", "imessage", "email", "whatsapp"] as const;
const DEBOUNCE_MS = 300;
const AUTO_MIN = 3; // search-as-you-type starts at 3 characters; Enter searches from 2

export function parseSearchQuery(params: URLSearchParams): SearchQuery {
  const channel = params.get("channel") as SearchQuery["channel"] | null;
  const contactId = params.get("contactId");
  return { q: (params.get("q") ?? "").trim().slice(0, 200), channel: channel && (SEARCH_CHANNELS as readonly string[]).includes(channel) ? channel : "all", contactId: contactId ? contactId.slice(0, 80) : null };
}

export function toSearchParams(query: SearchQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (query.q) p.set("q", query.q);
  if (query.channel !== "all") p.set("channel", query.channel);
  if (query.contactId) p.set("contactId", query.contactId);
  return p;
}

export function useSearchState() {
  const [params, setParams] = useSearchParams();
  const query = parseSearchQuery(params);
  const [draft, setDraft] = useState(query.q);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => setDraft(query.q), [query.q]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const update = useCallback((next: Partial<SearchQuery>, replace: boolean) => {
    setParams((prev) => toSearchParams({ ...parseSearchQuery(prev), ...next }), { replace });
  }, [setParams]);

  const type = useCallback((value: string) => {
    setDraft(value);
    window.clearTimeout(timer.current);
    if (value.trim().length >= AUTO_MIN || value.trim() === "") timer.current = window.setTimeout(() => update({ q: value.trim() }, true), DEBOUNCE_MS);
  }, [update]);
  const submit = useCallback(() => { window.clearTimeout(timer.current); update({ q: draft.trim() }, false); }, [draft, update]);
  const setChannel = useCallback((channel: SearchQuery["channel"]) => update({ channel }, false), [update]);
  const clearScope = useCallback(() => update({ contactId: null }, false), [update]);
  const clearAll = useCallback(() => { window.clearTimeout(timer.current); setDraft(""); setParams(new URLSearchParams(), { replace: false }); }, [setParams]);
  return { query, draft, type, submit, setChannel, clearScope, clearAll, searchable: canSearch(query.q), tooShort: draft.trim().length > 0 && !canSearch(draft) };
}

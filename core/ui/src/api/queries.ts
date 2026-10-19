import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchJson, type ApiError, type Result } from "./client";
import type { Channel, Contact, ContactList, SearchResult, StatusReport, Thread } from "./types.gen";

// react-query wants thrown errors; the client returns Results. This is the bridge.
export class ApiFailure extends Error {
  constructor(public readonly error: ApiError) {
    super(error.message);
  }
}
async function unwrap<T>(result: Promise<Result<T>>): Promise<T> {
  const r = await result;
  if (!r.ok) throw new ApiFailure(r.error);
  return r.data;
}

export type InboxQuery = { q: string; channel: "all" | "imessage" | "email" | "whatsapp" };
export const PAGE_SIZE = 30;

export function contactsUrl(query: InboxQuery, cursor: string | null): string {
  const p = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (query.q) p.set("q", query.q);
  if (query.channel !== "all") p.set("channel", query.channel);
  if (cursor) p.set("cursor", cursor);
  return `/api/contacts?${p}`;
}

// Retry once, after 2 s, only for errors the service marks retryable.
const retryOnce = (count: number, err: unknown) => count < 1 && err instanceof ApiFailure && err.error.retryable;

export function useContactList(query: InboxQuery) {
  return useInfiniteQuery({
    queryKey: ["contacts", query],
    queryFn: ({ pageParam, signal }) => unwrap(fetchJson<ContactList>(contactsUrl(query, pageParam), { signal })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: retryOnce,
    retryDelay: 2000,
  });
}

// Fast while a source is importing, relaxed otherwise; react-query pauses it while the tab is hidden.
export const pollInterval = (status: StatusReport | undefined): number => (status?.connectors.some((c) => c.state === "syncing") ? 3000 : 30_000);

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => unwrap(fetchJson<StatusReport>("/api/status", { signal })),
    refetchInterval: (q) => pollInterval(q.state.data),
    retry: false,
    staleTime: 2000,
  });
}

export const syncConnector = (id: string) => fetchJson<{ accepted: boolean; runId: string; state: string }>(`/api/sync/${encodeURIComponent(id)}`, { method: "POST", body: {}, timeoutMs: 15_000 });
export const recheckSources = () => fetchJson<StatusReport>("/api/status/recheck", { method: "POST", body: {}, timeoutMs: 30_000 });

export function useContact(id: string) {
  return useQuery({
    queryKey: ["contact", id],
    queryFn: ({ signal }) => unwrap(fetchJson<Contact>(`/api/contacts/${encodeURIComponent(id)}`, { signal })),
    retry: retryOnce,
    retryDelay: 2000,
  });
}

export const THREAD_PAGE = 50;

// Newest page first; "before" pages walk back in time. The first page is refetched every 30 s while the tab is visible.
export function useThread(id: string, channel: Channel | "all") {
  return useInfiniteQuery({
    queryKey: ["thread", id, channel],
    queryFn: ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: String(THREAD_PAGE) });
      if (channel !== "all") p.set("channel", channel);
      if (pageParam) p.set("before", pageParam);
      return unwrap(fetchJson<Thread>(`/api/contacts/${encodeURIComponent(id)}/messages?${p}`, { signal }));
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 30_000,
    retry: retryOnce,
    retryDelay: 2000,
  });
}

export type MergeResult = { mergeLogId: string; movedHandles: string[]; movedMessages: number; targetContactId: string };
export type MergeHistoryItem = { id: string; ts: string; action: "merge" | "unmerge"; fromName: string; toName: string; handlesCount: number; revertedBy?: string };

export function useMerges(id: string) {
  return useQuery({
    queryKey: ["merges", id],
    queryFn: ({ signal }) => unwrap(fetchJson<{ items: MergeHistoryItem[] }>(`/api/contacts/${encodeURIComponent(id)}/merges`, { signal })),
    retry: retryOnce,
    retryDelay: 2000,
  });
}

// Merge and unmerge wait for the server (no optimistic update) and refresh everything that shows the affected people.
export const mergeContacts = (targetId: string, sourceContactId: string) =>
  fetchJson<MergeResult>(`/api/contacts/${encodeURIComponent(targetId)}/merge`, { method: "POST", body: { sourceContactId }, timeoutMs: 30_000 });
export const unmergeContacts = (contactId: string, mergeLogId: string) =>
  fetchJson<{ restoredContactId: string; restoredHandles: string[] }>(`/api/contacts/${encodeURIComponent(contactId)}/unmerge`, { method: "POST", body: { mergeLogId }, timeoutMs: 30_000 });

export function mergeErrorText(e: ApiError): string {
  switch (e.code) {
    case "cannot_merge_self": return "Choose a different contact.";
    case "contact_not_found": return "That contact no longer exists. It may already have been merged.";
    case "handle_conflict": {
      const handles = Array.isArray(e.details?.handles) ? (e.details.handles as unknown[]).map(String).join(", ") : "";
      return `A handle was moved elsewhere since this merge${handles ? ` (${handles})` : ""}. Undo the later merge first, then try again.`;
    }
    case "merge_already_reverted": return "This merge was already undone.";
    case "merge_not_found": return "That merge is no longer in the history.";
    default: return e.message;
  }
}

export type SearchQuery = { q: string; channel: "all" | Channel; contactId: string | null };

export function searchUrl(query: SearchQuery, cursor: string | null): string {
  const p = new URLSearchParams({ q: query.q, limit: String(PAGE_SIZE) });
  if (query.channel !== "all") p.set("channel", query.channel);
  if (query.contactId) p.set("contactId", query.contactId);
  if (cursor) p.set("cursor", cursor);
  return `/api/search?${p}`;
}

// Changing the query cancels the request in flight (react-query aborts through the signal) and ignores late answers;
// the previous results stay on screen until the new ones arrive.
export function useSearch(query: SearchQuery, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["search", query],
    queryFn: ({ pageParam, signal }) => unwrap(fetchJson<SearchResult>(searchUrl(query, pageParam), { signal })),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
    placeholderData: keepPreviousData,
    retry: retryOnce,
    retryDelay: 2000,
    staleTime: 30_000,
  });
}

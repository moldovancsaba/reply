import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { fetchJson, type ApiError, type Result } from "./client";
import type { Channel, Contact, ContactList, StatusReport, Thread } from "./types.gen";

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

export function useStatus() {
  return useQuery({
    queryKey: ["status"],
    queryFn: ({ signal }) => unwrap(fetchJson<StatusReport>("/api/status", { signal })),
    refetchInterval: 30_000,
    retry: false,
    staleTime: 15_000,
  });
}

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

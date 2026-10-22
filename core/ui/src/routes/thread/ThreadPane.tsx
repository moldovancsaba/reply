import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Anchor, CardTitle, ChoiceChip, GdsBox, GdsInline, GdsStack, InlineAlert, MetadataText, SectionTitle, SemanticButton, StateBlock } from "@sovereignsquad/gds";
import { ApiFailure, markRead, useContact, useStatus, useThread } from "../../api/queries";
import type { Channel } from "../../api/types.gen";
import { Composer } from "./Composer";
import { TimelineEntry } from "../../patterns/TimelineEntry";
import { CHANNEL_LABEL, exactLabel } from "../../lib/time";
import { groupByDay } from "./groupByDay";

const CHANNELS = ["all", "imessage", "email", "whatsapp"] as const;
type Filter = (typeof CHANNELS)[number];
const CONNECTORS: Record<Channel, string[]> = { imessage: ["imessage"], email: ["apple-mail", "imap"], whatsapp: ["whatsapp"] };

// GDS layout primitives take no `role`; this renders the log landmark the timeline needs.
const LogRegion = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function LogRegion(props, ref) {
  return <div ref={ref} role="log" {...props} />;
});

const timeOf = (iso: string) => new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(iso));

export type ProfileControl = { shown: boolean; toggle: () => void } | { href: string; open: () => void };

export function ThreadPane({ contactId, profile }: { contactId: string; profile: ProfileControl }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get("thread");
  const filter: Filter = raw && (CHANNELS as readonly string[]).includes(raw) ? (raw as Filter) : "all";
  const setFilter = (f: Filter) => setParams((p) => { const n = new URLSearchParams(p); if (f === "all") n.delete("thread"); else n.set("thread", f); return n; }, { replace: false });

  const qc = useQueryClient();
  const contact = useContact(contactId);
  const thread = useThread(contactId, filter);
  const status = useStatus();

  const ascending = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const page of thread.data?.pages ?? []) for (const m of page.items) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
    return out.reverse();
  }, [thread.data]);
  const items = useMemo(() => groupByDay(ascending), [ascending]);

  // ---- scroll: open at the newest message, keep the anchor when older ones are added, follow only when already at the bottom
  const bottom = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [pendingNew, setPendingNew] = useState(0);
  const firstId = useRef<string | null>(null);
  const newestId = useRef<string | null>(null);
  const opened = useRef("");
  const key = `${contactId}|${filter}`;

  // Whether the reader is at the bottom is tracked as they scroll, measured against the marker at the end of the messages (the Reply
  // box sits below it), so the answer is already known when a new message arrives and makes the pane taller.
  useEffect(() => {
    const end = bottom.current;
    if (!end) return;
    let pane: HTMLElement | null = end.parentElement;
    while (pane && !(pane.scrollHeight > pane.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(pane).overflowY))) pane = pane.parentElement;
    const target: HTMLElement | Window = pane ?? window;
    const measure = () => {
      const edge = pane ? pane.getBoundingClientRect().bottom : window.innerHeight;
      atBottom.current = end.getBoundingClientRect().bottom <= edge + 48;
      if (atBottom.current) setPendingNew(0);
    };
    target.addEventListener("scroll", measure, { passive: true });
    measure();
    return () => target.removeEventListener("scroll", measure);
  }, [ascending.length > 0]);

  const toBottom = useCallback(() => { bottom.current?.scrollIntoView({ block: "end" }); setPendingNew(0); }, []);

  useLayoutEffect(() => {
    if (ascending.length === 0) return;
    const first = ascending[0].id;
    const newest = ascending[ascending.length - 1].id;
    if (opened.current !== key) {
      opened.current = key; firstId.current = first; newestId.current = newest; toBottom();
      // Safari has not laid the pane out yet at this point and the first scroll lands short: once more after the first paint
      const again = requestAnimationFrame(() => { if (opened.current === key) toBottom(); });
      return () => cancelAnimationFrame(again);
    }
    if (first !== firstId.current && newest === newestId.current) {
      document.getElementById(`msg-${firstId.current}`)?.scrollIntoView({ block: "start" }); // older messages were added above
    } else if (newest !== newestId.current) {
      const at = ascending.findIndex((m) => m.id === newestId.current);
      const added = at === -1 ? 0 : ascending.length - 1 - at;
      if (atBottom.current) toBottom(); else if (added > 0) setPendingNew((n) => n + added);
    }
    firstId.current = first; newestId.current = newest;
  }, [ascending, key, toBottom]);

  // "Seen": once the newest message is on screen (the reader is at the bottom), clear the conversation's new-message count.
  const newest = ascending[ascending.length - 1]?.id;
  useEffect(() => {
    if (!newest || pendingNew > 0) return;
    const t = window.setTimeout(() => { void markRead(contactId).then((r) => { if (r.ok) void qc.invalidateQueries({ queryKey: ["contacts"] }); }); }, 800);
    return () => window.clearTimeout(t);
  }, [newest, pendingNew, contactId, qc]);

  // ---- states
  if (contact.isError) {
    const err = contact.error instanceof ApiFailure ? contact.error.error : null;
    if (err?.code === "contact_not_found") {
      const into = typeof err.details?.mergedInto === "string" ? err.details.mergedInto : null;
      return (
        <StateBlock
          variant="empty"
          title="This contact no longer exists"
          description="It may have been merged into another contact."
          action={<GdsInline gap="md"><Anchor href="/inbox">Back to Inbox</Anchor>{into ? <Anchor href={`/inbox/${into}`}>Open the merged contact</Anchor> : null}</GdsInline>}
        />
      );
    }
    return <StateBlock variant="error" title="This contact could not be loaded" description={err ? `${err.message}${err.requestId ? ` (reference ${err.requestId})` : ""}` : "Something went wrong."} action={<SemanticButton action="refresh" label="Try again" onClick={() => void contact.refetch()} />} />;
  }
  const name = contact.data?.displayName ?? "…";

  const blocked = filter === "all" ? [] : (status.data?.connectors ?? []).filter((c) => CONNECTORS[filter].includes(c.id) && (c.state === "blocked" || c.state === "error"));

  let body;
  if (thread.isPending || contact.isPending) {
    body = <StateBlock variant="loading" title="Loading messages" description="Reading your messages…" />;
  } else if (thread.isError && ascending.length === 0) {
    const err = thread.error instanceof ApiFailure ? thread.error.error : null;
    body = <StateBlock variant="error" title="Messages could not be loaded" description={err ? `${err.message}${err.requestId ? ` (reference ${err.requestId})` : ""}` : "Something went wrong."} action={<SemanticButton action="refresh" label="Try again" onClick={() => void thread.refetch()} />} />;
  } else if (ascending.length === 0) {
    body = filter === "all"
      ? <StateBlock variant="empty" title="No messages with this person yet" />
      : <StateBlock variant="empty" title={`No ${CHANNEL_LABEL[filter]} messages with ${name} yet.`} action={<SemanticButton action="reset" label="Show all channels" onClick={() => setFilter("all")} />} />;
  } else {
    body = (
      <GdsStack gap="md">
        {thread.hasNextPage ? (
          <SemanticButton action="refresh" loading={thread.isFetchingNextPage} disabled={thread.isFetchingNextPage} label="Load earlier messages" onClick={() => void thread.fetchNextPage()} />
        ) : <MetadataText>Start of the conversation</MetadataText>}
        {thread.isFetchNextPageError ? <InlineAlert severity="error" title="Earlier messages could not be loaded" action={<SemanticButton action="refresh" label="Try again" onClick={() => void thread.fetchNextPage()} />} /> : null}
        {thread.isRefetchError && !thread.isFetchNextPageError ? <InlineAlert severity="warning" title="Could not check for new messages" message="Showing what was loaded before." /> : null}
        <GdsStack component={LogRegion} aria-label={`Messages with ${name}`} gap="md">
          {items.map((it) =>
            it.type === "day" ? (
              <CardTitle key={`d-${it.key}`}>{it.label}</CardTitle>
            ) : (
              <div key={it.message.id} id={`msg-${it.message.id}`}>
                <TimelineEntry
                  id={it.message.id}
                  channel={it.message.channel}
                  isFromMe={it.message.isFromMe}
                  time={timeOf(it.message.ts)}
                  timeExact={exactLabel(it.message.ts)}
                  subject={it.message.subject}
                  text={it.message.text}
                  isSummary={it.message.isSummary}
                  attachments={it.message.attachments}
                  counterpartLabel={it.message.senderName ?? it.message.sender ?? name}
                />
              </div>
            ),
          )}
        </GdsStack>
        <GdsBox component="output">{pendingNew > 0 ? `${pendingNew} new ${pendingNew === 1 ? "message" : "messages"}` : ""}</GdsBox>
        {pendingNew > 0 ? <SemanticButton action="refresh" label={`${pendingNew} new ${pendingNew === 1 ? "message" : "messages"}`} onClick={toBottom} /> : null}
        <div ref={bottom} />
      </GdsStack>
    );
  }

  const c = contact.data;
  return (
    <GdsStack gap="md">
      <GdsStack gap="xs">
        <GdsInline gap="md" align="center" justify="between">
          <SectionTitle>{name}</SectionTitle>
{"toggle" in profile
            ? <SemanticButton action="users" label={profile.shown ? "Hide profile" : "Show profile"} variant="default" aria-pressed={profile.shown} onClick={profile.toggle} />
            : <Anchor href={profile.href} onClick={(e: React.MouseEvent) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); profile.open(); }}>Profile</Anchor>}
        </GdsInline>
        {c ? <MetadataText>{`${c.countTotal.toLocaleString("en-US")} ${c.countTotal === 1 ? "message" : "messages"}${(["imessage", "email", "whatsapp"] as const).filter((x) => c.counts[x] > 0).map((x) => ` · ${CHANNEL_LABEL[x]} ${c.counts[x].toLocaleString("en-US")}`).join("")}`}</MetadataText> : null}
        <GdsInline gap="xs">
          {CHANNELS.map((f) => <ChoiceChip key={f} label={f === "all" ? "All channels" : `Only ${CHANNEL_LABEL[f]}`} active={filter === f} onClick={() => setFilter(f)} />)}
        </GdsInline>
      </GdsStack>
      {blocked.map((b) => <InlineAlert key={b.id} severity="warning" title={`${b.label} is not syncing`} message={`${b.message} Newer messages may be missing.`} action={<Anchor href="/sources">Open Sources</Anchor>} />)}
      {body}
      {c ? <Composer contact={c} lastChannel={ascending[ascending.length - 1]?.channel ?? null} lastEmailSubject={[...ascending].reverse().find((m) => m.channel === "email" && m.subject)?.subject} /> : null}
    </GdsStack>
  );
}

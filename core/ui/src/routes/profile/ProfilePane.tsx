import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, BodyText, CardTitle, GdsBadge, GdsInline, GdsRelativeTime, GdsStack, InlineAlert, MetadataText, SearchableSelect, SectionTitle, SemanticButton, StateBlock, useGdsToasts } from "@sovereignsquad/gds";
import { ApiFailure, mergeContacts, mergeErrorText, unmergeContacts, useContact, useMerges, type MergeHistoryItem } from "../../api/queries";
import { fetchJson, type ApiError } from "../../api/client";
import type { Channel, ContactList, ContactListItem } from "../../api/types.gen";
import { ConfirmPanel } from "../../components/ConfirmPanel";
import { CHANNEL_LABEL, exactLabel, relativeParts } from "../../lib/time";

const ORIGIN = { apple_contacts: "From your address book", auto: "Created automatically from messages", manual: "Created by you" } as const;
const ICON = { imessage: "Message", email: "Mail", whatsapp: "Phone" } as const;
const KIND_CHANNEL: Record<string, Channel | "other"> = { phone: "imessage", email: "email", whatsapp: "whatsapp", other: "other" };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

export function ProfilePane({ contactId }: { contactId: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toasts = useGdsToasts();
  const [params, setParams] = useSearchParams();
  const contact = useContact(contactId);
  const merges = useMerges(contactId);

  const [source, setSource] = useState<ContactListItem | null>(null);
  const known = useRef(new Map<string, ContactListItem>()); // rows the picker has shown, for the confirmation text
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [undoError, setUndoError] = useState<ApiError | null>(null);
  const [undoTarget, setUndoTarget] = useState<MergeHistoryItem | null>(null);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["contacts"] }), qc.invalidateQueries({ queryKey: ["contact"] }), qc.invalidateQueries({ queryKey: ["thread"] }), qc.invalidateQueries({ queryKey: ["merges"] })]);

  const loadOptions = async (query: string) => {
    const p = new URLSearchParams({ limit: "20", includeEmpty: "true" });
    if (query.trim()) p.set("q", query.trim());
    const r = await fetchJson<ContactList>(`/api/contacts?${p}`);
    if (!r.ok) throw new Error(r.error.message);
    r.data.items.forEach((i) => known.current.set(i.id, i));
    return r.data.items.filter((i) => i.id !== contactId).map((i) => ({ value: i.id, label: `${i.displayName} (${plural(i.countTotal, "message", "messages")})` }));
  };

  const confirmMerge = async () => {
    if (!source || submitting) return;
    setSubmitting(true);
    setError(null);
    const r = await mergeContacts(contactId, source.id);
    setSubmitting(false);
    if (!r.ok) { setError(r.error); return; }
    const name = contact.data?.displayName ?? "this contact";
    await refresh();
    setSource(null);
    toasts.notifySuccess({
      title: `Merged ${source.displayName} into ${name}.`,
      message: "You can undo this for a short time here, and any time from Merge history.",
      autoCloseMs: 15_000,
      actions: [{ id: "undo", label: "Undo", onClick: () => navigate(`/inbox/${contactId}/profile?undo=${encodeURIComponent(r.data.mergeLogId)}`) }],
    });
    navigate(`/inbox/${contactId}`);
  };

  const undoId = params.get("undo");
  const fromHistory = undoTarget ?? (undoId ? (merges.data?.items.find((i) => i.id === undoId && i.action === "merge") ?? null) : null);
  const closeUndo = () => { setUndoTarget(null); setUndoError(null); if (undoId) setParams((p) => { const n = new URLSearchParams(p); n.delete("undo"); return n; }, { replace: true }); };
  const confirmUndo = async () => {
    if (!fromHistory || submitting) return;
    setSubmitting(true);
    setUndoError(null);
    const r = await unmergeContacts(contactId, fromHistory.id);
    setSubmitting(false);
    if (!r.ok) { setUndoError(r.error); return; }
    await refresh();
    closeUndo();
    toasts.notifySuccess({ title: `Undone: ${fromHistory.fromName} is a separate contact again.`, autoCloseMs: 8000 });
  };

  if (contact.isError) {
    const err = contact.error instanceof ApiFailure ? contact.error.error : null;
    return err?.code === "contact_not_found"
      ? <StateBlock variant="empty" title="This contact no longer exists" description="It may have been merged into another contact." action={<Anchor href="/inbox">Back to Inbox</Anchor>} />
      : <StateBlock variant="error" title="This profile could not be loaded" description={err?.message} action={<SemanticButton action="refresh" label="Try again" onClick={() => void contact.refetch()} />} />;
  }
  if (contact.isPending) return <StateBlock variant="loading" title="Loading profile" />;
  const c = contact.data;
  const byChannel = (["imessage", "email", "whatsapp", "other"] as const).map((ch) => ({ ch, handles: c.handles.filter((h) => KIND_CHANNEL[h.kind] === ch) })).filter((g) => g.handles.length > 0);

  return (
    <GdsStack gap="lg">
      <Anchor href={`/inbox/${contactId}`} onClick={(e: React.MouseEvent) => { e.preventDefault(); navigate(`/inbox/${contactId}`); }}>Back to conversation</Anchor>
      <GdsStack gap="xs">
        <SectionTitle>{c.displayName}</SectionTitle>
        <MetadataText>{ORIGIN[c.origin]}</MetadataText>
        <MetadataText>{`${plural(c.countTotal, "message", "messages")}${(["imessage", "email", "whatsapp"] as const).filter((x) => c.counts[x] > 0).map((x) => ` · ${CHANNEL_LABEL[x]} ${c.counts[x].toLocaleString("en-US")}`).join("")}`}</MetadataText>
      </GdsStack>

      <GdsStack gap="sm">
        <CardTitle>Handles</CardTitle>
        {byChannel.length === 0 ? <BodyText>No phone numbers or addresses are linked to this contact.</BodyText> : byChannel.map(({ ch, handles }) => (
          <GdsStack key={ch} gap="xs" component="ul" aria-label={`${ch === "other" ? "Other" : CHANNEL_LABEL[ch]} handles`}>
            {handles.map((h) => (
              <li key={h.value}>
                <GdsInline gap="sm" align="center">
                  {ch === "other" ? <GdsBadge tone="neutral" label="Other" /> : <GdsBadge tone="neutral" icon={ICON[ch]} label={CHANNEL_LABEL[ch]} />}
                  <BodyText>{h.label}</BodyText>
                  <MetadataText>{h.kind}</MetadataText>
                </GdsInline>
              </li>
            ))}
          </GdsStack>
        ))}
      </GdsStack>

      <GdsStack gap="sm">
        <CardTitle>Merge with another contact</CardTitle>
        <BodyText>Use this when two entries are the same person. Their numbers and addresses move here; you can undo it.</BodyText>
        <SearchableSelect
          value={source?.id ?? null}
          onChange={(v) => { setError(null); setSource(v ? (known.current.get(v) ?? null) : null); }}
          loadOptions={loadOptions}
          placeholder="Search for a contact to merge"
          noResultsLabel="No contacts match"
          clearable
        />
      </GdsStack>

      <GdsStack gap="sm">
        <CardTitle>Merge history</CardTitle>
        {merges.isPending ? <MetadataText>Loading history</MetadataText> : merges.isError ? (
          <InlineAlert severity="error" title="History could not be loaded" action={<SemanticButton action="refresh" label="Try again" onClick={() => void merges.refetch()} />} />
        ) : merges.data.items.length === 0 ? <BodyText>No merges yet.</BodyText> : (
          <GdsStack component="ul" gap="sm" aria-label="Merge history">
            {merges.data.items.map((m) => {
              const parts = relativeParts(m.ts);
              return (
                <li key={m.id}>
                  <GdsInline gap="sm" align="center" justify="between">
                    <GdsStack gap="xs">
                      <BodyText>{m.action === "merge" ? `Merged ${m.fromName} into ${m.toName}` : `Undid the merge of ${m.fromName} into ${m.toName}`}</BodyText>
                      <MetadataText>
                        {plural(m.handlesCount, "handle", "handles")} · <time dateTime={m.ts} title={exactLabel(m.ts)}><GdsRelativeTime value={parts.value} unit={parts.unit} numeric="auto" /></time>{m.revertedBy ? " · undone" : ""}
                      </MetadataText>
                    </GdsStack>
                    {m.action === "merge" && !m.revertedBy ? <SemanticButton action="reset" label="Undo" onClick={() => { setUndoError(null); setUndoTarget(m); }} /> : null}
                  </GdsInline>
                </li>
              );
            })}
          </GdsStack>
        )}
      </GdsStack>

      <ConfirmPanel
        id="merge-confirm"
        opened={source !== null}
        onClose={() => { if (!submitting) { setSource(null); setError(null); } }}
        onConfirm={() => void confirmMerge()}
        title="Merge contacts"
        confirmLabel="Merge"
        loading={submitting}
      >
        {source ? (
          <GdsStack gap="sm">
            <BodyText>{`Move ${plural(source.handles.length, "handle", "handles")} and ${plural(source.countTotal, "message", "messages")} from ${source.displayName} into ${c.displayName}?`}</BodyText>
            <MetadataText>{`${source.displayName} disappears from your list; its messages appear in ${c.displayName}'s conversation. You can undo this.`}</MetadataText>
            {error ? <InlineAlert severity="error" title="The merge did not happen" message={mergeErrorText(error)} /> : null}
          </GdsStack>
        ) : null}
      </ConfirmPanel>

      <ConfirmPanel
        id="undo-confirm"
        opened={fromHistory !== null}
        onClose={() => { if (!submitting) closeUndo(); }}
        onConfirm={() => void confirmUndo()}
        title="Undo merge"
        confirmLabel="Undo merge"
        loading={submitting}
      >
        {fromHistory ? (
          <GdsStack gap="sm">
            <BodyText>{`Make ${fromHistory.fromName} a separate contact again, taking back ${plural(fromHistory.handlesCount, "handle", "handles")} from ${fromHistory.toName}?`}</BodyText>
            {undoError ? <InlineAlert severity="error" title="The undo did not happen" message={mergeErrorText(undoError)} /> : null}
          </GdsStack>
        ) : null}
      </ConfirmPanel>
    </GdsStack>
  );
}

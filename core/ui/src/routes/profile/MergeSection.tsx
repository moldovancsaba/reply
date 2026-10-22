import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { BodyText, GdsBox, CardTitle, GdsInline, GdsRelativeTime, GdsStack, InlineAlert, MetadataText, SearchableSelect, SemanticButton, useGdsToasts } from "@sovereignsquad/gds";
import { dismissDuplicate, mergeContacts, useDuplicates, mergeErrorText, unmergeContacts, useMerges, type MergeHistoryItem } from "../../api/queries";
import { fetchJson, type ApiError } from "../../api/client";
import type { ContactList, ContactListItem } from "../../api/types.gen";
import { ConfirmPanel } from "../../components/ConfirmPanel";
import { exactLabel, relativeParts } from "../../lib/time";


const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

// What the confirmation needs to know about the entry that moves in; the picker and the suggestions both provide it.
type MergeSource = Pick<ContactListItem, "id" | "displayName" | "countTotal"> & { handles: unknown[] };

// Merge two entries into this one, and the merge history with undo (the identity API, see CORE_IDENTITY.md).
export function MergeSection({ contactId, name }: { contactId: string; name: string }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toasts = useGdsToasts();
  const [params, setParams] = useSearchParams();
  const merges = useMerges(contactId);

  const duplicates = useDuplicates(contactId);
  const [source, setSource] = useState<MergeSource | null>(null);
  const known = useRef(new Map<string, ContactListItem>()); // rows the picker has shown, for the confirmation text
  const [submitting, setSubmitting] = useState(false);
  const sending = useRef(false); // a second click can arrive before the re-render that disables the button (Safari does this)
  const done = useRef(new Set<string>()); // merges and undos already made: a late second click on the still-open dialog must not repeat them
  const [error, setError] = useState<ApiError | null>(null);
  const [undoError, setUndoError] = useState<ApiError | null>(null);
  const [undoTarget, setUndoTarget] = useState<MergeHistoryItem | null>(null);

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: ["contacts"] }), qc.invalidateQueries({ queryKey: ["contact"] }), qc.invalidateQueries({ queryKey: ["thread"] }), qc.invalidateQueries({ queryKey: ["merges"] }), qc.invalidateQueries({ queryKey: ["duplicates"] }), qc.invalidateQueries({ queryKey: ["profile"] })]);

  const loadOptions = async (query: string) => {
    const p = new URLSearchParams({ limit: "20", includeEmpty: "true" });
    if (query.trim()) p.set("q", query.trim());
    const r = await fetchJson<ContactList>(`/api/contacts?${p}`);
    if (!r.ok) throw new Error(r.error.message);
    r.data.items.forEach((i) => known.current.set(i.id, i));
    return r.data.items.filter((i) => i.id !== contactId).map((i) => ({ value: i.id, label: `${i.displayName} (${plural(i.countTotal, "message", "messages")})` }));
  };

  const notSame = async (otherId: string) => {
    const r = await dismissDuplicate(contactId, otherId);
    if (r.ok) await qc.invalidateQueries({ queryKey: ["duplicates"] });
    else toasts.notifyError({ title: "Could not save that", message: r.error.message });
  };

  const confirmMerge = async () => {
    if (!source || sending.current || done.current.has(`merge:${source.id}`)) return;
    sending.current = true;
    setSubmitting(true);
    setError(null);
    const r = await mergeContacts(contactId, source.id);
    sending.current = false;
    setSubmitting(false);
    if (!r.ok) { setError(r.error); return; }
    done.current.add(`merge:${source.id}`);
    
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
    if (!fromHistory || sending.current || done.current.has(`undo:${fromHistory.id}`)) return;
    sending.current = true;
    setSubmitting(true);
    setUndoError(null);
    const r = await unmergeContacts(contactId, fromHistory.id);
    sending.current = false;
    setSubmitting(false);
    if (!r.ok) { setUndoError(r.error); return; }
    done.current.add(`undo:${fromHistory.id}`);
    await refresh();
    closeUndo();
    toasts.notifySuccess({ title: `Undone: ${fromHistory.fromName} is a separate contact again.`, autoCloseMs: 8000 });
  };

  return (
    <GdsStack gap="lg">
      {(duplicates.data?.items ?? []).length > 0 ? (
        <GdsStack gap="sm">
          <CardTitle>Might be the same person</CardTitle>
          <GdsStack component="ul" gap="sm" aria-label="Suggested duplicates">
            {duplicates.data!.items.map((d) => (
              <GdsBox component="li" key={d.id}>
                <GdsInline gap="sm" align="center" justify="between">
                  <GdsStack gap="xs">
                    <BodyText>{d.displayName}</BodyText>
                    <MetadataText>{`${d.reason === "same_number" ? "Same number on another channel" : "Same name"} · ${plural(d.countTotal, "message", "messages")}`}</MetadataText>
                  </GdsStack>
                  <GdsInline gap="sm">
                    <SemanticButton action="reset" label="Not the same" onClick={() => void notSame(d.id)} />
                    <SemanticButton action="refresh" label="Review merge" onClick={() => { setError(null); setSource(d); }} />
                  </GdsInline>
                </GdsInline>
              </GdsBox>
            ))}
          </GdsStack>
        </GdsStack>
      ) : null}

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
                <GdsBox component="li" key={m.id}>
                  <GdsInline gap="sm" align="center" justify="between">
                    <GdsStack gap="xs">
                      <BodyText>{m.action === "merge" ? `Merged ${m.fromName} into ${m.toName}` : `Undid the merge of ${m.fromName} into ${m.toName}`}</BodyText>
                      <MetadataText>
                        {plural(m.handlesCount, "handle", "handles")} · <time dateTime={m.ts} title={exactLabel(m.ts)}><GdsRelativeTime value={parts.value} unit={parts.unit} numeric="auto" /></time>{m.revertedBy ? " · undone" : ""}
                      </MetadataText>
                    </GdsStack>
                    {m.action === "merge" && !m.revertedBy ? <SemanticButton action="reset" label="Undo" onClick={() => { setUndoError(null); setUndoTarget(m); }} /> : null}
                  </GdsInline>
                </GdsBox>
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
            <BodyText>{`Move ${plural(source.handles.length, "handle", "handles")} and ${plural(source.countTotal, "message", "messages")} from ${source.displayName} into ${name}?`}</BodyText>
            <MetadataText>{`${source.displayName} disappears from your list; its messages appear in ${name}'s conversation. You can undo this.`}</MetadataText>
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

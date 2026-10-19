import type { Channel } from "../../api/types.gen";

export type Draft = { text: string; channel: Channel; savedAt: number };
export const DRAFT_KEY = (contactId: string) => `rc.draft.${contactId}`;

// sessionStorage can be missing or full (private windows, blocked storage): every call is guarded and a failure only
// means the draft is not kept.
export function loadDraft(contactId: string): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY(contactId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    return typeof d.text === "string" && (d.channel === "imessage" || d.channel === "email" || d.channel === "whatsapp") ? { text: d.text, channel: d.channel, savedAt: Number(d.savedAt) || 0 } : null;
  } catch { return null; }
}
export function saveDraft(contactId: string, draft: Omit<Draft, "savedAt">): boolean {
  try {
    if (draft.text === "") { window.sessionStorage.removeItem(DRAFT_KEY(contactId)); return true; }
    window.sessionStorage.setItem(DRAFT_KEY(contactId), JSON.stringify({ ...draft, savedAt: Date.now() }));
    return true;
  } catch { return false; }
}
export function clearDraft(contactId: string) {
  try { window.sessionStorage.removeItem(DRAFT_KEY(contactId)); } catch { /* nothing to clear */ }
}

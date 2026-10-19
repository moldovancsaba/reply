import { useEffect, useRef, useState } from "react";
import { Anchor, BodyText, CardTitle, GdsInline, GdsStack, InlineAlert, MetadataText, Radio, SemanticButton, StateBlock, Select, Textarea, useGdsToasts } from "@sovereignsquad/gds";
import { fetchJson, type ApiError } from "../../api/client";
import type { Channel, Contact } from "../../api/types.gen";
import { CHANNEL_LABEL } from "../../lib/time";
import { clearDraft, loadDraft, saveDraft } from "./draftStore";
import { openFromGesture } from "./openLink";

export const APP_LABEL = { imessage: "Messages", email: "Mail", whatsapp: "WhatsApp" } as const;
export const PREFILL_LIMIT = 1500; // above this the service answers copy_and_open (see CORE_HANDOFF.md)

type Handoff = { handoffId: string; action: "open_url" | "copy_and_open"; url: string; channel: Channel; handleLabel: string; note: string };

const ERROR_TEXT: Record<string, string> = {
  no_handle_for_channel: "This person has no address for that channel any more. Pick another channel.",
  handle_not_owned: "That address does not belong to this person any more. Pick it again.",
  text_empty: "Write a message first.",
  text_too_long: "That message is too long (over 10,000 characters). Shorten it.",
  contact_not_found: "This contact no longer exists. It may have been merged into another one.",
};
const errorText = (e: ApiError) => ERROR_TEXT[e.code] ?? e.message;

export function Composer({ contact, lastChannel }: { contact: Contact; lastChannel: Channel | null }) {
  const toasts = useGdsToasts();
  const channels = contact.replyChannels ?? [];
  const draft = useRef(loadDraft(contact.id)).current;
  const initial = (c: Channel | null | undefined) => (channels.some((x) => x.channel === c) ? (c as Channel) : channels[0]?.channel);

  const [channel, setChannel] = useState<Channel | undefined>(initial(draft?.channel ?? lastChannel));
  const [text, setText] = useState(draft?.text ?? "");
  const [handle, setHandle] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState<ApiError | { message: string; code: string } | null>(null);
  const [saved, setSaved] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const alert = useRef<HTMLDivElement>(null);

  // the default follows the newest message until the person chooses (or a draft already chose)
  const chosen = useRef(draft !== null);
  useEffect(() => { if (!chosen.current) setChannel(initial(lastChannel)); }, [lastChannel]);

  useEffect(() => {
    if (!channel) return;
    const t = window.setTimeout(() => setSaved(saveDraft(contact.id, { text, channel }) && text !== ""), 400);
    return () => window.clearTimeout(t);
  }, [text, channel, contact.id]);

  useEffect(() => { if (error) alert.current?.focus(); }, [error]);

  if (channels.length === 0 || !channel) {
    return (
      <StateBlock
        variant="empty"
        title="No way to reach this person from here yet"
        description="Reply Core needs a phone number or email address for this contact to open a reply."
        action={<Anchor href={`/inbox/${contact.id}/profile`}>Open the profile</Anchor>}
      />
    );
  }
  const current = channels.find((c) => c.channel === channel)!;
  const target = current.handles.find((h) => h.value === handle) ?? current.handles.find((h) => h.default) ?? current.handles[0];
  const app = APP_LABEL[channel];
  const long = text.length > PREFILL_LIMIT;

  const open = async () => {
    if (status === "submitting") return;
    if (!text.trim()) { setStatus("error"); setError({ code: "text_empty", message: ERROR_TEXT.text_empty }); return; }
    setStatus("submitting");
    setError(null);
    const r = await fetchJson<Handoff>("/api/handoff", { method: "POST", body: { contactId: contact.id, channel, text, ...(current.handles.length > 1 ? { handle: target.value } : {}) }, timeoutMs: 10_000 });
    if (!r.ok) { setStatus("error"); setError(r.error); return; } // the text stays
    let copied = true;
    if (r.data.action === "copy_and_open") copied = await navigator.clipboard.writeText(text).then(() => true, () => false);
    openFromGesture(r.data.url);
    toasts.notifySuccess({
      title: r.data.note,
      message: (
        <>
          {r.data.action === "copy_and_open" ? (copied ? "Your text was copied; paste it in the message. " : "Could not copy. Select the text and copy it manually. ") : ""}
          {"Press send there; the message will appear here after the next sync. "}
          <Anchor href={r.data.url} rel="noopener noreferrer">{`Click here to open ${APP_LABEL[r.data.channel]} again`}</Anchor>
        </>
      ),
      autoCloseMs: 20_000,
    });
    clearDraft(contact.id);
    setText("");
    setSaved(false);
    setStatus("idle");
    window.setTimeout(() => area.current?.focus(), 0);
  };

  const copy = async () => {
    const ok = await navigator.clipboard.writeText(text).then(() => true, () => false);
    toasts.notifySuccess({ title: ok ? "Text copied." : "Could not copy. Select the text and copy it manually.", autoCloseMs: 4000 });
  };

  return (
    <GdsStack gap="sm" component="section" aria-label="Reply">
      <CardTitle>Reply</CardTitle>
      <Radio.Group
        label="Send through"
        value={channel}
        onChange={(v: string) => { chosen.current = true; setChannel(v as Channel); setHandle(null); }}
      >
        <GdsStack gap="xs">
          {channels.map((c) => {
            const h = c.handles.find((x) => x.default) ?? c.handles[0];
            return <Radio key={c.channel} value={c.channel} label={`${CHANNEL_LABEL[c.channel]} · ${h.label}`} />;
          })}
        </GdsStack>
      </Radio.Group>
      {current.handles.length > 1 ? (
        <Select label="Address" value={target.value} onChange={(v: string | null) => setHandle(v)} data={current.handles.map((h) => ({ value: h.value, label: h.label }))} allowDeselect={false} />
      ) : null}
      <Textarea
        ref={area}
        label="Message"
        description={long ? "Long messages will be copied to the clipboard instead of prefilled." : `${text.length.toLocaleString("en-US")} characters. Longer than ${PREFILL_LIMIT.toLocaleString("en-US")} will be copied instead of prefilled.`}
        value={text}
        readOnly={status === "submitting"}
        autosize
        minRows={3}
        maxRows={12}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.currentTarget.value)}
      />
      <MetadataText>{saved ? "Draft saved" : " "}</MetadataText>
      {error ? (
        <div ref={alert} tabIndex={-1}>
          <InlineAlert severity="error" title="Nothing was opened" message={errorText(error as ApiError)} action={status === "error" && error.code !== "text_empty" && (error as ApiError).retryable ? <SemanticButton action="refresh" label="Try again" onClick={() => void open()} /> : undefined} />
        </div>
      ) : null}
      <BodyText>{`To ${contact.displayName} through ${CHANNEL_LABEL[channel]} (${target.label}). Reply Core opens ${app} with your text; you press send there. Reply Core never sends anything itself.`}</BodyText>
      <GdsInline gap="sm">
        <SemanticButton action="send" label={`Open in ${app}`} loading={status === "submitting"} disabled={status === "submitting"} onClick={() => void open()} />
        <SemanticButton action="copy" label="Copy text" variant="default" disabled={text.trim() === ""} onClick={() => void copy()} />
      </GdsInline>
    </GdsStack>
  );
}

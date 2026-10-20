import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, BodyText, CardTitle, GdsBox, GdsInline, GdsStack, InlineAlert, MetadataText, Radio, SemanticButton, StateBlock, Select, Switch, Textarea, TextInput, useGdsToasts } from "@sovereignsquad/gds";
import { fetchJson, type ApiError } from "../../api/client";
import type { Channel, Contact } from "../../api/types.gen";
import { CHANNEL_LABEL } from "../../lib/time";
import { ConfirmPanel } from "../../components/ConfirmPanel";
import { recoverySteps } from "../sources/viewModel";
import { clearDraft, loadDraft, saveDraft } from "./draftStore";
import { DraftPanel } from "./DraftPanel";
import { openFromGesture } from "./openLink";

export const APP_LABEL = { imessage: "Messages", email: "Mail", whatsapp: "WhatsApp" } as const;
export const PREFILL_LIMIT = 1500; // above this the service answers copy_and_open (see CORE_HANDOFF.md)

type Sent = { sendId: string; status: "sent"; channel: Channel; handleLabel?: string; note: string; replayed?: boolean };
type Handoff = { handoffId: string; action: "open_url" | "copy_and_open"; url: string; channel: Channel; handleLabel: string; note: string };

const ERROR_TEXT: Record<string, string> = {
  no_handle_for_channel: "This person has no address for that channel any more. Pick another channel.",
  handle_not_owned: "That address does not belong to this person any more. Pick it again.",
  text_empty: "Write a message first.",
  text_too_long: "That message is too long. Shorten it (sending takes up to 4,000 characters, opening it in the app up to 10,000).",
  contact_not_found: "This contact no longer exists. It may have been merged into another one.",
};
const errorText = (e: ApiError) => ERROR_TEXT[e.code] ?? e.message;

const CONFIRM_KEY = "rc.send.confirm";
const readConfirm = () => { try { return window.localStorage.getItem(CONFIRM_KEY) !== "0"; } catch { return true; } };
const newAttemptId = () => crypto.randomUUID().replace(/-/g, "");

export function Composer({ contact, lastChannel, lastEmailSubject }: { contact: Contact; lastChannel: Channel | null; lastEmailSubject?: string }) {
  const toasts = useGdsToasts();
  const qc = useQueryClient();
  const replySubject = lastEmailSubject ? `Re: ${lastEmailSubject.replace(/^(re:\s*)+/i, "")}` : "";
  const [subject, setSubject] = useState(replySubject);
  const subjectTouched = useRef(false);
  useEffect(() => { if (!subjectTouched.current) setSubject(replySubject); }, [replySubject]); // the thread may load after the composer appears
  const [confirmBefore, setConfirmBefore] = useState(readConfirm);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<ApiError | null>(null);
  const attempt = useRef<string | null>(null); // one id per message, so a double click or a retry after a lost answer never sends twice
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

  const canSend = current.send.available;

  const askToSend = () => {
    if (!text.trim()) { setStatus("error"); setError({ code: "text_empty", message: ERROR_TEXT.text_empty }); return; }
    setSendError(null);
    if (confirmBefore) setConfirming(true); else void doSend();
  };

  const doSend = async () => {
    if (sending) return;
    attempt.current ??= newAttemptId();
    setSending(true);
    setSendError(null);
    const r = await fetchJson<Sent>("/api/send", {
      method: "POST", timeoutMs: 75_000, // the app's own 45 s plus up to 15 s of looking for the WhatsApp message
      body: { contactId: contact.id, channel, text, clientId: attempt.current, ...(current.handles.length > 1 ? { handle: target.value } : {}), ...(channel === "email" ? { subject } : {}) },
    });
    setSending(false);
    setConfirming(false);
    if (!r.ok) {
      // a lost answer (timeout, network) keeps the id: asking again replays the same attempt instead of sending twice
      if (r.error.code !== "timeout" && r.error.code !== "network_error") attempt.current = null;
      setSendError(r.error);
      return;
    }
    attempt.current = null;
    toasts.notifySuccess({ title: `${r.data.note.replace(/\.$/, "")} to ${contact.displayName}.`, message: "It appears in the conversation after the next sync, in a few seconds.", autoCloseMs: 8000 });
    clearDraft(contact.id);
    setText("");
    setSaved(false);
    window.setTimeout(() => area.current?.focus(), 400); // after the dialog has handed focus back to its button
    for (const delay of [4000, 14000]) window.setTimeout(() => { void qc.invalidateQueries({ queryKey: ["thread", contact.id] }); void qc.invalidateQueries({ queryKey: ["contacts"] }); void qc.invalidateQueries({ queryKey: ["profile", contact.id] }); }, delay);
  };

  const allowSending = async () => {
    const r = await fetchJson<{ opened: boolean }>("/api/send/consent", { method: "POST", body: {} });
    if (r.ok) toasts.notifySuccess({ title: "Look for a macOS window.", message: "It asks whether {reply} may control Messages, Mail and System Events. Choose Allow, then try again.", autoCloseMs: 12000 });
    else toasts.notifyError({ title: "Could not ask macOS", message: r.error.message });
  };

  const toggleConfirm = (v: boolean) => { setConfirmBefore(v); try { window.localStorage.setItem(CONFIRM_KEY, v ? "1" : "0"); } catch { /* the choice is just not remembered */ } };

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
        readOnly={status === "submitting" || sending}
        autosize
        minRows={3}
        maxRows={12}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.currentTarget.value)}
      />
      <MetadataText>{saved ? "Draft saved" : " "}</MetadataText>
      <DraftPanel contactId={contact.id} channel={channel} composerText={text} onInsert={(t) => { setText(t); window.setTimeout(() => area.current?.focus(), 0); }} />
      {error ? (
        <div ref={alert} tabIndex={-1}>
          <InlineAlert severity="error" title="Nothing was opened" message={errorText(error as ApiError)} action={status === "error" && error.code !== "text_empty" && (error as ApiError).retryable ? <SemanticButton action="refresh" label="Try again" onClick={() => void open()} /> : undefined} />
        </div>
      ) : null}
      {canSend && channel === "email" ? <TextInput label="Subject" maxLength={300} value={subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { subjectTouched.current = true; setSubject(e.currentTarget.value); }} /> : null}
      {sendError ? (
        <div tabIndex={-1} ref={(el) => el?.focus()}>
          <InlineAlert
            severity="error"
            title={sendError.code === "whatsapp_wrong_chat" ? "The message went to a different chat" : sendError.code === "send_timeout" || sendError.code === "send_unconfirmed" || (sendError.code === "already_attempted" && /may already/.test(sendError.message)) ? "The message may have been sent" : "The message was not sent"}
            message={sendError.message}
            action={
              <GdsStack gap="sm">
                {recoverySteps((sendError.details?.recovery as { order: number; text: string; deepLink?: string }[] | undefined)).length > 0 ? (
                  <GdsStack component="ol" gap="xs" aria-label="What to do">
                    {recoverySteps((sendError.details?.recovery as { order: number; text: string; deepLink?: string }[] | undefined)).map((st) => (
                      <GdsBox component="li" key={st.order}><BodyText>{st.text}</BodyText>{st.href ? <Anchor href={st.href}>{st.linkLabel}</Anchor> : null}</GdsBox>
                    ))}
                  </GdsStack>
                ) : null}
                <GdsInline gap="sm">
                  {sendError.code === "automation_denied" || sendError.code === "accessibility_denied" ? <SemanticButton action="settings" label="Allow {reply} to send" onClick={() => void allowSending()} /> : null}
                  {sendError.retryable || sendError.code === "network_error" || sendError.code === "timeout" ? <SemanticButton action="refresh" label="Try again" onClick={() => void doSend()} /> : null}
                </GdsInline>
              </GdsStack>
            }
          />
        </div>
      ) : null}
      <BodyText>
        {canSend
          ? `To ${contact.displayName} through ${CHANNEL_LABEL[channel]} (${target.label}). Send sends it now, through ${app} on this Mac.`
          : `To ${contact.displayName} through ${CHANNEL_LABEL[channel]} (${target.label}). ${current.send.reason ?? ""} Reply Core opens ${app} with your text; you press send there.`}
      </BodyText>
      <GdsInline gap="sm" align="center" wrap="wrap">
        {canSend ? <SemanticButton action="send" label="Send" loading={sending} disabled={sending || confirming} onClick={askToSend} /> : null}
        <SemanticButton action={canSend ? "message" : "send"} label={canSend ? `Open in ${app} instead` : `Open in ${app}`} variant={canSend ? "default" : undefined} loading={status === "submitting"} disabled={status === "submitting"} onClick={() => void open()} />
        <SemanticButton action="copy" label="Copy text" variant="default" disabled={text.trim() === ""} onClick={() => void copy()} />
      </GdsInline>
      {canSend ? <Switch label="Ask me before sending" checked={confirmBefore} onChange={(e: React.ChangeEvent<HTMLInputElement>) => toggleConfirm(e.currentTarget.checked)} /> : null}
      <ConfirmPanel id="send-confirm" opened={confirming} title="Send this message?" confirmLabel="Send" loading={sending} onConfirm={() => void doSend()} onClose={() => { if (!sending) setConfirming(false); }}>
        <GdsStack gap="sm">
          <BodyText>{`To ${contact.displayName} through ${CHANNEL_LABEL[channel]} (${target.label})`}</BodyText>
          {channel === "email" && subject ? <BodyText>{`Subject: ${subject}`}</BodyText> : null}
          <GdsStack gap="xs" aria-label="The message">{text.split("\n").filter((l) => l.trim()).map((l, i) => <BodyText key={i}>{l}</BodyText>)}</GdsStack>
          <MetadataText>It is sent now and cannot be taken back.</MetadataText>
        </GdsStack>
      </ConfirmPanel>
    </GdsStack>
  );
}

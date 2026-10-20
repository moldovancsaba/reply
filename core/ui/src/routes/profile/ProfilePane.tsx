import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, BodyText, GdsBadge, GdsBox, GdsGeneratedAvatar, GdsInline, GdsRelativeTime, GdsStack, InlineAlert, MetadataText, SectionPanel, SectionTitle, SemanticButton, StateBlock, Textarea, TextInput, useGdsToasts } from "@sovereignsquad/gds";
import { addNote, ApiFailure, deleteNote, saveProfile, useProfile } from "../../api/queries";
import type { ApiError } from "../../api/client";
import type { Channel, Profile } from "../../api/types.gen";
import { ConfirmPanel } from "../../components/ConfirmPanel";
import { CHANNEL_LABEL, exactLabel, relativeParts } from "../../lib/time";
import { MergeSection } from "./MergeSection";

const ORIGIN = { apple_contacts: "From your address book", auto: "Created automatically from messages", manual: "Created by you" } as const;
const ICON = { imessage: "Message", email: "Mail", whatsapp: "Phone" } as const;
const KIND_LABEL = { phone: "Phone number", email: "Email address", whatsapp: "WhatsApp number", other: "Other" } as const;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

const When = ({ iso }: { iso: string | null }) => {
  if (!iso) return <>never</>;
  const p = relativeParts(iso);
  return <time dateTime={iso} title={exactLabel(iso)}><GdsRelativeTime value={p.value} unit={p.unit} numeric="auto" /></time>;
};
const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(iso)) : "never");

// "1985-03-09" -> "9 March 1985", "--03-09" -> "9 March"
export function birthdayLabel(b: string, locale?: string): string {
  const m = /^(?:(\d{4})|-)-(\d{2})-(\d{2})$/.exec(b);
  if (!m) return b;
  const d = new Date(2000, Number(m[2]) - 1, Number(m[3]));
  return m[1] ? new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(d);
}

function Facts({ rows, label }: { rows: [string, React.ReactNode][]; label: string }) {
  return (
    <GdsStack component="dl" gap="sm" aria-label={label}>
      {rows.map(([k, v]) => (
        <GdsBox key={k}>
          <MetadataText component="dt">{k}</MetadataText>
          <BodyText component="dd">{v}</BodyText>
        </GdsBox>
      ))}
    </GdsStack>
  );
}

function Header({ p }: { p: Profile }) {
  const role = [p.profile.profession || p.card.jobTitle, p.profile.company || p.card.organization].filter(Boolean).join(" at ");
  return (
    <GdsInline gap="md" align="center" wrap="nowrap">
      <GdsBox aria-hidden="true"><GdsGeneratedAvatar name={p.displayName} size={64} /></GdsBox>
      <GdsStack gap="xs" minWidth="zero">
        <SectionTitle>{p.displayName}</SectionTitle>
        {role ? <BodyText>{role}</BodyText> : null}
        <GdsInline gap="xs" wrap="wrap">
          {p.profile.relationship ? <GdsBadge tone="neutral" label={p.profile.relationship} /> : null}
          <MetadataText>{ORIGIN[p.origin]}</MetadataText>
        </GdsInline>
      </GdsStack>
    </GdsInline>
  );
}

function DetailsForm({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const toasts = useGdsToasts();
  const [form, setForm] = useState(p.profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  useEffect(() => setForm(p.profile), [p.profile]);
  const dirty = (["profession", "company", "relationship", "linkedinUrl", "intro"] as const).some((k) => form[k] !== p.profile[k]);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.currentTarget.value });

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const r = await saveProfile(p.id, { profession: form.profession, company: form.company, relationship: form.relationship, linkedinUrl: form.linkedinUrl, intro: form.intro });
    setSaving(false);
    if (!r.ok) { setError(r.error); return; }
    await qc.invalidateQueries({ queryKey: ["profile", p.id] });
    toasts.notifySuccess({ title: "Profile saved.", autoCloseMs: 4000 });
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <GdsStack gap="sm">
        <TextInput label="Profession" maxLength={200} value={form.profession} onChange={set("profession")} />
        <TextInput label="Company" maxLength={200} value={form.company} onChange={set("company")} />
        <TextInput label="Relationship" description="For example client, friend, supplier." maxLength={100} value={form.relationship} onChange={set("relationship")} />
        <TextInput label="LinkedIn address" placeholder="https://www.linkedin.com/in/…" maxLength={300} value={form.linkedinUrl} onChange={set("linkedinUrl")} />
        <Textarea label="Intro" description="Who they are and how you know them." maxLength={2000} autosize minRows={2} maxRows={8} value={form.intro} onChange={set("intro")} />
        {error ? <InlineAlert severity="error" title="The profile was not saved" message={error.message} /> : null}
        <GdsInline gap="sm" align="center">
          <SemanticButton action="save" type="submit" loading={saving} disabled={!dirty || saving} />
          {!dirty && p.profile.updatedAt ? <MetadataText>Saved <When iso={p.profile.updatedAt} /></MetadataText> : null}
        </GdsInline>
      </GdsStack>
    </form>
  );
}

function AddressBook({ p }: { p: Profile }) {
  const c = p.card;
  const rows: [string, React.ReactNode][] = [];
  const fullName = [c.givenName, c.familyName].filter(Boolean).join(" ");
  if (fullName) rows.push(["Name", fullName]);
  if (c.nickname) rows.push(["Nickname", c.nickname]);
  if (c.organization) rows.push(["Organization", c.organization]);
  if (c.jobTitle) rows.push(["Job title", c.jobTitle]);
  if (c.department) rows.push(["Department", c.department]);
  if (c.birthday) rows.push(["Birthday", birthdayLabel(c.birthday)]);
  for (const [i, u] of (c.urls ?? []).entries()) rows.push([i === 0 ? "Web" : "Web " + (i + 1), /^https?:\/\//i.test(u) ? <Anchor href={u} target="_blank" rel="noopener noreferrer">{u}</Anchor> : u]);
  for (const [i, a] of (c.addresses ?? []).entries()) rows.push([i === 0 ? "Address" : `Address ${i + 1}`, a]);
  if (rows.length === 0) return <BodyText>{p.origin === "apple_contacts" ? "Your address book has no further details for this person." : "This person is not in your address book (or it has not been imported yet)."}</BodyText>;
  return <Facts rows={rows} label="Address book details" />;
}

function Members({ p }: { p: Profile }) {
  const navigate = useNavigate();
  return (
    <GdsStack component="ul" gap="sm" aria-label="Group members">
      {p.members.map((m) => (
        <GdsBox component="li" key={m.handle}>
          <GdsInline gap="sm" align="center" wrap="wrap">
            {m.contactId ? (
              <Anchor href={`/inbox/${m.contactId}`} onClick={(e: React.MouseEvent) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(`/inbox/${m.contactId}`); }}>{m.name}</Anchor>
            ) : <BodyText>{m.name}</BodyText>}
            {m.admin ? <GdsBadge tone="neutral" label="Admin" /> : null}
            <MetadataText>{plural(m.messages, "message", "messages") + " in this group"}</MetadataText>
          </GdsInline>
        </GdsBox>
      ))}
    </GdsStack>
  );
}

function Channels({ p }: { p: Profile }) {
  if (p.handles.length === 0) return <BodyText>No phone numbers or addresses are linked to this contact.</BodyText>;
  return (
    <GdsStack gap="sm">
      <GdsStack component="ul" gap="sm" aria-label="Phone numbers and addresses">
        {p.handles.map((h) => (
          <GdsBox component="li" key={h.value}>
            <GdsInline gap="sm" align="center" wrap="wrap">
              <BodyText>{h.label}</BodyText>
              <MetadataText>{`${KIND_LABEL[h.kind]} · ${plural(h.messages, "message", "messages")}${h.lastTs ? " · last " : ""}`}{h.lastTs ? <When iso={h.lastTs} /> : null}</MetadataText>
            </GdsInline>
          </GdsBox>
        ))}
      </GdsStack>
      {p.profile.linkedinUrl && /^https?:\/\//i.test(p.profile.linkedinUrl) ? <Anchor href={p.profile.linkedinUrl} target="_blank" rel="noopener noreferrer">LinkedIn profile</Anchor> : null}
    </GdsStack>
  );
}

function Activity({ p }: { p: Profile }) {
  const s = p.stats;
  if (s.total === 0) return <BodyText>No messages with this person yet.</BodyText>;
  return (
    <GdsStack gap="md">
      <Facts label="Activity" rows={[
        ["Messages", `${s.total.toLocaleString("en-US")} (${s.received.toLocaleString("en-US")} received, ${s.sent.toLocaleString("en-US")} sent)`],
        ["In touch since", day(s.firstTs)],
        ["Last message", <When key="l" iso={s.lastTs} />],
        ["Last heard from them", <When key="r" iso={s.lastReceivedTs} />],
        ["Last wrote to them", <When key="w" iso={s.lastSentTs} />],
        ["Last 30 days", plural(s.last30Days, "message", "messages")],
      ]} />
      <GdsStack component="ul" gap="xs" aria-label="Messages by channel">
        {(Object.keys(CHANNEL_LABEL) as Channel[]).filter((c) => s.byChannel[c].total > 0).map((c) => (
          <GdsBox component="li" key={c}>
            <GdsInline gap="sm" align="center" wrap="wrap">
              <GdsBadge tone="neutral" icon={ICON[c]} label={CHANNEL_LABEL[c]} />
              <MetadataText>{`${plural(s.byChannel[c].total, "message", "messages")} (${s.byChannel[c].received.toLocaleString("en-US")} received, ${s.byChannel[c].sent.toLocaleString("en-US")} sent) · since ${day(s.byChannel[c].firstTs)}`}</MetadataText>
            </GdsInline>
          </GdsBox>
        ))}
      </GdsStack>
    </GdsStack>
  );
}

function Notes({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const toasts = useGdsToasts();
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [doomed, setDoomed] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["profile", p.id] });

  const add = async () => {
    if (adding || !text.trim()) return;
    setAdding(true);
    setError(null);
    const r = await addNote(p.id, text);
    setAdding(false);
    if (!r.ok) { setError(r.error); return; }
    setText("");
    await refresh();
  };
  const remove = async () => {
    if (!doomed || deleting) return;
    setDeleting(true);
    const r = await deleteNote(p.id, doomed.id);
    setDeleting(false);
    if (!r.ok && r.error.code !== "note_not_found") { toasts.notifyError({ title: "The note was not deleted", message: r.error.message }); return; }
    setDoomed(null);
    await refresh();
  };

  return (
    <GdsStack gap="sm">
      <form onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <GdsStack gap="sm">
          <Textarea label="Add a note" description="Only you see notes; they stay on this Mac." maxLength={4000} autosize minRows={2} maxRows={8} value={text} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setText(e.currentTarget.value)} />
          {error ? <InlineAlert severity="error" title="The note was not added" message={error.message} /> : null}
          <GdsInline><SemanticButton action="add" label="Add note" type="submit" loading={adding} disabled={adding || !text.trim()} /></GdsInline>
        </GdsStack>
      </form>
      {p.notes.length === 0 ? <BodyText>No notes yet.</BodyText> : (
        <GdsStack component="ul" gap="sm" aria-label="Notes">
          {p.notes.map((n) => (
            <GdsBox component="li" key={n.id}>
              <GdsStack gap="xs">
                {n.text.split("\n").filter((l) => l.trim()).map((l, i) => <BodyText key={i}>{l}</BodyText>)}
                <GdsInline gap="sm" align="center" justify="between">
                  <MetadataText><When iso={n.createdAt} /></MetadataText>
                  <SemanticButton action="delete" label="Delete note" variant="default" onClick={() => setDoomed({ id: n.id, text: n.text })} />
                </GdsInline>
              </GdsStack>
            </GdsBox>
          ))}
        </GdsStack>
      )}
      <ConfirmPanel id="delete-note" opened={doomed !== null} title="Delete this note?" confirmLabel="Delete note" loading={deleting} onConfirm={() => void remove()} onClose={() => { if (!deleting) setDoomed(null); }}>
        <GdsStack gap="xs">
          <BodyText>This permanently deletes the note. It cannot be undone.</BodyText>
          {doomed ? <MetadataText>{doomed.text.length > 160 ? `${doomed.text.slice(0, 160)}…` : doomed.text}</MetadataText> : null}
        </GdsStack>
      </ConfirmPanel>
    </GdsStack>
  );
}

export function ProfilePane({ contactId, onBack }: { contactId: string; onBack?: () => void }) {
  const q = useProfile(contactId);
  if (q.isError) {
    const err = q.error instanceof ApiFailure ? q.error.error : null;
    return err?.code === "contact_not_found"
      ? <StateBlock variant="empty" title="This contact no longer exists" description="It may have been merged into another contact." action={<Anchor href="/inbox">Back to Inbox</Anchor>} />
      : <StateBlock variant="error" title="This profile could not be loaded" description={err?.message} action={<SemanticButton action="refresh" label="Try again" onClick={() => void q.refetch()} />} />;
  }
  if (q.isPending) return <StateBlock variant="loading" title="Loading profile" />;
  const p = q.data;
  return (
    <GdsStack gap="lg" component="section" aria-label={`Profile of ${p.displayName}`}>
      {onBack ? <Anchor href={`/inbox/${contactId}`} onClick={(e: React.MouseEvent) => { e.preventDefault(); onBack(); }}>Back to conversation</Anchor> : null}
      <Header p={p} />
      {p.mergedFrom.length > 0 ? <MetadataText>{`Also known as: ${p.mergedFrom.join(", ")} (merged in)`}</MetadataText> : null}
      {p.members.length > 0 ? (
        <SectionPanel title={`Members (${p.members.length})`}><Members p={p} /></SectionPanel>
      ) : (
        <>
          <SectionPanel title="Address book"><AddressBook p={p} /></SectionPanel>
          <SectionPanel title="How to reach them"><Channels p={p} /></SectionPanel>
        </>
      )}
      <SectionPanel title="Activity"><Activity p={p} /></SectionPanel>
      <SectionPanel title="Details you add"><DetailsForm p={p} /></SectionPanel>
      <SectionPanel title="Notes"><Notes p={p} /></SectionPanel>
      <SectionPanel title="Merge"><MergeSection contactId={contactId} name={p.displayName} /></SectionPanel>
    </GdsStack>
  );
}

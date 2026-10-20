import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Anchor, BannerNotice, BodyText, GdsBox, GdsInline, GdsRelativeTime, GdsStack, InlineAlert, MetadataText, PageHeader, SectionPanel, SemanticButton, StateBlock, StatusBadge, useGdsToasts } from "@sovereignsquad/gds";
import { ApiFailure, askConsent, recheckSources, syncConnector, useStatus } from "../api/queries";
import type { ConnectorStatus, RecoveryStep } from "../api/types.gen";
import { exactLabel, relativeParts } from "../lib/time";
import { useThrottled } from "../lib/useThrottled";
import { isFirstRun, recoverySteps, sourceView, summary } from "./sources/viewModel";

const when = (iso: string) => {
  const p = relativeParts(iso);
  return <time dateTime={iso} title={exactLabel(iso)}><GdsRelativeTime value={p.value} unit={p.unit} numeric="auto" /></time>;
};

function Steps({ steps }: { steps: RecoveryStep[] | undefined }) {
  const list = recoverySteps(steps);
  if (list.length === 0) return null;
  return (
    <GdsStack component="ol" gap="xs" aria-label="What to do">
      {list.map((s) => (
        <li key={s.order}>
          <BodyText>{s.text}</BodyText>
          {s.href ? <Anchor href={s.href}>{s.linkLabel}</Anchor> : null}
        </li>
      ))}
    </GdsStack>
  );
}

const CONSENT_TEXT = {
  sending: "It asks whether {reply} may control Messages, Mail and System Events, and for Accessibility. Choose Allow in each window.",
  contacts: "It asks whether {reply} may read your Contacts. Choose Allow, then press Recheck.",
};

function AllowButton({ kind, label }: { kind: "sending" | "contacts"; label: string }) {
  const toasts = useGdsToasts();
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    const r = await askConsent(kind);
    if (r.ok) toasts.notifySuccess({ title: "Look for a macOS window.", message: CONSENT_TEXT[kind], autoCloseMs: 12000 });
    else toasts.notifyError({ title: "Could not ask macOS", message: r.error.message });
    setBusy(false);
  };
  return <SemanticButton action="refresh" label={label} loading={busy} disabled={busy} onClick={() => void ask()} />;
}

function SourcePanel({ c, busy, onSync, onRecheck, rechecking }: { c: ConnectorStatus; busy: boolean; onSync: () => void; onRecheck: () => void; rechecking: boolean }) {
  const v = sourceView(c);
  const imported = useThrottled(c.messagesThisRun ?? 0, 5000);
  return (
    <SectionPanel
      title={c.label}
      action={<StatusBadge status={v.tone} withIcon>{v.label}</StatusBadge>}
    >
      <GdsStack gap="sm">
        <BodyText>{v.sentence}</BodyText>
        {c.state === "syncing" ? <GdsBox component="output">{`Imported ${imported.toLocaleString("en-US")} messages so far`}</GdsBox> : null}
        {c.state === "blocked" || c.state === "error" ? <Steps steps={c.recovery} /> : null}
        <MetadataText>
          {c.id === "contacts" ? `${c.messagesTotal.toLocaleString("en-US")} ${c.messagesTotal === 1 ? "person" : "people"}` : `${c.messagesTotal.toLocaleString("en-US")} ${c.messagesTotal === 1 ? "message" : "messages"}`}
          {c.lastSuccessAt ? <> · Last success {when(c.lastSuccessAt)}</> : null}
          {c.state === "error" && c.retryAt ? <> · Next attempt {when(c.retryAt)}</> : c.nextRunAt && c.state === "ok" ? <> · Next check {when(c.nextRunAt)}</> : null}
        </MetadataText>
        {(c.accounts ?? []).length > 0 ? (
          <GdsStack component="ul" gap="xs" aria-label={`${c.label} accounts`}>
            {c.accounts!.map((a) => (
              <li key={a.account}>
                <GdsInline gap="sm" align="center">
                  <StatusBadge status={sourceView(a).tone} withIcon>{sourceView(a).label}</StatusBadge>
                  <BodyText>{a.account}</BodyText>
                  <MetadataText>{a.state === "ok" ? `${a.messagesTotal.toLocaleString("en-US")} messages` : a.message}</MetadataText>
                </GdsInline>
              </li>
            ))}
          </GdsStack>
        ) : null}
        <GdsInline gap="sm">
          {c.id === "contacts" && (c.state === "blocked" || c.state === "error") ? <AllowButton kind="contacts" label="Allow {reply} to read Contacts" /> : null}
          {v.action === "recheck" ? <SemanticButton action="refresh" label="Recheck" loading={rechecking} disabled={rechecking} onClick={onRecheck} /> : null}
          {v.action !== "recheck" ? <SemanticButton action="refresh" label={c.state === "syncing" ? "Syncing…" : "Sync now"} loading={busy} disabled={busy || c.state === "syncing"} onClick={onSync} /> : null}
        </GdsInline>
      </GdsStack>
    </SectionPanel>
  );
}

export default function Sources() {
  const qc = useQueryClient();
  const toasts = useGdsToasts();
  const status = useStatus();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rechecking, setRechecking] = useState(false);
  const [announce, setAnnounce] = useState("");
  const previous = useRef<Map<string, string>>(new Map());

  // "iMessage is connected": said once when a source that was blocked or in error becomes ok.
  useEffect(() => {
    const now = new Map((status.data?.connectors ?? []).map((c) => [c.id, c.state]));
    const fixed = (status.data?.connectors ?? []).filter((c) => c.state === "ok" && ["blocked", "error"].includes(previous.current.get(c.id) ?? ""));
    if (fixed.length > 0) setAnnounce(fixed.map((c) => `${c.label} is connected.`).join(" "));
    previous.current = now as Map<string, string>;
  }, [status.data]);

  const sync = async (id: string, label: string) => {
    setBusy((b) => new Set(b).add(id));
    const r = await syncConnector(id);
    if (!r.ok && r.error.code !== "already_running") toasts.notifyError({ title: `${label} could not start`, message: r.error.code === "blocked" ? `${r.error.message} Follow the steps shown for this source, then recheck.` : r.error.message });
    await qc.invalidateQueries({ queryKey: ["status"] });
    setBusy((b) => { const n = new Set(b); n.delete(id); return n; });
  };
  const recheck = async () => {
    setRechecking(true);
    const r = await recheckSources();
    if (r.ok) qc.setQueryData(["status"], r.data); else toasts.notifyError({ title: "Recheck did not work", message: r.error.message });
    setRechecking(false);
  };

  const report = status.data;
  const connectors = report?.connectors ?? [];
  const infra = report ? [
    ...(report.storage.state === "error" ? [{ key: "storage", title: "Storage problem", message: report.storage.message, recovery: report.storage.recovery }] : []),
    ...(report.helper.state !== "ok" ? [{ key: "helper", title: report.helper.state === "missing" ? "The macOS helper is missing" : "The macOS helper was modified", message: "Reply Core cannot read Messages, Mail or Contacts without it.", recovery: undefined }] : []),
  ] : [];

  return (
    <>
      <PageHeader title="Sources" description={report ? summary(connectors) : "Checking your sources"} />
      <GdsStack gap="md">
        {report && isFirstRun(connectors) ? <BannerNotice severity="info" title="Connect a source to get started" message="Nothing is connected yet, so your inbox is empty. Follow the steps below for at least one source." /> : null}
        {infra.map((i) => <InlineAlert key={i.key} severity="error" title={i.title} message={i.message} action={<Steps steps={i.recovery} />} />)}
        <GdsBox component="output">{announce}</GdsBox>
        {status.isPending ? (
          <StateBlock variant="loading" title="Checking your sources" />
        ) : status.isError && !report ? (
          <StateBlock variant="error" title="Sources could not be checked" description={status.error instanceof ApiFailure ? status.error.error.message : undefined} action={<SemanticButton action="refresh" label="Try again" onClick={() => void status.refetch()} />} />
        ) : connectors.length === 0 ? (
          <StateBlock variant="empty" title="No sources are enabled" description="Enable a source in the Reply Core settings, then reload this page." />
        ) : (
          <>
            <GdsInline><SemanticButton action="refresh" label="Recheck all" loading={rechecking} disabled={rechecking} onClick={() => void recheck()} /></GdsInline>
            {status.isError ? <InlineAlert severity="warning" title="Could not refresh the status" message="Showing what was loaded before." /> : null}
            <SectionPanel title="Sending">
              <GdsStack gap="sm">
                <BodyText>To send from the Reply box, macOS must let {"{reply}"} control Messages, Mail and System Events (and Accessibility for WhatsApp). macOS lists {"{reply}"} in those settings only after it has asked.</BodyText>
                <GdsInline><AllowButton kind="sending" label="Allow {reply} to send" /></GdsInline>
              </GdsStack>
            </SectionPanel>
            {connectors.map((c) => <SourcePanel key={c.id} c={c} busy={busy.has(c.id)} rechecking={rechecking} onSync={() => void sync(c.id, c.label)} onRecheck={() => void recheck()} />)}
          </>
        )}
      </GdsStack>
    </>
  );
}

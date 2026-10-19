import type { ConnectorStatus, RecoveryStep, SourceState } from "../../api/types.gen";

export type Tone = "success" | "info" | "neutral" | "warning" | "danger";
export type SourceView = { label: string; tone: Tone; sentence: string; action: "sync" | "recheck" | "none" };

// state -> words, tone and the one recommended action. The tone is always shown together with the text and an icon.
export function sourceView(c: Pick<ConnectorStatus, "state" | "message">): SourceView {
  const views: Record<SourceState, SourceView> = {
    ok: { label: "Connected", tone: "success", sentence: "Messages are up to date.", action: "sync" },
    syncing: { label: "Syncing", tone: "info", sentence: "Importing messages now.", action: "none" },
    never_synced: { label: "Not synced yet", tone: "neutral", sentence: "Nothing has been imported from this source yet.", action: "sync" },
    error: { label: "Problem, will retry", tone: "warning", sentence: c.message || "The last attempt failed.", action: "sync" },
    blocked: { label: "Needs your attention", tone: "danger", sentence: c.message || "Reply Core cannot read this source.", action: "recheck" },
  };
  return views[c.state];
}

const ALLOWED_DEEP_LINK = /^x-apple\.systempreferences:/;
export const isAllowedDeepLink = (href: string | undefined): href is string => typeof href === "string" && ALLOWED_DEEP_LINK.test(href);

const PANES: [RegExp, string][] = [[/Privacy_AllFiles/i, "Full Disk Access"], [/Privacy_Contacts/i, "Contacts"], [/Privacy_Automation/i, "Automation"], [/Privacy_Accessibility/i, "Accessibility"]];
export const deepLinkLabel = (href: string) => `Open ${PANES.find(([re]) => re.test(href))?.[1] ?? "System"} settings`;

// Ordered steps; a link only survives if it is an allowed System Settings link.
export function recoverySteps(steps: RecoveryStep[] | undefined): { order: number; text: string; href?: string; linkLabel?: string }[] {
  return [...(steps ?? [])].sort((a, b) => a.order - b.order).map((s) => (isAllowedDeepLink(s.deepLink) ? { order: s.order, text: s.text, href: s.deepLink, linkLabel: deepLinkLabel(s.deepLink) } : { order: s.order, text: s.text }));
}

export const isFirstRun = (connectors: ConnectorStatus[]) => connectors.length > 0 && connectors.every((c) => c.state !== "ok" && c.messagesTotal === 0);

export function summary(connectors: ConnectorStatus[]): string {
  if (connectors.length === 0) return "No sources are enabled.";
  const bad = connectors.filter((c) => c.state === "blocked" || c.state === "error").length;
  if (bad > 0) return `${bad} of ${connectors.length} ${connectors.length === 1 ? "source needs" : "sources need"} attention.`;
  if (connectors.every((c) => c.state === "ok")) return "All sources are connected.";
  return "Your sources are getting ready.";
}

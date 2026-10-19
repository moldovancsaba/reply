const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31_536_000], ["month", 2_592_000], ["week", 604_800], ["day", 86_400], ["hour", 3600], ["minute", 60], ["second", 1]];

// The largest whole unit: 5 minutes ago -> { value: -5, unit: "minute" }.
export function relativeParts(iso: string, now: number = Date.now()): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  for (const [unit, size] of UNITS) if (Math.abs(seconds) >= size || unit === "second") return { value: Math.trunc(seconds / size), unit };
  return { value: 0, unit: "second" };
}

export function relativeLabel(iso: string, now: number = Date.now(), locale?: string): string {
  const { value, unit } = relativeParts(iso, now);
  if (unit === "second" && Math.abs(value) < 45) return "just now";
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(value, unit);
}

export function exactLabel(iso: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "full", timeStyle: "short" }).format(new Date(iso));
}

export const CHANNEL_LABEL = { imessage: "iMessage", email: "Email", whatsapp: "WhatsApp" } as const;

// ["iMessage"] -> "iMessage"; two -> "iMessage and Email"; three -> "iMessage, Email and WhatsApp".
export function listOf(items: string[]): string {
  return items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

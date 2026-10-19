import type { ThreadMessage } from "../../api/types.gen";

export type TimelineItem = { type: "day"; key: string; label: string } | { type: "message"; message: ThreadMessage };

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function dayLabel(key: string, now: Date = new Date(), locale?: string): string {
  const today = localDay(now.toISOString());
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: "full" }).format(new Date(y, m - 1, d, 12));
}

// Messages oldest to newest in; a day heading before the first message of each local day out.
export function groupByDay(ascending: ThreadMessage[], now: Date = new Date(), locale?: string): TimelineItem[] {
  const out: TimelineItem[] = [];
  let day = "";
  for (const message of ascending) {
    const key = localDay(message.ts);
    if (key !== day) {
      out.push({ type: "day", key, label: dayLabel(key, now, locale) });
      day = key;
    }
    out.push({ type: "message", message });
  }
  return out;
}

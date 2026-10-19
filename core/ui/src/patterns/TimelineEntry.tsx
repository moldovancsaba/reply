import { memo } from "react";
import { AccentPanel, BodyText, GdsBadge, GdsBox, GdsColumnGrid, GdsColumnGridItem, GdsInline, GdsStack, LabelText, MetadataText } from "@sovereignsquad/gds";
import type { Channel } from "../api/types.gen";
import { CHANNEL_LABEL, isAttachmentOnly } from "../lib/time";

// Local pattern contract (GDS PATTERN_SERVICE_MODEL): composed from governed primitives only; candidate for promotion to GDS.
export type TimelineEntryProps = {
  id: string;
  channel: Channel;
  isFromMe: boolean;
  time: string;
  timeExact: string;
  subject?: string;
  text: string;
  isSummary?: boolean;
  attachments: { name?: string; mimeType?: string; bytes?: number }[];
  counterpartLabel: string;
};

const ICON = { imessage: "Message", email: "Mail", whatsapp: "Phone" } as const;

export function entryName(p: Pick<TimelineEntryProps, "channel" | "isFromMe" | "counterpartLabel" | "timeExact">): string {
  return p.isFromMe ? `${CHANNEL_LABEL[p.channel]} sent by you, ${p.timeExact}` : `${CHANNEL_LABEL[p.channel]} from ${p.counterpartLabel}, ${p.timeExact}`;
}

export function sizeLabel(bytes?: number): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Text only: React escapes everything, nothing is turned into links or markup.
export const TimelineEntry = memo(function TimelineEntry(p: TimelineEntryProps) {
  const lines = (isAttachmentOnly(p.text) && p.attachments.length > 0 ? "" : p.text).split("\n").filter((l) => l.trim() !== "");
  return (
    <GdsColumnGrid columns={12}>
      <GdsColumnGridItem span={{ base: 11, md: 9 }} start={p.isFromMe ? { base: 2, md: 4 } : 1}>
      <GdsBox component="article" aria-label={entryName(p)}>
        <AccentPanel tone={p.isFromMe ? "violet" : "gray"} variant="subtle">
        <GdsStack gap="xs">
          <GdsInline gap="sm" align="center">
            <GdsBadge tone="neutral" icon={ICON[p.channel]} label={CHANNEL_LABEL[p.channel]} />
            <LabelText>{p.isFromMe ? "You" : p.counterpartLabel}</LabelText>
            <MetadataText>{p.time}</MetadataText>
            {p.isSummary ? <MetadataText>Email summary</MetadataText> : null}
          </GdsInline>
          {p.subject ? <LabelText>{p.subject}</LabelText> : null}
          {lines.map((l, i) => <BodyText key={i}>{l}</BodyText>)}
          {p.attachments.map((a, i) => (
            <MetadataText key={i}>{`Attachment: ${[a.name ?? "unnamed", sizeLabel(a.bytes)].filter(Boolean).join(" · ")} (not downloadable)`}</MetadataText>
          ))}
        </GdsStack>
        </AccentPanel>
      </GdsBox>
      </GdsColumnGridItem>
    </GdsColumnGrid>
  );
});

import { memo } from "react";
import { BodyText, GdsBadge, GdsBox, GdsColumnGrid, GdsColumnGridItem, GdsInline, GdsStack, LabelText, MetadataText } from "@sovereignsquad/gds";
import type { Channel } from "../api/types.gen";
import { CHANNEL_LABEL } from "../lib/time";

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
  const lines = p.text.split("\n").filter((l) => l.trim() !== "");
  return (
    <GdsColumnGrid columns={12}>
      <GdsColumnGridItem span={{ base: 11, md: 9 }} start={p.isFromMe ? { base: 2, md: 4 } : 1}>
      <GdsBox component="article" aria-label={entryName(p)} padding="sm">
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
            <MetadataText key={i}>{`Attachment: ${[a.name ?? "unnamed", a.mimeType, sizeLabel(a.bytes)].filter(Boolean).join(", ")} (not downloadable)`}</MetadataText>
          ))}
        </GdsStack>
      </GdsBox>
      </GdsColumnGridItem>
    </GdsColumnGrid>
  );
});

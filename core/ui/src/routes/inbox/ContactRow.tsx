import { useNavigate } from "react-router-dom";
import { AccentPanel, Anchor, BodyText, GdsBadge, GdsBox, GdsGeneratedAvatar, GdsInline, GdsRelativeTime, GdsStack, MetadataText } from "@sovereignsquad/gds";
import type { Channel, ContactListItem } from "../../api/types.gen";
import { CHANNEL_LABEL, exactLabel, readablePreview, relativeParts } from "../../lib/time";

const ICON = { imessage: "Message", email: "Mail", whatsapp: "Phone" } as const;

export function countsSentence(counts: ContactListItem["counts"]): string {
  const parts = (Object.keys(CHANNEL_LABEL) as Channel[]).filter((c) => counts[c] > 0).map((c) => `${counts[c].toLocaleString("en-US")} ${CHANNEL_LABEL[c]} ${counts[c] === 1 ? "message" : "messages"}`);
  return parts.join(", ");
}

export function ContactRow({ contact, selected }: { contact: ContactListItem; selected: boolean }) {
  const navigate = useNavigate();
  const href = `/inbox/${contact.id}`;
  const parts = contact.lastTs ? relativeParts(contact.lastTs) : null;
  const preview = contact.lastPreview ? `${contact.lastFromMe ? "You: " : ""}${readablePreview(contact.lastPreview)}` : "";
  return (
    <GdsBox component="li">
      <AccentPanel tone={selected ? "violet" : "gray"} variant={selected ? "subtle" : "soft-outline"}>
        <Anchor
          href={href}
          underline="never"
          c="inherit"
          aria-current={selected ? "page" : undefined}
          onClick={(e: React.MouseEvent) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            navigate(href);
          }}
        >
          {/* a row, not a 12-column grid: in a narrow list column 2 of 12 was thinner than the 40 px avatar and it overlapped the name */}
          <GdsInline gap="sm" align="start" wrap="nowrap">
            <GdsBox aria-hidden="true" style={{ flexShrink: 0 }}><GdsGeneratedAvatar name={contact.displayName} size={40} /></GdsBox>
            <GdsStack gap="xs" minWidth="zero">
              <BodyText>{contact.displayName}</BodyText>
              {preview ? <MetadataText>{preview.length > 140 ? `${preview.slice(0, 140)}…` : preview}</MetadataText> : null}
              <GdsInline gap="xs" wrap="wrap" align="center">
                {contact.unread > 0 ? <GdsBadge tone="info" label={`${contact.unread.toLocaleString("en-US")} new`} /> : null}
                {contact.lastChannel ? <GdsBadge tone="neutral" icon={ICON[contact.lastChannel]} label={CHANNEL_LABEL[contact.lastChannel]} /> : null}
                {contact.lastTs && parts ? (
                  <MetadataText>
                    <time dateTime={contact.lastTs} title={exactLabel(contact.lastTs)}>
                      <GdsRelativeTime value={parts.value} unit={parts.unit} numeric="auto" />
                    </time>
                  </MetadataText>
                ) : null}
              </GdsInline>
              <GdsInline gap="xs" wrap="wrap">
                <MetadataText>{countsSentence(contact.counts)}</MetadataText>
              </GdsInline>
            </GdsStack>
          </GdsInline>
        </Anchor>
      </AccentPanel>
    </GdsBox>
  );
}

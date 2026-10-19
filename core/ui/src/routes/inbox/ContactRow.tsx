import { useNavigate } from "react-router-dom";
import { Anchor, BodyText, GdsBadge, GdsBox, GdsGeneratedAvatar, GdsInline, GdsRelativeTime, GdsStack, MetadataText } from "@sovereignsquad/gds";
import type { Channel, ContactListItem } from "../../api/types.gen";
import { CHANNEL_LABEL, exactLabel, relativeParts } from "../../lib/time";

const ICON = { imessage: "Message", email: "Mail", whatsapp: "Phone" } as const;

export function countsSentence(counts: ContactListItem["counts"]): string {
  const parts = (Object.keys(CHANNEL_LABEL) as Channel[]).filter((c) => counts[c] > 0).map((c) => `${counts[c].toLocaleString("en-US")} ${CHANNEL_LABEL[c]} ${counts[c] === 1 ? "message" : "messages"}`);
  return parts.join(", ");
}

export function ContactRow({ contact, selected }: { contact: ContactListItem; selected: boolean }) {
  const navigate = useNavigate();
  const href = `/inbox/${contact.id}`;
  const parts = contact.lastTs ? relativeParts(contact.lastTs) : null;
  return (
    <GdsBox component="li">
      <Anchor
        href={href}
        aria-current={selected ? "page" : undefined}
        onClick={(e: React.MouseEvent) => {
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          navigate(href);
        }}
      >
        <GdsInline gap="md" align="start" wrap="nowrap">
          <GdsBox aria-hidden="true"><GdsGeneratedAvatar name={contact.displayName} size={40} /></GdsBox>
          <GdsStack gap="xs" minWidth="zero">
            <GdsInline justify="between" gap="sm" align="baseline">
              <BodyText>{contact.displayName}</BodyText>
              {contact.lastTs && parts ? (
                <MetadataText>
                  <time dateTime={contact.lastTs} title={exactLabel(contact.lastTs)}>
                    <GdsRelativeTime value={parts.value} unit={parts.unit} numeric="auto" />
                  </time>
                </MetadataText>
              ) : null}
            </GdsInline>
            {contact.lastPreview ? <MetadataText>{`${contact.lastFromMe ? "You: " : ""}${contact.lastPreview}`}</MetadataText> : null}
            <GdsInline gap="xs" wrap="wrap">
              {contact.lastChannel ? <GdsBadge tone="neutral" icon={ICON[contact.lastChannel]} label={CHANNEL_LABEL[contact.lastChannel]} /> : null}
              {(Object.keys(CHANNEL_LABEL) as Channel[]).filter((c) => contact.counts[c] > 0).map((c) => (
                <MetadataText key={c}>{`${contact.counts[c].toLocaleString("en-US")} ${CHANNEL_LABEL[c]}`}</MetadataText>
              ))}
            </GdsInline>
          </GdsStack>
        </GdsInline>
      </Anchor>
    </GdsBox>
  );
}

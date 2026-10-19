import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Anchor, ChoiceChip, DataToolbar, GdsColumnGrid, GdsColumnGridItem, GdsInline, GdsStack, PageHeader, SemanticButton, StateBlock, TextInput } from "@sovereignsquad/gds";
import { useMediaQuery } from "../lib/useMediaQuery";
import { CHANNEL_LABEL } from "../lib/time";
import { ProfilePane } from "./profile/ProfilePane";
import { ThreadPane } from "./thread/ThreadPane";
import { ConversationList } from "./inbox/ConversationList";
import { SourceNotice } from "./inbox/SourceNotice";
import { CHANNELS, useInboxQuery } from "./inbox/inboxQuery";

export default function Inbox() {
  const { contactId, section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMediaQuery("(min-width: 62em)");
  const { query, draft, setSearch, setChannel, clear, clearSearch, active } = useInboxQuery();

  const list = (
    <GdsStack gap="md">
      <DataToolbar
        searchSlot={<TextInput label="Search names" type="search" value={draft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.currentTarget.value)} />}
        filterSlot={
          <GdsInline gap="xs">
            {CHANNELS.map((c) => <ChoiceChip key={c} label={c === "all" ? "All" : CHANNEL_LABEL[c]} active={query.channel === c} onClick={() => setChannel(c)} />)}
          </GdsInline>
        }
        resetAction={active ? <SemanticButton action="reset" onClick={clear} label="Clear filters" /> : undefined}
        activeFilters={[
          ...(query.q ? [{ label: `Name: ${query.q}`, onRemove: clearSearch }] : []),
          ...(query.channel !== "all" ? [{ label: `Channel: ${CHANNEL_LABEL[query.channel]}`, onRemove: () => setChannel("all") }] : []),
        ]}
      />
      <SourceNotice />
      <ConversationList query={query} selectedId={contactId} active={active} onClear={clear} />
    </GdsStack>
  );
  const detail = contactId ? (
    section === "profile" ? <ProfilePane key={contactId} contactId={contactId} /> : <ThreadPane key={contactId} contactId={contactId} />
  ) : (
    <StateBlock variant="empty" title="Pick a conversation" description="Choose someone from the list to read your messages with them." />
  );

  // GdsSplit's inline grid-template-columns beats its own media query, so it never splits; a 12-column grid does.
  return (
    <>
      <PageHeader title="Inbox" description="Everyone you talk to, across every channel." />
      {!wide ? (
        contactId ? (
          <GdsStack gap="md">
            <Anchor href="/inbox" onClick={(e: React.MouseEvent) => { e.preventDefault(); navigate({ pathname: "/inbox", search: location.search }); }}>Back to conversations</Anchor>
            {detail}
          </GdsStack>
        ) : list
      ) : (
        <GdsColumnGrid columns={12} gap="lg">
          <GdsColumnGridItem span={4}>{list}</GdsColumnGridItem>
          <GdsColumnGridItem span={8}>{detail}</GdsColumnGridItem>
        </GdsColumnGrid>
      )}
    </>
  );
}

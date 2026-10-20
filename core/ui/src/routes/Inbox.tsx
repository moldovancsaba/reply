import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Anchor, ChoiceChip, DataToolbar, GdsBox, GdsColumnGrid, GdsColumnGridItem, GdsInline, GdsStack, OverflowContainer, PageHeader, SemanticButton, StateBlock, TextInput } from "@sovereignsquad/gds";
import { useMediaQuery } from "../lib/useMediaQuery";
import { CHANNEL_LABEL } from "../lib/time";
import { useProfile } from "../api/queries";
import { ProfilePane } from "./profile/ProfilePane";
import { ThreadPane } from "./thread/ThreadPane";
import { ConversationList } from "./inbox/ConversationList";
import { SourceNotice } from "./inbox/SourceNotice";
import { CHANNELS, useInboxQuery } from "./inbox/inboxQuery";

// Side by side, each pane scrolls on its own so the list stays in view while a long conversation is read.
const PANE_HEIGHT = "calc(100dvh - 9.5rem)";

export default function Inbox() {
  const { contactId, section } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const wide = useMediaQuery("(min-width: 62em)"); // list | conversation
  const huge = useMediaQuery("(min-width: 80em)"); // the sidebar takes about 14rem, so a third column needs this much room
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
  // Huge: list | conversation | profile (the profile column can be hidden and the choice is remembered). Wide: list |
  // conversation, and the profile page (/inbox/:id/profile) takes the conversation's place. Narrow: the list, the
  // conversation or the profile page, one at a time.
  const [profileShown, setProfileShown] = useState(() => { try { return window.localStorage.getItem("rc.profile.shown") !== "0"; } catch { return true; } });
  const toggleProfile = () => setProfileShown((v) => { try { window.localStorage.setItem("rc.profile.shown", v ? "0" : "1"); } catch { /* the choice is just not remembered */ } return !v; });
  const profileData = useProfile(contactId ?? "", contactId !== undefined); // shared with the column; an unknown contact gets no column
  const showProfileColumn = huge && contactId !== undefined && !profileData.isError && (profileShown || section === "profile");
  const profileLink = contactId ? `/inbox/${contactId}/profile` : "";

  const thread = contactId ? <ThreadPane key={contactId} contactId={contactId} profile={huge ? { shown: showProfileColumn, toggle: toggleProfile } : { href: profileLink, open: () => navigate(profileLink) }} /> : (
    <StateBlock variant="empty" title="Pick a conversation" description="Choose someone from the list to read your messages with them." />
  );
  const profile = contactId ? <ProfilePane key={contactId} contactId={contactId} onBack={huge ? undefined : () => navigate(`/inbox/${contactId}`)} /> : null;
  const detail = section === "profile" && !huge ? profile : thread;

  // GdsSplit's inline grid-template-columns beats its own media query, so it never splits; a 12-column grid does.
  return (
    <>
      <PageHeader title="Inbox" />
      {!wide ? (
        contactId ? (
          <GdsStack gap="md">
            <Anchor href="/inbox" onClick={(e: React.MouseEvent) => { e.preventDefault(); navigate({ pathname: "/inbox", search: location.search }); }}>Back to conversations</Anchor>
            {detail}
          </GdsStack>
        ) : list
      ) : (
        <GdsColumnGrid columns={12} gap="lg">
          <GdsColumnGridItem span={showProfileColumn ? 3 : huge ? 4 : 5}>
            <OverflowContainer maxHeight={PANE_HEIGHT} label="Conversations"><GdsBox padding="xs">{list}</GdsBox></OverflowContainer>
          </GdsColumnGridItem>
          <GdsColumnGridItem span={showProfileColumn ? 5 : huge ? 8 : 7}>
            <OverflowContainer maxHeight={PANE_HEIGHT} label={detail === profile && profile ? "Profile" : "Conversation"}><GdsBox padding="xs">{detail}</GdsBox></OverflowContainer>
          </GdsColumnGridItem>
          {showProfileColumn ? (
            <GdsColumnGridItem span={4}>
              <OverflowContainer maxHeight={PANE_HEIGHT} label="Profile"><GdsBox padding="xs">{profile}</GdsBox></OverflowContainer>
            </GdsColumnGridItem>
          ) : null}
        </GdsColumnGrid>
      )}
    </>
  );
}

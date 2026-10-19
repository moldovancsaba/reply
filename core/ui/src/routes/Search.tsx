import { Anchor, ChoiceChip, GdsBox, GdsInline, GdsRemovableTag, GdsStack, InlineAlert, MetadataText, PageHeader, SemanticButton, StateBlock, TextInput } from "@sovereignsquad/gds";
import { ApiFailure, useContact, useSearch, useStatus, type SearchQuery } from "../api/queries";
import type { Channel } from "../api/types.gen";
import { CHANNEL_LABEL, listOf } from "../lib/time";
import { SearchResults } from "./search/SearchResults";
import { SEARCH_CHANNELS, useSearchState } from "./search/searchQuery";

const CHANNEL_CONNECTORS: Record<Channel, string[]> = { imessage: ["imessage"], email: ["apple-mail", "imap"], whatsapp: ["whatsapp"] };
const ALL: Channel[] = ["imessage", "email", "whatsapp"];

export default function Search() {
  const { query, draft, type, submit, setChannel, clearScope, clearAll, searchable, tooShort } = useSearchState();
  const result = useSearch(query, searchable);
  const status = useStatus();
  const scope = useContact(query.contactId ?? "");

  const wanted: Channel[] = query.channel === "all" ? ALL : [query.channel];
  const connectors = status.data?.connectors ?? [];
  const problem = (ch: Channel) => connectors.filter((c) => CHANNEL_CONNECTORS[ch].includes(c.id));
  const notConnected = wanted.filter((ch) => problem(ch).length > 0 && problem(ch).every((c) => c.state === "never_synced" && c.messagesTotal === 0));
  const failing = wanted.filter((ch) => problem(ch).some((c) => c.state === "blocked" || c.state === "error"));
  const searched = wanted.filter((ch) => !notConnected.includes(ch));
  const active = query.q !== "" || query.channel !== "all" || query.contactId !== null;
  const err = result.isError ? (result.error instanceof ApiFailure ? result.error.error : null) : null;

  return (
    <>
      <PageHeader title="Search" description="Find a word or phrase in every message and email." />
      <GdsStack gap="md">
        <GdsBox component="search">
          <GdsStack gap="sm">
            <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
              <GdsInline gap="sm" align="end" wrap="wrap">
                <TextInput label="Search messages" type="search" value={draft} onChange={(e: React.ChangeEvent<HTMLInputElement>) => type(e.currentTarget.value)} />
                <SemanticButton action="search" type="submit" />
              </GdsInline>
            </form>
            {tooShort ? <MetadataText>Type at least 2 characters.</MetadataText> : null}
            <GdsInline gap="xs">
              {SEARCH_CHANNELS.map((c) => <ChoiceChip key={c} label={c === "all" ? "All channels" : `Only ${CHANNEL_LABEL[c]}`} active={query.channel === c} onClick={() => setChannel(c)} />)}
            </GdsInline>
            {query.contactId ? <GdsRemovableTag label={`In conversation with ${scope.data?.displayName ?? "…"}`} onRemove={clearScope} removeLabel="Remove conversation filter" /> : null}
            {active ? <GdsInline><SemanticButton action="reset" label="Clear filters" onClick={clearAll} /></GdsInline> : null}
          </GdsStack>
        </GdsBox>

        {[...notConnected.map((ch) => ({ ch, text: `${CHANNEL_LABEL[ch]} is not connected, so it was not searched.` })), ...failing.map((ch) => ({ ch, text: `${CHANNEL_LABEL[ch]} is not syncing, so recent messages may be missing from the results.` }))].map(({ ch, text }) => (
          <InlineAlert key={`${ch}-${text}`} severity="warning" title={text} action={<Anchor href="/sources">Open Sources</Anchor>} />
        ))}

        {!searchable ? (
          <StateBlock variant="info" title="Search your messages and email" description="Type at least 2 characters." />
        ) : result.isPending ? (
          <StateBlock variant="loading" title="Searching" description={`Searching ${listOf(searched.map((c) => CHANNEL_LABEL[c])) || "your messages"}…`} />
        ) : result.isError && !result.data ? (
          <StateBlock variant="error" title="The search did not work" description={err ? `${err.message}${err.requestId ? ` (reference ${err.requestId})` : ""}` : "Something went wrong."} action={<SemanticButton action="refresh" label="Try again" onClick={() => void result.refetch()} />} />
        ) : (
          <SearchResults query={query as SearchQuery} result={result} searched={searched} dimmed={result.isPlaceholderData} onClear={clearAll} filtered={query.channel !== "all" || query.contactId !== null} />
        )}
      </GdsStack>
    </>
  );
}

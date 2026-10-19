import { Anchor, GdsBox, GdsStack, MetadataText, SemanticButton, StateBlock } from "@sovereignsquad/gds";
import { ApiFailure, useContactList, type InboxQuery } from "../../api/queries";
import { ContactRow } from "./ContactRow";

export function ConversationList({ query, selectedId, active, onClear }: { query: InboxQuery; selectedId?: string; active: boolean; onClear: () => void }) {
  const list = useContactList(query);

  if (list.isPending) return <StateBlock variant="loading" title="Loading conversations" description="Reading your messages…" />;
  if (list.isError) {
    const err = list.error instanceof ApiFailure ? list.error.error : null;
    return (
      <StateBlock
        variant="error"
        title="Conversations could not be loaded"
        description={err ? `${err.message}${err.requestId ? ` (reference ${err.requestId})` : ""}` : "Something went wrong."}
        action={<SemanticButton action="refresh" label="Try again" onClick={() => void list.refetch()} />}
      />
    );
  }

  const items = list.data.pages.flatMap((p) => p.items);
  const total = list.data.pages[0]?.total ?? items.length;
  if (items.length === 0) {
    return active ? (
      <StateBlock variant="empty" title="No conversations match" description="Try a different name or channel." action={<SemanticButton action="reset" label="Clear filters" onClick={onClear} />} />
    ) : (
      <StateBlock variant="empty" title="No conversations yet" description="Connect a source to see your messages here." action={<Anchor href="/sources">Open Sources</Anchor>} />
    );
  }

  return (
    <GdsBox>
      <GdsBox component="output"><MetadataText>{`Showing ${items.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} ${total === 1 ? "conversation" : "conversations"}`}</MetadataText></GdsBox>
      <GdsStack component="ul" gap="xs" aria-label="Conversations">
        {items.map((c) => <ContactRow key={c.id} contact={c} selected={c.id === selectedId} />)}
      </GdsStack>
      {list.hasNextPage ? (
        <SemanticButton action="refresh" loading={list.isFetchingNextPage} label={list.isFetchingNextPage ? "Loading more" : "Load more"} onClick={() => void list.fetchNextPage()} />
      ) : null}
      {list.isFetchNextPageError ? <StateBlock compact variant="error" title="More conversations could not be loaded" /> : null}
    </GdsBox>
  );
}

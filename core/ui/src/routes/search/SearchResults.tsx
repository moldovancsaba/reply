import { Fragment } from "react";
import { useNavigate } from "react-router-dom";
import { Anchor, BodyText, GdsBadge, GdsBox, GdsGeneratedAvatar, GdsInline, GdsRelativeTime, GdsStack, InlineAlert, LabelText, MetadataText, SemanticButton, StateBlock } from "@sovereignsquad/gds";
import type { SearchQuery, useSearch } from "../../api/queries";
import type { Channel } from "../../api/types.gen";
import { CHANNEL_LABEL, exactLabel, listOf, relativeParts } from "../../lib/time";
import { parseSnippet } from "../../lib/snippet";

const ICON = { imessage: "Message", email: "Mail", whatsapp: "Phone" } as const;

// Marks come from parseSnippet segments: text nodes and <mark> elements, never HTML strings.
export function Snippet({ text }: { text: string }) {
  return (
    <BodyText>
      {parseSnippet(text).map((s, i) => (s.hit ? <mark key={i}>{s.text}</mark> : <Fragment key={i}>{s.text}</Fragment>))}
    </BodyText>
  );
}

export function SearchResults({ query, result, searched, dimmed, filtered, onClear }: {
  query: SearchQuery;
  result: ReturnType<typeof useSearch>;
  searched: Channel[];
  dimmed: boolean;
  filtered: boolean;
  onClear: () => void;
}) {
  const navigate = useNavigate();
  const seen = new Set<string>();
  const hits = (result.data?.pages ?? []).flatMap((p) => p.items).filter((h) => (seen.has(h.messageId) ? false : (seen.add(h.messageId), true)));
  const where = listOf(searched.map((c) => CHANNEL_LABEL[c])) || "your messages";

  if (hits.length === 0) {
    return (
      <StateBlock
        variant="empty"
        title={`No results for “${query.q}” in ${where}.`}
        description="Check the spelling or try fewer words."
        action={filtered ? <SemanticButton action="reset" label="Clear filters" onClick={onClear} /> : undefined}
      />
    );
  }
  return (
    <GdsStack gap="md" aria-busy={dimmed}>
      <GdsBox component="output">{`${hits.length.toLocaleString("en-US")}${result.hasNextPage ? "+" : ""} ${hits.length === 1 && !result.hasNextPage ? "result" : "results"} for “${query.q}”`}</GdsBox>
      <MetadataText>{`Searched ${where}`}</MetadataText>
      {result.isRefetchError ? <InlineAlert severity="warning" title="Could not refresh the results" message="Showing the previous results." /> : null}
      <GdsStack component="ul" gap="sm" aria-label="Search results">
        {hits.map((h) => {
          const parts = relativeParts(h.ts);
          const href = `/inbox/${h.contactId}`;
          return (
            <li key={h.messageId}>
              <Anchor href={href} onClick={(e: React.MouseEvent) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(href); }}>
                <GdsInline gap="md" align="start" wrap="nowrap">
                  <GdsBox aria-hidden="true"><GdsGeneratedAvatar name={h.contactName} size={40} /></GdsBox>
                  <GdsStack gap="xs" minWidth="zero">
                    <GdsInline gap="sm" align="center">
                      <LabelText>{h.contactName}</LabelText>
                      <GdsBadge tone="neutral" icon={ICON[h.channel]} label={CHANNEL_LABEL[h.channel]} />
                      <MetadataText><time dateTime={h.ts} title={exactLabel(h.ts)}><GdsRelativeTime value={parts.value} unit={parts.unit} numeric="auto" /></time></MetadataText>
                    </GdsInline>
                    <Snippet text={h.snippet} />
                  </GdsStack>
                </GdsInline>
              </Anchor>
            </li>
          );
        })}
      </GdsStack>
      {result.hasNextPage ? <SemanticButton action="refresh" loading={result.isFetchingNextPage} disabled={result.isFetchingNextPage} label={result.isFetchingNextPage ? "Loading more" : "Load more"} onClick={() => void result.fetchNextPage()} /> : null}
      {result.isFetchNextPageError ? <InlineAlert severity="error" title="More results could not be loaded" /> : null}
    </GdsStack>
  );
}

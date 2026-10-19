import { Anchor, InlineAlert, GdsStack } from "@sovereignsquad/gds";
import { useStatus } from "../../api/queries";

// Sources that are not working, said once above the list, so a short list is never mistaken for "no messages".
export function SourceNotice() {
  const { data } = useStatus();
  const bad = (data?.connectors ?? []).filter((c) => c.state !== "ok" && c.state !== "never_synced" && c.state !== "syncing");
  if (bad.length === 0) return null;
  return (
    <GdsStack gap="sm">
      {bad.map((c) => (
        <InlineAlert key={c.id} severity={c.state === "blocked" ? "warning" : "info"} title={`${c.label}: ${c.state === "blocked" ? "needs your attention" : "problem"}`}
          message={`${c.message} Messages from this source may be missing.`}
          action={<Anchor href="/sources">Open Sources</Anchor>}
        />
      ))}
    </GdsStack>
  );
}

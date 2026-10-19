import { PageHeader, StateBlock } from "@sovereignsquad/gds";

// Shown until each screen lands (the screen's own issue removes its placeholder).
export function Placeholder({ title, description, issue }: { title: string; description: string; issue: number }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <StateBlock variant="info" title={`${title} is not built yet`} description={`This screen arrives with issue #${issue}.`} />
    </>
  );
}

import { useNavigate } from "react-router-dom";
import { PageHeader, SemanticButton, StateBlock } from "@sovereignsquad/gds";

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Page not found" />
      <StateBlock variant="empty" title="This page does not exist" description="Check the address, or go back to your inbox."
        action={<SemanticButton action="dashboard" label="Go to Inbox" onClick={() => navigate("/inbox")} />} />
    </>
  );
}

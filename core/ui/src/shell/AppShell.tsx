import { Suspense, useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { AsyncSurface, DiscoveryShell, InlineAlert, GdsBadge, GdsIcon, GdsInline, SemanticButton, SidebarNav, SidebarNavItem, SidebarNavSection, BodyText } from "@sovereignsquad/gds";
import { Notices } from "./Notices";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { SkipLink } from "../components/SkipLink";
import { useStatus } from "../api/queries";
import { useHealth } from "../hooks/useHealth";
import { isFirstRun } from "../routes/sources/viewModel";
import { DESTINATIONS } from "./nav";

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { state, health, retryNow } = useHealth();

  // First run: when no source works yet, opening the app at /inbox leads to /sources once (never again after that, so
  // the user can still look at the empty inbox).
  const status = useStatus();
  const checkedFirstRun = useRef(false);
  useEffect(() => {
    if (checkedFirstRun.current || !status.data) return;
    checkedFirstRun.current = true;
    if (pathname === "/inbox" && isFirstRun(status.data.connectors)) navigate("/sources", { replace: true });
  }, [status.data, pathname, navigate]);

  return (
    <>
      <SkipLink />
      <DiscoveryShell
        mobileNavigationLabel="Open navigation"
        desktopNavigationLabel="Reply Core"
        sidebarStorageKey="reply-core.sidebar"
        header={
          <GdsInline justify="between" align="center">
            <BodyText>Reply Core</BodyText>
            {state === "up" ? <GdsBadge tone="success" icon="Check" label={health ? `Running v${health.version}` : "Running"} /> : null}
            {state === "down" ? <GdsBadge tone="danger" icon="Warning" label="Not running" /> : null}
          </GdsInline>
        }
        sidebar={
          <SidebarNav ariaLabel="Reply Core">
            <SidebarNavSection>
              {DESTINATIONS.map((d) => (
                <SidebarNavItem
                  key={d.path}
                  href={d.path}
                  label={d.label}
                  icon={<GdsIcon icon={d.icon} decorative />}
                  active={d.match(pathname)}
                  onClick={(e: React.MouseEvent) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; // let the browser open it in a new tab
                    e.preventDefault();
                    navigate(d.path);
                  }}
                />
              ))}
            </SidebarNavSection>
          </SidebarNav>
        }
      >
        {state === "down" ? (
          <InlineAlert
            severity="error"
            title="Reply Core is not running"
            message="Start it and this page will reconnect."
            action={<SemanticButton action="refresh" label="Retry now" onClick={retryNow} />}
          />
        ) : null}
        <Notices />
        <div id="main-content" tabIndex={-1} data-gds-main-content>
          <ErrorBoundary resetKey={pathname}>
            <Suspense fallback={<AsyncSurface state="loading" loadingTitle="Loading" loadingDescription="Loading this screen." />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </DiscoveryShell>
    </>
  );
}

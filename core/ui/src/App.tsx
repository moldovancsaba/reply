import { lazy } from "react";
import { GdsToastProvider, OverlayManagerProvider } from "@sovereignsquad/gds";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./shell/AppShell";

const Inbox = lazy(() => import("./routes/Inbox"));
const Search = lazy(() => import("./routes/Search"));
const Sources = lazy(() => import("./routes/Sources"));
const NotFound = lazy(() => import("./routes/NotFound"));

export function App() {
  return (
    <GdsToastProvider>
    <OverlayManagerProvider>
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/inbox" replace />} />
        <Route path="/inbox" element={<Inbox />} />
        <Route path="/inbox/:contactId" element={<Inbox />} />
        <Route path="/inbox/:contactId/:section" element={<Inbox />} />
        <Route path="/search" element={<Search />} />
        <Route path="/sources" element={<Sources />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </OverlayManagerProvider>
    </GdsToastProvider>
  );
}

// The GDS stylesheet must be imported exactly once, before any app code.
import "@sovereignsquad/gds-theme/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GdsProvider } from "@sovereignsquad/gds";
import { App } from "./App";
import { replyTheme } from "./theme/replyTheme";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: true, staleTime: 15_000 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GdsProvider defaultColorScheme="auto" theme={replyTheme}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </GdsProvider>
  </StrictMode>,
);

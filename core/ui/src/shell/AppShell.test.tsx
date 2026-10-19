import { render, screen, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { GdsProvider } from "@sovereignsquad/gds";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

const userEvent = userEventLib;
let healthy = true;

beforeEach(() => {
  healthy = true;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (!healthy) throw new TypeError("down");
    return new Response(JSON.stringify({ status: "ok", version: "0.1.0", uptimeSeconds: 1, home: "/h", time: "t" }), { status: 200 });
  });
});
afterEach(() => vi.restoreAllMocks());

const renderAt = (path: string) => render(<GdsProvider><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></GdsProvider>);

describe("app shell", () => {
  it("redirects / to the inbox and marks the active destination", async () => {
    renderAt("/");
    expect(await screen.findByRole("heading", { level: 1, name: "Inbox" })).toBeInTheDocument();
    const nav = screen.getAllByRole("navigation", { name: "Reply Core" })[0];
    expect(within(nav).getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Search" })).not.toHaveAttribute("aria-current");
  });

  it("keeps Inbox active on a contact deep link", async () => {
    renderAt("/inbox/c_123");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    const nav = screen.getAllByRole("navigation", { name: "Reply Core" })[0];
    expect(within(nav).getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
  });

  it("navigates with the sidebar and updates the page", async () => {
    const user = userEvent.setup();
    renderAt("/inbox");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    await user.click(screen.getAllByRole("link", { name: "Sources" })[0]);
    expect(await screen.findByRole("heading", { level: 1, name: "Sources" })).toBeInTheDocument();
  });

  it("shows a not-found state with a way back", async () => {
    renderAt("/nope");
    expect(await screen.findByText("This page does not exist")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go to Inbox/ })).toBeInTheDocument();
  });

  it("has one main landmark, a skip link as the first tab stop, and a focusable target", async () => {
    renderAt("/inbox");
    await screen.findByRole("heading", { level: 1, name: "Inbox" });
    expect(screen.getAllByRole("main")).toHaveLength(1);
    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveTextContent("Skip to content");
    expect(links[0]).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).toHaveAttribute("tabindex", "-1");
  });

  it("shows the not-running banner after the service stops answering, and removes it when it returns", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { act } = await import("@testing-library/react");
    renderAt("/inbox");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("Running v0.1.0")).toBeInTheDocument();
    expect(screen.queryByText("Reply Core is not running")).not.toBeInTheDocument();
    healthy = false;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000 + 4000); });
    expect(screen.getByRole("alert")).toHaveTextContent("Reply Core is not running");
    expect(screen.getByRole("button", { name: /Retry now/ })).toBeInTheDocument();
    healthy = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.queryByText("Reply Core is not running")).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});

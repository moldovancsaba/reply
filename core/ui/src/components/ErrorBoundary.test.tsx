import { render, screen } from "@testing-library/react";
import { GdsProvider } from "@sovereignsquad/gds";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error("kaboom");
  return <p>fine</p>;
}
afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary", () => {
  it("shows a GDS error state instead of a blank page, and logs to the console only", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<GdsProvider><ErrorBoundary><Boom explode /></ErrorBoundary></GdsProvider>);
    expect(screen.getByText("Something went wrong showing this screen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reload/ })).toBeInTheDocument();
    expect(log.mock.calls.some((c) => String(c[0]).includes("render error") && String(c[1]).includes("kaboom"))).toBe(true);
  });

  it("recovers when the route changes (resetKey)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { rerender } = render(<GdsProvider><ErrorBoundary resetKey="/a"><Boom explode /></ErrorBoundary></GdsProvider>);
    expect(screen.getByText("Something went wrong showing this screen")).toBeInTheDocument();
    rerender(<GdsProvider><ErrorBoundary resetKey="/b"><Boom explode={false} /></ErrorBoundary></GdsProvider>);
    expect(screen.getByText("fine")).toBeInTheDocument();
  });
});

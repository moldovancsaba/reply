import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GdsProvider } from "@sovereignsquad/gds";
import { describe, expect, it } from "vitest";
import { TimelineEntry, entryName, sizeLabel, type TimelineEntryProps } from "../../patterns/TimelineEntry";
import { dayLabel, groupByDay } from "./groupByDay";
import type { ThreadMessage } from "../../api/types.gen";

const m = (id: string, ts: string): ThreadMessage => ({ id, channel: "imessage", isFromMe: false, ts, text: id, attachments: [], counterpartHandle: "h" });

describe("groupByDay", () => {
  it("puts one heading before the first message of each local day", () => {
    const out = groupByDay([m("a", "2026-10-18T10:00:00"), m("b", "2026-10-18T11:00:00"), m("c", "2026-10-19T09:00:00")], new Date("2026-10-19T12:00:00"), "en-US");
    expect(out.map((i) => (i.type === "day" ? `# ${i.label}` : i.message.id))).toEqual(["# Yesterday", "a", "b", "# Today", "c"]);
  });
  it("labels older days with the full date", () => {
    expect(dayLabel("2026-10-01", new Date("2026-10-19T12:00:00"), "en-US")).toBe("Thursday, October 1, 2026");
  });
  it("is empty for no messages", () => expect(groupByDay([])).toEqual([]));
});

describe("TimelineEntry", () => {
  const base: TimelineEntryProps = { id: "1", channel: "email", isFromMe: false, time: "18:02", timeExact: "Monday, 18 October 2026 at 18:02", text: "<img src=x onerror=alert(1)>\n\nsecond", attachments: [{ name: "a.pdf", bytes: 5 * 1024 * 1024 }], counterpartLabel: "Anna Kovacs", isSummary: true };
  const wrap = (ui: React.ReactNode) => render(<GdsProvider>{ui}</GdsProvider>);

  it("names the entry by channel, direction and time, and renders text as text", () => {
    const { container } = wrap(<TimelineEntry {...base} />);
    expect(screen.getByRole("article", { name: entryName(base) })).toBeInTheDocument();
    expect(entryName({ ...base, isFromMe: true })).toBe("Email sent by you, Monday, 18 October 2026 at 18:02");
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(container.querySelector("img[src='x']")).toBeNull();
    expect(screen.getByText("Email summary")).toBeInTheDocument();
    expect(screen.getByText("Attachment: a.pdf · 5.0 MB (not downloadable)")).toBeInTheDocument();
  });

  it("formats sizes", () => expect([sizeLabel(1), sizeLabel(2048), sizeLabel(undefined)]).toEqual(["1 B", "2 KB", ""]));

  it("does not re-render when the parent re-renders with the same props", async () => {
    // attachments.map runs once per render of the entry, so counting calls counts renders
    let renders = 0;
    const attachments = [{ name: "a.pdf" }];
    const realMap = attachments.map.bind(attachments);
    attachments.map = ((...args: Parameters<typeof realMap>) => { renders += 1; return realMap(...args); }) as typeof attachments.map;
    const props = { ...base, attachments };
    function Parent() {
      const [n, setN] = useState(0);
      return (
        <>
          <button onClick={() => setN(n + 1)}>tick {n}</button>
          <TimelineEntry {...props} />
        </>
      );
    }
    wrap(<Parent />);
    const first = renders;
    expect(first).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(screen.getByRole("button"));
    expect(renders).toBe(first);
  });
});

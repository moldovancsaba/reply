import { describe, expect, it } from "vitest";
import { birthdayLabel } from "./ProfilePane";

describe("birthdayLabel", () => {
  it("shows the year when known and just day and month when not", () => {
    expect(birthdayLabel("1985-03-09", "en-GB")).toBe("9 March 1985");
    expect(birthdayLabel("--12-24", "en-GB")).toBe("24 December");
    expect(birthdayLabel("garbage")).toBe("garbage");
  });
});

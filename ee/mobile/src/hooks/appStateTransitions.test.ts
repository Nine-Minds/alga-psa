import { describe, expect, it } from "vitest";
import { isResumeTransition } from "./appStateTransitions";

describe("appStateTransitions", () => {
  it("detects background/inactive -> active transitions", () => {
    expect(isResumeTransition("inactive", "active")).toBe(true);
    expect(isResumeTransition("background", "active")).toBe(true);
    expect(isResumeTransition("active", "active")).toBe(false);
    expect(isResumeTransition("active", "background")).toBe(false);
  });
});


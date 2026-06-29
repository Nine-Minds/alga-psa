import { describe, expect, it } from "vitest";
import { workflowTaskGating } from "./workflowTaskGating";

const ME = "user-1";

describe("workflowTaskGating", () => {
  it("a task assigned directly to me needs no claim — complete straight away", () => {
    const g = workflowTaskGating({ status: "pending", assignedUsers: [ME], claimedBy: null }, ME);
    expect(g.assignedToMe).toBe(true);
    expect(g.canComplete).toBe(true);
    expect(g.showClaim).toBe(false);
    expect(g.showUnclaim).toBe(false);
  });

  it("a pending pool task (not assigned to me) requires claiming first", () => {
    const g = workflowTaskGating({ status: "pending", assignedUsers: [], claimedBy: null }, ME);
    expect(g.assignedToMe).toBe(false);
    expect(g.canComplete).toBe(false);
    expect(g.showClaim).toBe(true);
    expect(g.showUnclaim).toBe(false);
  });

  it("a pool task I've claimed can be completed and released", () => {
    const g = workflowTaskGating({ status: "claimed", assignedUsers: [], claimedBy: ME }, ME);
    expect(g.claimedByMe).toBe(true);
    expect(g.canComplete).toBe(true);
    expect(g.showClaim).toBe(false);
    expect(g.showUnclaim).toBe(true);
  });

  it("a pool task claimed by someone else is locked (no complete, no claim)", () => {
    const g = workflowTaskGating({ status: "claimed", assignedUsers: [], claimedBy: "user-2" }, ME);
    expect(g.claimedByMe).toBe(false);
    expect(g.canComplete).toBe(false);
    expect(g.showClaim).toBe(false);
    expect(g.showUnclaim).toBe(false);
  });

  it("direct assignment wins even if claimed by another user", () => {
    const g = workflowTaskGating({ status: "claimed", assignedUsers: [ME], claimedBy: "user-2" }, ME);
    expect(g.assignedToMe).toBe(true);
    expect(g.canComplete).toBe(true);
    expect(g.showClaim).toBe(false);
    // It's not "mine" by claim, so no release affordance either.
    expect(g.showUnclaim).toBe(false);
  });

  it("a completed task is not open and offers nothing", () => {
    const g = workflowTaskGating({ status: "completed", assignedUsers: [ME], claimedBy: ME }, ME);
    expect(g.isOpen).toBe(false);
    expect(g.showClaim).toBe(false);
    expect(g.showUnclaim).toBe(false);
  });

  it("handles an unknown user id (no session) without claiming anything", () => {
    const g = workflowTaskGating({ status: "pending", assignedUsers: [ME], claimedBy: null }, undefined);
    expect(g.assignedToMe).toBe(false);
    expect(g.canComplete).toBe(false);
    expect(g.showClaim).toBe(true);
  });
});

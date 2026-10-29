import { describe, expect, it } from "vitest";
import { getTicketBundleRole, isBundleChild, isBundleWorkflowLocked, normalizeBundleView } from "./ticketsBundle";

describe("ticketsBundle", () => {
  it("classifies children by master link and masters by child count", () => {
    expect(getTicketBundleRole({ master_ticket_id: "m1", bundle_master_ticket_number: "T-1", bundle_child_count: 0 })).toBe("child");
    expect(getTicketBundleRole({ master_ticket_id: null, bundle_child_count: 2 })).toBe("master");
    expect(getTicketBundleRole({ master_ticket_id: null, bundle_child_count: 0 })).toBe("standalone");
    expect(getTicketBundleRole({})).toBe("standalone");
    expect(getTicketBundleRole(null)).toBe("standalone");
  });

  it("locks workflow fields only on children", () => {
    expect(isBundleChild({ master_ticket_id: "m1" })).toBe(true);
    expect(isBundleChild({ bundle_child_count: 3 })).toBe(false);
    expect(isBundleChild(undefined)).toBe(false);
  });

  it("locks a child's workflow fields only under a sync_updates master", () => {
    const child = { master_ticket_id: "m1" };
    expect(isBundleWorkflowLocked(child, { settings: { mode: "sync_updates", reopen_on_child_reply: false } })).toBe(true);
    expect(isBundleWorkflowLocked(child, { settings: { mode: "link_only", reopen_on_child_reply: false } })).toBe(false);
    // No settings row behaves as link_only.
    expect(isBundleWorkflowLocked(child, { settings: null })).toBe(false);
    // Mode not loaded yet: stay locked.
    expect(isBundleWorkflowLocked(child, null)).toBe(true);
    // Masters and standalone tickets are never locked.
    expect(isBundleWorkflowLocked({ bundle_child_count: 2 }, { settings: { mode: "sync_updates", reopen_on_child_reply: false } })).toBe(false);
    expect(isBundleWorkflowLocked(undefined, null)).toBe(false);
  });

  it("falls back to the bundled view for saved filters that predate the option", () => {
    expect(normalizeBundleView(undefined)).toBe("bundled");
    expect(normalizeBundleView("bundled")).toBe("bundled");
    expect(normalizeBundleView("individual")).toBe("individual");
    expect(normalizeBundleView("nonsense")).toBe("bundled");
  });
});

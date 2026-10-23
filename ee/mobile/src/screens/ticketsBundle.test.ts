import { describe, expect, it } from "vitest";
import { getTicketBundleRole, isBundleChild, normalizeBundleView } from "./ticketsBundle";

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

  it("falls back to the bundled view for saved filters that predate the option", () => {
    expect(normalizeBundleView(undefined)).toBe("bundled");
    expect(normalizeBundleView("bundled")).toBe("bundled");
    expect(normalizeBundleView("individual")).toBe("individual");
    expect(normalizeBundleView("nonsense")).toBe("bundled");
  });
});

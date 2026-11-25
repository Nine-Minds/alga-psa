import { describe, expect, it, vi } from "vitest";

vi.mock("../capabilities/CapabilitiesContext", () => ({ useCapabilities: () => ({ features: {}, operationalScope: null, loaded: true }) }));

import { priorityFitsBoard } from "./CreateTicketScreen";

describe("priorityFitsBoard", () => {
  it("offers an ITIL board its ITIL priorities only, and any other board its custom ones", () => {
    expect(priorityFitsBoard({ is_from_itil_standard: true }, { priority_type: "itil" })).toBe(true);
    expect(priorityFitsBoard({ is_from_itil_standard: false }, { priority_type: "itil" })).toBe(false);
    expect(priorityFitsBoard({ is_from_itil_standard: false }, { priority_type: "custom" })).toBe(true);
    expect(priorityFitsBoard({ is_from_itil_standard: true }, { priority_type: "custom" })).toBe(false);
    expect(priorityFitsBoard({ is_from_itil_standard: true }, { priority_type: null })).toBe(false);
  });

  it("offers everything when the server sends no ITIL flag or no board is chosen", () => {
    expect(priorityFitsBoard({}, { priority_type: "custom" })).toBe(true);
    expect(priorityFitsBoard({ is_from_itil_standard: true }, undefined)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { defaultOpportunityDueDate, defaultOpportunityType } from "./CreateOpportunityModal";

describe("quick opportunity defaults", () => {
  it("uses new-logo only for prospects and expansion for known clients", () => {
    expect(defaultOpportunityType("prospect")).toBe("new_logo");
    expect(defaultOpportunityType("active")).toBe("expansion");
    expect(defaultOpportunityType("former")).toBe("expansion");
  });

  it("sets the first action three working days out", () => {
    const friday = new Date(2026, 7, 21, 15, 30);
    const due = defaultOpportunityDueDate(friday);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(7);
    expect(due.getDate()).toBe(26);
    expect(due.getHours()).toBe(9);
  });
});

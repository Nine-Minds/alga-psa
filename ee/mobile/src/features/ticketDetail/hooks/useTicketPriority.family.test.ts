import { describe, expect, it } from "vitest";
import { prioritiesOfSameFamily } from "./useTicketPriority";

const custom = { priority_id: "c1", priority_name: "Whimsical Wish", is_from_itil_standard: false };
const itil = { priority_id: "i1", priority_name: "P3 - Medium", is_from_itil_standard: true };

describe("prioritiesOfSameFamily", () => {
  it("keeps a ticket on a custom-priority board to custom priorities, and an ITIL one to ITIL", () => {
    expect(prioritiesOfSameFamily([custom, itil], "c1")).toEqual([custom]);
    expect(prioritiesOfSameFamily([custom, itil], "i1")).toEqual([itil]);
  });

  it("offers everything without a current priority or without the server's ITIL flag", () => {
    expect(prioritiesOfSameFamily([custom, itil], null)).toEqual([custom, itil]);
    const legacy = [{ priority_id: "c1", priority_name: "Whimsical Wish" }, { priority_id: "i1", priority_name: "P3 - Medium" }];
    expect(prioritiesOfSameFamily(legacy, "c1")).toEqual(legacy);
  });
});

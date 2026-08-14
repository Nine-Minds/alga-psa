import { describe, expect, it } from "vitest";
import { computeHourBlockCharges } from "./computeHourBlockCharges";

const PERIOD = { startDate: "2026-08-01", endDate: "2026-09-01" };

describe("computeHourBlockCharges", () => {
  it("emits one zero-dollar charge per block with burn in the window", () => {
    const { charges } = computeHourBlockCharges({
      billingPeriod: PERIOD,
      blocks: [
        {
          block_id: "block-1",
          service_id: "svc-1",
          service_name: "Support Hours",
          hours_used: 4,
          hours_remaining: 12.5,
          covered_entry_ids: ["entry-a", "entry-b"],
        },
      ],
    });

    expect(charges).toHaveLength(1);
    const charge = charges[0];
    expect(charge.type).toBe("hour_block");
    expect(charge.block_id).toBe("block-1");
    expect(charge.total).toBe(0);
    expect(charge.rate).toBe(0);
    expect(charge.hoursUsed).toBe(4);
    expect(charge.hoursRemaining).toBe(12.5);
    expect(charge.coveredEntryIds).toEqual(["entry-a", "entry-b"]);
    expect(charge.serviceId).toBe("svc-1");
    expect(charge.is_taxable).toBe(false);
    expect(charge.tax_amount).toBe(0);
    expect(charge.servicePeriodStart).toBe(PERIOD.startDate);
    expect(charge.servicePeriodEnd).toBe(PERIOD.endDate);
  });

  it("emits no charge when a block has no burn in the window", () => {
    const { charges } = computeHourBlockCharges({
      billingPeriod: PERIOD,
      blocks: [
        {
          block_id: "block-1",
          service_id: "svc-1",
          service_name: "Support Hours",
          hours_used: 0,
          hours_remaining: 10,
          covered_entry_ids: [],
        },
      ],
    });
    expect(charges).toHaveLength(0);
  });

  it("emits one charge per block with burn", () => {
    const { charges } = computeHourBlockCharges({
      billingPeriod: PERIOD,
      blocks: [
        {
          block_id: "block-1",
          service_id: "svc-1",
          service_name: "Support Hours",
          hours_used: 2,
          hours_remaining: 8,
          covered_entry_ids: ["entry-a"],
        },
        {
          block_id: "block-2",
          service_id: "svc-2",
          service_name: "Onboarding",
          hours_used: 0.5,
          hours_remaining: 9.5,
          covered_entry_ids: [],
        },
        {
          block_id: "block-3",
          service_id: "svc-3",
          service_name: "Idle",
          hours_used: 0,
          hours_remaining: 10,
          covered_entry_ids: [],
        },
      ],
    });

    expect(charges).toHaveLength(2);
    expect(charges.map((charge) => charge.block_id)).toEqual(["block-1", "block-2"]);
    expect(charges.every((charge) => charge.total === 0)).toBe(true);
  });
});

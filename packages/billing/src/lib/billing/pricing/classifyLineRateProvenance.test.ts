import { describe, it, expect } from "vitest";
import {
  classifyLineRateProvenance,
  nextBillingPeriodBoundary,
  type ClassifyLineRateInput,
} from "./classifyLineRateProvenance";

const PERIOD = { start: "2026-11-01", end: "2026-12-01" };
const USD = "USD";

function input(
  overrides: Partial<ClassifyLineRateInput> = {},
): ClassifyLineRateInput {
  return {
    resolver: {
      line: {
        contract_line_id: "line-1",
        custom_rate: 6000,
        rate_provenance: "unreviewed",
      },
      planServices: [
        {
          service_id: "svc-a",
          config_id: "cfg-a",
          configuration_quantity: 1,
        },
      ],
      schedules: [],
      revisions: [],
      catalogPrices: [
        {
          service_id: "svc-a",
          currency_code: USD,
          rate: 6000,
          effective_date: "1970-01-01",
        },
      ],
      period: PERIOD,
      currency: USD,
      tenantDefaultCurrency: USD,
    },
    storedRateCents: 6000,
    currentProvenance: "unreviewed",
    contractIsActive: true,
    contractHasEnded: false,
    serviceIds: ["svc-a"],
    ...overrides,
  };
}

describe("classifyLineRateProvenance", () => {
  it("proposes inherited when the stored rate equals the catalog rate", () => {
    const result = classifyLineRateProvenance(input());
    expect(result.classification).toBe("inherited");
    expect(result.resolvedRateCents).toBe(6000);
    expect(result.reason).toMatch(/catalog/i);
  });

  it("proposes custom when the stored rate differs from the catalog rate", () => {
    const result = classifyLineRateProvenance(
      input({
        resolver: {
          ...input().resolver,
          line: {
            contract_line_id: "line-1",
            custom_rate: 4500,
            rate_provenance: "unreviewed",
          },
        },
        storedRateCents: 4500,
      }),
    );
    expect(result.classification).toBe("custom");
    expect(result.storedRateCents).toBe(4500);
    expect(result.resolvedRateCents).toBe(6000);
  });

  it("skips when the contract currency has no catalog price for the service", () => {
    const result = classifyLineRateProvenance(
      input({
        resolver: { ...input().resolver, currency: "EUR" },
      }),
    );
    expect(result.classification).toBe("skip");
    expect(result.skipReason).toBe("no_catalog_price");
  });

  it("skips when members resolve to no catalog rate at all", () => {
    const result = classifyLineRateProvenance(
      input({
        resolver: { ...input().resolver, catalogPrices: [] },
      }),
    );
    expect(result.classification).toBe("skip");
    // A currency with no row at all trips the currency guard first.
    expect(result.skipReason).toBe("no_catalog_price");

    const noMember = classifyLineRateProvenance(
      input({
        resolver: {
          ...input().resolver,
          catalogPrices: [
            {
              service_id: "svc-other",
              currency_code: USD,
              rate: 9999,
              effective_date: "1970-01-01",
            },
          ],
        },
        serviceIds: ["svc-a", "svc-other"],
      }),
    );
    expect(noMember.classification).toBe("skip");
    expect(noMember.skipReason).toBe("no_member_catalog_rate");
  });

  it("skips inactive or ended contracts", () => {
    const inactive = classifyLineRateProvenance(
      input({ contractIsActive: false }),
    );
    expect(inactive.classification).toBe("skip");
    expect(inactive.skipReason).toBe("contract_inactive");

    const ended = classifyLineRateProvenance(
      input({ contractHasEnded: true }),
    );
    expect(ended.skipReason).toBe("contract_inactive");
  });

  it("skips lines that are already classified", () => {
    expect(
      classifyLineRateProvenance(input({ currentProvenance: "inherited" }))
        .skipReason,
    ).toBe("already_inherited");
    expect(
      classifyLineRateProvenance(input({ currentProvenance: "custom" }))
        .skipReason,
    ).toBe("already_custom");
  });

  it("realises a line-scoped pricing schedule when treating the rate as null", () => {
    const result = classifyLineRateProvenance(
      input({
        resolver: {
          ...input().resolver,
          schedules: [
            {
              schedule_id: "sched-1",
              contract_line_id: "line-1",
              effective_date: "2026-01-01",
              end_date: null,
              custom_rate: 7777,
            },
          ],
        },
        storedRateCents: 7777,
      }),
    );
    expect(result.classification).toBe("inherited");
    expect(result.resolvedRateCents).toBe(7777);
  });
});

describe("nextBillingPeriodBoundary", () => {
  it("returns the current month boundary by default", () => {
    expect(nextBillingPeriodBoundary(new Date("2026-11-15T12:00:00Z"))).toEqual({
      start: "2026-11-01",
      end: "2026-12-01",
    });
  });
});

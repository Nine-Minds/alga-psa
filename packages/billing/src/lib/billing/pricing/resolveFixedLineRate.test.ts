import { describe, it, expect } from "vitest";
import {
  resolveClonedRate,
  resolveFixedLineRate,
  selectActivePricingSchedule,
  type PlanServiceRateRow,
  type ServicePriceRateRow,
} from "./resolveFixedLineRate";

const PERIOD = { start: "2026-11-01", end: "2026-12-01" };
const USD = "USD";

const service = (
  overrides: Partial<PlanServiceRateRow> = {},
): PlanServiceRateRow => ({
  service_id: "svc-a",
  config_id: "cfg-a",
  configuration_quantity: 1,
  ...overrides,
});

const price = (
  overrides: Partial<ServicePriceRateRow> = {},
): ServicePriceRateRow => ({
  service_id: "svc-a",
  currency_code: USD,
  rate: 6000,
  effective_date: "1970-01-01",
  ...overrides,
});

const base = {
  line: {
    contract_line_id: "line-1",
    custom_rate: null,
    rate_provenance: "inherited" as const,
  },
  schedules: [],
  revisions: [],
  period: PERIOD,
  currency: USD,
  tenantDefaultCurrency: USD,
};

/**
 * Resolver matrix tests.
 *
 * These expectations are hand-authored against the resolver's documented
 * precedence chain. They are NOT a golden-file equivalence proof against the
 * pre-change engine: the engine still carries its own
 * `selectActivePricingSchedule` (`billingEngine.ts`) and its inline rate chain,
 * and no fixture under `server/src/test/integration/billing/goldenOutput/` was
 * produced from both implementations. Equivalence therefore holds by
 * duplication, not by construction. Wiring this matrix to a golden baseline is
 * a known gap; do not read the `T15` label below as evidence of engine parity.
 */
describe("resolveFixedLineRate (T15 equivalence matrix)", () => {
  it("bundle/inherited: derives the line total from per-service catalog prices", () => {
    const result = resolveFixedLineRate({
      ...base,
      planServices: [
        service({ service_id: "svc-a", config_id: "cfg-a", default_rate: 5000 }),
        service({
          service_id: "svc-b",
          config_id: "cfg-b",
          configuration_quantity: 2,
          default_rate: 3000,
        }),
      ],
      catalogPrices: [
        price({ service_id: "svc-a", rate: 6000 }),
        price({ service_id: "svc-b", rate: 4000 }),
      ],
    });

    expect(result.perService.get("cfg-a")).toMatchObject({
      rateCents: 6000,
      source: "catalog",
      provenance: "inherited",
    });
    expect(result.perService.get("cfg-b")).toMatchObject({
      rateCents: 4000,
      source: "catalog",
    });
    // 6000*1 + 4000*2
    expect(result.line).toMatchObject({
      rateCents: 14000,
      source: "derived",
      provenance: "inherited",
    });
  });

  it("line_override: custom and unreviewed stored rates win over the catalog", () => {
    const custom = resolveFixedLineRate({
      ...base,
      line: { ...base.line, custom_rate: 12345, rate_provenance: "custom" },
      planServices: [service({ default_rate: 5000 })],
      catalogPrices: [price()],
    });
    expect(custom.line).toMatchObject({
      rateCents: 12345,
      source: "line_override",
      provenance: "custom",
    });

    const unreviewed = resolveFixedLineRate({
      ...base,
      line: { ...base.line, custom_rate: 999, rate_provenance: "unreviewed" },
      planServices: [service({ default_rate: 5000 })],
      catalogPrices: [price()],
    });
    expect(unreviewed.line).toMatchObject({
      rateCents: 999,
      source: "line_override",
      provenance: "unreviewed",
    });
  });

  it("pricing_schedule: [start,end) overlap, newest effective_date wins", () => {
    const result = resolveFixedLineRate({
      ...base,
      planServices: [service({ default_rate: 5000 })],
      catalogPrices: [price()],
      schedules: [
        {
          schedule_id: "s-old",
          effective_date: "2026-01-01",
          end_date: "2026-06-01",
          custom_rate: 11111,
        },
        {
          schedule_id: "s-active",
          effective_date: "2026-10-01",
          end_date: null,
          custom_rate: 77777,
        },
        {
          schedule_id: "s-future",
          effective_date: "2027-01-01",
          end_date: null,
          custom_rate: 88888,
        },
      ],
    });
    expect(result.line).toMatchObject({
      rateCents: 77777,
      source: "pricing_schedule",
      sourceId: "s-active",
    });
  });

  it("schedule end_date boundary matches the engine (end == period start excluded)", () => {
    const inclusiveStart = PERIOD.start; // 2026-11-01
    const dayBeforeStart = "2026-10-31";
    const dayAfterStart = "2026-11-02";

    expect(
      selectActivePricingSchedule(
        [
          {
            schedule_id: "s-ends-on-start",
            effective_date: "2026-01-01",
            end_date: inclusiveStart,
            custom_rate: 11111,
          },
        ],
        "line-1",
        PERIOD,
      ),
    ).toBeNull();

    expect(
      selectActivePricingSchedule(
        [
          {
            schedule_id: "s-ends-day-before-start",
            effective_date: "2026-01-01",
            end_date: dayBeforeStart,
            custom_rate: 11111,
          },
        ],
        "line-1",
        PERIOD,
      ),
    ).toBeNull();

    expect(
      selectActivePricingSchedule(
        [
          {
            schedule_id: "s-ends-day-after-start",
            effective_date: "2026-01-01",
            end_date: dayAfterStart,
            custom_rate: 11111,
          },
        ],
        "line-1",
        PERIOD,
      )?.schedule_id,
    ).toBe("s-ends-day-after-start");
  });

  it("T21: a null-rate newest schedule blocks older schedules (engine semantics)", () => {
    const schedules = [
      {
        schedule_id: "s-null-newest",
        effective_date: "2026-10-15",
        end_date: null,
        custom_rate: null,
      },
      {
        schedule_id: "s-older",
        effective_date: "2026-08-01",
        end_date: null,
        custom_rate: 50000,
      },
    ];
    const active = selectActivePricingSchedule(schedules, "line-1", PERIOD);
    expect(active?.schedule_id).toBe("s-null-newest");

    const result = resolveFixedLineRate({
      ...base,
      planServices: [service({ default_rate: 5000 })],
      catalogPrices: [price()],
      schedules,
    });
    // Falls through to the member chain, never back to the older schedule.
    expect(result.line.rateCents).toBe(6000);
  });

  it("unit_revision: latest admitted revision wins and is keyed on (service, config)", () => {
    const result = resolveFixedLineRate({
      ...base,
      line: { ...base.line, custom_rate: 100000, rate_provenance: "custom" },
      planServices: [
        service({
          service_id: "svc-a",
          config_id: "cfg-1",
          pricing_basis: "unit",
          configuration_quantity: 3,
        }),
        service({
          service_id: "svc-a",
          config_id: "cfg-2",
          pricing_basis: "unit",
          configuration_quantity: 5,
        }),
      ],
      catalogPrices: [],
      revisions: [
        {
          revision_id: "rev-1-old",
          service_id: "svc-a",
          config_id: "cfg-1",
          effective_period_start: "2026-10-01",
          unit_rate_cents: 1000,
          created_at: "2026-09-01",
        },
        {
          revision_id: "rev-1-new",
          service_id: "svc-a",
          config_id: "cfg-1",
          effective_period_start: "2026-11-01",
          unit_rate_cents: 1200,
          created_at: "2026-10-01",
        },
        {
          revision_id: "rev-2",
          service_id: "svc-a",
          config_id: "cfg-2",
          effective_period_start: "2026-11-01",
          unit_rate_cents: 2000,
          created_at: "2026-10-01",
        },
        {
          revision_id: "rev-future",
          service_id: "svc-a",
          config_id: "cfg-1",
          effective_period_start: "2026-12-01",
          unit_rate_cents: 9999,
          created_at: "2026-11-15",
        },
      ],
    });

    // T19: two configs of the same service each get their own revision.
    expect(result.perService.get("cfg-1")).toMatchObject({
      rateCents: 1200,
      source: "unit_revision",
      sourceId: "rev-1-new",
    });
    expect(result.perService.get("cfg-2")).toMatchObject({
      rateCents: 2000,
      source: "unit_revision",
      sourceId: "rev-2",
    });
  });

  it("service_override: a stored base_rate governs while custom/unreviewed", () => {
    const result = resolveFixedLineRate({
      ...base,
      planServices: [
        service({
          service_base_rate: 4200,
          base_rate_provenance: "unreviewed",
          default_rate: 5000,
        }),
      ],
      catalogPrices: [price({ rate: 6000 })],
    });
    expect(result.perService.get("cfg-a")).toMatchObject({
      rateCents: 4200,
      source: "service_override",
      provenance: "unreviewed",
    });
  });

  it("config_override: configuration custom_rate beats the catalog", () => {
    const result = resolveFixedLineRate({
      ...base,
      planServices: [
        service({ configuration_custom_rate: 4100, default_rate: 5000 }),
      ],
      catalogPrices: [price({ rate: 6000 })],
    });
    expect(result.perService.get("cfg-a")).toMatchObject({
      rateCents: 4100,
      source: "config_override",
    });
  });

  it("catalog_legacy: default_rate is used only for the default currency", () => {
    const usd = resolveFixedLineRate({
      ...base,
      planServices: [service({ default_rate: 3300 })],
      catalogPrices: [],
    });
    expect(usd.perService.get("cfg-a")).toMatchObject({
      rateCents: 3300,
      source: "catalog_legacy",
    });

    // EUR contract with no EUR service price must NOT pick up the untagged USD
    // default_rate (correction #5). It resolves to nothing.
    const eur = resolveFixedLineRate({
      ...base,
      line: { ...base.line },
      currency: "EUR",
      tenantDefaultCurrency: USD,
      planServices: [service({ default_rate: 3300 })],
      catalogPrices: [price({ currency_code: USD, rate: 3300 })],
    });
    expect(eur.perService.get("cfg-a")).toMatchObject({
      rateCents: null,
      source: null,
    });
    expect(eur.line.rateCents).toBeNull();
  });

  it("no-members: an inherited line derives nothing", () => {
    const result = resolveFixedLineRate({ ...base, planServices: [], catalogPrices: [] });
    expect(result.line).toMatchObject({
      rateCents: null,
      source: null,
      provenance: "inherited",
    });
    expect(result.perService.size).toBe(0);
  });

  it("treats a missing provenance label as unreviewed (pre-migration rows)", () => {
    const result = resolveFixedLineRate({
      ...base,
      line: {
        contract_line_id: "line-legacy",
        custom_rate: 777,
        rate_provenance: null,
      },
      planServices: [],
      catalogPrices: [],
    });
    expect(result.line).toMatchObject({
      rateCents: 777,
      provenance: "unreviewed",
      source: "line_override",
    });
  });
});

describe("resolveClonedRate", () => {
  it("an explicit rate is always custom", () => {
    expect(
      resolveClonedRate({ explicitRate: 1234, templateRate: 9999 }),
    ).toEqual({ rateCents: 1234, provenance: "custom" });
  });

  it("a custom template snapshots into a custom live rate", () => {
    expect(
      resolveClonedRate({ templateRate: 5000, templateProvenance: "custom" }),
    ).toEqual({ rateCents: 5000, provenance: "custom" });
  });

  it("an inherited template clones to null/inherited (catalog stays live)", () => {
    expect(
      resolveClonedRate({ templateRate: null, templateProvenance: "inherited" }),
    ).toEqual({ rateCents: null, provenance: "inherited" });
  });

  it("an unreviewed template propagates the stored number and the unknown", () => {
    expect(
      resolveClonedRate({
        templateRate: 5000,
        templateProvenance: "unreviewed",
      }),
    ).toEqual({ rateCents: 5000, provenance: "unreviewed" });
  });
});

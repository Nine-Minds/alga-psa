import { describe, expect, it, vi } from "vitest";

import { BillingEngine } from "@alga-psa/billing/services";

const buildStaticQuery = (firstResult: any, selectResult: any = []) => {
  const builder: any = {};
  builder.where = vi.fn().mockImplementation(() => builder);
  builder.andWhere = vi.fn().mockImplementation(() => builder);
  builder.whereNull = vi.fn().mockImplementation(() => builder);
  builder.whereIn = vi.fn().mockImplementation(() => builder);
  builder.orderBy = vi.fn().mockImplementation(() => builder);
  builder.join = vi.fn().mockImplementation(() => builder);
  builder.leftJoin = vi.fn().mockImplementation(() => builder);
  builder.whereNot = vi.fn().mockImplementation(() => builder);
  builder.distinct = vi.fn().mockImplementation(() => builder);
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.first = vi.fn().mockResolvedValue(firstResult);
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) =>
    Promise.resolve(selectResult).then(onFulfilled, onRejected),
  );
  return builder;
};

const buildPricingScheduleQuery = (rows: Array<Record<string, any>>) => {
  const state: {
    endExclusive?: string;
    startExclusive?: string;
  } = {};

  const builder: any = {};
  builder.where = vi.fn().mockImplementation((arg1: any, arg2?: any, arg3?: any) => {
    if (typeof arg1 === "function") {
      const nestedBuilder = {
        whereNull: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockImplementation((column: string, operator: string, value: string) => {
          if (column === "end_date" && operator === ">") {
            state.startExclusive = value;
          }
          return nestedBuilder;
        }),
      };
      arg1(nestedBuilder);
      return builder;
    }

    if (arg1 === "effective_date" && arg2 === "<") {
      state.endExclusive = arg3;
    }

    return builder;
  });
  builder.andWhere = vi.fn().mockImplementation(() => builder);
  builder.orderBy = vi.fn().mockImplementation(() => builder);
  builder.first = vi.fn().mockImplementation(async () => {
    const matches = rows
      .filter((row) => {
        const effectiveOk = state.endExclusive
          ? row.effective_date < state.endExclusive
          : true;
        const endOk = state.startExclusive
          ? row.end_date == null || row.end_date > state.startExclusive
          : true;
        return effectiveOk && endOk;
      })
      .sort((a, b) => b.effective_date.localeCompare(a.effective_date));

    return matches[0] ?? null;
  });

  return builder;
};

const buildDiscountQuery = (rows: Array<Record<string, any>>) => {
  const state: {
    endInclusive?: string;
    startExclusive?: string;
  } = {};

  const builder: any = {};
  builder.join = vi.fn().mockImplementation(() => builder);
  builder.where = vi.fn().mockImplementation(() => builder);
  builder.andWhere = vi.fn().mockImplementation((arg1: any, arg2?: any, arg3?: any) => {
    if (typeof arg1 === "function") {
      const nestedBuilder = {
        whereNull: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockImplementation((column: string, operator: string, value: string) => {
          if (column === "discounts.end_date" && operator === ">") {
            state.startExclusive = value;
          }
          return nestedBuilder;
        }),
      };
      arg1.call(nestedBuilder);
      return builder;
    }

    if (arg1 === "discounts.start_date" && arg2 === "<=") {
      state.endInclusive = arg3;
    }

    return builder;
  });
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.distinct = vi.fn().mockImplementation(() => builder);
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) => {
    const matches = rows.filter((row) => {
      const startOk = state.endInclusive ? row.start_date <= state.endInclusive : true;
      const endOk = state.startExclusive
        ? row.end_date == null || row.end_date > state.startExclusive
        : true;
      return startOk && endOk;
    });

    return Promise.resolve(matches).then(onFulfilled, onRejected);
  });

  return builder;
};

describe("BillingEngine discount and pricing timing parity", () => {
  it("T054: pricing schedule effective-date boundaries stay keyed to the billing window on the fixed recurring canonical path", async () => {
    const engine = new BillingEngine();
    const pricingScheduleBuilder = buildPricingScheduleQuery([
      {
        schedule_id: "schedule-jan",
        contract_id: "contract-1",
        effective_date: "2025-01-01",
        end_date: "2025-02-01",
        custom_rate: 3100,
      },
      {
        schedule_id: "schedule-feb",
        contract_id: "contract-1",
        effective_date: "2025-02-01",
        end_date: "2025-03-01",
        custom_rate: 6200,
      },
      {
        schedule_id: "schedule-mar",
        contract_id: "contract-1",
        effective_date: "2025-03-01",
        end_date: null,
        custom_rate: 9100,
      },
    ]);

    (engine as any).tenant = "test_tenant";
    vi.spyOn(engine as any, "getBillingCycle").mockResolvedValue("monthly");
    vi.spyOn(engine as any, "hasExistingServicePeriodCharge").mockResolvedValue(false);
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue("US-NY");
    vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
      taxRegion: undefined,
      isTaxable: false,
    });

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "contract_pricing_schedules") {
        return pricingScheduleBuilder;
      }

      if (tableName === "clients") {
        return buildStaticQuery({
          client_id: "client-1",
          tenant: "test_tenant",
          client_name: "Mock Client",
          is_tax_exempt: false,
        });
      }

      if (tableName === "contract_lines") {
        return buildStaticQuery({
          contract_line_id: "contract-line-1",
          tenant: "test_tenant",
          contract_line_type: "Fixed",
          custom_rate: null,
          enable_proration: false,
          billing_cycle_alignment: "start",
        });
      }

      if (tableName === "contract_line_services as cls") {
        return buildStaticQuery(null, [
          {
            service_id: "service-1",
            service_name: "Managed Support",
            default_rate: 1000,
            tax_rate_id: null,
            service_quantity: 1,
            configuration_quantity: 1,
            config_id: "config-1",
            service_base_rate: 1000,
          },
        ]);
      }

      return buildStaticQuery(null);
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "arrears",
        start_date: "2025-01-01",
        end_date: null,
        custom_rate: null,
      },
    );

    expect(pricingScheduleBuilder.where).toHaveBeenNthCalledWith(
      2,
      "effective_date",
      "<",
      "2025-03-01",
    );
    expect(charges).toEqual([
      expect.objectContaining({
        total: 6200,
        rate: 6200,
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
      }),
    ]);
  });

  it("T055: discount start and end applicability remains keyed to invoice-window overlap after fixed recurring timing goes canonical", async () => {
    const engine = new BillingEngine();
    const discountsBuilder = buildDiscountQuery([
      {
        discount_id: "discount-jan",
        start_date: "2025-01-01",
        end_date: "2025-02-01",
        discount_type: "fixed",
        value: 500,
        is_active: true,
      },
      {
        discount_id: "discount-feb",
        start_date: "2025-02-01",
        end_date: "2025-03-01",
        discount_type: "fixed",
        value: 700,
        is_active: true,
      },
      {
        discount_id: "discount-mar",
        start_date: "2025-03-01",
        end_date: null,
        discount_type: "fixed",
        value: 900,
        is_active: true,
      },
    ]);

    (engine as any).tenant = "test_tenant";
    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "clients") {
        return buildStaticQuery({
          client_id: "client-1",
          tenant: "test_tenant",
        });
      }

      if (tableName === "discounts") {
        return discountsBuilder;
      }

      return buildStaticQuery(null);
    });

    const discounts = await (engine as any).fetchDiscounts("client-1", {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    });

    expect(discountsBuilder.andWhere).toHaveBeenNthCalledWith(
      1,
      "discounts.start_date",
      "<=",
      "2025-03-01",
    );
    expect(discounts.map((discount: any) => discount.discount_id)).toEqual([
      "discount-feb",
      "discount-mar",
    ]);
  });
});

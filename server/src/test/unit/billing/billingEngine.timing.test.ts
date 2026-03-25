import { describe, it, expect, vi } from "vitest";
import { BillingEngine } from "@alga-psa/billing/services";
import { TaxService } from "@alga-psa/billing/services/taxService";

vi.mock("@alga-psa/billing/actions/billingAndTax", () => ({
  getNextBillingDate: vi.fn(
    async (_clientId: string, currentEndDate: string) => currentEndDate,
  ),
}));

const buildQuery = (firstResult: any, selectResult: any = []) => {
  const builder: any = {};
  builder.where = vi.fn().mockImplementation((condition: any) => {
    if (typeof condition === "function") {
      condition({
        whereNull: vi.fn().mockReturnThis(),
        orWhere: vi.fn().mockReturnThis(),
      });
    }
    return builder;
  });
  builder.andWhere = vi.fn().mockImplementation(() => builder);
  builder.whereNull = vi.fn().mockImplementation(() => builder);
  builder.whereIn = vi.fn().mockImplementation(() => builder);
  builder.orderBy = vi.fn().mockImplementation(() => builder);
  builder.join = vi.fn().mockImplementation(() => builder);
  builder.leftJoin = vi.fn().mockImplementation(() => builder);
  builder.whereNot = vi.fn().mockImplementation(() => builder);
  builder.select = vi.fn().mockImplementation(() => builder);
  builder.first = vi.fn().mockResolvedValue(firstResult);
  builder.then = vi.fn((onFulfilled?: any, onRejected?: any) =>
    Promise.resolve(selectResult).then(onFulfilled, onRejected),
  );
  return builder;
};

interface FixedChargeMockOptions {
  billingPeriod?: { startDate: string; endDate: string };
  scheduleRate?: number | null;
  contractLineCustomRate?: number | null;
  assignmentCustomRate?: number | null;
  serviceRates?: number[];
  enableProration?: boolean;
  contractLineType?: string;
  billingCycleAlignment?: "start" | "end" | "prorated";
}

const installFixedChargeMocks = (
  engine: BillingEngine,
  options: FixedChargeMockOptions = {},
) => {
  const billingPeriod = options.billingPeriod ?? {
    startDate: "2025-01-01",
    endDate: "2025-02-01",
  };
  const serviceRates = options.serviceRates ?? [6200];

  (engine as any).tenant = "test_tenant";
  vi.spyOn(engine as any, "getBillingCycle").mockResolvedValue("monthly");
  vi.spyOn(engine as any, "hasExistingServicePeriodCharge").mockResolvedValue(
    false,
  );
  vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
    "US-NY",
  );
  vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
    taxRegion: undefined,
    isTaxable: false,
  });

  (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
    if (tableName === "contract_pricing_schedules") {
      if (options.scheduleRate === undefined || options.scheduleRate === null) {
        return buildQuery(null);
      }

      return buildQuery({
        schedule_id: "schedule-1",
        contract_id: "contract-1",
        effective_date: billingPeriod.startDate,
        end_date: null,
        custom_rate: options.scheduleRate,
      });
    }

    if (tableName === "clients") {
      return buildQuery({
        client_id: "client-1",
        tenant: "test_tenant",
        client_name: "Mock Client",
        is_tax_exempt: false,
      });
    }

      if (tableName === "contract_lines") {
        return buildQuery({
          contract_line_id: "contract-line-1",
          tenant: "test_tenant",
          contract_line_type: options.contractLineType ?? "Fixed",
          custom_rate: options.contractLineCustomRate ?? null,
          enable_proration: options.enableProration ?? false,
          billing_cycle_alignment: options.billingCycleAlignment ?? "start",
      });
    }

    if (tableName === "contract_line_services as cls") {
      return buildQuery(
        null,
        serviceRates.map((rate, index) => ({
          service_id: `service-${index + 1}`,
          service_name: `Managed Support ${index + 1}`,
          default_rate: rate,
          tax_rate_id: null,
          service_quantity: 1,
          configuration_quantity: 1,
          config_id: `config-${index + 1}`,
          service_base_rate: rate,
        })),
      );
    }

    return buildQuery(null);
  });

  return billingPeriod;
};

const installRecurringRolloutGuardHarness = (
  engine: BillingEngine,
  clientContractLines: any[],
) => {
  (engine as any).tenant = "test_tenant";
  vi.spyOn(engine as any, "initKnex").mockResolvedValue(undefined);
  vi.spyOn(engine as any, "getClientContractLinesAndCycle").mockResolvedValue({
    clientContractLines,
    billingCycle: "monthly",
  });
  vi.spyOn(engine as any, "calculateMaterialCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateFixedPriceCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateTimeBasedCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateUsageBasedCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateBucketPlanCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateProductCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateLicenseCharges").mockResolvedValue([]);

  (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
    if (tableName === "clients") {
      return buildQuery({
        client_id: "client-1",
        tenant: "test_tenant",
        client_name: "Guardrail Client",
        default_currency_code: "USD",
        is_tax_exempt: false,
      });
    }

    if (tableName === "client_billing_cycles") {
      return buildQuery({
        billing_cycle_id: "cycle-1",
        client_id: "client-1",
        tenant: "test_tenant",
        start_date: "2025-02-01",
        end_date: "2025-03-01",
        effective_date: "2025-02-01",
      });
    }

    return buildQuery(null);
  });
};

const installPersistedRecurringExecutionHarness = (
  engine: BillingEngine,
  clientContractLines: any[],
) => {
  (engine as any).tenant = "test_tenant";
  vi.spyOn(engine as any, "initKnex").mockResolvedValue(undefined);
  vi.spyOn(engine as any, "withPinnedTransaction").mockImplementation(
    async (callback: any) => callback((engine as any).knex),
  );
  vi.spyOn(engine as any, "getClientContractLinesForBillingPeriod").mockResolvedValue(
    clientContractLines,
  );
  vi.spyOn(engine as any, "calculateMaterialCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateFixedPriceCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateTimeBasedCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateUsageBasedCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateBucketPlanCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateProductCharges").mockResolvedValue([]);
  vi.spyOn(engine as any, "calculateLicenseCharges").mockResolvedValue([]);

  (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
    if (tableName === "clients") {
      return buildQuery({
        client_id: "client-1",
        tenant: "test_tenant",
        client_name: "Persisted Client",
        default_currency_code: "USD",
        is_tax_exempt: false,
      });
    }

    return buildQuery(null);
  });
};

describe("BillingEngine billing timing", () => {
  it("T045: fixed recurring arrears timing resolves partial first periods through shared coverage instead of a special skip branch", () => {
    const engine = new BillingEngine();

    const result = (engine as any).resolveFixedRecurringChargeTiming(
      {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
      {
        client_contract_line_id: "ccd-1",
        billing_timing: "arrears",
        start_date: "2025-01-10",
        end_date: null,
      },
      "monthly",
    );

    expect(result).toMatchObject({
      duePosition: "arrears",
      servicePeriodStart: "2025-01-10",
      servicePeriodEnd: "2025-01-31",
      servicePeriodStartExclusive: "2025-01-10",
      servicePeriodEndExclusive: "2025-02-01",
    });
    expect(result?.coverageRatio).toBeCloseTo(22 / 31, 8);
  });

  it("T146: recurring selection stays deterministic when client-cadence and contract-cadence lines coexist on one client", () => {
    const engine = new BillingEngine();

    const billingPeriod = {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    };

    const clientAdvanceLine = {
      client_contract_line_id: "client-line",
      billing_timing: "advance",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    const contractArrearsSameWindowLine = {
      client_contract_line_id: "contract-line-match",
      billing_timing: "arrears",
      billing_frequency: "monthly",
      cadence_owner: "contract",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    const contractAdvanceDifferentWindowLine = {
      client_contract_line_id: "contract-line-different-window",
      billing_timing: "advance",
      billing_frequency: "monthly",
      cadence_owner: "contract",
      start_date: "2025-02-08",
      end_date: null,
    } as any;

    const mixedOrderSelection = (engine as any).buildRecurringTimingSelections(
      billingPeriod,
      [
        contractAdvanceDifferentWindowLine,
        contractArrearsSameWindowLine,
        clientAdvanceLine,
      ],
      "monthly",
    );
    const reversedOrderSelection = (engine as any).buildRecurringTimingSelections(
      billingPeriod,
      [
        clientAdvanceLine,
        contractArrearsSameWindowLine,
        contractAdvanceDifferentWindowLine,
      ],
      "monthly",
    );

    expect(mixedOrderSelection).toEqual(reversedOrderSelection);
    expect(Object.keys(mixedOrderSelection)).toEqual([
      "client-line",
      "contract-line-match",
    ]);
    expect(mixedOrderSelection).toMatchObject({
      "client-line": {
        duePosition: "advance",
        servicePeriodStart: "2025-02-01",
        servicePeriodEnd: "2025-02-28",
      },
      "contract-line-match": {
        duePosition: "arrears",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
      },
    });
    expect(
      mixedOrderSelection["contract-line-different-window"],
    ).toBeUndefined();
  });

  it("T149: end-exclusive overlap semantics remain correct when mixed cadence owners coexist", () => {
    const engine = new BillingEngine();

    const billingPeriod = {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    };

    const clientAdvanceLine = {
      client_contract_line_id: "client-line",
      billing_timing: "advance",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    const contractBoundaryAdvanceLine = {
      client_contract_line_id: "contract-boundary-line",
      billing_timing: "advance",
      billing_frequency: "monthly",
      cadence_owner: "contract",
      start_date: "2025-03-01",
      end_date: null,
    } as any;

    const selections = (engine as any).buildRecurringTimingSelections(
      billingPeriod,
      [clientAdvanceLine, contractBoundaryAdvanceLine],
      "monthly",
    );

    expect(Object.keys(selections)).toEqual(["client-line"]);
    expect(selections).toMatchObject({
      "client-line": {
        duePosition: "advance",
        servicePeriodStart: "2025-02-01",
        servicePeriodEnd: "2025-02-28",
      },
    });
    expect(selections["contract-boundary-line"]).toBeUndefined();
  });

  it("T158: partial rollout protection rejects a billing run when provided recurring timing selections cover only some due recurring lines", async () => {
    const engine = new BillingEngine();
    const billingPeriod = {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    };

    const fixedLine = {
      client_contract_line_id: "fixed-line",
      contract_line_name: "Fixed Coverage",
      contract_line_type: "Fixed",
      currency_code: "USD",
      billing_timing: "advance",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    const productLine = {
      client_contract_line_id: "product-line",
      contract_line_name: "Recurring Product",
      contract_line_type: "Fixed",
      currency_code: "USD",
      billing_timing: "advance",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    installRecurringRolloutGuardHarness(engine, [fixedLine, productLine]);

    const canonicalSelections = (engine as any).buildRecurringTimingSelections(
      billingPeriod,
      [fixedLine, productLine],
      "monthly",
    );

    await expect(
      (engine as any).calculateBillingInternal(
        "client-1",
        billingPeriod.startDate,
        billingPeriod.endDate,
        "cycle-1",
        {
          recurringTimingSelections: {
            "fixed-line": canonicalSelections["fixed-line"],
          },
        },
      ),
    ).rejects.toThrow(
      "Recurring timing rollout guard blocked mixed legacy/canonical timing state: product-line: missing canonical selection",
    );

    expect((engine as any).calculateFixedPriceCharges).not.toHaveBeenCalled();
    expect((engine as any).calculateProductCharges).not.toHaveBeenCalled();
    expect((engine as any).calculateLicenseCharges).not.toHaveBeenCalled();
  });

  it("uses persisted recurring due selections without loading a client billing cycle row", async () => {
    const engine = new BillingEngine();
    const hourlyLine = {
      client_contract_line_id: "hourly-line",
      contract_line_type: "Hourly",
    } as any;
    const persistedSelections = {
      "hourly-line": {
        duePosition: "arrears",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
        servicePeriodStartExclusive: "2025-01-01",
        servicePeriodEndExclusive: "2025-02-01",
        coverageRatio: 1,
      },
    };

    installPersistedRecurringExecutionHarness(engine, [hourlyLine]);

    const loadPersistedSelections = vi
      .spyOn(engine as any, "loadPersistedRecurringTimingSelections")
      .mockResolvedValue(persistedSelections);
    const getBillingCycle = vi.spyOn(engine as any, "getBillingCycle");

    const result = await engine.selectDueRecurringServicePeriodsForBillingWindow(
      "client-1",
      "2025-02-01",
      "2025-03-01",
    );

    expect(result).toEqual(persistedSelections);
    expect(
      (engine as any).getClientContractLinesForBillingPeriod,
    ).toHaveBeenCalledWith("client-1", {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    });
    expect(loadPersistedSelections).toHaveBeenCalledWith(
      {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
      [hourlyLine],
    );
    expect(getBillingCycle).not.toHaveBeenCalled();
  });

  it("passes persisted execution-window timing through billing calculation without calling the legacy client-cycle loader", async () => {
    const engine = new BillingEngine();
    const hourlyLine = {
      client_contract_line_id: "hourly-line",
      contract_line_name: "Recurring Hours",
      contract_line_type: "Hourly",
      currency_code: "USD",
      billing_timing: "arrears",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;
    const persistedSelection = {
      duePosition: "arrears",
      servicePeriodStart: "2025-01-01",
      servicePeriodEnd: "2025-01-31",
      servicePeriodStartExclusive: "2025-01-01",
      servicePeriodEndExclusive: "2025-02-01",
      coverageRatio: 1,
    };

    installPersistedRecurringExecutionHarness(engine, [hourlyLine]);

    const getClientContractLinesAndCycle = vi.spyOn(
      engine as any,
      "getClientContractLinesAndCycle",
    );
    const getBillingCycle = vi.spyOn(engine as any, "getBillingCycle");
    await engine.calculateBillingForExecutionWindow(
      "client-1",
      "2025-02-01",
      "2025-03-01",
      {
        recurringTimingSelections: {
          "hourly-line": persistedSelection,
        },
        recurringTimingSelectionSource: "persisted",
      },
    );

    expect(getClientContractLinesAndCycle).not.toHaveBeenCalled();
    expect(
      (engine as any).getClientContractLinesForBillingPeriod,
    ).toHaveBeenCalledWith("client-1", {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    });
    expect(getBillingCycle).not.toHaveBeenCalled();
  });

  it("T150: partial rollout protection rejects a billing run when a provided recurring selection diverges from the canonical service period for a line", async () => {
    const engine = new BillingEngine();
    const billingPeriod = {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    };

    const recurringLine = {
      client_contract_line_id: "recurring-line",
      contract_line_name: "Recurring Fixed",
      contract_line_type: "Fixed",
      currency_code: "USD",
      billing_timing: "arrears",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    installRecurringRolloutGuardHarness(engine, [recurringLine]);

    const canonicalSelections = (engine as any).buildRecurringTimingSelections(
      billingPeriod,
      [recurringLine],
      "monthly",
    );

    await expect(
      (engine as any).calculateBillingInternal(
        "client-1",
        billingPeriod.startDate,
        billingPeriod.endDate,
        "cycle-1",
        {
          recurringTimingSelections: {
            "recurring-line": {
              ...canonicalSelections["recurring-line"],
              servicePeriodEnd: "2025-01-30",
            },
          },
        },
      ),
    ).rejects.toThrow(
      "Recurring timing rollout guard blocked mixed legacy/canonical timing state: recurring-line: selection diverged from canonical timing",
    );

    expect((engine as any).calculateFixedPriceCharges).not.toHaveBeenCalled();
    expect((engine as any).calculateProductCharges).not.toHaveBeenCalled();
    expect((engine as any).calculateLicenseCharges).not.toHaveBeenCalled();
  });

  it("skips hourly and usage contract lines when precomputing recurring timing selections", () => {
    const engine = new BillingEngine();

    const billingPeriod = {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    };

    const fixedLine = {
      client_contract_line_id: "fixed-line",
      contract_line_type: "Fixed",
      billing_timing: "advance",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    const hourlyLine = {
      client_contract_line_id: "hourly-line",
      contract_line_type: "Hourly",
      billing_timing: "arrears",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    const usageLine = {
      client_contract_line_id: "usage-line",
      contract_line_type: "Usage",
      billing_timing: "arrears",
      billing_frequency: "monthly",
      cadence_owner: "client",
      start_date: "2025-01-01",
      end_date: null,
    } as any;

    const recurringTimingSelections = (engine as any).buildRecurringTimingSelections(
      billingPeriod,
      [hourlyLine, fixedLine, usageLine],
      "monthly",
    );

    expect(recurringTimingSelections).toMatchObject({
      "fixed-line": {
        duePosition: "advance",
        servicePeriodStart: "2025-02-01",
        servicePeriodEnd: "2025-02-28",
      },
    });
    expect(recurringTimingSelections["hourly-line"]).toBeUndefined();
    expect(recurringTimingSelections["usage-line"]).toBeUndefined();
  });

  it("T041: fixed recurring charge calculation no longer depends on resolveServicePeriod", async () => {
    const engine = new BillingEngine();
    (engine as any).tenant = "test_tenant";
    vi.spyOn(engine as any, "getBillingCycle").mockResolvedValue("monthly");
    expect((engine as any).resolveServicePeriod).toBeUndefined();

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "contract_pricing_schedules") {
        return buildQuery(null);
      }

      if (tableName === "clients") {
        return buildQuery({
          client_id: "client-1",
          tenant: "test_tenant",
          client_name: "Mock Client",
          is_tax_exempt: false,
        });
      }

      if (tableName === "contract_lines") {
        return buildQuery({
          contract_line_id: "contract-line-1",
          tenant: "test_tenant",
          contract_line_type: "Fixed",
          custom_rate: 20000,
          enable_proration: false,
          billing_cycle_alignment: "start",
        });
      }

      if (tableName === "contract_line_services as cls") {
        return buildQuery(null, [
          {
            service_id: "service-1",
            service_name: "Managed Support",
            default_rate: 20000,
            tax_rate_id: null,
            service_quantity: 1,
            configuration_quantity: 1,
            config_id: "config-1",
            service_base_rate: 20000,
          },
        ]);
      }

      return buildQuery(null);
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
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "arrears",
        start_date: "2025-01-01",
        end_date: null,
        custom_rate: 15000,
      },
    );

    expect(charges).toEqual([
      expect.objectContaining({
        type: "fixed",
        rate: 15000,
        total: 15000,
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
      }),
    ]);
  });

  it("T042: fixed recurring parity holds for a full-period monthly client-cadence contract", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      serviceRates: [6200],
      enableProration: false,
      billingPeriod: {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
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

    expect(charges).toEqual([
      expect.objectContaining({
        type: "fixed",
        total: 6200,
        rate: 6200,
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
        client_contract_id: "assignment-1",
      }),
    ]);
  });

  it("T043: fixed recurring parity holds for a mid-start monthly client-cadence contract", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      serviceRates: [6200],
      enableProration: true,
      billingPeriod: {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "arrears",
        start_date: "2025-01-10",
        end_date: null,
        custom_rate: null,
      },
    );

    expect(charges).toEqual([
      expect.objectContaining({
        type: "fixed",
        total: 4400,
        rate: 4400,
        servicePeriodStart: "2025-01-10",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
        client_contract_id: "assignment-1",
      }),
    ]);
  });

  it("T044: fixed recurring parity holds for a mid-end monthly client-cadence contract", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      serviceRates: [6200],
      enableProration: false,
      billingPeriod: {
        startDate: "2025-01-01",
        endDate: "2025-02-01",
      },
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "advance",
        start_date: "2024-12-01",
        end_date: "2025-01-20",
        custom_rate: null,
      },
    );

    expect(charges).toEqual([
      expect.objectContaining({
        type: "fixed",
        total: 4000,
        rate: 4000,
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-20",
        billingTiming: "advance",
        client_contract_id: "assignment-1",
      }),
    ]);
  });

  it("T078: advance duplicate-prevention uses canonical service-period end dates instead of invoice-window ends", async () => {
    const engine = new BillingEngine();
    (engine as any).tenant = "test_tenant";

    vi.spyOn(engine as any, "getBillingCycle").mockResolvedValue("monthly");
    const existingChargeSpy = vi
      .spyOn(engine as any, "hasExistingServicePeriodCharge")
      .mockResolvedValue(false);
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
      "US-NY",
    );
    vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
      taxRegion: undefined,
      isTaxable: false,
    });

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "contract_pricing_schedules") {
        return buildQuery(null);
      }

      if (tableName === "clients") {
        return buildQuery({
          client_id: "client-1",
          tenant: "test_tenant",
          client_name: "Mock Client",
          is_tax_exempt: false,
        });
      }

      if (tableName === "contract_lines") {
        return buildQuery({
          contract_line_id: "contract-line-1",
          tenant: "test_tenant",
          contract_line_type: "Fixed",
          custom_rate: 6200,
          enable_proration: false,
          billing_cycle_alignment: "start",
        });
      }

      if (tableName === "contract_line_services as cls") {
        return buildQuery(null, [
          {
            service_id: "service-1",
            service_name: "Managed Support",
            default_rate: 6200,
            tax_rate_id: null,
            service_quantity: 1,
            configuration_quantity: 1,
            config_id: "config-1",
            service_base_rate: 6200,
          },
        ]);
      }

      return buildQuery(null);
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      {
        startDate: "2025-01-01",
        endDate: "2025-02-01",
      },
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "advance",
        start_date: "2024-12-01",
        end_date: null,
        custom_rate: null,
      },
    );

    expect(existingChargeSpy).toHaveBeenCalledWith(
      "ccd-1",
      "2025-01-01",
      "2025-01-31",
      "advance",
    );
    expect(charges).toEqual([
      expect.objectContaining({
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "advance",
      }),
    ]);
  });

  it("T087: billed-through suppression skips an already-persisted advance service period even when the invoice window is later metadata", async () => {
    const engine = new BillingEngine();
    (engine as any).tenant = "test_tenant";

    vi.spyOn(engine as any, "getBillingCycle").mockResolvedValue("monthly");
    vi.spyOn(engine as any, "hasExistingServicePeriodCharge").mockResolvedValue(
      true,
    );
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
      "US-NY",
    );
    vi.spyOn(engine as any, "getTaxInfoFromService").mockResolvedValue({
      taxRegion: undefined,
      isTaxable: false,
    });

    (engine as any).knex = vi.fn().mockImplementation((tableName: string) => {
      if (tableName === "contract_pricing_schedules") {
        return buildQuery(null);
      }

      if (tableName === "clients") {
        return buildQuery({
          client_id: "client-1",
          tenant: "test_tenant",
          client_name: "Mock Client",
          is_tax_exempt: false,
        });
      }

      if (tableName === "contract_lines") {
        return buildQuery({
          contract_line_id: "contract-line-1",
          tenant: "test_tenant",
          contract_line_type: "Fixed",
          custom_rate: 6200,
          enable_proration: false,
          billing_cycle_alignment: "start",
        });
      }

      if (tableName === "contract_line_services as cls") {
        return buildQuery(null, [
          {
            service_id: "service-1",
            service_name: "Managed Support",
            default_rate: 6200,
            tax_rate_id: null,
            service_quantity: 1,
            configuration_quantity: 1,
            config_id: "config-1",
            service_base_rate: 6200,
          },
        ]);
      }

      return buildQuery(null);
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      {
        startDate: "2025-01-01",
        endDate: "2025-02-01",
      },
      {
        client_contract_line_id: "ccd-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "advance",
        start_date: "2024-12-01",
        end_date: null,
        custom_rate: null,
      },
    );

    expect(charges).toEqual([]);
  });

  it("T162: billing_cycle_alignment no longer changes migrated fixed recurring execution", async () => {
    const billingPeriod = {
      startDate: "2025-02-01",
      endDate: "2025-03-01",
    };

    const runForAlignment = async (
      alignment: "start" | "end" | "prorated",
    ) => {
      const engine = new BillingEngine();
      installFixedChargeMocks(engine, {
        serviceRates: [6200],
        enableProration: true,
        billingCycleAlignment: alignment,
        billingPeriod,
      });

      return (engine as any).calculateFixedPriceCharges(
        "client-1",
        billingPeriod,
        {
          client_contract_line_id: "ccd-1",
          client_id: "client-1",
          contract_line_id: "contract-line-1",
          client_contract_id: "assignment-1",
          contract_id: "contract-1",
          contract_line_name: "Managed Support",
          contract_name: "Acme Corp",
          billing_timing: "arrears",
          start_date: "2025-01-10",
          end_date: null,
          custom_rate: null,
        },
      );
    };

    const [startCharges, endCharges, proratedCharges] = await Promise.all([
      runForAlignment("start"),
      runForAlignment("end"),
      runForAlignment("prorated"),
    ]);

    expect(startCharges).toEqual([
      expect.objectContaining({
        type: "fixed",
        total: 4400,
        rate: 4400,
        servicePeriodStart: "2025-01-10",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
      }),
    ]);
    expect(endCharges).toEqual(startCharges);
    expect(proratedCharges).toEqual(startCharges);
    expect(startCharges[0]).not.toHaveProperty("billing_cycle_alignment");
    expect(endCharges[0]).not.toHaveProperty("billing_cycle_alignment");
    expect(proratedCharges[0]).not.toHaveProperty("billing_cycle_alignment");
  });

  it("T046: advance termination credits settle into one canonical partial fixed charge instead of a separate negative credit branch", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      assignmentCustomRate: 3100,
      contractLineCustomRate: 6200,
      serviceRates: [6200],
      enableProration: false,
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "contract-line-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "advance",
        start_date: "2024-12-01",
        end_date: "2025-01-20",
        custom_rate: 3100,
      },
    );

    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      type: "fixed",
      total: 2000,
      rate: 2000,
      servicePeriodStart: "2025-01-01",
      servicePeriodEnd: "2025-01-20",
      billingTiming: "advance",
    });
    expect(charges.every((charge) => (charge.total ?? 0) >= 0)).toBe(true);
  });

  it("T047: fixed FMV allocations keep their per-service totals when advance final periods settle through canonical coverage", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      contractLineCustomRate: 3100,
      assignmentCustomRate: null,
      serviceRates: [2000, 1100],
      enableProration: false,
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "contract-line-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "advance",
        start_date: "2024-12-01",
        end_date: "2025-01-20",
        custom_rate: null,
      },
    );

    expect(charges).toHaveLength(2);
    expect(charges.map((charge) => charge.total)).toEqual([1290, 710]);
    expect(charges.map((charge) => charge.allocated_amount)).toEqual([
      1290, 710,
    ]);
    expect(charges.map((charge) => charge.fmv)).toEqual([2000, 1100]);
    expect(charges.reduce((sum, charge) => sum + (charge.total ?? 0), 0)).toBe(
      2000,
    );
  });

  it("T048: pricing schedule overrides still win over base contract rates after fixed recurring timing moves onto canonical settlement", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      scheduleRate: 6200,
      contractLineCustomRate: null,
      assignmentCustomRate: 3100,
      serviceRates: [1000],
      enableProration: true,
      billingPeriod: {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "contract-line-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "arrears",
        start_date: "2025-01-10",
        end_date: null,
        custom_rate: 3100,
      },
    );

    expect(charges).toEqual([
      expect.objectContaining({
        total: 4400,
        rate: 4400,
        servicePeriodStart: "2025-01-10",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
      }),
    ]);
  });

  it("T049: contract-level custom-rate overrides still apply correctly when fixed recurring coverage is settled canonically", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      contractLineCustomRate: 6200,
      assignmentCustomRate: 3100,
      serviceRates: [6200],
      enableProration: true,
      billingPeriod: {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "contract-line-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "arrears",
        start_date: "2025-01-10",
        end_date: null,
        custom_rate: 3100,
      },
    );

    expect(charges).toEqual([
      expect.objectContaining({
        config_id: "config-1",
        serviceId: "service-1",
        client_contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        total: 2200,
        rate: 2200,
        servicePeriodStart: "2025-01-10",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
      }),
    ]);
  });

  it("preserves assignment metadata on fixed-service edge charges so PO-scoped billing can still group them correctly", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      contractLineType: "Time",
      serviceRates: [6200],
      enableProration: false,
      billingPeriod: {
        startDate: "2025-02-01",
        endDate: "2025-03-01",
      },
    });

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "contract-line-1",
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

    expect(charges).toEqual([
      expect.objectContaining({
        type: "fixed",
        config_id: "config-1",
        client_contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_name: "Acme Corp",
        servicePeriodStart: "2025-01-01",
        servicePeriodEnd: "2025-01-31",
        billingTiming: "arrears",
      }),
    ]);
  });

  it("T051: tax allocation for fixed recurring charges remains stable when timing settles a partial advance final period canonically", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      contractLineCustomRate: 3100,
      assignmentCustomRate: null,
      serviceRates: [2000, 1100],
      enableProration: false,
    });

    vi.spyOn(engine as any, "getTaxInfoFromService").mockImplementation(
      async () => ({
        taxRegion: "US-NY",
        isTaxable: true,
      }),
    );
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
      "US-NY",
    );
    vi.spyOn(TaxService.prototype, "calculateTax").mockImplementation(
      async (_clientId: string, amount: number) => ({
        taxRate: 10,
        taxAmount: Math.round(amount * 0.1),
      }),
    );

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "contract-line-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "advance",
        start_date: "2024-12-01",
        end_date: "2025-01-20",
        custom_rate: null,
      },
    );

    expect(charges.map((charge) => charge.tax_amount)).toEqual([129, 71]);
    expect(
      charges.reduce((sum, charge) => sum + (charge.tax_amount ?? 0), 0),
    ).toBe(200);
  });

  it("T052/T056: fixed recurring tax-region and tax-date selection follow the canonical settled service period", async () => {
    const engine = new BillingEngine();
    const billingPeriod = installFixedChargeMocks(engine, {
      contractLineCustomRate: 3100,
      assignmentCustomRate: null,
      serviceRates: [2000, 1100],
      enableProration: false,
    });

    vi.spyOn(engine as any, "getTaxInfoFromService").mockImplementation(
      async (service: any) => ({
        taxRegion: service.service_id === "service-1" ? "US-NY" : undefined,
        isTaxable: true,
      }),
    );
    vi.spyOn(engine as any, "getClientDefaultTaxRegionCode").mockResolvedValue(
      "US-WA",
    );

    const calculateTaxSpy = vi
      .spyOn(TaxService.prototype, "calculateTax")
      .mockImplementation(
        async (
          _clientId: string,
          amount: number,
          _taxDate: string,
          region: string,
        ) => ({
          taxRate: region === "US-NY" ? 10 : 5,
          taxAmount: Math.round(amount * (region === "US-NY" ? 0.1 : 0.05)),
        }),
      );

    const charges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      billingPeriod,
      {
        client_contract_line_id: "contract-line-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support",
        contract_name: "Acme Corp",
        billing_timing: "advance",
        start_date: "2024-12-01",
        end_date: "2025-01-20",
        custom_rate: null,
      },
    );

    expect(charges.map((charge) => charge.tax_region)).toEqual([
      "US-NY",
      "US-WA",
    ]);
    expect(calculateTaxSpy).toHaveBeenCalledWith(
      "client-1",
      2000,
      "2025-01-20",
      "US-NY",
      true,
      "USD",
    );
    expect(calculateTaxSpy).toHaveBeenCalledWith(
      "client-1",
      1100,
      "2025-01-20",
      "US-WA",
      true,
      "USD",
    );
  });

  it("T059: negative recurring totals and credit-generating fixed allocations preserve canonical service periods", async () => {
    const engine = new BillingEngine();

    const negativeBillingPeriod = installFixedChargeMocks(engine, {
      contractLineCustomRate: -1000,
      assignmentCustomRate: null,
      serviceRates: [-1000],
      enableProration: false,
    });

    const negativeCharges = await (engine as any).calculateFixedPriceCharges(
      "client-1",
      negativeBillingPeriod,
      {
        client_contract_line_id: "contract-line-1",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        client_contract_id: "assignment-1",
        contract_id: "contract-1",
        contract_line_name: "Managed Support Credit",
        contract_name: "Acme Corp",
        billing_timing: "arrears",
        start_date: "2024-12-01",
        end_date: null,
        custom_rate: null,
      },
    );

    expect(negativeCharges).toEqual([
      expect.objectContaining({
        serviceId: "service-1",
        total: -1000,
        allocated_amount: -1000,
        fmv: -1000,
        proportion: 1,
        servicePeriodStart: "2024-12-01",
        servicePeriodEnd: "2024-12-31",
        billingTiming: "arrears",
      }),
    ]);

    const mixedAllocationEngine = new BillingEngine();
    const mixedAllocationBillingPeriod = installFixedChargeMocks(
      mixedAllocationEngine,
      {
        contractLineCustomRate: 1000,
        assignmentCustomRate: null,
        serviceRates: [2000, -1000],
        enableProration: false,
      },
    );

    const mixedAllocationCharges =
      await (mixedAllocationEngine as any).calculateFixedPriceCharges(
        "client-1",
        mixedAllocationBillingPeriod,
        {
          client_contract_line_id: "contract-line-1",
          client_id: "client-1",
          contract_line_id: "contract-line-1",
          client_contract_id: "assignment-1",
          contract_id: "contract-1",
          contract_line_name: "Managed Support Credit Mix",
          contract_name: "Acme Corp",
          billing_timing: "arrears",
          start_date: "2024-12-01",
          end_date: null,
          custom_rate: null,
        },
      );

    expect(mixedAllocationCharges).toEqual([
      expect.objectContaining({
        serviceId: "service-1",
        total: 2000,
        allocated_amount: 2000,
        fmv: 2000,
        proportion: 2,
        servicePeriodStart: "2024-12-01",
        servicePeriodEnd: "2024-12-31",
        billingTiming: "arrears",
      }),
      expect.objectContaining({
        serviceId: "service-2",
        total: -1000,
        allocated_amount: -1000,
        fmv: -1000,
        proportion: -1,
        servicePeriodStart: "2024-12-01",
        servicePeriodEnd: "2024-12-31",
        billingTiming: "arrears",
      }),
    ]);
    expect(
      mixedAllocationCharges.reduce(
        (sum: number, charge: any) => sum + (charge.total ?? 0),
        0,
      ),
    ).toBe(1000);
  });
});

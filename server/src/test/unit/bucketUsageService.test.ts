import { describe, expect, it, vi } from "vitest";

import {
  findOrCreateCurrentBucketUsageRecord,
  reconcileBucketUsageRecord,
  updateBucketUsageMinutes,
} from "@alga-psa/billing/services/bucketUsageService";

type BucketUsageRow = {
  usage_id: string;
  tenant: string;
  client_id: string;
  contract_line_id: string;
  service_catalog_id: string;
  period_start: string;
  period_end: string;
  minutes_used: number;
  overage_minutes: number;
  rolled_over_minutes: number;
};

type ServiceConfigurationRow = {
  config_id: string;
  configuration_type: string;
};

/**
 * A (contract line, service) pair holds one configuration row per
 * configuration_type. Default to the single-Bucket shape; tests that care about
 * the multi-configuration case pass their own set.
 */
const DEFAULT_SERVICE_CONFIGURATIONS: ServiceConfigurationRow[] = [
  { config_id: "bucket-config-1", configuration_type: "Bucket" },
];

function buildBucketUsageTransaction(config: {
  existingUsage?: BucketUsageRow;
  previousUsage?: BucketUsageRow;
  allowRollover?: boolean;
  bucketConfig?: Record<string, unknown> | null;
  serviceConfigurations?: ServiceConfigurationRow[];
}) {
  const serviceConfigurations = config.serviceConfigurations ?? DEFAULT_SERVICE_CONFIGURATIONS;
  const state = {
    bucketUsageFirstCalls: 0,
    clientContractFirstCalls: 0,
    insertedRecord: null as Record<string, unknown> | null,
    tablesCalled: [] as string[],
    whereCalls: [] as Array<{ tableName: string; args: unknown[] }>,
    /** config_id the service resolved and then looked up a detail row for. */
    requestedBucketConfigId: null as string | null,
  };

  const trx: any = ((tableName: string) => {
    const baseTableName = tableName.split(/\s+as\s+/i)[0];
    if (baseTableName === "client_contract_lines") {
      throw new Error('relation "client_contract_lines" does not exist');
    }

    state.tablesCalled.push(tableName);
    const builder: any = {};
    // Track the filter this builder actually applied, so the fakes can answer
    // like a real table rather than ignoring the predicate.
    const appliedWhere: Record<string, unknown> = {};
    builder.where = vi.fn().mockImplementation((...args: unknown[]) => {
      state.whereCalls.push({ tableName, args });
      if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
        Object.assign(appliedWhere, args[0] as Record<string, unknown>);
      }
      return builder;
    });
    builder.andWhere = vi.fn().mockImplementation(() => builder);
    builder.whereNotNull = vi.fn().mockImplementation(() => builder);
    builder.whereNotIn = vi.fn().mockImplementation(() => builder);
    builder.join = vi.fn().mockImplementation(() => builder);
    builder.leftJoin = vi.fn().mockImplementation(() => builder);
    builder.andOn = vi.fn().mockImplementation(() => builder);
    builder.andOnVal = vi.fn().mockImplementation(() => builder);
    builder.orderBy = vi.fn().mockImplementation(() => builder);
    builder.select = vi.fn().mockImplementation(() => builder);

    builder.first = vi.fn().mockImplementation(async () => {
      if (tableName === "client_contracts as cc") {
        state.clientContractFirstCalls += 1;
        if (state.clientContractFirstCalls > 1) {
          return undefined;
        }

        return {
          client_contract_id: "assignment-1",
          client_contract_line_id: "contract-line-1",
          contract_line_id: "contract-line-1",
          start_date: "2025-01-01",
          billing_frequency: "monthly",
          cadence_owner: "client",
        };
      }

      if (tableName === "recurring_service_periods") {
        return undefined;
      }

      if (tableName === "bucket_usage") {
        state.bucketUsageFirstCalls += 1;
        return state.bucketUsageFirstCalls === 1
          ? config.existingUsage
          : config.previousUsage;
      }

      if (tableName === "contract_line_service_configuration") {
        // Honour configuration_type when the caller pins it. Omitting it is the
        // alga0002175 defect: the pair can hold an Hourly row too, and picking
        // that one leaves the bucket detail lookup below with nothing.
        const matches = "configuration_type" in appliedWhere
          ? serviceConfigurations.filter(
              (row) => row.configuration_type === appliedWhere.configuration_type,
            )
          : serviceConfigurations;

        return matches.length > 0 ? { config_id: matches[0].config_id } : undefined;
      }

      if (tableName === "contract_line_service_bucket_config") {
        const requestedConfigId = appliedWhere.config_id as string | undefined;
        state.requestedBucketConfigId = requestedConfigId ?? null;

        if (config.bucketConfig === null) {
          return undefined;
        }

        // Only Bucket configurations have a detail row.
        const owningConfiguration = serviceConfigurations.find(
          (row) => row.config_id === requestedConfigId,
        );
        if (owningConfiguration && owningConfiguration.configuration_type !== "Bucket") {
          return undefined;
        }

        return config.bucketConfig ?? {
          config_id: requestedConfigId ?? "bucket-config-1",
          contract_line_id: "contract-line-1",
          service_catalog_id: "service-1",
          total_minutes: 120,
          allow_rollover: config.allowRollover ?? false,
          overage_rate: 2.5,
          tenant: "test-tenant",
        };
      }

      return undefined;
    });

    builder.insert = vi.fn().mockImplementation((payload: Record<string, unknown>) => {
      state.insertedRecord = payload;
      return {
        returning: vi.fn().mockResolvedValue([
          {
            usage_id: "usage-new",
            ...payload,
          },
        ]),
      };
    });

    return builder;
  }) as any;

  trx.raw = (value: string) => value;
  trx.client = {
    config: {
      tenant: "test-tenant",
    },
  };

  return { trx, state };
}

function buildBucketUsageUpdateTransaction(config: {
  currentUsage: Record<string, unknown>;
  timeEntryMinutes?: string | number | null;
  usageMinutes?: string | number | null;
  updateCount?: number;
  firstErrorTable?: "time_entries" | "usage_tracking";
}) {
  const state = {
    tablesCalled: [] as string[],
    whereCalls: [] as Array<{ tableName: string; args: unknown[] }>,
    updates: [] as Array<{ tableName: string; payload: Record<string, unknown> }>,
  };

  const trx: any = ((tableName: string) => {
    state.tablesCalled.push(tableName);

    const builder: any = {};
    builder.where = vi.fn().mockImplementation((...args: unknown[]) => {
      state.whereCalls.push({ tableName, args });
      return builder;
    });
    builder.andWhere = vi.fn().mockImplementation(() => builder);
    builder.join = vi.fn().mockImplementation(() => builder);
    builder.leftJoin = vi.fn().mockImplementation(() => builder);
    builder.andOn = vi.fn().mockImplementation(() => builder);
    builder.andOnVal = vi.fn().mockImplementation(() => builder);
    builder.select = vi.fn().mockImplementation(() => builder);
    builder.sum = vi.fn().mockImplementation(() => builder);
    builder.first = vi.fn().mockImplementation(async () => {
      if (tableName === config.firstErrorTable) {
        throw new Error(`${tableName} aggregation failed`);
      }

      if (tableName === "bucket_usage as bu") {
        return config.currentUsage;
      }

      if (tableName === "time_entries") {
        return { total_duration_minutes: config.timeEntryMinutes ?? null };
      }

      if (tableName === "usage_tracking") {
        return { total_quantity: config.usageMinutes ?? null };
      }

      return undefined;
    });
    builder.update = vi.fn().mockImplementation(async (payload: Record<string, unknown>) => {
      state.updates.push({ tableName, payload });
      return config.updateCount ?? 1;
    });

    return builder;
  }) as any;

  trx.raw = (value: string) => value;
  trx.fn = {
    now: vi.fn(() => "NOW"),
  };
  trx.client = {
    config: {
      tenant: "test-tenant",
    },
  };

  return { trx, state };
}

describe("BucketUsageService Unit Tests", () => {
  describe("findOrCreateCurrentBucketUsageRecord", () => {
    it("returns an existing bucket usage record without creating one", async () => {
      const existingUsage: BucketUsageRow = {
        usage_id: "usage-existing",
        tenant: "test-tenant",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        service_catalog_id: "service-1",
        period_start: "2025-02-01",
        period_end: "2025-02-28",
        minutes_used: 45,
        overage_minutes: 0,
        rolled_over_minutes: 0,
      };
      const { trx, state } = buildBucketUsageTransaction({ existingUsage });

      const record = await findOrCreateCurrentBucketUsageRecord(
        trx,
        "client-1",
        "service-1",
        "2025-02-10T00:00:00Z",
      );

      expect(record).toBe(existingUsage);
      expect(state.insertedRecord).toBeNull();
      expect(state.tablesCalled).not.toContain("contract_line_service_configuration");
      expect(state.whereCalls).toContainEqual({
        tableName: "bucket_usage",
        args: ["bucket_usage.tenant", "test-tenant"],
      });
    });

    it("creates a zeroed usage record when rollover is disabled", async () => {
      const { trx, state } = buildBucketUsageTransaction({
        bucketConfig: {
          config_id: "bucket-config-1",
          contract_line_id: "contract-line-1",
          service_catalog_id: "service-1",
          total_minutes: 120,
          allow_rollover: false,
          overage_rate: 2.5,
          tenant: "test-tenant",
        },
      });

      const record = await findOrCreateCurrentBucketUsageRecord(
        trx,
        "client-1",
        "service-1",
        "2025-02-10T00:00:00Z",
      );

      expect(state.insertedRecord).toEqual({
        tenant: "test-tenant",
        client_id: "client-1",
        contract_line_id: "contract-line-1",
        service_catalog_id: "service-1",
        period_start: "2025-02-01",
        period_end: "2025-02-28",
        minutes_used: 0,
        overage_minutes: 0,
        rolled_over_minutes: 0,
      });
      expect(record).toEqual({ usage_id: "usage-new", ...state.insertedRecord });
      expect(state.bucketUsageFirstCalls).toBe(1);
    });

    it("creates a record with zero rollover when no previous period exists", async () => {
      const { trx, state } = buildBucketUsageTransaction({
        allowRollover: true,
      });

      const record = await findOrCreateCurrentBucketUsageRecord(
        trx,
        "client-1",
        "service-1",
        "2025-02-10T00:00:00Z",
      );

      expect(state.bucketUsageFirstCalls).toBe(2);
      expect(state.insertedRecord).toMatchObject({
        contract_line_id: "contract-line-1",
        period_start: "2025-02-01",
        period_end: "2025-02-28",
        rolled_over_minutes: 0,
      });
      expect(record.rolled_over_minutes).toBe(0);
    });

    it("throws when the service has no bucket configuration", async () => {
      const { trx, state } = buildBucketUsageTransaction({ bucketConfig: null });

      await expect(
        findOrCreateCurrentBucketUsageRecord(
          trx,
          "client-1",
          "service-1",
          "2025-02-10T00:00:00Z",
        ),
      ).rejects.toMatchObject({ code: "MISSING_BUCKET_CONFIG" });
      expect(state.insertedRecord).toBeNull();
    });

    // Regression: alga0002175. An Hourly contract line carrying a bucket
    // overlay ("7 hours included, overage above that") has BOTH an 'Hourly' and
    // a 'Bucket' configuration row for the one service. Resolving on
    // (contract_line_id, service_id) alone can return the Hourly row, whose
    // bucket detail lookup finds nothing — so every bucket time entry in the
    // tenant fails. Ordered Hourly-first here so an unqualified query picks it.
    it("resolves the Bucket configuration when the line also has an Hourly one", async () => {
      const { trx, state } = buildBucketUsageTransaction({
        serviceConfigurations: [
          { config_id: "hourly-config-1", configuration_type: "Hourly" },
          { config_id: "bucket-config-1", configuration_type: "Bucket" },
        ],
      });

      const record = await findOrCreateCurrentBucketUsageRecord(
        trx,
        "client-1",
        "service-1",
        "2025-02-10T00:00:00Z",
      );

      expect(state.requestedBucketConfigId).toBe("bucket-config-1");
      expect(record).toMatchObject({
        contract_line_id: "contract-line-1",
        service_catalog_id: "service-1",
        minutes_used: 0,
      });
    });

    it("pins configuration_type when querying contract_line_service_configuration", async () => {
      const { trx, state } = buildBucketUsageTransaction({});

      await findOrCreateCurrentBucketUsageRecord(
        trx,
        "client-1",
        "service-1",
        "2025-02-10T00:00:00Z",
      );

      const configurationFilters = state.whereCalls
        .filter((call) => call.tableName === "contract_line_service_configuration")
        .flatMap((call) => call.args)
        .filter((arg): arg is Record<string, unknown> =>
          typeof arg === "object" && arg !== null,
        );

      expect(
        configurationFilters.some((filter) => filter.configuration_type === "Bucket"),
      ).toBe(true);
    });

    it("reports a missing Bucket configuration distinctly from a missing detail row", async () => {
      const { trx } = buildBucketUsageTransaction({
        // Line covers the service, but only with an Hourly configuration.
        serviceConfigurations: [
          { config_id: "hourly-config-1", configuration_type: "Hourly" },
        ],
      });

      await expect(
        findOrCreateCurrentBucketUsageRecord(
          trx,
          "client-1",
          "service-1",
          "2025-02-10T00:00:00Z",
        ),
      ).rejects.toMatchObject({ code: "MISSING_PLAN_SERVICE_CONFIG" });
    });
  });

  describe("updateBucketUsageMinutes", () => {
    it("calculates overage when a positive delta exceeds total minutes", async () => {
      const { trx, state } = buildBucketUsageUpdateTransaction({
        currentUsage: {
          minutes_used: 90,
          rolled_over_minutes: 0,
          total_minutes: 100,
        },
      });

      await updateBucketUsageMinutes(trx, "usage-1", 25);

      expect(state.updates).toEqual([
        {
          tableName: "bucket_usage",
          payload: {
            minutes_used: 115,
            overage_minutes: 15,
          },
        },
      ]);
    });

    it("reduces overage to zero after a negative delta", async () => {
      const { trx, state } = buildBucketUsageUpdateTransaction({
        currentUsage: {
          minutes_used: 150,
          rolled_over_minutes: 0,
          total_minutes: 100,
        },
      });

      await updateBucketUsageMinutes(trx, "usage-1", -60);

      expect(state.updates).toEqual([
        {
          tableName: "bucket_usage",
          payload: {
            minutes_used: 90,
            overage_minutes: 0,
          },
        },
      ]);
    });

    it("does no database work for a zero delta", async () => {
      const { trx, state } = buildBucketUsageUpdateTransaction({
        currentUsage: {
          minutes_used: 20,
          rolled_over_minutes: 0,
          total_minutes: 100,
        },
      });

      await expect(updateBucketUsageMinutes(trx, "usage-1", 0)).resolves.toBeUndefined();

      expect(state.tablesCalled).toEqual([]);
      expect(state.updates).toEqual([]);
    });

    it("throws when the tenant-scoped update affects no usage row", async () => {
      const { trx, state } = buildBucketUsageUpdateTransaction({
        currentUsage: {
          minutes_used: 20,
          rolled_over_minutes: 0,
          total_minutes: 100,
        },
        updateCount: 0,
      });

      await expect(updateBucketUsageMinutes(trx, "usage-missing", 10)).rejects.toThrow(
        "Failed to update bucket usage record with ID usage-missing. Record might not exist or tenant mismatch.",
      );
      expect(state.whereCalls).toContainEqual({
        tableName: "bucket_usage",
        args: ["bucket_usage.tenant", "test-tenant"],
      });
      expect(state.updates).toHaveLength(1);
    });
  });

  describe("reconcileBucketUsageRecord", () => {
    it("writes zero sums when no time entries or usage rows exist", async () => {
      const { trx, state } = buildBucketUsageUpdateTransaction({
        currentUsage: {
          client_id: "client-1",
          service_catalog_id: "service-1",
          period_start: "2025-02-01",
          period_end: "2025-02-28",
          rolled_over_minutes: 0,
          total_minutes: 120,
        },
        timeEntryMinutes: null,
        usageMinutes: null,
      });

      await reconcileBucketUsageRecord(trx, "usage-1");

      expect(state.updates).toEqual([
        {
          tableName: "bucket_usage",
          payload: {
            minutes_used: 0,
            overage_minutes: 0,
          },
        },
      ]);
      expect(state.whereCalls).toEqual(
        expect.arrayContaining([
          { tableName: "time_entries", args: ["time_entries.tenant", "test-tenant"] },
          { tableName: "usage_tracking", args: ["usage_tracking.tenant", "test-tenant"] },
          { tableName: "bucket_usage", args: ["bucket_usage.tenant", "test-tenant"] },
        ]),
      );
    });

    it("propagates reconciliation query failures without updating usage", async () => {
      const { trx, state } = buildBucketUsageUpdateTransaction({
        currentUsage: {
          client_id: "client-1",
          service_catalog_id: "service-1",
          period_start: "2025-02-01",
          period_end: "2025-02-28",
          rolled_over_minutes: 0,
          total_minutes: 120,
        },
        firstErrorTable: "time_entries",
      });

      await expect(reconcileBucketUsageRecord(trx, "usage-1")).rejects.toThrow(
        "time_entries aggregation failed",
      );
      expect(state.tablesCalled).not.toContain("usage_tracking");
      expect(state.updates).toEqual([]);
    });
  });
});

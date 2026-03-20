import { describe, expect, it, vi } from "vitest";

import { findOrCreateCurrentBucketUsageRecord } from "@alga-psa/billing/services/bucketUsageService";

type RecurringServicePeriodRow = {
  schedule_key: string;
  service_period_start: string;
  service_period_end: string;
};

function buildBucketUsageTransaction(config: {
  cadenceOwner: "client" | "contract";
  clientContractLineId: string;
  contractLineId: string;
  currentRecurringPeriod: RecurringServicePeriodRow;
  previousRecurringPeriod: RecurringServicePeriodRow;
  previousBucketUsage: {
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
}) {
  const state = {
    bucketUsageFirstCalls: 0,
    recurringServicePeriodCalls: 0,
    insertedRecord: null as Record<string, unknown> | null,
    tablesCalled: [] as string[],
    recurringWhereCalls: [] as unknown[][][],
  };

  const trx: any = ((tableName: string) => {
    const baseTableName = tableName.split(/\s+as\s+/i)[0];
    if (baseTableName === "client_contract_lines") {
      throw new Error('relation "client_contract_lines" does not exist');
    }

    state.tablesCalled.push(tableName);
    const builder: any = {};
    const recurringCallIndex =
      tableName === "recurring_service_periods"
        ? state.recurringWhereCalls.push([]) - 1
        : -1;

    builder.where = vi.fn().mockImplementation((...args: unknown[]) => {
      if (recurringCallIndex >= 0) {
        state.recurringWhereCalls[recurringCallIndex].push(args);
      }
      return builder;
    });
    builder.andWhere = vi.fn().mockImplementation((...args: unknown[]) => {
      if (recurringCallIndex >= 0) {
        state.recurringWhereCalls[recurringCallIndex].push(args);
      }
      return builder;
    });
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
        return {
          client_contract_line_id: config.clientContractLineId,
          contract_line_id: config.contractLineId,
          start_date: "2024-12-15",
          billing_frequency: "monthly",
          cadence_owner: config.cadenceOwner,
        };
      }

      if (tableName === "recurring_service_periods") {
        state.recurringServicePeriodCalls += 1;
        return state.recurringServicePeriodCalls === 1
          ? config.currentRecurringPeriod
          : config.previousRecurringPeriod;
      }

      if (tableName === "bucket_usage") {
        state.bucketUsageFirstCalls += 1;
        if (state.bucketUsageFirstCalls === 1) {
          return undefined;
        }

        return config.previousBucketUsage;
      }

      if (tableName === "contract_line_service_configuration") {
        return {
          config_id: "bucket-config-1",
        };
      }

      if (tableName === "contract_line_service_bucket_config") {
        return {
          config_id: "bucket-config-1",
          contract_line_id: config.contractLineId,
          service_catalog_id: "service-1",
          total_minutes: 2400,
          allow_rollover: true,
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

describe("bucketUsageService period selection", () => {
  it("T054: bucket recurring period resolution follows canonical recurring service periods for client cadence", async () => {
    const { trx, state } = buildBucketUsageTransaction({
      cadenceOwner: "client",
      clientContractLineId: "plan-1",
      contractLineId: "plan-1",
      currentRecurringPeriod: {
        schedule_key: "schedule-client",
        service_period_start: "2025-02-01",
        service_period_end: "2025-03-01",
      },
      previousRecurringPeriod: {
        schedule_key: "schedule-client",
        service_period_start: "2025-01-01",
        service_period_end: "2025-02-01",
      },
      previousBucketUsage: {
        usage_id: "usage-prev",
        tenant: "test-tenant",
        client_id: "client-1",
        contract_line_id: "plan-1",
        service_catalog_id: "service-1",
        period_start: "2025-01-01",
        period_end: "2025-01-31",
        minutes_used: 1800,
        overage_minutes: 0,
        rolled_over_minutes: 0,
      },
    });

    const record = await findOrCreateCurrentBucketUsageRecord(
      trx,
      "client-1",
      "service-1",
      "2025-02-10T00:00:00Z",
    );

    expect(state.insertedRecord).toMatchObject({
      tenant: "test-tenant",
      client_id: "client-1",
      contract_line_id: "plan-1",
      service_catalog_id: "service-1",
      period_start: "2025-02-01",
      period_end: "2025-02-28",
      rolled_over_minutes: 600,
    });
    expect(record).toMatchObject({
      usage_id: "usage-new",
      period_start: "2025-02-01",
      period_end: "2025-02-28",
      rolled_over_minutes: 600,
    });
    expect(state.tablesCalled).not.toContain("client_billing_cycles");
    expect(state.recurringWhereCalls[0]).toEqual(
      expect.arrayContaining([
        [{ tenant: "test-tenant", obligation_type: "client_contract_line", obligation_id: "plan-1" }],
      ]),
    );
  });

  it("T055: bucket recurring period resolution follows canonical recurring service periods for contract cadence", async () => {
    const { trx, state } = buildBucketUsageTransaction({
      cadenceOwner: "contract",
      clientContractLineId: "assignment-1",
      contractLineId: "plan-1",
      currentRecurringPeriod: {
        schedule_key: "schedule-contract",
        service_period_start: "2025-02-15",
        service_period_end: "2025-03-15",
      },
      previousRecurringPeriod: {
        schedule_key: "schedule-contract",
        service_period_start: "2025-01-15",
        service_period_end: "2025-02-15",
      },
      previousBucketUsage: {
        usage_id: "usage-prev",
        tenant: "test-tenant",
        client_id: "client-1",
        contract_line_id: "plan-1",
        service_catalog_id: "service-1",
        period_start: "2025-01-15",
        period_end: "2025-02-14",
        minutes_used: 1200,
        overage_minutes: 0,
        rolled_over_minutes: 0,
      },
    });

    const record = await findOrCreateCurrentBucketUsageRecord(
      trx,
      "client-1",
      "service-1",
      "2025-02-20T00:00:00Z",
    );

    expect(state.insertedRecord).toMatchObject({
      tenant: "test-tenant",
      client_id: "client-1",
      contract_line_id: "plan-1",
      service_catalog_id: "service-1",
      period_start: "2025-02-15",
      period_end: "2025-03-14",
      rolled_over_minutes: 1200,
    });
    expect(record).toMatchObject({
      usage_id: "usage-new",
      period_start: "2025-02-15",
      period_end: "2025-03-14",
      rolled_over_minutes: 1200,
    });
    expect(state.tablesCalled).not.toContain("client_billing_cycles");
    expect(state.recurringWhereCalls[0]).toEqual(
      expect.arrayContaining([
        [{ tenant: "test-tenant", obligation_type: "contract_line", obligation_id: "plan-1" }],
      ]),
    );
  });
});

import { describe, expect, it, vi } from "vitest";

import {
  findOrCreateCurrentBucketUsageRecord,
  reconcileBucketUsageRecord,
  updateBucketUsageMinutes,
} from "@alga-psa/billing/services/bucketUsageService";

type RecurringServicePeriodRow = {
  schedule_key: string;
  service_period_start: string;
  service_period_end: string;
};

function buildBucketUsageTransaction(config: {
  cadenceOwner: "client" | "contract";
  clientContractId?: string;
  clientContractLineId: string;
  contractLineId: string;
  conflictingClientContractId?: string;
  currentRecurringPeriod: RecurringServicePeriodRow;
  previousRecurringPeriod: RecurringServicePeriodRow;
  previousBucketUsage: {
    usage_id: string;
    tenant: string;
    client_id: string;
    contract_line_id: string;
    service_catalog_id: string;
    bucket_id: string;
    period_start: string;
    period_end: string;
    minutes_used: number;
    overage_minutes: number;
    rolled_over_minutes: number;
  };
  bucket?: Record<string, unknown> | null;
  members?: Array<Record<string, unknown>>;
}) {
  const state = {
    bucketUsageFirstCalls: 0,
    clientContractFirstCalls: 0,
    recurringServicePeriodCalls: 0,
    insertedRecord: null as Record<string, unknown> | null,
    tablesCalled: [] as string[],
    recurringWhereCalls: [] as unknown[][][],
  };

  const members = config.members ?? [{ bucket_id: "bucket-1", contract_line_id: config.contractLineId, service_id: "service-1", burn_multiplier: 1 }];
  const listRowsFor = (tableName: string): unknown[] => {
    if (tableName === "client_contracts as cc") {
      // The service reads active assignments as a list (no `.first()`); the
      // primary assignment row must come back for the draw to resolve.
      const primary = {
        client_contract_id: config.clientContractId ?? "assignment-1",
        client_contract_line_id: config.clientContractLineId,
        contract_line_id: config.contractLineId,
        start_date: "2024-12-15",
        billing_frequency: "monthly",
        cadence_owner: config.cadenceOwner,
      };
      if (config.conflictingClientContractId) {
        return [
          primary,
          {
            ...primary,
            client_contract_id: config.conflictingClientContractId,
          },
        ];
      }
      return [primary];
    }
    return [];
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
    builder.sum = vi.fn().mockImplementation(() => builder);

    // List reads awaited directly.
    builder.then = (resolve: (value: unknown[]) => void) => {
      resolve(listRowsFor(tableName));
    };

    builder.first = vi.fn().mockImplementation(async () => {
      if (tableName === "client_contracts as cc") {
        state.clientContractFirstCalls += 1;
        return {
          client_contract_id: config.clientContractId ?? "assignment-1",
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

      if (tableName === "contract_line_bucket_services") {
        return members[0];
      }

      if (tableName === "contract_line_buckets") {
        if (config.bucket === null) {
          return undefined;
        }
        return config.bucket ?? {
          bucket_id: "bucket-1",
          contract_line_id: config.contractLineId,
          total_minutes: 2400,
          overage_rate: 0,
          allow_rollover: true,
          covers_all_services: false,
          after_hours_multiplier: null,
          business_hours_schedule_id: null,
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
  members?: Array<Record<string, unknown>>;
  timeEntries?: Array<Record<string, unknown>>;
  usageRows?: Array<Record<string, unknown>>;
  updateCount?: number;
}) {
  const state = {
    tablesCalled: [] as string[],
    updates: [] as Array<{ tableName: string; payload: Record<string, unknown> }>,
  };

  const listRowsFor = (tableName: string): unknown[] => {
    if (tableName === "time_entries") {
      return config.timeEntries ?? [];
    }
    if (tableName === "usage_tracking") {
      return config.usageRows ?? [];
    }
    if (tableName === "contract_line_bucket_services") {
      return config.members ?? [];
    }
    return [];
  };

  const trx: any = ((tableName: string) => {
    state.tablesCalled.push(tableName);

    const builder: any = {};
    builder.where = vi.fn().mockImplementation(() => builder);
    builder.andWhere = vi.fn().mockImplementation(() => builder);
    builder.whereIn = vi.fn().mockImplementation(() => builder);
    builder.whereNull = vi.fn().mockImplementation(() => builder);
    builder.whereNotIn = vi.fn().mockImplementation(() => builder);
    builder.join = vi.fn().mockImplementation(() => builder);
    builder.leftJoin = vi.fn().mockImplementation(() => builder);
    builder.andOn = vi.fn().mockImplementation(() => builder);
    builder.andOnVal = vi.fn().mockImplementation(() => builder);
    builder.select = vi.fn().mockImplementation(() => builder);
    builder.sum = vi.fn().mockImplementation(() => builder);
    builder.then = (resolve: (value: unknown[]) => void) => {
      resolve(listRowsFor(tableName));
    };

    builder.first = vi.fn().mockImplementation(async () => {
      if (tableName === "bucket_usage as bu") {
        return config.currentUsage;
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
        bucket_id: "bucket-1",
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
      bucket_id: "bucket-1",
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
        ["recurring_service_periods.tenant", "test-tenant"],
        [{ obligation_type: "client_contract_line", obligation_id: "plan-1" }],
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
        bucket_id: "bucket-1",
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
      bucket_id: "bucket-1",
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
        ["recurring_service_periods.tenant", "test-tenant"],
        [{ obligation_type: "contract_line", obligation_id: "plan-1" }],
      ]),
    );
  });

  it("T046: overlapping bucket-bearing assignments fail explicitly instead of selecting the latest assignment silently", async () => {
    const { trx } = buildBucketUsageTransaction({
      cadenceOwner: "client",
      clientContractId: "assignment-1",
      conflictingClientContractId: "assignment-2",
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
        bucket_id: "bucket-1",
        period_start: "2025-01-01",
        period_end: "2025-01-31",
        minutes_used: 1800,
        overage_minutes: 0,
        rolled_over_minutes: 0,
      },
    });

    await expect(
      findOrCreateCurrentBucketUsageRecord(
        trx,
        "client-1",
        "service-1",
        "2025-02-10T00:00:00Z",
      ),
    ).rejects.toThrow(
      "Ambiguous bucket usage assignment resolution for client client-1, service service-1, date 2025-02-10. Matched assignments: assignment-1, assignment-2. Provide explicit assignment identity before bucket billing.",
    );
  });

  it("T056: bucket usage delta updates coerce numeric strings and never write audit timestamps", async () => {
    const { trx, state } = buildBucketUsageUpdateTransaction({
      currentUsage: {
        minutes_used: "30",
        rolled_over_minutes: "0",
        total_minutes: "120",
      },
    });

    await updateBucketUsageMinutes(trx, "usage-1", 15);

    expect(state.updates).toEqual([
      {
        tableName: "bucket_usage",
        payload: {
          minutes_used: 45,
          overage_minutes: 0,
        },
      },
    ]);
  });

  it("T057: bucket usage reconciliation coerces aggregate strings and never writes audit timestamps", async () => {
    const { trx, state } = buildBucketUsageUpdateTransaction({
      currentUsage: {
        client_id: "client-1",
        service_catalog_id: "service-1",
        contract_line_id: "plan-1",
        bucket_id: "bucket-1",
        period_start: "2025-02-01",
        period_end: "2025-02-28",
        rolled_over_minutes: "5",
        total_minutes: "40",
        allow_rollover: false,
        covers_all_services: false,
        after_hours_multiplier: null,
        business_hours_schedule_id: null,
      },
      members: [
        { bucket_id: "bucket-1", contract_line_id: "plan-1", service_id: "service-1", burn_multiplier: 1 },
      ],
      timeEntries: [
        {
          entry_id: "entry-1",
          service_id: "service-1",
          start_time: "2025-02-10T10:00:00Z",
          end_time: "2025-02-10T11:00:00Z",
          billable_duration: "45",
        },
      ],
      usageRows: [
        { service_id: "service-1", quantity: "5" },
      ],
    });

    await reconcileBucketUsageRecord(trx, "usage-1");

    expect(state.updates).toEqual([
      {
        tableName: "bucket_usage",
        payload: {
          minutes_used: 50,
          overage_minutes: 5,
        },
      },
    ]);
  });
});

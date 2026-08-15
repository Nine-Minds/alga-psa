import { describe, expect, it, vi } from "vitest";

import {
  findOrCreateCurrentBucketUsageRecord,
  reconcileBucketUsageRecord,
  resolveBucketDraw,
  updateBucketUsageMinutes,
} from "@alga-psa/billing/services/bucketUsageService";

type BucketUsageRow = {
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

type MemberRow = {
  bucket_id: string;
  contract_line_id: string;
  service_id: string;
  burn_multiplier: number;
};

type ClientContractRow = {
  client_contract_id: string;
  client_contract_line_id: string;
  contract_line_id: string;
  start_date: string;
  billing_frequency: string;
  cadence_owner: "client" | "contract" | null;
};

const PRIMARY_ASSIGNMENT: ClientContractRow = {
  client_contract_id: "assignment-1",
  client_contract_line_id: "contract-line-1",
  contract_line_id: "contract-line-1",
  start_date: "2025-01-01",
  billing_frequency: "monthly",
  cadence_owner: "client",
};

const DEFAULT_MEMBER: MemberRow = {
  bucket_id: "bucket-1",
  contract_line_id: "contract-line-1",
  service_id: "service-1",
  burn_multiplier: 1,
};

const DEFAULT_BUCKET = {
  bucket_id: "bucket-1",
  contract_line_id: "contract-line-1",
  total_minutes: 120,
  overage_rate: 2.5,
  allow_rollover: false,
  covers_all_services: false,
  after_hours_multiplier: null,
  business_hours_schedule_id: null,
};

/**
 * Build a fake transaction that answers like the new pool keying.
 * `trx` is wrapped by the real tenantDb, so every table call gets a leading
 * `.where(<table>.tenant, ...)` — the fakes tolerate that.
 */
function buildBucketUsageTransaction(config: {
  existingUsage?: BucketUsageRow;
  previousUsage?: BucketUsageRow;
  allowRollover?: boolean;
  bucket?: Record<string, unknown> | null;
  members?: MemberRow[];
  // Adds a second assignment whose line also pools the service → ambiguity.
  conflictingAssignment?: boolean;
  // The services configured on the line (contract_line_service_configuration).
  // Defaults to the known service so a catch-all draw legitimately resolves.
  lineConfiguredServices?: string[];
}) {
  const members = config.members
    ?? (config.conflictingAssignment
      // The second assignment's line also pools the service — both lines
      // resolve a bucket, so the ambiguity guard must fire.
      ? [DEFAULT_MEMBER, { ...DEFAULT_MEMBER, contract_line_id: "contract-line-2" }]
      : [DEFAULT_MEMBER]);
  const lineConfiguredServices = config.lineConfiguredServices ?? [DEFAULT_MEMBER.service_id];
  const state = {
    bucketUsageFirstCalls: 0,
    clientContractFirstCalls: 0,
    insertedRecord: null as Record<string, unknown> | null,
    tablesCalled: [] as string[],
    whereCalls: [] as Array<{ tableName: string; args: unknown[] }>,
  };

  const listRowsFor = (tableName: string): unknown[] => {
    if (tableName === "contract_line_service_configuration") {
      // The line's roster of configured services — the catch-all draw set.
      return lineConfiguredServices.map((service_id) => ({ service_id }));
    }
    if (tableName === "client_contracts as cc") {
      // The service reads the active assignments as a list and resolves each
      // line's pool itself (scope rule per line, then the ambiguity guard).
      if (config.conflictingAssignment) {
        return [
          PRIMARY_ASSIGNMENT,
          {
            client_contract_id: "assignment-2",
            contract_line_id: "contract-line-2",
            start_date: "2025-01-01",
            billing_frequency: "monthly",
            cadence_owner: "client",
          },
        ];
      }
      return [PRIMARY_ASSIGNMENT];
    }
    return [];
  };

  const trx: any = ((tableName: string) => {
    const baseTableName = tableName.split(/\s+as\s+/i)[0];
    if (baseTableName === "client_contract_lines") {
      throw new Error('relation "client_contract_lines" does not exist');
    }
    if (baseTableName === "contract_line_service_bucket_config") {
      throw new Error("legacy bucket configuration should not be queried by the pool-keyed service");
    }

    state.tablesCalled.push(tableName);
    const builder: any = {};
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
    builder.whereIn = vi.fn().mockImplementation(() => builder);
    builder.join = vi.fn().mockImplementation(() => builder);
    builder.leftJoin = vi.fn().mockImplementation(() => builder);
    builder.andOn = vi.fn().mockImplementation(() => builder);
    builder.andOnVal = vi.fn().mockImplementation(() => builder);
    builder.orderBy = vi.fn().mockImplementation(() => builder);
    builder.select = vi.fn().mockImplementation(() => builder);
    builder.sum = vi.fn().mockImplementation(() => builder);

    // List reads are awaited directly (`await q.select(...)`): make the
    // builder thenable. Chainable `.orderBy(...).first()` still works.
    builder.then = (resolve: (value: unknown[]) => void, reject: (reason?: unknown) => void) => {
      if (tableName === config.firstErrorTable) {
        reject(new Error(`${tableName} aggregation failed`));
        return;
      }
      resolve(listRowsFor(tableName));
    };

    builder.first = vi.fn().mockImplementation(async () => {
      if (tableName === "client_contracts as cc") {
        state.clientContractFirstCalls += 1;
        return PRIMARY_ASSIGNMENT;
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

      if (tableName === "contract_line_bucket_services") {
        const lineId = appliedWhere.contract_line_id as string | undefined;
        const serviceId = appliedWhere.service_id as string | undefined;
        return members.find(
          (member) =>
            (lineId === undefined || member.contract_line_id === lineId) &&
            (serviceId === undefined || member.service_id === serviceId),
        );
      }

      if (tableName === "contract_line_buckets") {
        if (config.bucket === null) {
          return undefined;
        }
        const requestedBucketId = appliedWhere.bucket_id as string | undefined;
        const bucket = config.bucket ?? { ...DEFAULT_BUCKET, allow_rollover: config.allowRollover ?? false };
        if (requestedBucketId && requestedBucketId !== bucket.bucket_id) {
          return undefined;
        }
        // Catch-all lookups filter on covers_all_services — honor it so a
        // member-scoped bucket never answers a catch-all probe.
        if (appliedWhere.covers_all_services !== undefined
            && Boolean(bucket.covers_all_services) !== Boolean(appliedWhere.covers_all_services)) {
          return undefined;
        }
        return bucket;
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
  members?: MemberRow[];
  timeEntries?: Array<Record<string, unknown>>;
  usageRows?: Array<Record<string, unknown>>;
  updateCount?: number;
  firstErrorTable?: string;
  afterHours?: boolean;
}) {
  const state = {
    tablesCalled: [] as string[],
    whereCalls: [] as Array<{ tableName: string; args: unknown[] }>,
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
      return config.members ?? [DEFAULT_MEMBER];
    }
    if (tableName === "business_hours_entries") {
      return [];
    }
    if (tableName === "holidays") {
      return [];
    }
    return [];
  };

  const trx: any = ((tableName: string) => {
    const baseTableName = tableName.split(/\s+as\s+/i)[0];
    state.tablesCalled.push(tableName);

    const builder: any = {};
    const appliedWhere: Record<string, unknown> = {};
    builder.where = vi.fn().mockImplementation((...args: unknown[]) => {
      state.whereCalls.push({ tableName, args });
      if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
        Object.assign(appliedWhere, args[0] as Record<string, unknown>);
      }
      return builder;
    });
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

    // List reads are awaited directly (`await q.select(...)`): make the
    // builder thenable. `.first()` still works because chainable methods keep
    // returning the builder.
    builder.then = (resolve: (value: unknown[]) => void, reject: (reason?: unknown) => void) => {
      if (tableName === config.firstErrorTable) {
        reject(new Error(`${tableName} aggregation failed`));
        return;
      }
      resolve(listRowsFor(tableName));
    };

    builder.first = vi.fn().mockImplementation(async () => {
      if (tableName === config.firstErrorTable) {
        throw new Error(`${tableName} aggregation failed`);
      }
      if (tableName === "bucket_usage as bu") {
        return config.currentUsage;
      }
      if (tableName === "contract_line_buckets") {
        if (config.afterHours) {
          return {
            bucket_id: "bucket-1",
            contract_line_id: "contract-line-1",
            total_minutes: 120,
            overage_rate: 0,
            allow_rollover: false,
            covers_all_services: false,
            after_hours_multiplier: 1.5,
            business_hours_schedule_id: "schedule-1",
          };
        }
        return undefined;
      }
      if (tableName === "business_hours_schedules") {
        return config.afterHours ? { timezone: "UTC", is_24x7: false } : undefined;
      }
      if (tableName === "contract_line_bucket_services") {
        return config.members?.[0];
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
  trx.client = {
    config: {
      tenant: "test-tenant",
    },
  };

  return { trx, state };
}

describe("resolveBucketDraw", () => {
  it("resolves an explicit member pool via membership", async () => {
    const { trx } = buildBucketUsageTransaction({});

    const draw = await resolveBucketDraw(trx, "client-1", "service-1", "2025-02-10T00:00:00Z");

    expect(draw).toMatchObject({
      bucketId: "bucket-1",
      contractLineId: "contract-line-1",
      serviceId: "service-1",
      memberMultiplier: 1,
      coversAllServices: false,
    });
  });

  it("resolves the line catch-all pool when the service has no explicit membership", async () => {
    const { trx } = buildBucketUsageTransaction({
      bucket: { ...DEFAULT_BUCKET, covers_all_services: true },
      members: [],
    });

    const draw = await resolveBucketDraw(trx, "client-1", "service-1", "2025-02-10T00:00:00Z");

    expect(draw).toMatchObject({
      bucketId: "bucket-1",
      memberMultiplier: 1,
      coversAllServices: true,
    });
  });

  it("does not resolve the line catch-all pool for a service the line does not offer", async () => {
    // The line's catch-all pool exists, but service-1 is NOT configured on this
    // line (contract_line_service_configuration membership) — a catch-all
    // covers all LINE services, never anything this client bills elsewhere.
    const { trx } = buildBucketUsageTransaction({
      bucket: { ...DEFAULT_BUCKET, covers_all_services: true },
      members: [],
      lineConfiguredServices: ["service-other-line"],
    });

    const draw = await resolveBucketDraw(trx, "client-1", "service-1", "2025-02-10T00:00:00Z");

    expect(draw).toBeNull();
  });

  it("returns null when the service draws from no bucket (plain hourly)", async () => {
    const { trx } = buildBucketUsageTransaction({
      bucket: null,
      members: [],
    });

    const draw = await resolveBucketDraw(trx, "client-1", "service-1", "2025-02-10T00:00:00Z");

    expect(draw).toBeNull();
  });

  it("throws AMBIGUOUS_ASSIGNMENT when another active assignment pools the service", async () => {
    const { trx } = buildBucketUsageTransaction({ conflictingAssignment: true });

    await expect(
      resolveBucketDraw(trx, "client-1", "service-1", "2025-02-10T00:00:00Z"),
    ).rejects.toMatchObject({ code: "AMBIGUOUS_ASSIGNMENT" });
  });
});

describe("findOrCreateCurrentBucketUsageRecord", () => {
  it("returns an existing bucket usage record keyed by bucket without creating one", async () => {
    const existingUsage: BucketUsageRow = {
      usage_id: "usage-existing",
      tenant: "test-tenant",
      client_id: "client-1",
      contract_line_id: "contract-line-1",
      service_catalog_id: "service-1",
      bucket_id: "bucket-1",
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

  it("creates a zeroed usage record keyed by bucket when rollover is disabled", async () => {
    const { trx, state } = buildBucketUsageTransaction({
      bucket: { ...DEFAULT_BUCKET, allow_rollover: false },
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
      bucket_id: "bucket-1",
      period_start: "2025-02-01",
      period_end: "2025-02-28",
      minutes_used: 0,
      overage_minutes: 0,
      rolled_over_minutes: 0,
    });
    expect(record).toEqual({ usage_id: "usage-new", ...state.insertedRecord });
    expect(state.bucketUsageFirstCalls).toBe(1);
  });

  it("computes weighted rollover from the pool total across periods", async () => {
    const previousUsage: BucketUsageRow = {
      usage_id: "usage-prev",
      tenant: "test-tenant",
      client_id: "client-1",
      contract_line_id: "contract-line-1",
      service_catalog_id: "service-1",
      bucket_id: "bucket-1",
      period_start: "2025-01-01",
      period_end: "2025-01-31",
      minutes_used: 60,
      overage_minutes: 0,
      rolled_over_minutes: 0,
    };
    const { trx, state } = buildBucketUsageTransaction({
      allowRollover: true,
      previousUsage,
    });

    const record = await findOrCreateCurrentBucketUsageRecord(
      trx,
      "client-1",
      "service-1",
      "2025-02-10T00:00:00Z",
    );

    // 120 total - 60 used = 60 unused minutes roll into the new period.
    expect(record.rolled_over_minutes).toBe(60);
    expect(state.insertedRecord).toMatchObject({
      bucket_id: "bucket-1",
      period_start: "2025-02-01",
      rolled_over_minutes: 60,
    });
  });

  it("throws when the service draws from no bucket pool", async () => {
    const { trx, state } = buildBucketUsageTransaction({ bucket: null, members: [] });

    await expect(
      findOrCreateCurrentBucketUsageRecord(
        trx,
        "client-1",
        "service-1",
        "2025-02-10T00:00:00Z",
      ),
    ).rejects.toMatchObject({ code: "NO_ACTIVE_CONTRACT_LINE" });
    expect(state.insertedRecord).toBeNull();
  });
});

describe("updateBucketUsageMinutes", () => {
  it("accepts a weighted numeric delta and calculates overage from the pool total", async () => {
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

  it("accrues fractional weighted overage", async () => {
    const { trx, state } = buildBucketUsageUpdateTransaction({
      currentUsage: {
        minutes_used: 99.5,
        rolled_over_minutes: 0,
        total_minutes: 100,
      },
    });

    await updateBucketUsageMinutes(trx, "usage-1", 2.5);

    expect(state.updates).toEqual([
      {
        tableName: "bucket_usage",
        payload: {
          minutes_used: 102,
          overage_minutes: 2,
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
  const reconcileUsage = {
    client_id: "client-1",
    service_catalog_id: "service-1",
    contract_line_id: "contract-line-1",
    bucket_id: "bucket-1",
    period_start: "2025-02-01",
    period_end: "2025-02-28",
    rolled_over_minutes: 0,
    total_minutes: 120,
    allow_rollover: false,
    covers_all_services: false,
    after_hours_multiplier: null,
    business_hours_schedule_id: null,
  };

  it("writes zero weighted sums when no time entries or usage rows exist", async () => {
    const { trx, state } = buildBucketUsageUpdateTransaction({ currentUsage: reconcileUsage });

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
        { tableName: "bucket_usage", args: ["bucket_usage.tenant", "test-tenant"] },
      ]),
    );
  });

  it("recomputes weighted minutes through the calculator with member multipliers", async () => {
    const { trx, state } = buildBucketUsageUpdateTransaction({
      currentUsage: reconcileUsage,
      members: [
        { bucket_id: "bucket-1", contract_line_id: "contract-line-1", service_id: "service-1", burn_multiplier: 2 },
      ],
      timeEntries: [
        {
          entry_id: "entry-1",
          service_id: "service-1",
          start_time: "2025-02-10T10:00:00Z",
          end_time: "2025-02-10T11:00:00Z",
          billable_duration: 60,
        },
      ],
      usageRows: [
        { service_id: "service-1", quantity: "30" },
      ],
    });

    await reconcileBucketUsageRecord(trx, "usage-1");

    // 60 in-hours minutes at 2x = 120, plus 30 usage units at 2x = 60 → 180 used.
    expect(state.updates[0].payload.minutes_used).toBe(180);
    expect(state.updates[0].payload.overage_minutes).toBe(60);
  });

  it("re-weights after a multiplier change (reweighting in-flight periods)", async () => {
    const { trx, state } = buildBucketUsageUpdateTransaction({
      currentUsage: reconcileUsage,
      members: [
        { bucket_id: "bucket-1", contract_line_id: "contract-line-1", service_id: "service-1", burn_multiplier: 3 },
      ],
      timeEntries: [
        {
          entry_id: "entry-1",
          service_id: "service-1",
          start_time: "2025-02-10T10:00:00Z",
          end_time: "2025-02-10T11:00:00Z",
          billable_duration: 60,
        },
      ],
    });

    await reconcileBucketUsageRecord(trx, "usage-1");

    // Multiplier changed 1 → 3: reconcile rewrites 60 in-hours minutes to 180.
    expect(state.updates[0].payload.minutes_used).toBe(180);
    expect(state.updates[0].payload.overage_minutes).toBe(60);
  });

  it("propagates reconciliation query failures without updating usage", async () => {
    const { trx, state } = buildBucketUsageUpdateTransaction({
      currentUsage: reconcileUsage,
      firstErrorTable: "time_entries",
    });

    await expect(reconcileBucketUsageRecord(trx, "usage-1")).rejects.toThrow(
      "time_entries aggregation failed",
    );
    expect(state.updates).toEqual([]);
  });
});

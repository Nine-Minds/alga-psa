/**
 * Parity: the contract simulator must produce the same charges as the billing
 * engine for the same live contract and the same activity.
 *
 * Each fixture seeds a real (database-backed) contract plus real time entries /
 * usage rows for one invoice window, then compares
 *   - the engine's dry-run charges (BillingEngine.calculateBillingForExecutionWindow,
 *     which persists nothing), against
 *   - the simulator's snapshot of the same contract, with its assumptions set to
 *     the activity that was seeded,
 * line by line. See ee/docs/plans/2026-10-20-shared-contract-charge-resolution.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { writeFileSync } from "node:fs";
import { v4 as uuidv4 } from "uuid";
import type { Knex } from "knex";
import type { ContractScenario } from "@alga-psa/types";
import { ensureClientBillingSettingsRow } from "@alga-psa/shared/billingClients/billingSettings";
import { TestContext } from "@main-test-utils/testContext";
import {
  createFixedPlanAssignment,
  createTestService,
  setupClientTaxConfiguration,
} from "@main-test-utils/billingTestHelpers";
import { createTicket as createBillingTestTicket } from "@main-test-utils/billingProfileTestHelpers";
import {
  simulateContractScenario,
  snapshotContractToScenario,
} from "@ee/lib/billing/simulator";
import { assumptionKey } from "@ee/lib/billing/simulator/syntheticActivity";
import {
  findOrCreateCurrentBucketUsageRecord,
  updateBucketUsageMinutes,
} from "@alga-psa/shared/billingClients/bucketUsageService";
import { BillingEngine } from "@alga-psa/billing/lib/billing/billingEngine";
import { syncPrepaidBlockIssuancesForContractLine } from "@alga-psa/billing/services/prepaidBlockIssuanceSync";
import { generateInvoiceForNormalizedSelectionInputs } from "@alga-psa/billing/actions/invoiceGeneration";
import { buildContractCadenceDueSelectionInput } from "@alga-psa/shared/billingClients/recurringRunExecutionIdentity";

process.env.DB_PORT =
  process.env.DB_PORT === "6432" ? "5432" : process.env.DB_PORT;

let authenticatedTenant = "";
let authenticatedUser = "";
vi.mock("@alga-psa/auth", async (importOriginal) => {
  const original = (await importOriginal()) as typeof import("@alga-psa/auth");
  return {
    ...original,
    withAuth:
      (handler: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) =>
        handler(
          {
            user_id: authenticatedUser,
            user_type: "internal",
            tenant: authenticatedTenant,
          },
          { tenant: authenticatedTenant },
          ...args,
        ),
  };
});
vi.mock("@alga-psa/auth/rbac", async (importOriginal) => ({
  ...((await importOriginal()) as typeof import("@alga-psa/auth/rbac")),
  hasPermission: vi.fn().mockResolvedValue(true),
}));

const WINDOW_START = "2025-02-15";
const WINDOW_END = "2025-03-15";
// Arrears: the service period for the 2025-02-15 invoice window is 2025-01-15..2025-02-15.
const ACTIVITY_DATE = "2025-01-20";
// Second consecutive period (rollover fixtures): service period 2025-02-15..2025-03-15,
// invoiced in the 2025-03-15..2025-04-15 window.
const SECOND_WINDOW_START = "2025-03-15";
const SECOND_WINDOW_END = "2025-04-15";
const SECOND_ACTIVITY_DATE = "2025-02-20";

type ParityLine = {
  kind: string;
  serviceId: string | null;
  quantity: number;
  net: number;
};

interface PoolSpec {
  totalMinutes: number;
  overageRate: number;
  /** burn multiplier per hourly service (default 1). */
  burn?: number;
  allowRollover?: boolean;
  /** Catch-all pool: covers every configured service on the line (no member rows). */
  coversAll?: boolean;
  /**
   * `typed-config` keeps the legacy `Bucket` configuration row (what the
   * simulator understood); `pool-only` carries the pool solely in
   * contract_line_buckets / contract_line_bucket_services (what the engine
   * reads and the live product writes for a pool on an Hourly line).
   */
  shape: "typed-config" | "pool-only";
}

interface ParityContract {
  contractId: string;
  clientContractId: string;
  hourlyServiceId: string;
  hourlyLineId: string;
  usageServiceId: string;
  usageLineId: string;
  usageTotal: number;
  scenario: ContractScenario;
}

describe("Contract charge resolution parity (simulator vs engine dry run)", () => {
  const helpers = TestContext.createHelpers();
  let context: TestContext;

  beforeAll(async () => {
    context = await helpers.beforeAll({
      runSeeds: true,
      clientName: "Parity client",
      userType: "internal",
    });
  }, 180_000);

  beforeEach(async () => {
    context = await helpers.beforeEach();
    authenticatedTenant = context.tenantId;
    authenticatedUser = context.userId;
  }, 60_000);

  afterAll(async () => {
    await helpers.afterAll();
    writeInvoiceLineDump();
  }, 60_000);

  it("fixed, product, license and hourly (no pool) charges match the engine line by line", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [150],
      usageQuantities: [3],
    });
    const { engine, simulator } = await compare(context, contract, {
      hourlyHours: 2.5,
    });
    expect(engine.length).toBeGreaterThanOrEqual(4);
    expect(simulator).toEqual(engine);
  }, 120_000);

  it("hourly + usage with a tiered usage config match the engine", async () => {
    const contract = await seedParityContract(context, {
      // One entry / one record: the engine prices each time entry and each
      // usage record separately while the simulator aggregates assumptions per
      // period (a separate engine/simulator split, marked with LEVERAGE and
      // deliberately not covered by this card).
      hourlyMinutes: [180],
      usageQuantities: [12],
    });
    const { engine, simulator } = await compare(context, contract, {
      hourlyHours: 3,
      usageQuantity: 12,
    });
    expect(simulator).toEqual(engine);
  }, 120_000);

  it("Hourly line + legacy Bucket-typed overlay pool (10h, 14h worked) matches the engine", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [840],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, shape: "typed-config" },
    });
    const { engine, simulator } = await compare(context, contract, {
      hourlyHours: 14,
    });
    expect(simulator).toEqual(engine);
  }, 120_000);

  // RED at a62fafbcb5: the simulator only prices Bucket-typed configurations. Flip to `it` when the scenario source lands.
  it("Hourly line with a pool carried only in contract_line_buckets (10h, 14h worked) matches the engine", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [840],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, shape: "pool-only" },
    });
    const { engine, simulator } = await compare(context, contract, {
      hourlyHours: 14,
    });
    // The engine bills 4 overage hours and no plain hourly charge for the pooled service.
    const bucket = engine.filter((line) => line.kind === "bucket");
    expect(bucket).toHaveLength(1);
    expect(bucket[0].net).toBe(4 * 15_000);
    expect(
      engine.filter(
        (line) => line.kind === "hourly" && line.serviceId === contract.hourlyServiceId,
      ),
    ).toHaveLength(0);
    expect(simulator).toEqual(engine);
  }, 120_000);

  // RED at a62fafbcb5: the simulator only prices Bucket-typed configurations. Flip to `it` when the scenario source lands.
  it("weighted (2x burn) pool carried only in contract_line_buckets matches the engine", async () => {
    // 8h worked at 2x = 16 weighted hours against a 10h pool => 6 overage hours.
    const contract = await seedParityContract(context, {
      hourlyMinutes: [480],
      usageQuantities: [3],
      pool: {
        totalMinutes: 600,
        overageRate: 15_000,
        burn: 2,
        shape: "pool-only",
      },
    });
    const { engine, simulator } = await compare(context, contract, {
      hourlyHours: 8,
    });
    const bucket = engine.filter((line) => line.kind === "bucket");
    expect(bucket).toHaveLength(1);
    expect(bucket[0].net).toBe(6 * 15_000);
    expect(simulator).toEqual(engine);
  }, 120_000);

  // RED at a62fafbcb5: the simulator only prices Bucket-typed configurations. Flip to `it` when the scenario source lands.
  it("a pool that is not exhausted bills no overage and no plain hourly charge", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [300],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, shape: "pool-only" },
    });
    const { engine, simulator } = await compare(context, contract, {
      hourlyHours: 5,
    });
    expect(
      engine.filter(
        (line) => line.kind === "hourly" && line.serviceId === contract.hourlyServiceId,
      ),
    ).toHaveLength(0);
    expect(simulator).toEqual(engine);
  }, 120_000);
  // RED at a62fafbcb5 (same cause). Flip to `it` when the scenario source lands.
  it("catch-all pool (covers_all_services, no member rows) matches the engine", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [840],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, coversAll: true, shape: "pool-only" },
    });
    const { engine, simulator } = await compare(context, contract, {
      hourlyHours: 14,
    });
    expect(engine.filter((line) => line.kind === "bucket")).toHaveLength(1);
    expect(simulator).toEqual(engine);
  }, 120_000);

  it("acceptance: unedited snapshot of an Hourly line + 10h pool, 14 assumed hours -> exactly 4 overage hours, no plain hourly charge", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [840],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, shape: "pool-only" },
    });
    // The snapshot is used exactly as taken: no line, service or pool field is
    // edited. Only the assumed activity and the horizon are supplied.
    const scenario = structuredClone(contract.scenario);
    scenario.horizon = { start_date: "2025-01-15T00:00:00Z", period_count: 3 };
    scenario.assumptions[assumptionKey(contract.hourlyLineId, contract.hourlyServiceId)] = { flat: 14 };
    const simulated = await simulateContractScenario(context.db, context.tenantId, scenario);
    const allLines = simulated.periods.flatMap((period) => period.lines);
    const bucketLines = allLines.filter((line) => line.charge_type === "bucket");
    // Absolute values, not a comparison with the engine: 14h worked - 10h pool = 4h at 150.00/h.
    expect(bucketLines.length).toBeGreaterThan(0);
    for (const line of bucketLines) {
      expect(line.net_amount).toBe(4 * 15_000);
      // Displayed quantity follows the invoice rule (overage hours), not the
      // canonical line's quantity of 1.
      expect(line.quantity).toBe(4);
      expect(line.quantity_label).toBe("4 hrs overage");
      expect(line.unit_price).toBe(15_000);
    }
    const hourlyForPooled = allLines.filter(
      (line) =>
        (line.charge_type === "time" || line.charge_type === "hourly") &&
        line.service_id === contract.hourlyServiceId,
    );
    expect(hourlyForPooled).toHaveLength(0);
  }, 120_000);

  it("fixed billed in advance (service period starts at the invoice window) matches the engine", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [150],
      usageQuantities: [3],
      fixedAdvance: true,
    });
    const { engine, simulator } = await compare(context, contract, { hourlyHours: 2.5 });
    expect(engine.filter((line) => line.kind === "fixed")).toHaveLength(1);
    expect(simulator).toEqual(engine);
  }, 120_000);

  it("an active contract pricing schedule overrides the fixed rate identically", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [150],
      usageQuantities: [3],
      pricingScheduleRate: 23_000,
    });
    const { engine, simulator } = await compare(context, contract, { hourlyHours: 2.5 });
    const fixedLine = engine.find((line) => line.kind === "fixed");
    expect(fixedLine?.net).toBe(23_000);
    expect(simulator).toEqual(engine);
  }, 120_000);

  it("a percentage discount on the fixed line is produced and priced identically", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [150],
      usageQuantities: [3],
      discountPercent: 0.1,
    });
    const { engine, simulator } = await compare(context, contract, { hourlyHours: 2.5 });
    const discounts = engine.filter((line) => line.kind === "discount");
    expect(discounts).toHaveLength(1);
    // percentage discounts are fractions (0.1 = 10%) of the invoice gross
    const gross = engine
      .filter((line) => line.kind !== "discount")
      .reduce((sum, line) => sum + line.net, 0);
    expect(Math.abs(discounts[0].net)).toBe(Math.round(gross * 0.1));
    expect(simulator).toEqual(engine);
  }, 120_000);

  it("pool with allow_rollover carries unused minutes into the next period and bills the same overage", async () => {
    // Period 1: 4h worked of a 10h pool => 6h carried. Period 2: 18h worked
    // against 10h + 6h = 16h => 2h overage (without rollover it would be 8h).
    const contract = await seedParityContract(context, {
      hourlyMinutes: [240],
      secondPeriodHourlyMinutes: [1080],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, allowRollover: true, shape: "pool-only" },
    });
    const { engine, simulator } = await compare(
      context,
      contract,
      { hourlyHours: 4, hourlyOverrides: { 2: 18 } },
      { period: "second", kinds: ["bucket", "hourly"] },
    );
    const record = await context
      .db("bucket_usage")
      .where({ tenant: context.tenantId, period_start: "2025-02-15" })
      .first();
    expect(Number(record.rolled_over_minutes)).toBe(360);
    expect(engine.filter((line) => line.kind === "bucket").map((line) => line.net)).toEqual([2 * 15_000]);
    expect(engine.filter((line) => line.kind === "hourly" && line.serviceId === contract.hourlyServiceId)).toHaveLength(0);
    expect(simulator).toEqual(engine);
  }, 180_000);

  it("rollover is not carried when the pool does not allow it (same two periods)", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [240],
      secondPeriodHourlyMinutes: [1080],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, allowRollover: false, shape: "pool-only" },
    });
    const { engine, simulator } = await compare(
      context,
      contract,
      { hourlyHours: 4, hourlyOverrides: { 2: 18 } },
      { period: "second", kinds: ["bucket", "hourly"] },
    );
    expect(engine.filter((line) => line.kind === "bucket").map((line) => line.net)).toEqual([8 * 15_000]);
    expect(simulator).toEqual(engine);
  }, 180_000);

  it("several time entries pooled into one pool bill the same overage as the engine", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [300, 300, 240],
      usageQuantities: [3],
      pool: { totalMinutes: 600, overageRate: 15_000, shape: "pool-only" },
    });
    const { engine, simulator } = await compare(context, contract, { hourlyHours: 14 });
    expect(engine.filter((line) => line.kind === "bucket").map((line) => line.net)).toEqual([4 * 15_000]);
    expect(simulator).toEqual(engine);
  }, 120_000);

  it("KNOWN GAP: unpooled time entries are rounded per entry by the engine and once per period by the simulator", async () => {
    // 50 + 50 minutes with a 15 minute round-up: the engine prices 60 + 60
    // = 2.00h, the simulator aggregates the assumption (100 min) and rounds
    // once to 105 min = 1.75h. Marked LEVERAGE pattern per-entry-vs-aggregated-hours.
    const contract = await seedParityContract(context, {
      hourlyMinutes: [50, 50],
      usageQuantities: [3],
    });
    const { engine, simulator } = await compare(context, contract, { hourlyHours: 100 / 60 });
    const hourlyOf = (lines: ParityLine[]) =>
      lines.filter((line) => line.kind === "hourly" && line.serviceId === contract.hourlyServiceId);
    const hoursOf = (lines: ParityLine[]) => round(hourlyOf(lines).reduce((sum, line) => sum + line.quantity, 0));
    expect(hourlyOf(engine)).toHaveLength(2);
    expect(hoursOf(engine)).toBe(2);
    expect(hoursOf(simulator)).toBe(1.75);
    // Everything except the hourly lines still matches.
    const rest = (lines: ParityLine[]) => lines.filter((line) => !hourlyOf(lines).includes(line));
    expect(rest(simulator)).toEqual(rest(engine));
  }, 120_000);

  it("consumption-mode prepaid block: the issuance line matches the engine's selected issuance", async () => {
    const contract = await seedParityContract(context, {
      hourlyMinutes: [150],
      usageQuantities: [3],
    });
    // A 10 hour block sold as the hourly service, issued at contract start.
    await context.db("contract_line_prepaid_blocks").insert({
      tenant: context.tenantId,
      contract_line_id: contract.hourlyLineId,
      block_minutes: 600,
      block_price: 150_000,
      expiry_months: 12,
      trigger_on_exhaustion: false,
      trigger_on_expiry: false,
      replenishment_tier: "draft",
      sold_as_service_id: contract.hourlyServiceId,
    });
    await context.db.transaction((trx) =>
      syncPrepaidBlockIssuancesForContractLine(trx, context.tenantId, contract.hourlyLineId),
    );
    const issuance = await context
      .db("contract_line_block_issuances")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .first();
    expect(issuance).toBeTruthy();

    const result = await BillingEngine.forTransaction(context.db as never, context.tenantId)
      .calculateBillingForExecutionWindow(context.clientId, WINDOW_START, WINDOW_END, {
        // The options invoice generation passes for a block-only selection.
        recurringTimingSelections: {},
        recurringTimingSelectionSource: "persisted",
        prepaidBlockSelection: { issuanceIds: [issuance.issuance_id] },
        nonContractSelection: { include: false, timeEntryIds: [], usageRecordIds: [] },
      });
    recordInvoiceLineDump(result);
    if (result.error) throw new Error(`Engine failed: ${result.error}`);
    const engine = (result.charges as any[])
      .filter((charge) => charge.type === "prepaid_block")
      .map((charge): ParityLine => ({
        kind: "prepaid_block",
        serviceId: charge.serviceId ?? null,
        quantity: round(Number(charge.quantity)),
        net: Number(charge.total),
      }));
    expect(engine).toHaveLength(1);

    // Re-snapshot: the block configuration was added after the seeded snapshot.
    const scenario = await snapshotContractToScenario(context.db, context.tenantId, {
      contractId: contract.contractId,
      clientContractId: contract.clientContractId,
    });
    for (const line of scenario.lines) line.cadence_owner = "contract";
    scenario.horizon = { start_date: "2025-01-15T00:00:00Z", period_count: 3 };
    const simulated = await simulateContractScenario(context.db, context.tenantId, scenario);
    const simulator = simulated.periods
      .flatMap((period) => period.lines)
      .filter((line) => line.charge_type === "prepaid_block")
      .map((line): ParityLine => ({
        kind: "prepaid_block",
        serviceId: line.service_id,
        quantity: round(Number(line.quantity ?? 0)),
        net: line.net_amount,
      }));
    expect(simulator).toEqual(engine);
  }, 120_000);
});

// ---------------------------------------------------------------------------

async function compare(
  context: TestContext,
  contract: ParityContract,
  assumed: {
    hourlyHours?: number;
    usageQuantity?: number;
    /** Assumed hourly hours for a later simulated period (index -> hours). */
    hourlyOverrides?: Record<number, number>;
  },
  options: {
    /** Which simulated period / engine invoice window to compare (default: first). */
    period?: "first" | "second";
    /** Compare only these line kinds (the other kinds are seeded for one period only). */
    kinds?: string[];
  } = {},
): Promise<{ engine: ParityLine[]; simulator: ParityLine[] }> {
  const second = options.period === "second";
  const engine = (
    await runEngineDryRun(
      context,
      contract,
      second
        ? { start: SECOND_WINDOW_START, end: SECOND_WINDOW_END }
        : { start: WINDOW_START, end: WINDOW_END },
    )
  ).filter((line) => !options.kinds || options.kinds.includes(line.kind));

  const scenario = structuredClone(contract.scenario);
  for (const line of scenario.lines) line.cadence_owner = "contract";
  // The simulator bills arrears one invoice window after the service period
  // starts, so the horizon begins one period before the engine window under
  // test: simulated period 1 is the engine's 2025-02-15 window, period 2 its
  // 2025-03-15 window. Period 0 is a warm-up and is never compared.
  scenario.horizon = { start_date: "2025-01-15T00:00:00Z", period_count: 3 };
  if (assumed.hourlyHours != null) {
    scenario.assumptions[
      assumptionKey(contract.hourlyLineId, contract.hourlyServiceId)
    ] = { flat: assumed.hourlyHours, overrides: assumed.hourlyOverrides };
  }
  scenario.assumptions[
    assumptionKey(contract.usageLineId, contract.usageServiceId)
  ] = { flat: assumed.usageQuantity ?? contract.usageTotal };
  const simulated = await simulateContractScenario(
    context.db,
    context.tenantId,
    scenario,
  );
  const lines = simulated.periods[second ? 2 : 1]?.lines ?? [];
  const simulator = lines
    .map(
      (line): ParityLine => ({
        kind: normalizeKind(line.charge_type),
        serviceId: serviceIdFor(normalizeKind(line.charge_type), line.service_id),
        quantity: quantityFor(normalizeKind(line.charge_type), Number(line.quantity ?? 0)),
        net: line.net_amount,
      }),
    )
    .filter((line) => !options.kinds || options.kinds.includes(line.kind))
    .sort(compareLines);
  return { engine, simulator };
}

/**
 * The engine's own output for the window: production invoice generation is
 * run end to end (it is the only caller that builds the persisted recurring
 * timing selections the engine needs), and the BillingEngine result is captured
 * before anything is persisted. Nothing here reimplements engine logic.
 */
async function runEngineDryRun(
  context: TestContext,
  contract: ParityContract,
  window: { start: string; end: string } = { start: WINDOW_START, end: WINDOW_END },
): Promise<ParityLine[]> {
  const captured: any[] = [];
  const original = BillingEngine.prototype.calculateBillingForExecutionWindow;
  const spy = vi
    .spyOn(BillingEngine.prototype, "calculateBillingForExecutionWindow")
    .mockImplementation(async function (this: BillingEngine, ...args) {
      const result = await original.apply(this, args);
      captured.push(result);
      return result;
    });
  try {
    await generateInvoiceForNormalizedSelectionInputs({
      user: {
        user_id: context.userId,
        user_type: "internal",
        tenant: context.tenantId,
      } as never,
      tenant: context.tenantId,
      knex: context.db,
      normalizedSelectorInputs: contract.scenario.lines.map((line) =>
        buildContractCadenceDueSelectionInput({
          clientId: context.clientId,
          contractId: contract.contractId,
          contractLineId: line.origin_contract_line_id ?? line.key,
          windowStart: `${window.start}T00:00:00Z`,
          windowEnd: `${window.end}T00:00:00Z`,
        }),
      ),
    });
  } finally {
    spy.mockRestore();
  }
  const result = captured[0];
  if (!result) throw new Error("Engine did not run for the window");
  recordInvoiceLineDump(result);
  if (result.error) throw new Error(`Engine failed: ${result.error}`);
  const chargeLines = (result.charges as any[]).map((charge): ParityLine => {
    const kind = normalizeKind(String(charge.type));
    return {
      kind,
      serviceId: serviceIdFor(kind, charge.serviceId ?? charge.service_catalog_id ?? null),
      quantity: quantityFor(kind, Number(charge.quantity ?? 0)),
      net: Number(charge.total),
    };
  });
  // Discounts are computed by the shared compute pipeline and live beside
  // `charges` on the engine result; the simulator emits them as lines.
  const discountLines = ((result.discounts ?? []) as any[]).map(
    (discount): ParityLine => ({
      kind: "discount",
      serviceId: null,
      quantity: 0,
      net: -Math.abs(Number(discount.amount)),
    }),
  );
  return [...chargeLines, ...discountLines].sort(compareLines);
}

// ---------------------------------------------------------------------------
// Invoice-line dump (before/after engine switch). When CHARGE_RESOLUTION_DUMP
// names a file, every engine result seen by this suite is written there with
// ids replaced by order-of-appearance tokens, in engine output order, so two
// runs (before and after the engine change) can be diffed byte for byte.

const dumpedResults: unknown[] = [];

function recordInvoiceLineDump(result: unknown): void {
  dumpedResults.push(result);
}

function writeInvoiceLineDump(): void {
  const target = process.env.CHARGE_RESOLUTION_DUMP;
  if (!target || dumpedResults.length === 0) return;
  const ids = new Map<string, string>();
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
  const text = JSON.stringify(
    dumpedResults,
    (key, value) =>
      key === "created_at" || key === "updated_at" || key === "tenant"
        ? undefined
        : value,
    2,
  ).replace(uuid, (match) => {
    if (!ids.has(match)) ids.set(match, `<id${ids.size}>`);
    return ids.get(match) as string;
  });
  writeFileSync(target, text);
}

function normalizeKind(kind: string): string {
  return kind === "time" ? "hourly" : kind;
}

/** Fixed and bucket-overage lines are not keyed to a catalog service on both sides. */
function serviceIdFor(kind: string, serviceId: string | null): string | null {
  return kind === "fixed" || kind === "bucket" || kind === "discount" ? null : serviceId;
}

/**
 * A bucket line's "quantity" is hours used on the engine and a unit count on
 * the simulator; the overage amount (`net`) is the comparable figure.
 */
function quantityFor(kind: string, quantity: number): number {
  return kind === "bucket" || kind === "discount" ? 0 : round(quantity);
}

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function compareLines(left: ParityLine, right: ParityLine): number {
  return `${left.kind}:${left.serviceId ?? ""}:${left.net}:${left.quantity}`.localeCompare(
    `${right.kind}:${right.serviceId ?? ""}:${right.net}:${right.quantity}`,
  );
}

async function seedParityContract(
  context: TestContext,
  options: {
    hourlyMinutes: number[];
    usageQuantities: number[];
    pool?: PoolSpec;
    /** Fixed line billed in advance (default arrears like the other lines). */
    fixedAdvance?: boolean;
    /** Contract-wide pricing schedule active over the compared service period. */
    pricingScheduleRate?: number;
    /** Percentage discount on the fixed line. */
    discountPercent?: number;
    /**
     * Minutes worked in the NEXT service period (2025-02-15..2025-03-15). When
     * set, both service periods are materialized and the pool usage for both is
     * recorded through the live bucket-usage service, in order (so rollover is
     * carried the way the live app carries it).
     */
    secondPeriodHourlyMinutes?: number[];
  },
): Promise<ParityContract> {
  const taxRateId = await setupClientTaxConfiguration(context, {
    regionCode: "US-NY",
    regionName: "New York",
    description: "Parity tax",
    startDate: "2020-01-01T00:00:00.000Z",
    taxPercentage: 10,
  });
  await ensureClientBillingSettingsRow(context.db, {
    tenant: context.tenantId,
    clientId: context.clientId,
  });
  await context
    .db("clients")
    .where({ tenant: context.tenantId, client_id: context.clientId })
    .update({ billing_cycle: "monthly" });
  await context
    .db("client_billing_settings")
    .where({ tenant: context.tenantId, client_id: context.clientId })
    .update({
      billing_cycle_anchor_day_of_month: 15,
      billing_cycle_anchor_month_of_year: null,
      billing_cycle_anchor_day_of_week: null,
      billing_cycle_anchor_reference_date: null,
    });

  const fixedService = await pricedService(context, "Managed support", "fixed", 10_000, taxRateId);
  const hourlyService = await pricedService(context, "Engineering", "hourly", 5_000, taxRateId);
  const usageService = await pricedService(context, "Cloud backup", "usage", 200, taxRateId, "GB");
  const productService = await pricedService(context, "Managed appliance", "fixed", 2_500, taxRateId);
  const licenseService = await pricedService(context, "Security license", "fixed", 1_000, taxRateId);
  await context
    .db("service_catalog")
    .where({ tenant: context.tenantId, service_id: productService })
    .update({ item_kind: "product", is_license: false });
  await context
    .db("service_catalog")
    .where({ tenant: context.tenantId, service_id: licenseService })
    .update({ item_kind: "product", is_license: true });

  const contractId = uuidv4();
  const clientContractId = uuidv4();
  const common = {
    contractId,
    clientContractId,
    clientId: context.clientId,
    startDate: "2025-01-15",
    endDate: "2026-12-31",
    billingFrequency: "monthly" as const,
    billingTiming: "arrears" as const,
    cadenceOwner: "contract" as const,
  };
  const fixed = await createFixedPlanAssignment(context, fixedService, {
    ...common,
    billingTiming: options.fixedAdvance ? ("advance" as const) : common.billingTiming,
    planName: "Managed support",
    baseRateCents: 10_000,
  });
  const hourly = await createFixedPlanAssignment(context, hourlyService, {
    ...common,
    planName: "Engineering",
    baseRateCents: 5_000,
  });
  const usage = await createFixedPlanAssignment(context, usageService, {
    ...common,
    planName: "Cloud backup",
    baseRateCents: 200,
  });
  const product = await createFixedPlanAssignment(context, productService, {
    ...common,
    planName: "Managed appliance",
    baseRateCents: 2_500,
    quantity: 2,
  });
  const license = await createFixedPlanAssignment(context, licenseService, {
    ...common,
    planName: "Security license",
    baseRateCents: 1_000,
    quantity: 5,
  });

  const hourlyConfig = await convertConfiguration(context, hourly.contractLineId, hourlyService, "Hourly");
  await context.db("contract_line_service_hourly_configs").insert({
    tenant: context.tenantId,
    config_id: hourlyConfig,
    hourly_rate: 5_000,
    minimum_billable_time: 15,
    round_up_to_nearest: 15,
  });
  await context.db("contract_line_service_hourly_config").insert({
    tenant: context.tenantId,
    config_id: hourlyConfig,
    minimum_billable_time: 15,
    round_up_to_nearest: 15,
    enable_overtime: false,
    enable_after_hours_rate: false,
  });

  const usageConfig = await convertConfiguration(context, usage.contractLineId, usageService, "Usage");
  await context.db("contract_line_service_usage_config").insert({
    tenant: context.tenantId,
    config_id: usageConfig,
    unit_of_measure: "GB",
    enable_tiered_pricing: true,
    minimum_usage: 2,
    base_rate: 200,
  });
  await context.db("contract_line_service_rate_tiers").insert([
    { tenant: context.tenantId, tier_id: uuidv4(), config_id: usageConfig, min_quantity: 0, max_quantity: 10, rate: 200 },
    { tenant: context.tenantId, tier_id: uuidv4(), config_id: usageConfig, min_quantity: 10, max_quantity: null, rate: 150 },
  ]);

  if (options.pricingScheduleRate != null) {
    await context.db("contract_pricing_schedules").insert({
      tenant: context.tenantId,
      schedule_id: uuidv4(),
      contract_id: contractId,
      effective_date: "2025-01-01",
      end_date: null,
      custom_rate: options.pricingScheduleRate,
    });
  }
  if (options.discountPercent != null) {
    const discountId = uuidv4();
    await context.db("discounts").insert({
      tenant: context.tenantId,
      discount_id: discountId,
      discount_name: "Parity loyalty discount",
      discount_type: "percentage",
      value: options.discountPercent,
      start_date: "2025-01-01",
      end_date: null,
      is_active: true,
    });
    await context.db("contract_line_discounts").insert({
      tenant: context.tenantId,
      contract_line_id: fixed.contractLineId,
      discount_id: discountId,
    });
  }
  if (options.pool) {
    await addPool(context, hourly.contractLineId, hourlyService, options.pool);
  }

  await seedActivity(context, {
    hourlyLineId: hourly.contractLineId,
    hourlyServiceId: hourlyService,
    hourlyMinutes: options.hourlyMinutes,
    usageLineId: usage.contractLineId,
    usageServiceId: usageService,
    usageQuantities: options.usageQuantities,
  });
  const lineFamilies = {
    [product.contractLineId]: "product",
    [license.contractLineId]: "license",
    [fixed.contractLineId]: "fixed",
    [hourly.contractLineId]: "hourly",
    [usage.contractLineId]: "usage",
  };
  const allLineIds = [
    fixed.contractLineId,
    hourly.contractLineId,
    usage.contractLineId,
    product.contractLineId,
    license.contractLineId,
  ];
  const burn = options.pool?.burn ?? 1;
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
  if (options.secondPeriodHourlyMinutes) {
    // Both periods exist before any pool usage is recorded, so the live service
    // resolves each period from the materialized schedule and carries rollover
    // from the first into the second.
    await persistServicePeriods(context, allLineIds, lineFamilies, {
      fixedAdvance: options.fixedAdvance,
      fixedLineId: fixed.contractLineId,
    });
    await persistServicePeriods(context, allLineIds, lineFamilies, {
      second: true,
      fixedLineId: fixed.contractLineId,
    });
    await seedActivity(context, {
      hourlyLineId: hourly.contractLineId,
      hourlyServiceId: hourlyService,
      hourlyMinutes: options.secondPeriodHourlyMinutes,
      usageLineId: usage.contractLineId,
      usageServiceId: usageService,
      usageQuantities: [3],
      activityDate: SECOND_ACTIVITY_DATE,
      ticketNumber: "PAR-0002",
    });
    if (options.pool) {
      await recordLivePoolUsage(context, hourlyService, ACTIVITY_DATE, sum(options.hourlyMinutes) * burn);
      await recordLivePoolUsage(
        context,
        hourlyService,
        SECOND_ACTIVITY_DATE,
        sum(options.secondPeriodHourlyMinutes) * burn,
      );
    }
  } else {
    if (options.pool) {
      await recordLivePoolUsage(
        context,
        hourlyService,
        ACTIVITY_DATE,
        sum(options.hourlyMinutes) * burn,
      );
    }
    await persistServicePeriods(context, allLineIds, lineFamilies, {
      fixedAdvance: options.fixedAdvance,
      fixedLineId: fixed.contractLineId,
    });
  }

  const scenario = await snapshotContractToScenario(context.db, context.tenantId, {
    contractId,
    clientContractId,
  });
  return {
    contractId,
    clientContractId,
    hourlyServiceId: hourlyService,
    hourlyLineId: hourly.contractLineId,
    usageServiceId: usageService,
    usageLineId: usage.contractLineId,
    usageTotal: options.usageQuantities.reduce((sum, value) => sum + value, 0),
    scenario,
  };
}

async function addPool(
  context: TestContext,
  contractLineId: string,
  serviceId: string,
  pool: PoolSpec,
): Promise<void> {
  const bucketId = uuidv4();
  if (pool.shape === "typed-config") {
    await context.db("contract_line_service_configuration").insert({
      tenant: context.tenantId,
      config_id: bucketId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: "Bucket",
    });
    await context.db("contract_line_service_bucket_config").insert({
      tenant: context.tenantId,
      config_id: bucketId,
      total_minutes: pool.totalMinutes,
      billing_period: "monthly",
      overage_rate: pool.overageRate,
      allow_rollover: pool.allowRollover ?? false,
    });
  }
  await context.db("contract_line_buckets").insert({
    tenant: context.tenantId,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    bucket_name: "Included hours",
    total_minutes: pool.totalMinutes,
    overage_rate: pool.overageRate,
    allow_rollover: pool.allowRollover ?? false,
    billing_period: "monthly",
    covers_all_services: pool.coversAll ?? false,
  });
  if (!pool.coversAll) {
    await context.db("contract_line_bucket_services").insert({
      tenant: context.tenantId,
      bucket_id: bucketId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      burn_multiplier: pool.burn ?? 1,
    });
  }
}

/**
 * The live app writes `bucket_usage` whenever billable time is saved; seeded
 * time entries bypass that path, so the pool state a real tenant would have is
 * recorded here through the same shared service.
 */
async function recordLivePoolUsage(
  context: TestContext,
  serviceId: string,
  date: string,
  weightedMinutes: number,
): Promise<void> {
  await context.db.transaction(async (trx) => {
    (trx as any).client.config.tenant = context.tenantId;
    const record = await findOrCreateCurrentBucketUsageRecord(
      trx,
      context.clientId,
      serviceId,
      `${date}T09:00:00Z`,
    );
    await updateBucketUsageMinutes(trx, record.usage_id, weightedMinutes);
  });
}

async function seedActivity(
  context: TestContext,
  input: {
    hourlyLineId: string;
    hourlyServiceId: string;
    hourlyMinutes: number[];
    usageLineId: string;
    usageServiceId: string;
    usageQuantities: number[];
    activityDate?: string;
    ticketNumber?: string;
  },
): Promise<void> {
  const activityDate = input.activityDate ?? ACTIVITY_DATE;
  const ticketId = await createBillingTestTicket(
    { db: context.db, tenantId: context.tenantId },
    {
      clientId: context.clientId,
      title: "Parity activity",
      ticketNumber: input.ticketNumber ?? "PAR-0001",
    },
  );
  let offset = 0;
  const entries = input.hourlyMinutes.map((minutes) => {
    const start = new Date(`${activityDate}T${String(8 + offset++).padStart(2, "0")}:00:00Z`);
    return {
      tenant: context.tenantId,
      entry_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: input.hourlyLineId,
      work_item_id: ticketId,
      work_item_type: "ticket",
      user_id: context.userId,
      service_id: input.hourlyServiceId,
      entry_date: activityDate,
      work_date: activityDate,
      start_time: start.toISOString(),
      end_time: new Date(start.getTime() + minutes * 60_000).toISOString(),
      billable_duration: minutes,
      is_billable: true,
      invoiced: false,
      approval_status: "APPROVED",
      work_timezone: "UTC",
    };
  });
  if (entries.length) await insertSupportedRows(context.db, "time_entries", entries);
  if (input.usageQuantities.length) {
    await insertSupportedRows(
      context.db,
      "usage_tracking",
      input.usageQuantities.map((quantity) => ({
        tenant: context.tenantId,
        usage_id: uuidv4(),
        client_id: context.clientId,
        contract_line_id: input.usageLineId,
        service_id: input.usageServiceId,
        usage_date: activityDate,
        quantity,
        is_billable: true,
        invoiced: false,
      })),
    );
  }
}

async function persistServicePeriods(
  context: TestContext,
  lineIds: string[],
  families: Record<string, string>,
  options: { second?: boolean; fixedAdvance?: boolean; fixedLineId?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const arrears = options.second
    ? { start: "2025-02-15", end: "2025-03-15", windowStart: SECOND_WINDOW_START, windowEnd: SECOND_WINDOW_END }
    : { start: "2025-01-15", end: "2025-02-15", windowStart: WINDOW_START, windowEnd: WINDOW_END };
  // Advance billing covers the period that starts at the invoice window.
  const advance = options.second
    ? { start: "2025-03-15", end: "2025-04-15", windowStart: SECOND_WINDOW_START, windowEnd: SECOND_WINDOW_END }
    : { start: "2025-02-15", end: "2025-03-15", windowStart: WINDOW_START, windowEnd: WINDOW_END };
  await insertSupportedRows(
    context.db,
    "recurring_service_periods",
    lineIds.map((lineId) => {
      const timing = options.fixedAdvance && lineId === options.fixedLineId ? advance : arrears;
      return {
        tenant: context.tenantId,
        record_id: uuidv4(),
        schedule_key: `parity:${lineId}`,
        period_key: `${timing.start}:${timing.end}`,
        revision: 1,
        obligation_id: lineId,
        charge_family: families[lineId],
        cadence_owner: "contract",
        due_position: timing === advance ? "advance" : "arrears",
        lifecycle_state: "generated",
        service_period_start: timing.start,
        service_period_end: timing.end,
        invoice_window_start: timing.windowStart,
        invoice_window_end: timing.windowEnd,
        provenance_kind: "generated",
        source_rule_version: "parity-v1",
        reason_code: "initial_materialization",
        source_run_key: "charge-resolution-parity",
        created_at: now,
        updated_at: now,
      };
    }),
  );
}

async function pricedService(
  context: TestContext,
  name: string,
  billingMethod: "fixed" | "hourly" | "usage",
  rate: number,
  taxRateId: string,
  unitOfMeasure = "each",
): Promise<string> {
  const serviceId = await createTestService(context, {
    service_name: name,
    billing_method: billingMethod,
    default_rate: rate,
    unit_of_measure: unitOfMeasure,
    tax_rate_id: taxRateId,
  });
  await context
    .db("service_prices")
    .insert({
      tenant: context.tenantId,
      service_id: serviceId,
      currency_code: "USD",
      rate,
      effective_date: "1970-01-01",
    })
    .onConflict(["tenant", "service_id", "currency_code", "effective_date"])
    .merge({ rate });
  return serviceId;
}

async function convertConfiguration(
  context: TestContext,
  contractLineId: string,
  serviceId: string,
  type: "Hourly" | "Usage",
): Promise<string> {
  const config = await context
    .db("contract_line_service_configuration")
    .where({
      tenant: context.tenantId,
      contract_line_id: contractLineId,
      service_id: serviceId,
      configuration_type: "Fixed",
    })
    .first("config_id");
  if (!config?.config_id) throw new Error(`Missing config for ${contractLineId}`);
  await context
    .db("contract_line_service_fixed_config")
    .where({ tenant: context.tenantId, config_id: config.config_id })
    .delete();
  await context
    .db("contract_line_service_configuration")
    .where({ tenant: context.tenantId, config_id: config.config_id })
    .update({ configuration_type: type });
  await context
    .db("contract_lines")
    .where({ tenant: context.tenantId, contract_line_id: contractLineId })
    .update({ contract_line_type: type });
  return config.config_id;
}

async function insertSupportedRows(
  db: Knex,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const columns = await db(table).columnInfo();
  await db(table).insert(
    rows.map((row) =>
      Object.fromEntries(Object.entries(row).filter(([column]) => column in columns)),
    ),
  );
}

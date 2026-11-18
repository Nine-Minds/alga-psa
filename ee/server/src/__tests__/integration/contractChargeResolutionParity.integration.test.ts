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
import { loadReplayAssumptions } from "@ee/lib/billing/simulator/activityAssumptions";
import { pairReplayLines } from "@ee/lib/billing/simulator/replayLineIdentity";
import { loadClientInvoiceSchedule } from "@ee/lib/billing/simulator/clientInvoiceSchedule";
import {
  findOrCreateCurrentBucketUsageRecord,
  updateBucketUsageMinutes,
} from "@alga-psa/shared/billingClients/bucketUsageService";
import { buildRecurringServicePeriodScheduleKey } from "@alga-psa/shared/billingClients/recurringServicePeriodKeys";
import { reconcileLineAllocations } from "@alga-psa/shared/billingClients/hourBlockService";
import { BillingEngine } from "@alga-psa/billing/lib/billing/billingEngine";
import { syncPrepaidBlockIssuancesForContractLine } from "@alga-psa/billing/services/prepaidBlockIssuanceSync";
import { generateInvoiceForNormalizedSelectionInputs } from "@alga-psa/billing/actions/invoiceGeneration";
import { repairArrearsOnlyLineSchedulesForTenant } from "@alga-psa/billing/actions/arrearsOnlyLineRepair";
import { fetchStrandedArrearsOnlyLineGaps } from "@alga-psa/billing/actions/arrearsOnlyLineGaps";
import { repairAllClientCadenceServicePeriodsForTenant } from "@alga-psa/shared/billingClients/clientCadenceScheduleRegeneration";
import {
  removeContractLinePrepaidBlockInTransaction,
  upsertContractLinePrepaidBlockInTransaction,
} from "@alga-psa/billing/services/prepaidBlockConfigService";
import { applyClientCadenceChange } from "@alga-psa/shared/billingClients/applyClientCadenceChange";
import { finalizeInvoiceWithKnex } from "@alga-psa/billing/actions/invoiceModification";
import { materializeContractCadenceServicePeriodsForContract } from "@alga-psa/billing/actions/contractCadenceServicePeriodMaterialization";
import {
  buildClientCadenceDueSelectionInput,
  buildContractCadenceDueSelectionInput,
} from "@alga-psa/shared/billingClients/recurringRunExecutionIdentity";

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

  // -------------------------------------------------------------------------
  // Cadence-mode prepaid block: the block fee is its own advance stream on the
  // Hourly line, time draws it first, overage bills in arrears.

  it("cadence block: the first window bills the block in advance and not the hourly stream", async () => {
    const contract = await seedCadenceBlockContract(context, {});
    const nov = await generateCadenceWindow(context, contract, NOV);
    expect(nov.lines.map((line) => line.kind).sort()).toEqual(["fixed", "prepaid_block"]);
    expect(nov.lines.find((line) => line.kind === "prepaid_block")?.net).toBe(150_000);
    expect(nov.lines.some((line) => line.kind === "hourly")).toBe(false);
    expect(nov.total).toBe(300_000);
    expect(await simulatedWindow(context, contract, 0, {})).toEqual(nov.lines);
  }, 180_000);

  it("cadence block draw-down: 8 h bills no overage, no plain hourly charge and a zero draw line", async () => {
    const contract = await seedCadenceBlockContract(context, {});
    await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await logHours(context, contract, "2025-11-10", [480]);
    const dec = await generateCadenceWindow(context, contract, DEC);
    expect(dec.lines.filter((line) => line.kind === "hourly")).toEqual([]);
    expect(dec.lines.some((line) => line.net === 0 && line.quantity === 8)).toBe(true);
    expect(await simulatedWindow(context, contract, 1, { 1: 8 })).toEqual(dec.lines);
  }, 180_000);

  it("cadence block arrears overage: 14 h bills 4 h at the line rate beside the next block", async () => {
    const contract = await seedCadenceBlockContract(context, {});
    await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await logHours(context, contract, "2025-11-10", [840]);
    const dec = await generateCadenceWindow(context, contract, DEC);
    expect(dec.lines.filter((line) => line.net === 60_000 && line.quantity === 4)).toHaveLength(1);
    expect(dec.lines.filter((line) => line.kind === "prepaid_block" && line.net === 150_000)).toHaveLength(1);
    expect(await simulatedWindow(context, contract, 1, { 1: 14 })).toEqual(dec.lines);
  }, 180_000);

  it.each([
    { rollover: 1, hours: [6, 13], overageHours: 0 },
    { rollover: 0, hours: [6, 13], overageHours: 3 },
  ])("cadence block rollover_periods=$rollover: $hours h then bills $overageHours h overage", async ({ rollover, hours, overageHours }) => {
    const contract = await seedCadenceBlockContract(context, { rolloverPeriods: rollover });
    await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await logHours(context, contract, "2025-11-10", [hours[0] * 60]);
    await generateCadenceWindow(context, contract, DEC, { finalize: true });
    await logHours(context, contract, "2025-12-10", [hours[1] * 60]);
    const jan = await generateCadenceWindow(context, contract, JAN);
    const overage = jan.lines.filter((line) => line.kind === "hourly");
    expect(overage.reduce((sum, line) => sum + line.quantity, 0)).toBe(overageHours);
    expect(await simulatedWindow(context, contract, 2, { 1: hours[0], 2: hours[1] })).toEqual(jan.lines);
  }, 240_000);

  it("acceptance: unedited snapshot, Nov 3,000 then Dec 3,600 with 14 h, simulator equals engine, edit moves only the next unbilled period", async () => {
    const contract = await seedCadenceBlockContract(context, {});
    const nov = await generateCadenceWindow(context, contract, NOV, { finalize: true });
    expect(nov.total).toBe(300_000);
    await logHours(context, contract, "2025-11-10", [840]);
    const dec = await generateCadenceWindow(context, contract, DEC);
    expect(dec.total).toBe(360_000);
    expect(dec.lines.filter((line) => line.kind === "fixed")).toHaveLength(1);
    expect(dec.lines.find((line) => line.kind === "fixed")?.net).toBe(150_000);
    expect(dec.lines.find((line) => line.kind === "prepaid_block")?.net).toBe(150_000);
    expect(dec.lines.some((line) => line.net === 60_000 && line.quantity === 4)).toBe(true);
    expect(dec.lines.some((line) => line.net === 0 && line.quantity === 10)).toBe(true);
    expect(dec.descriptions.some((text) => text.includes("(over prepaid block)"))).toBe(true);
    expect(dec.descriptions.some((text) => /prepaid block, 10 h$/.test(text))).toBe(true);
    expect(await simulatedWindow(context, contract, 1, { 1: 14 })).toEqual(dec.lines);
    // Same wording as the issued invoice, for the block fee and the overage line, so
    // "Compare with past invoices" pairs them instead of showing two unmatched lines.
    const simulatedDescriptions = (await simulatedRawLines(context, contract, 1, { 1: 14 }))
      .filter((line) => line.charge_type === "prepaid_block" || line.net_amount === 60_000)
      .map((line) => line.service_name);
    expect(simulatedDescriptions).toHaveLength(2);
    expect(simulatedDescriptions.some((text) => /prepaid block, 10 h$/.test(text))).toBe(true);
    expect(simulatedDescriptions.some((text) => text.endsWith("(over prepaid block)"))).toBe(true);
    for (const text of simulatedDescriptions) expect(dec.descriptions).toContain(text);

    // Editing the block changes only the next unbilled period.
    await context
      .db("contract_line_prepaid_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .update({ block_minutes: 720, block_price: 180_000 });
    const billed = await context
      .db("hour_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .orderBy("valid_from");
    // The December block was minted with the December invoice and keeps its size.
    expect(billed.map((row) => Number(row.total_minutes))).toEqual([600, 600]);
    await generateCadenceWindow(context, contract, DEC, { finalize: true, reuse: dec });
    const jan = await generateCadenceWindow(context, contract, JAN);
    expect(jan.lines.find((line) => line.kind === "prepaid_block")?.net).toBe(180_000);
  }, 300_000);

  // -------------------------------------------------------------------------
  // Late time on a cadence block line: approved after the invoice for its
  // service period was issued. It draws the block valid on its work date and
  // bills the rest as overage on the line's next invoice, exactly once.
  //
  // The simulator has no notion of late arrival, so each case compares the
  // engine's late window with the simulator's window for the same work billed
  // on time (the period after its service period): the block rule is shared,
  // so the draw, overage and block-fee lines must be identical.

  it("late time (a): fully covered by the remaining hours of the block valid on the work date", async () => {
    const contract = await seedCadenceBlockContract(context, { rolloverPeriods: 1 });
    await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await generateCadenceWindow(context, contract, DEC, { finalize: true });
    await logHours(context, contract, "2025-11-10", [480]);
    const jan = await generateCadenceWindow(context, contract, JAN, { finalize: true });
    expect(jan.lines.filter((line) => line.kind === "hourly")).toEqual([]);
    expect(jan.lines.filter((line) => line.kind === "prepaid_block")).toHaveLength(1);
    expect(jan.lines.filter((line) => line.kind === "hour_block")).toMatchObject([{ quantity: 8, net: 0 }]);
    expect(await simulatedWindow(context, contract, 1, { 1: 8 })).toEqual(jan.lines);
    // November's block paid for it; December's block is untouched.
    const blocks = await context
      .db("hour_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .orderBy("valid_from");
    expect(blocks.slice(0, 2).map((row) => Number(row.remaining_minutes))).toEqual([120, 600]);
    // The covered entry rode January exactly once: it is invoiced and absent after.
    const entries = await context
      .db("time_entries")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId });
    expect(entries.map((row) => row.invoiced)).toEqual([true]);
  }, 300_000);

  it("late time (b): partly covered bills the rest as overage with the late label, once", async () => {
    const contract = await seedCadenceBlockContract(context, { rolloverPeriods: 1 });
    await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await generateCadenceWindow(context, contract, DEC, { finalize: true });
    await logHours(context, contract, "2025-11-10", [840]);
    const jan = await generateCadenceWindow(context, contract, JAN, { finalize: true });
    expect(jan.lines.filter((line) => line.kind === "hourly")).toMatchObject([{ quantity: 4, net: 60_000 }]);
    // The block that was valid on the work date gives 10 h; December's block gives none of it.
    expect(jan.lines.filter((line) => line.kind === "hour_block")).toMatchObject([{ quantity: 10, net: 0 }]);
    expect(
      jan.descriptions.some(
        (text) => text.includes("(over prepaid block)") && text.includes("late time, service period 2025-11-01"),
      ),
    ).toBe(true);
    expect(await simulatedWindow(context, contract, 1, { 1: 14 })).toEqual(jan.lines);
    const blocks = await context
      .db("hour_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .orderBy("valid_from");
    expect(blocks.slice(0, 2).map((row) => Number(row.remaining_minutes))).toEqual([0, 600]);
    // Exactly once: the next invoice carries neither the overage nor the draw.
    const feb = await generateCadenceWindow(context, contract, FEB);
    expect(feb.lines.filter((line) => line.kind === "hourly" || line.kind === "hour_block")).toEqual([]);
  }, 300_000);

  it("late time (c): dated in a period whose block rolled over draws the earlier block first", async () => {
    const contract = await seedCadenceBlockContract(context, { rolloverPeriods: 1 });
    await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await generateCadenceWindow(context, contract, DEC, { finalize: true });
    await generateCadenceWindow(context, contract, JAN, { finalize: true });
    // December work approved after January's invoice closed December: November's
    // block (rolled over, expires 31 Dec) is drawn first, then December's.
    await logHours(context, contract, "2025-12-10", [840]);
    const feb = await generateCadenceWindow(context, contract, FEB);
    expect(feb.lines.filter((line) => line.kind === "hourly")).toEqual([]);
    expect(feb.lines.filter((line) => line.kind === "hour_block").map((line) => line.quantity).sort((x, y) => x - y)).toEqual([4, 10]);
    expect(await simulatedWindow(context, contract, 2, { 2: 14 })).toEqual(feb.lines);
  }, 300_000);

  it.each([
    { minutes: 480, covered: 8, overage: 0, remaining: 120 },
    { minutes: 840, covered: 10, overage: 4, remaining: 0 },
  ])("late time: expired historical block covers $covered hours and $overage hours are overage", async ({ minutes, covered, overage, remaining }) => {
    const contract = await seedCadenceBlockContract(context, { rolloverPeriods: 0 });
    await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await generateCadenceWindow(context, contract, DEC, { finalize: true });
    const blocks = await context.db("hour_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .orderBy("valid_from").select("block_id", "status");
    await context.db("hour_blocks")
      .where({ tenant: context.tenantId, block_id: blocks[0].block_id })
      .update({ status: "expired" });
    await logHours(context, contract, "2025-11-10", [minutes]);
    const jan = await generateCadenceWindow(context, contract, JAN, { finalize: true });
    expect(jan.lines.filter((line) => line.kind === "hour_block")).toMatchObject([{ quantity: covered, net: 0 }]);
    const hourly = jan.lines.filter((line) => line.kind === "hourly");
    expect(hourly).toHaveLength(overage ? 1 : 0);
    if (overage) {
      expect(hourly).toMatchObject([{ quantity: overage, net: overage * 15_000 }]);
      expect(jan.descriptions.some((text) => text.includes("late time, service period 2025-11-01"))).toBe(true);
    }
    expect(await simulatedWindow(context, contract, 1, { 1: minutes / 60 })).toEqual(jan.lines);
    const priorBlocks = await context.db("hour_blocks").where({ tenant: context.tenantId })
      .whereIn("block_id", blocks.map((block) => block.block_id)).orderBy("valid_from");
    expect(priorBlocks.map((block) => [block.status, Number(block.remaining_minutes)])).toEqual([["expired", remaining], ["active", 600]]);
    const feb = await generateCadenceWindow(context, contract, FEB);
    expect(feb.lines.filter((line) => line.kind === "hourly" || line.kind === "hour_block")).toEqual([]);
  }, 300_000);

  it("cadence block mid-period start prorates hours and price together, with an indivisible price", async () => {
    // Client cadence anchored on the 15th; the block starts on the 20th, so the
    // first service period covers 25 of the 30 days of the cycle.
    const contract = await seedCadenceBlockContract(context, {
      startDate: "2025-11-20",
      blockPrice: 100_001,
      blockMinutes: 600,
      enableProration: true,
      clientCadence: { servicePeriod: { start: "2025-11-20", end: "2025-12-15" }, window: { start: "2025-11-15", end: "2025-12-15" } },
    });
    const first = await generateCadenceWindow(context, contract, { start: "2025-11-15", end: "2025-12-15" });
    const block = first.lines.find((line) => line.kind === "prepaid_block");
    expect(block).toBeTruthy();
    // 100001 * 25 / 30 = 83334.17 cents; the shared coverage rule rounds up, and the total stays authoritative.
    expect(block!.net).toBe(83_335);
    expect(block!.quantity).toBeCloseTo((600 * 25) / 30 / 60, 4);
    const hourBlock = await context
      .db("hour_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .first();
    expect(Number(hourBlock.total_minutes)).toBe(500);
    expect(Number(hourBlock.purchase_amount)).toBe(83_335);
    const sim = await simulatedWindow(context, contract, 0, {}, "2025-11-20", true);
    expect(sim).toEqual(first.lines);
  }, 180_000);

  it("the Hourly/Usage advance repair leaves a cadence block's advance rows alone", async () => {
    const contract = await seedCadenceBlockContract(context, {});
    const blockRows = () =>
      context
        .db("recurring_service_periods")
        .where({
          tenant: context.tenantId,
          obligation_id: contract.hourlyLineId,
          charge_family: "prepaid_block",
        })
        .whereNotIn("lifecycle_state", ["superseded", "archived"])
        .orderBy("service_period_start")
        .select("record_id", "due_position", "lifecycle_state");
    const before = await blockRows();
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((row) => row.due_position === "advance")).toBe(true);

    // A legacy hourly row scheduled in advance: the repair's target on this very line.
    const now = new Date().toISOString();
    const staleId = uuidv4();
    await insertSupportedRows(context.db, "recurring_service_periods", [
      {
        tenant: context.tenantId,
        record_id: staleId,
        schedule_key: `legacy-advance:${contract.hourlyLineId}`,
        period_key: "2025-10-01:2025-11-01",
        revision: 1,
        obligation_id: contract.hourlyLineId,
        charge_family: "hourly",
        cadence_owner: "contract",
        due_position: "advance",
        lifecycle_state: "generated",
        service_period_start: "2025-10-01",
        service_period_end: "2025-11-01",
        invoice_window_start: "2025-10-01",
        invoice_window_end: "2025-11-01",
        provenance_kind: "generated",
        source_rule_version: "parity-v1",
        reason_code: "initial_materialization",
        source_run_key: "legacy",
        created_at: now,
        updated_at: now,
      },
    ]);
    const summary = await context.db.transaction((trx) =>
      repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: context.tenantId }),
    );
    expect(summary.advanceRowsSuperseded).toBe(1);
    const stale = await context
      .db("recurring_service_periods")
      .where({ tenant: context.tenantId, record_id: staleId })
      .first("lifecycle_state");
    expect(stale.lifecycle_state).toBe("superseded");

    expect(await blockRows()).toEqual(before);
    const superseded = await context
      .db("recurring_service_periods")
      .where({
        tenant: context.tenantId,
        obligation_id: contract.hourlyLineId,
        charge_family: "prepaid_block",
        lifecycle_state: "superseded",
      });
    expect(superseded).toEqual([]);
  }, 180_000);

  it("the tenant-wide repair's client-cadence pass and the stranded-gap reader leave cadence block rows alone", async () => {
    const contract = await seedCadenceBlockContract(context, {
      startDate: "2025-11-20",
      clientCadence: {
        servicePeriod: { start: "2025-11-20", end: "2025-12-15" },
        window: { start: "2025-11-15", end: "2025-12-15" },
      },
    });
    const blockRows = () =>
      context
        .db("recurring_service_periods")
        .where({ tenant: context.tenantId, obligation_id: contract.hourlyLineId, charge_family: "prepaid_block" })
        .whereNotIn("lifecycle_state", ["superseded", "archived"])
        .orderBy("service_period_start")
        .select("record_id", "due_position", "lifecycle_state", "period_key");
    const before = await blockRows();
    expect(before.length).toBeGreaterThan(0);

    await context.db.transaction(async (trx) => {
      await repairArrearsOnlyLineSchedulesForTenant(trx, { tenant: context.tenantId });
      await repairAllClientCadenceServicePeriodsForTenant(trx, { tenant: context.tenantId });
    });
    // The client-cadence pass may backfill the block stream's horizon, but it keeps
    // the existing rows as they were and never supersedes or re-times the stream.
    const after = await blockRows();
    expect(after.filter((row) => before.some((b) => b.record_id === row.record_id))).toEqual(before);
    expect(after.every((row) => row.due_position === "advance")).toBe(true);

    // A billed advance block period with no charge detail looks like a stranded
    // hourly advance row to a careless reader; it must not be reported.
    const now = new Date().toISOString();
    await insertSupportedRows(context.db, "recurring_service_periods", [
      {
        tenant: context.tenantId,
        record_id: uuidv4(),
        schedule_key: `billed-block:${contract.hourlyLineId}`,
        period_key: "2025-10-15:2025-11-15",
        revision: 1,
        obligation_id: contract.hourlyLineId,
        charge_family: "prepaid_block",
        cadence_owner: "client",
        due_position: "advance",
        lifecycle_state: "billed",
        service_period_start: "2025-10-15",
        service_period_end: "2025-11-15",
        invoice_window_start: "2025-10-15",
        invoice_window_end: "2025-11-15",
        provenance_kind: "generated",
        source_rule_version: "parity-v1",
        reason_code: "initial_materialization",
        source_run_key: "billed-block",
        created_at: now,
        updated_at: now,
      },
    ]);
    const gaps = await fetchStrandedArrearsOnlyLineGaps(context.db, context.tenantId);
    expect(gaps).toEqual([]);
  }, 180_000);

  it("switching a block line between cadence and consumption retires and restores the unbilled block stream", async () => {
    const contract = await seedCadenceBlockContract(context, {});
    const liveBlockRows = () =>
      context
        .db("recurring_service_periods")
        .where({ tenant: context.tenantId, obligation_id: contract.hourlyLineId, charge_family: "prepaid_block" })
        .whereNotIn("lifecycle_state", ["superseded", "archived"]);
    const scheduledIssuances = async () =>
      Number(
        (
          await context
            .db("contract_line_block_issuances")
            .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId, status: "scheduled" })
            .count({ count: "*" })
            .first()
        )?.count ?? 0,
      );
    const config = await context
      .db("contract_line_prepaid_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .first();
    const base = {
      block_minutes: Number(config.block_minutes),
      block_price: Number(config.block_price),
      sold_as_service_id: config.sold_as_service_id,
    };
    expect((await liveBlockRows()).length).toBeGreaterThan(0);
    expect(await scheduledIssuances()).toBe(0);

    await context.db.transaction((trx) =>
      upsertContractLinePrepaidBlockInTransaction(trx, context.tenantId, contract.hourlyLineId, {
        ...base,
        issue_mode: "consumption",
        trigger_on_exhaustion: true,
      }),
    );
    expect(await liveBlockRows()).toEqual([]);
    expect(await scheduledIssuances()).toBeGreaterThan(0);

    await context.db.transaction((trx) =>
      upsertContractLinePrepaidBlockInTransaction(trx, context.tenantId, contract.hourlyLineId, {
        ...base,
        issue_mode: "cadence",
        rollover_periods: 1,
      }),
    );
    expect((await liveBlockRows()).length).toBeGreaterThan(0);
    expect(await scheduledIssuances()).toBe(0);

    await context.db.transaction((trx) =>
      removeContractLinePrepaidBlockInTransaction(trx, context.tenantId, contract.hourlyLineId),
    );
    expect(await liveBlockRows()).toEqual([]);
  }, 180_000);

  it("client cadence changes monthly -> quarterly mid-history: simulated windows, block fees and overage equal the engine", async () => {
    const contract = await seedCadenceBlockContract(context, { liveClientCadence: true });
    // Nov and Dec bill on the monthly schedule through the production (Due Work)
    // generation path, which writes no client_billing_cycles rows: the billed
    // recurring_service_periods ledger is the only record of the monthly windows.
    const nov = await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await logHours(context, contract, "2025-11-10", [840]);
    const dec = await generateCadenceWindow(context, contract, DEC, { finalize: true });
    expect(dec.lines.filter((line) => line.net === 60_000 && line.quantity === 4)).toHaveLength(1);

    // The client moves to a quarterly cycle (Jan/Apr/Jul/Oct); billed history stays monthly.
    await context.db.transaction((trx) =>
      applyClientCadenceChange(trx, context.tenantId, {
        clientId: context.clientId,
        billingCycle: "quarterly",
        anchor: { dayOfMonth: 1, monthOfYear: 1 },
      }),
    );
    const q1 = { start: "2026-01-01", end: "2026-04-01" };
    const engineQ1 = await generateCadenceWindow(context, contract, q1);

    const simulated = (index: number) =>
      simulatedWindow(context, contract, index, { 1: 14 }, "2025-11-01", true);
    // Window boundaries (period_end is the inclusive last day): two monthly windows as billed, then the quarter.
    const schedule = await loadClientInvoiceSchedule(context.db, context.tenantId, context.clientId);
    expect(schedule.billing_cycle).toBe("quarterly");
    // The Q1 draft generated above is invoice-linked, so its window is billed history too.
    expect(schedule.history).toEqual([
      { start_date: "2025-11-01", end_date: "2025-12-01" },
      { start_date: "2025-12-01", end_date: "2026-01-01" },
      { start_date: "2026-01-01", end_date: "2026-04-01" },
    ]);
    const windows = (await simulatedPeriods(context, contract, { 1: 14 })).map((p) => `${p.period_start.slice(0, 10)}:${p.period_end.slice(0, 10)}`);
    expect(windows.slice(0, 3)).toEqual(["2025-11-01:2025-11-30", "2025-12-01:2025-12-31", "2026-01-01:2026-03-31"]);
    expect(await simulated(0)).toEqual(nov.lines);
    expect(await simulated(1)).toEqual(dec.lines);
    expect(await simulated(2)).toEqual(engineQ1.lines);
    // Window shape: two monthly block fees, then ONE block fee for the quarter.
    expect(dec.lines.filter((line) => line.kind === "prepaid_block")).toHaveLength(1);
    expect(engineQ1.lines.filter((line) => line.kind === "prepaid_block")).toHaveLength(1);
  }, 300_000);

  it("Compare with past invoices after a cycle change replays the billed monthly windows, not the current quarter", async () => {
    const contract = await seedCadenceBlockContract(context, { liveClientCadence: true });
    // The live repro client is untaxed ($1,500 / $2,100 invoices); line-level tax
    // rounding is not what this case is about.
    await context.db("clients").where({ tenant: context.tenantId, client_id: context.clientId }).update({ is_tax_exempt: true });
    // Two monthly invoices through the production generation path: $1,500 block
    // fee for the first month; the second is the $1,500 block fee plus 4 overage
    // hours at $150.
    const nov = await generateCadenceWindow(context, contract, NOV, { finalize: true });
    await logHours(context, contract, "2025-11-10", [840]);
    const dec = await generateCadenceWindow(context, contract, DEC, { finalize: true });
    expect(nov.total).toBe(150_000);
    expect(dec.total).toBe(210_000);

    // The client then moves to a quarterly cycle. The billed boundary (2026-01-01)
    // must be a quarter boundary, so the fixture uses Jan/Apr/Jul/Oct rather than
    // the live repro's February quarters (Sep/Oct billed, boundary Nov 1).
    await context.db.transaction((trx) =>
      applyClientCadenceChange(trx, context.tenantId, {
        clientId: context.clientId,
        billingCycle: "quarterly",
        anchor: { dayOfMonth: 1, monthOfYear: 1 },
      }),
    );

    const scenario = structuredClone(
      await snapshotContractToScenario(context.db, context.tenantId, {
        contractId: contract.contractId,
        clientContractId: contract.clientContractId,
      }),
    );
    const prefill = await loadReplayAssumptions(
      context.db,
      context.tenantId,
      scenario,
      "2025-11-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    // Two monthly replay windows, not one merged quarter.
    expect(prefill.horizon.period_count).toBe(2);
    expect(prefill.actual_invoices).toHaveLength(2);

    scenario.horizon = prefill.horizon;
    scenario.assumptions = prefill.assumptions;
    const simulated = await simulateContractScenario(context.db, context.tenantId, scenario);
    const windows = simulated.periods.slice(0, 2).map((p) => `${p.period_start.slice(0, 10)}:${p.period_end.slice(0, 10)}`);
    expect(windows).toEqual(["2025-11-01:2025-11-30", "2025-12-01:2025-12-31"]);

    const actual = prefill.actual_invoices ?? [];
    expect(actual.map((invoice) => invoice.subtotal)).toEqual([150_000, 210_000]);
    expect(actual.map((invoice) => invoice.total)).toEqual([150_000, 210_000]);
    simulated.periods.slice(0, 2).forEach((period, index) => {
      const invoice = actual[index];
      expect(invoice.period_start.slice(0, 10)).toBe(period.period_start.slice(0, 10));
      const pairs = pairReplayLines(invoice.lines, period.lines);
      expect(pairs.length).toBeGreaterThan(0);
      for (const pair of pairs) expect(pair.delta).toBe(0);
    });
  }, 300_000);

  it("a mode switch on a client-cadence line retires the block stream", async () => {
    const contract = await seedCadenceBlockContract(context, {
      startDate: "2025-11-20",
      clientCadence: {
        servicePeriod: { start: "2025-11-20", end: "2025-12-15" },
        window: { start: "2025-11-15", end: "2025-12-15" },
      },
    });
    const live = () =>
      context
        .db("recurring_service_periods")
        .where({ tenant: context.tenantId, obligation_id: contract.hourlyLineId, charge_family: "prepaid_block" })
        .whereNotIn("lifecycle_state", ["superseded", "archived"]);
    expect((await live()).length).toBe(1);
    const config = await context
      .db("contract_line_prepaid_blocks")
      .where({ tenant: context.tenantId, contract_line_id: contract.hourlyLineId })
      .first();
    await context.db.transaction((trx) =>
      upsertContractLinePrepaidBlockInTransaction(trx, context.tenantId, contract.hourlyLineId, {
        block_minutes: Number(config.block_minutes),
        block_price: Number(config.block_price),
        sold_as_service_id: config.sold_as_service_id,
        issue_mode: "consumption",
        trigger_on_exhaustion: true,
      }),
    );
    expect(await live()).toEqual([]);
  }, 180_000);
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

// ---------------------------------------------------------------------------
// Cadence-mode prepaid block fixtures.

const NOV = { start: "2025-11-01", end: "2025-12-01" };
const DEC = { start: "2025-12-01", end: "2026-01-01" };
const JAN = { start: "2026-01-01", end: "2026-02-01" };
const FEB = { start: "2026-02-01", end: "2026-03-01" };

interface CadenceBlockContract {
  contractId: string;
  clientContractId: string;
  hourlyLineId: string;
  hourlyServiceId: string;
  fixedLineId: string;
  scenario: ContractScenario;
}

interface CadenceWindowResult {
  lines: ParityLine[];
  total: number;
  descriptions: string[];
  invoiceId: string | null;
}

/**
 * A contract-cadence contract from 1 Nov: a $1,500 Fixed advance line and an
 * Hourly line ($150/h) carrying a monthly cadence prepaid block (10 h / $1,500
 * by default). Service periods are materialized by the production
 * materializer, so both recurring streams exist for the engine.
 */
async function seedCadenceBlockContract(
  context: TestContext,
  options: {
    rolloverPeriods?: number;
    startDate?: string;
    blockMinutes?: number;
    blockPrice?: number;
    enableProration?: boolean;
    /**
     * Client-owned cadence on a client that bills monthly on the 1st, with the
     * schedule, cycle history and recurring periods written by the production
     * cadence-change path (not hand-persisted).
     */
    liveClientCadence?: boolean;
    /** Client-owned cadence (anchor day 15) with one hand-persisted block period. */
    clientCadence?: {
      servicePeriod: { start: string; end: string };
      window: { start: string; end: string };
    };
  },
): Promise<CadenceBlockContract> {
  const taxRateId = await setupClientTaxConfiguration(context);
  const fixedService = await pricedService(context, "Cadence managed support", "fixed", 150_000, taxRateId);
  const hourlyService = await pricedService(context, "Cadence engineering", "hourly", 15_000, taxRateId);
  const contractId = uuidv4();
  const clientContractId = uuidv4();
  const common = {
    contractId,
    clientContractId,
    clientId: context.clientId,
    startDate: options.startDate ?? "2025-11-01",
    endDate: null,
    billingFrequency: "monthly" as const,
    cadenceOwner:
      options.clientCadence || options.liveClientCadence ? ("client" as const) : ("contract" as const),
    enableProration: options.enableProration ?? false,
  };
  if (options.clientCadence) {
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
  }
  // The client-cadence variant carries only the block line.
  const fixed = options.clientCadence || options.liveClientCadence
    ? null
    : await createFixedPlanAssignment(context, fixedService, {
        ...common,
        billingTiming: "advance" as const,
        planName: "Cadence fixed",
        baseRateCents: 150_000,
      });
  const hourly = await createFixedPlanAssignment(context, hourlyService, {
    ...common,
    billingTiming: "arrears" as const,
    planName: "Cadence prepaid block",
    baseRateCents: 15_000,
  });
  const hourlyConfig = await convertConfiguration(context, hourly.contractLineId, hourlyService, "Hourly");
  await context.db("contract_line_service_hourly_configs").insert({
    tenant: context.tenantId,
    config_id: hourlyConfig,
    hourly_rate: 15_000,
    minimum_billable_time: 1,
    round_up_to_nearest: 1,
  });
  await context.db("contract_line_service_hourly_config").insert({
    tenant: context.tenantId,
    config_id: hourlyConfig,
    minimum_billable_time: 1,
    round_up_to_nearest: 1,
    enable_overtime: false,
    enable_after_hours_rate: false,
  });
  await context.db("contract_line_prepaid_blocks").insert({
    tenant: context.tenantId,
    contract_line_id: hourly.contractLineId,
    block_minutes: options.blockMinutes ?? 600,
    block_price: options.blockPrice ?? 150_000,
    expiry_months: null,
    trigger_on_exhaustion: false,
    trigger_on_expiry: false,
    replenishment_tier: "draft",
    sold_as_service_id: hourlyService,
    issue_mode: "cadence",
    rollover_periods: options.rolloverPeriods ?? 0,
  });
  if (options.clientCadence) {
    const { servicePeriod, window } = options.clientCadence;
    const now = new Date().toISOString();
    await insertSupportedRows(context.db, "recurring_service_periods", [
      {
        tenant: context.tenantId,
        record_id: uuidv4(),
        schedule_key: buildRecurringServicePeriodScheduleKey({
          tenant: context.tenantId,
          obligationId: hourly.contractLineId,
          cadenceOwner: "client",
          duePosition: "advance",
        }),
        period_key: `${window.start}:${window.end}`,
        revision: 1,
        obligation_id: hourly.contractLineId,
        charge_family: "prepaid_block",
        cadence_owner: "client",
        due_position: "advance",
        lifecycle_state: "generated",
        // The full cycle, with the part of it the line was active in.
        service_period_start: window.start,
        service_period_end: window.end,
        activity_window_start: servicePeriod.start,
        activity_window_end: servicePeriod.end,
        invoice_window_start: window.start,
        invoice_window_end: window.end,
        provenance_kind: "generated",
        source_rule_version: "parity-v1",
        reason_code: "initial_materialization",
        source_run_key: "cadence-block-parity",
        created_at: now,
        updated_at: now,
      },
    ]);
  } else if (options.liveClientCadence) {
    await context.db.transaction((trx) =>
      applyClientCadenceChange(trx, context.tenantId, {
        clientId: context.clientId,
        billingCycle: "monthly",
        anchor: { dayOfMonth: 1 },
      }),
    );
  } else {
    await context.db.transaction((trx) =>
      materializeContractCadenceServicePeriodsForContract(trx, {
        tenant: context.tenantId,
        contractId,
        sourceRunPrefix: "cadence-block-parity",
      }),
    );
  }
  const scenario = await snapshotContractToScenario(context.db, context.tenantId, {
    contractId,
    clientContractId,
  });
  return {
    contractId,
    clientContractId,
    hourlyLineId: hourly.contractLineId,
    hourlyServiceId: hourlyService,
    fixedLineId: fixed?.contractLineId ?? "",
    scenario,
  };
}

async function logHours(
  context: TestContext,
  contract: CadenceBlockContract,
  date: string,
  minutes: number[],
): Promise<void> {
  const real = minutes.filter((value) => value > 0);
  if (real.length === 0) return;
  await seedActivity(context, {
    hourlyLineId: contract.hourlyLineId,
    hourlyServiceId: contract.hourlyServiceId,
    hourlyMinutes: real,
    usageLineId: contract.hourlyLineId,
    usageServiceId: contract.hourlyServiceId,
    usageQuantities: [],
    activityDate: date,
    ticketNumber: `CAD-${date}`,
  });
  // What the time-entry save does in production: draw the new work against the
  // line's live blocks.
  await context.db.transaction((trx) =>
    reconcileLineAllocations(trx, context.tenantId, contract.hourlyLineId),
  );
}

/**
 * Generates (and optionally finalizes) the real invoice for the window and
 * returns the lines the engine produced, in the simulator's comparable shape.
 */
async function generateCadenceWindow(
  context: TestContext,
  contract: CadenceBlockContract,
  window: { start: string; end: string },
  options: { finalize?: boolean; reuse?: CadenceWindowResult } = {},
): Promise<CadenceWindowResult> {
  if (options.reuse) {
    if (options.finalize && options.reuse.invoiceId) {
      await finalizeInvoiceWithKnex(options.reuse.invoiceId, context.db, context.tenantId, context.userId);
    }
    return options.reuse;
  }
  const captured: any[] = [];
  const original = BillingEngine.prototype.calculateBillingForExecutionWindow;
  const spy = vi
    .spyOn(BillingEngine.prototype, "calculateBillingForExecutionWindow")
    .mockImplementation(async function (this: BillingEngine, ...args) {
      const result = await original.apply(this, args);
      captured.push(result);
      return result;
    });
  let invoice: any;
  try {
    invoice = await generateInvoiceForNormalizedSelectionInputs({
      user: { user_id: context.userId, user_type: "internal", tenant: context.tenantId } as never,
      tenant: context.tenantId,
      knex: context.db,
      normalizedSelectorInputs: await cadenceSelectorInputs(context, contract, window),
    });
  } finally {
    spy.mockRestore();
  }
  const result = captured[0];
  if (!result) throw new Error("Engine did not run for the window");
  if (result.error) throw new Error(`Engine failed: ${result.error}`);
  const invoiceId: string | null = invoice?.invoice_id ?? null;
  const rows = invoiceId
    ? await context.db("invoice_charges").where({ tenant: context.tenantId, invoice_id: invoiceId })
    : [];
  const lines = (result.charges as any[])
    .map((charge): ParityLine => {
      const kind = normalizeKind(String(charge.type));
      return {
        kind,
        serviceId: serviceIdFor(kind, charge.serviceId ?? charge.service_catalog_id ?? null),
        // A draw line carries its hours in hoursUsed, not the quantity.
        quantity:
          kind === "hour_block"
            ? round(Number(charge.hoursUsed ?? 0))
            : quantityFor(kind, Number(charge.quantity ?? 0)),
        net: Number(charge.total),
      };
    })
    .sort(compareLines);
  if (options.finalize && invoiceId) {
    await finalizeInvoiceWithKnex(invoiceId, context.db, context.tenantId, context.userId);
  }
  return {
    lines,
    total: lines.reduce((sum, line) => sum + line.net, 0),
    descriptions: rows.map((row) => String(row.description ?? "")),
    invoiceId,
  };
}

async function cadenceSelectorInputs(
  context: TestContext,
  contract: CadenceBlockContract,
  window: { start: string; end: string },
) {
  const clientRows = await context
    .db("recurring_service_periods")
    .where({ tenant: context.tenantId, cadence_owner: "client", obligation_id: contract.hourlyLineId })
    .whereNotIn("lifecycle_state", ["superseded", "archived"]);
  const inWindow = clientRows.filter(
    (row) =>
      toDateOnly(row.invoice_window_start) === window.start && toDateOnly(row.invoice_window_end) === window.end,
  );
  if (inWindow.length > 0) {
    // One selection per recurring stream whose invoice window is this window.
    return inWindow.map((row) =>
      buildClientCadenceDueSelectionInput({
        clientId: context.clientId,
        scheduleKey: row.schedule_key,
        periodKey: row.period_key,
        windowStart: `${window.start}T00:00:00Z`,
        windowEnd: `${window.end}T00:00:00Z`,
      }),
    );
  }
  if (clientRows.length > 0) {
    const row = clientRows[0];
    return [
      buildClientCadenceDueSelectionInput({
        clientId: context.clientId,
        scheduleKey: row.schedule_key,
        periodKey: row.period_key,
        windowStart: `${window.start}T00:00:00Z`,
        windowEnd: `${window.end}T00:00:00Z`,
      }),
    ];
  }
  return contract.scenario.lines.map((line) =>
    buildContractCadenceDueSelectionInput({
      clientId: context.clientId,
      contractId: contract.contractId,
      contractLineId: line.origin_contract_line_id ?? line.key,
      windowStart: `${window.start}T00:00:00Z`,
      windowEnd: `${window.end}T00:00:00Z`,
    }),
  );
}

function toDateOnly(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

/** The simulator's lines for invoice window `index` (0 = November) of the unedited snapshot. */
async function simulatedWindow(
  context: TestContext,
  contract: CadenceBlockContract,
  index: number,
  hoursByWindow: Record<number, number>,
  horizonStart = "2025-11-01",
  keepCadenceOwner = false,
): Promise<ParityLine[]> {
  return (await simulatedRawLines(context, contract, index, hoursByWindow, horizonStart, keepCadenceOwner))
    .map((line): ParityLine => {
      const kind = line.charge_type === "block_draw" ? "hour_block" : normalizeKind(line.charge_type);
      return {
        kind,
        serviceId: serviceIdFor(kind, line.service_id),
        quantity: kind === "hour_block" ? round(Number(line.quantity ?? 0)) : quantityFor(kind, Number(line.quantity ?? 0)),
        net: line.net_amount,
      };
    })
    .sort(compareLines);
}

/** The simulator's presentation lines for one window (descriptions are `service_name`). */
async function simulatedRawLines(
  context: TestContext,
  contract: CadenceBlockContract,
  index: number,
  hoursByWindow: Record<number, number>,
  horizonStart = "2025-11-01",
  keepCadenceOwner = false,
) {
  return (await simulatedPeriods(context, contract, hoursByWindow, horizonStart, keepCadenceOwner))[index]?.lines ?? [];
}

/** The simulator's windows (boundaries and lines) for the unedited snapshot. */
async function simulatedPeriods(
  context: TestContext,
  contract: CadenceBlockContract,
  hoursByWindow: Record<number, number> = {},
  horizonStart = "2025-11-01",
  keepCadenceOwner = true,
) {
  const scenario = structuredClone(
    await snapshotContractToScenario(context.db, context.tenantId, {
      contractId: contract.contractId,
      clientContractId: contract.clientContractId,
    }),
  );
  if (!keepCadenceOwner) for (const line of scenario.lines) line.cadence_owner = "contract";
  scenario.horizon = { start_date: `${horizonStart}T00:00:00Z`, period_count: 4 };
  scenario.assumptions[assumptionKey(contract.hourlyLineId, contract.hourlyServiceId)] = {
    flat: 0,
    overrides: hoursByWindow,
  };
  const simulated = await simulateContractScenario(context.db, context.tenantId, scenario);
  return simulated.periods;
}


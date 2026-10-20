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
  it.fails("Hourly line with a pool carried only in contract_line_buckets (10h, 14h worked) matches the engine", async () => {
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
  it.fails("weighted (2x burn) pool carried only in contract_line_buckets matches the engine", async () => {
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
  it.fails("a pool that is not exhausted bills no overage and no plain hourly charge", async () => {
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
});

// ---------------------------------------------------------------------------

async function compare(
  context: TestContext,
  contract: ParityContract,
  assumed: { hourlyHours?: number; usageQuantity?: number },
): Promise<{ engine: ParityLine[]; simulator: ParityLine[] }> {
  const engine = await runEngineDryRun(context, contract);

  const scenario = structuredClone(contract.scenario);
  for (const line of scenario.lines) line.cadence_owner = "contract";
  scenario.horizon = { start_date: `${WINDOW_START}T00:00:00Z`, period_count: 2 };
  if (assumed.hourlyHours != null) {
    scenario.assumptions[
      assumptionKey(contract.hourlyLineId, contract.hourlyServiceId)
    ] = { flat: assumed.hourlyHours };
  }
  scenario.assumptions[
    assumptionKey(contract.usageLineId, contract.usageServiceId)
  ] = { flat: assumed.usageQuantity ?? contract.usageTotal };
  const simulated = await simulateContractScenario(
    context.db,
    context.tenantId,
    scenario,
  );
  const lines =
    simulated.periods.find((period) => period.lines.length > 0)?.lines ?? [];
  const simulator = lines
    .map(
      (line): ParityLine => ({
        kind: normalizeKind(line.charge_type),
        serviceId: serviceIdFor(normalizeKind(line.charge_type), line.service_id),
        quantity: quantityFor(normalizeKind(line.charge_type), Number(line.quantity ?? 0)),
        net: line.net_amount,
      }),
    )
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
          windowStart: `${WINDOW_START}T00:00:00Z`,
          windowEnd: `${WINDOW_END}T00:00:00Z`,
        }),
      ),
    });
  } finally {
    spy.mockRestore();
  }
  const result = captured[0];
  if (!result) throw new Error("Engine did not run for the window");
  if (result.error) throw new Error(`Engine failed: ${result.error}`);
  return (result.charges as any[])
    .filter((charge) => !charge.is_discount)
    .map((charge): ParityLine => {
      const kind = normalizeKind(String(charge.type));
      return {
        kind,
        serviceId: serviceIdFor(kind, charge.serviceId ?? charge.service_catalog_id ?? null),
        quantity: quantityFor(kind, Number(charge.quantity ?? 0)),
        net: Number(charge.total),
      };
    })
    .sort(compareLines);
}

function normalizeKind(kind: string): string {
  return kind === "time" ? "hourly" : kind;
}

/** Fixed and bucket-overage lines are not keyed to a catalog service on both sides. */
function serviceIdFor(kind: string, serviceId: string | null): string | null {
  return kind === "fixed" || kind === "bucket" ? null : serviceId;
}

/**
 * A bucket line's "quantity" is hours used on the engine and a unit count on
 * the simulator; the overage amount (`net`) is the comparable figure.
 */
function quantityFor(kind: string, quantity: number): number {
  return kind === "bucket" ? 0 : round(quantity);
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
  if (options.pool) {
    await recordLivePoolUsage(
      context,
      hourlyService,
      ACTIVITY_DATE,
      options.hourlyMinutes.reduce((sum, minutes) => sum + minutes, 0) *
        (options.pool.burn ?? 1),
    );
  }
  await persistServicePeriods(context, [
    fixed.contractLineId,
    hourly.contractLineId,
    usage.contractLineId,
    product.contractLineId,
    license.contractLineId,
  ], {
    [product.contractLineId]: "product",
    [license.contractLineId]: "license",
    [fixed.contractLineId]: "fixed",
    [hourly.contractLineId]: "hourly",
    [usage.contractLineId]: "usage",
  });

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
    covers_all_services: false,
  });
  await context.db("contract_line_bucket_services").insert({
    tenant: context.tenantId,
    bucket_id: bucketId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    burn_multiplier: pool.burn ?? 1,
  });
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
  },
): Promise<void> {
  const ticketId = await createBillingTestTicket(
    { db: context.db, tenantId: context.tenantId },
    {
      clientId: context.clientId,
      title: "Parity activity",
      ticketNumber: `PAR-${uuidv4().slice(0, 8)}`,
    },
  );
  let offset = 0;
  const entries = input.hourlyMinutes.map((minutes) => {
    const start = new Date(`${ACTIVITY_DATE}T${String(8 + offset++).padStart(2, "0")}:00:00Z`);
    return {
      tenant: context.tenantId,
      entry_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: input.hourlyLineId,
      work_item_id: ticketId,
      work_item_type: "ticket",
      user_id: context.userId,
      service_id: input.hourlyServiceId,
      entry_date: ACTIVITY_DATE,
      work_date: ACTIVITY_DATE,
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
        usage_date: ACTIVITY_DATE,
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
): Promise<void> {
  const now = new Date().toISOString();
  await insertSupportedRows(
    context.db,
    "recurring_service_periods",
    lineIds.map((lineId) => ({
      tenant: context.tenantId,
      record_id: uuidv4(),
      schedule_key: `parity:${lineId}`,
      period_key: "2025-01-15:2025-02-15",
      revision: 1,
      obligation_id: lineId,
      charge_family: families[lineId],
      cadence_owner: "contract",
      due_position: "arrears",
      lifecycle_state: "generated",
      service_period_start: "2025-01-15",
      service_period_end: "2025-02-15",
      invoice_window_start: WINDOW_START,
      invoice_window_end: WINDOW_END,
      provenance_kind: "generated",
      source_rule_version: "parity-v1",
      reason_code: "initial_materialization",
      source_run_key: "charge-resolution-parity",
      created_at: now,
      updated_at: now,
    })),
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

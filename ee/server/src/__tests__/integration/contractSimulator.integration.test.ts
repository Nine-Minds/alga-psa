import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { createClient, createTenant } from "@main-test-utils/testDataFactory";
import {
  loadRecentAverageAssumptions,
  loadReplayAssumptions,
  simulateContractScenario,
  snapshotContractToScenario,
} from "@ee/lib/billing/simulator";
import { assumptionKey } from "@ee/lib/billing/simulator/syntheticActivity";
import { generateInvoiceForNormalizedSelectionInputs } from "@alga-psa/billing/actions/invoiceGeneration";
import { buildContractCadenceDueSelectionInput } from "@alga-psa/shared/billingClients/recurringRunExecutionIdentity";

process.env.DB_PORT =
  process.env.DB_PORT === "6432" ? "5432" : process.env.DB_PORT;

let authenticatedTenant = "";
let authenticatedUser = "";
vi.mock("@alga-psa/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@alga-psa/auth")>();
  return {
    ...original,
    withAuth: (handler: (...args: never[]) => unknown) =>
      (...args: never[]) => handler(
        { user_id: authenticatedUser, user_type: "internal", tenant: authenticatedTenant },
        { tenant: authenticatedTenant },
        ...args,
      ),
  };
});
vi.mock("@alga-psa/auth/rbac", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@alga-psa/auth/rbac")>()),
  hasPermission: vi.fn().mockResolvedValue(true),
}));

interface SimulatorFixture {
  contractId: string;
  clientContractId: string;
  locationId: string;
  scenario: ContractScenario;
  services: {
    fixed: string;
    hourly: string;
    usage: string;
    product: string;
    license: string;
  };
  lines: {
    fixed: string;
    hourly: string;
    usage: string;
    product: string;
    license: string;
  };
  configs: {
    hourly: string;
    usage: string;
  };
}

function compareSemanticLines(
  left: { serviceId: string | null; description: string },
  right: { serviceId: string | null; description: string },
): number {
  return `${left.serviceId ?? ""}:${left.description}`.localeCompare(
    `${right.serviceId ?? ""}:${right.description}`,
  );
}

describe("Contract simulator – migrated-schema integration", () => {
  const helpers = TestContext.createHelpers();
  let context: TestContext;
  let fixture: SimulatorFixture;

  beforeAll(async () => {
    context = await helpers.beforeAll({
      runSeeds: true,
      clientName: "Simulator integration client",
      userType: "internal",
    });
  }, 180_000);

  beforeEach(async () => {
    context = await helpers.beforeEach();
    authenticatedTenant = context.tenantId;
    authenticatedUser = context.userId;
    fixture = await seedSimulatorFixture(context);
  }, 60_000);

  afterAll(async () => {
    await helpers.afterAll();
  }, 60_000);

  it("snapshots tenant-scoped assignment, cadence, catalog, configuration, tier, and schedule context", async () => {
    const scenario = fixture.scenario;

    expect(scenario.contract_id).toBe(fixture.contractId);
    expect(scenario.client_binding).toMatchObject({
      kind: "client",
      client_id: context.clientId,
    });
    expect(scenario.contract_start_date).toBe("2025-01-15T00:00:00Z");
    expect(scenario.contract_end_date).toBe("2026-12-31T00:00:00Z");
    expect(scenario.invoice_schedule).toEqual({
      billing_cycle: "monthly",
      anchor: {
        day_of_month: 15,
        month_of_year: null,
        day_of_week: null,
        reference_date: null,
      },
    });

    const fixed = scenario.lines.find(
      (line) => line.key === fixture.lines.fixed,
    );
    const hourly = scenario.lines.find(
      (line) => line.key === fixture.lines.hourly,
    );
    const usage = scenario.lines.find(
      (line) => line.key === fixture.lines.usage,
    );

    expect(fixed).toMatchObject({
      origin_contract_line_id: fixture.lines.fixed,
      location_id: fixture.locationId,
      billing_frequency: "monthly",
      billing_timing: "arrears",
    });
    expect(
      hourly?.services.map(
        (service) => service.configuration.configuration_type,
      ),
    ).toEqual(expect.arrayContaining(["Hourly", "Bucket"]));
    expect(
      usage?.services.find(
        (service) => service.configuration.configuration_type === "Usage",
      )?.configuration,
    ).toMatchObject({
      configuration_type: "Usage",
      unit_of_measure: "GB",
      enable_tiered_pricing: true,
      minimum_usage: 2,
      tiers: [
        { min_quantity: 0, max_quantity: 10, rate: 200 },
        { min_quantity: 10, max_quantity: null, rate: 150 },
      ],
    });
    expect(scenario.pricing_schedules).toEqual([
      {
        effective_date: "2025-07-01T00:00:00Z",
        end_date: null,
        custom_rate: 12_500,
      },
    ]);
    expect(scenario.available_services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          service_id: fixture.services.product,
          service_name: "Managed appliance",
          currency_rate: 2_500,
          item_kind: "product",
          is_license: false,
        }),
        expect.objectContaining({
          service_id: fixture.services.license,
          item_kind: "product",
          is_license: true,
        }),
      ]),
    );
  });

  it("simulates mixed fixed, hourly, usage, bucket, product, and license charges with tax and explanations", async () => {
    const scenario = structuredClone(fixture.scenario);
    scenario.horizon = {
      start_date: "2025-05-15T00:00:00Z",
      period_count: 2,
    };
    scenario.assumptions[
      assumptionKey(fixture.lines.hourly, fixture.services.hourly)
    ] = {
      flat: 3,
    };
    scenario.assumptions[
      assumptionKey(fixture.lines.usage, fixture.services.usage)
    ] = {
      flat: 12,
    };

    const result = await simulateContractScenario(
      context.db,
      context.tenantId,
      scenario,
    );

    expect(result.periods).toHaveLength(2);
    expect(result.periods[0].period_start).toBe("2025-05-15T00:00:00Z");
    expect(result.periods[0].period_end).toBe("2025-06-14T00:00:00Z");
    const chargedPeriod = result.periods.find(
      (period) => period.lines.length > 0,
    );
    expect(chargedPeriod).toBeDefined();
    expect(
      new Set(chargedPeriod?.lines.map((line) => line.charge_type)),
    ).toEqual(
      new Set(["fixed", "time", "usage", "bucket", "product", "license"]),
    );
    expect(chargedPeriod?.lines.every((line) => line.explanation)).toBe(true);
    expect(chargedPeriod?.subtotal).toBeGreaterThan(0);
    expect(chargedPeriod?.tax).toBeGreaterThan(0);
    expect(chargedPeriod?.total).toBe(
      (chargedPeriod?.subtotal ?? 0) + (chargedPeriod?.tax ?? 0),
    );
    expect(chargedPeriod?.invoice_view_model.items).toHaveLength(
      chargedPeriod?.lines.length,
    );
    expect(
      chargedPeriod?.invoice_view_model.items.every((item) => item.id),
    ).toBe(true);
    expect(chargedPeriod?.invoice_view_model.customer).toMatchObject({
      name: expect.any(String),
      address: expect.not.stringContaining("N/A"),
    });
    expect(chargedPeriod?.invoice_view_model).toHaveProperty("tenantClient");
    expect(chargedPeriod?.invoice_view_model).toHaveProperty("recurringItems");
  });

  it("reports unsupported cadence, empty lines, and missing product prices instead of silently omitting them", async () => {
    const scenario = structuredClone(fixture.scenario);
    scenario.horizon = {
      start_date: "2025-05-15T00:00:00Z",
      period_count: 1,
    };
    const emptyLine = scenario.lines.find(
      (line) => line.key === fixture.lines.usage,
    );
    const productLine = scenario.lines.find(
      (line) => line.key === fixture.lines.product,
    );
    if (!emptyLine || !productLine)
      throw new Error("Fixture lines are missing");
    emptyLine.billing_frequency = "fortnightly";
    emptyLine.services = [];
    for (const service of productLine.services) {
      service.custom_rate = null;
      service.default_rate = null;
      service.service_custom_rate = null;
      service.configuration_custom_rate = null;
    }

    const result = await simulateContractScenario(
      context.db,
      context.tenantId,
      scenario,
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("projection cannot model"),
        expect.stringContaining("Has no services"),
        expect.stringContaining("has no USD product price"),
      ]),
    );
  });

  it("leaves billing, contract, tax, numbering, and event-related tables byte-for-byte unchanged", async () => {
    const scenario = structuredClone(fixture.scenario);
    scenario.horizon = {
      start_date: "2025-05-15T00:00:00Z",
      period_count: 2,
    };
    scenario.assumptions[
      assumptionKey(fixture.lines.hourly, fixture.services.hourly)
    ] = {
      flat: 2,
    };

    const tables = [
      "contracts",
      "contract_lines",
      "contract_line_services",
      "contract_line_service_configuration",
      "client_contracts",
      "client_contract_lines",
      "invoices",
      "invoice_charges",
      "invoice_charge_details",
      "recurring_service_periods",
      "time_entries",
      "usage_tracking",
      "bucket_usage",
      "tax_rates",
      "tax_regions",
      "client_tax_settings",
      "client_tax_rates",
      "next_number",
      "audit_logs",
      "events",
      "workflow_events",
      "inbound_email_outbox",
    ];
    const before = await fingerprintTenantTables(
      context.db,
      context.tenantId,
      tables,
    );

    await simulateContractScenario(context.db, context.tenantId, scenario);

    const after = await fingerprintTenantTables(
      context.db,
      context.tenantId,
      tables,
    );
    expect(after).toEqual(before);
  });

  it("matches simulator detail to an invoice persisted by production generation", async () => {
    const windowStart = "2025-02-15T00:00:00Z";
    const windowEnd = "2025-03-15T00:00:00Z";
    await seedHistoricalActivity(context, fixture);

    const scenario = structuredClone(fixture.scenario);
    await context.db("contract_lines")
      .where({ tenant: context.tenantId, contract_id: fixture.contractId })
      .update({ cadence_owner: "contract" });
    for (const line of scenario.lines) line.cadence_owner = "contract";
    scenario.horizon = { start_date: windowStart, period_count: 2 };
    scenario.assumptions[
      assumptionKey(fixture.lines.hourly, fixture.services.hourly)
    ] = { flat: 0 };
    scenario.assumptions[
      assumptionKey(fixture.lines.usage, fixture.services.usage)
    ] = { flat: 3 };
    await persistScenarioServicePeriods(context, scenario);

    const beforeSimulation = await fingerprintTenantTables(
      context.db,
      context.tenantId,
      ["invoices", "invoice_charges", "invoice_charge_details", "next_number", "audit_logs", "events", "workflow_events"],
    );
    const simulated = await simulateContractScenario(
      context.db,
      context.tenantId,
      scenario,
    );
    const afterSimulation = await fingerprintTenantTables(
      context.db,
      context.tenantId,
      ["invoices", "invoice_charges", "invoice_charge_details", "next_number", "audit_logs", "events", "workflow_events"],
    );
    expect(afterSimulation).toEqual(beforeSimulation);
    const invoice = await generateInvoiceForNormalizedSelectionInputs({
      user: {
        user_id: context.userId,
        user_type: "internal",
        tenant: context.tenantId,
      } as never,
      tenant: context.tenantId,
      knex: context.db,
      normalizedSelectorInputs: scenario.lines.map((line) =>
        buildContractCadenceDueSelectionInput({
          clientId: context.clientId,
          contractId: fixture.contractId,
          contractLineId: line.origin_contract_line_id ?? line.key,
          windowStart,
          windowEnd,
        }),
      ),
    });
    expect(invoice).not.toBeNull();

    const persisted = await context.db("invoice_charges")
      .where({ tenant: context.tenantId, invoice_id: invoice?.invoice_id })
      .whereNot({ is_discount: true })
      .orderBy(["service_id", "description"]);
    const simulatedLines = simulated.periods.find(
      (period) => period.lines.length > 0,
    )?.lines ?? [];
    const semanticLine = (line: {
      service_id?: string | null;
      description?: string | null;
      quantity?: number | string | null;
      unit_price?: number | string | null;
      net_amount?: number | string | null;
      tax_amount?: number | string | null;
    }) => ({
      serviceId: line.service_id ?? null,
      description: (line.description ?? "").replace(/^(Product|License): /, ""),
      quantity: Number(line.quantity ?? 0),
      unitRate: Number(line.unit_price ?? 0),
      netAmount: Number(line.net_amount ?? 0),
      taxAmount: Number(line.tax_amount ?? 0),
    });
    const liveDetail = persisted.map(semanticLine).sort(compareSemanticLines);
    const simulationDetail = simulatedLines
      .map((line) => ({
        serviceId: line.charge_type === "fixed" ? null : line.service_id ?? null,
        description: line.service_name.replace(/^(Product|License): /, ""),
        quantity: Number(line.quantity ?? 0),
        unitRate: Number(line.unit_price ?? 0),
        netAmount: line.net_amount,
        taxAmount: line.tax_amount,
      }))
      .sort(compareSemanticLines);
    expect(liveDetail).toEqual(simulationDetail);
  }, 120_000);

  it("rejects cross-tenant contract, client, service, and replay references", async () => {
    const otherTenant = await createTenant(
      context.db,
      "Other simulator tenant",
    );
    const otherClient = await createClient(
      context.db,
      otherTenant,
      "Other tenant client",
    );
    const otherService = await createTestService(
      {
        db: context.db,
        tenantId: otherTenant,
        clientId: otherClient,
      } as TestContext,
      { service_name: "Other tenant service", default_rate: 99_999 },
    );
    const otherContract = uuidv4();
    await context.db("contracts").insert({
      tenant: otherTenant,
      contract_id: otherContract,
      contract_name: "Other tenant contract",
      contract_description: "Must not leak",
      billing_frequency: "monthly",
      is_active: true,
      status: "Active",
      is_template: false,
      currency_code: "USD",
      owner_client_id: otherClient,
    });

    await expect(
      snapshotContractToScenario(context.db, context.tenantId, {
        contractId: otherContract,
        clientContractId: null,
      }),
    ).rejects.toThrow("not found");

    const foreignClientScenario = structuredClone(fixture.scenario);
    foreignClientScenario.client_binding = {
      kind: "client",
      client_id: otherClient,
      client_name: "Must not leak",
    };
    await expect(
      simulateContractScenario(
        context.db,
        context.tenantId,
        foreignClientScenario,
      ),
    ).rejects.toThrow("Scenario client is not available");

    const foreignServiceScenario = structuredClone(fixture.scenario);
    foreignServiceScenario.lines[0].services[0].service_id = otherService;
    await expect(
      simulateContractScenario(
        context.db,
        context.tenantId,
        foreignServiceScenario,
      ),
    ).rejects.toThrow("invalid service reference");
    await expect(
      loadReplayAssumptions(
        context.db,
        context.tenantId,
        foreignServiceScenario,
        "2025-01-15T00:00:00Z",
        "2025-02-15T00:00:00Z",
      ),
    ).rejects.toThrow("invalid service reference");
  });

  it("prefills recent averages and replay overrides from actual contract activity", async () => {
    await seedHistoricalActivity(context, fixture);

    const recentScenario = structuredClone(fixture.scenario);
    recentScenario.horizon.start_date = "2025-04-15T00:00:00Z";
    const recent = await loadRecentAverageAssumptions(
      context.db,
      context.tenantId,
      recentScenario,
      3,
    );
    expect(
      recent.assumptions[
        assumptionKey(fixture.lines.hourly, fixture.services.hourly)
      ]?.flat,
    ).toBeCloseTo(1);
    expect(
      recent.assumptions[
        assumptionKey(fixture.lines.usage, fixture.services.usage)
      ]?.flat,
    ).toBeCloseTo(4);

    const replay = await loadReplayAssumptions(
      context.db,
      context.tenantId,
      recentScenario,
      "2025-01-15T00:00:00Z",
      "2025-04-15T00:00:00Z",
    );
    expect(replay.horizon).toEqual({
      start_date: "2025-01-15T00:00:00Z",
      period_count: 3,
    });
    expect(
      replay.assumptions[
        assumptionKey(fixture.lines.hourly, fixture.services.hourly)
      ]?.overrides,
    ).toEqual({ 0: 1, 1: 2, 2: 0 });
    expect(
      replay.assumptions[
        assumptionKey(fixture.lines.usage, fixture.services.usage)
      ]?.overrides,
    ).toEqual({ 0: 3, 1: 0, 2: 9 });
  });

  it("returns seeded issued invoices beside replay assumptions with normalized lines", async () => {
    const invoiceId = await seedIssuedInvoice(context, fixture);
    const replay = await loadReplayAssumptions(
      context.db,
      context.tenantId,
      fixture.scenario,
      "2025-01-15T00:00:00Z",
      "2025-02-15T00:00:00Z",
    );

    expect(replay.actual_invoices).toHaveLength(1);
    expect(replay.actual_invoices?.[0]).toMatchObject({
      invoice_id: invoiceId,
      invoice_number: "SIM-ACTUAL-001",
      status: "sent",
      period_start: "2025-01-15T00:00:00Z",
      subtotal: 10_000,
      tax: 1_000,
      total: 11_000,
    });
    expect(replay.actual_invoices?.[0].lines[0]).toMatchObject({
      service_id: fixture.services.hourly,
      net_amount: 10_000,
      tax_amount: 1_000,
      total: 11_000,
    });
    expect(
      replay.actual_invoices?.[0].invoice_view_model.items[0],
    ).toMatchObject({
      quantity: 2,
      unitPrice: 5_000,
      total: 10_000,
    });
    expect(
      replay.actual_invoices?.[0].invoice_view_model.customer.address,
    ).not.toBe("N/A");
    expect(replay.actual_invoices?.[0].invoice_view_model).toHaveProperty(
      "recurringItems",
    );
  });
});

async function seedSimulatorFixture(
  context: TestContext,
): Promise<SimulatorFixture> {
  const taxRateId = await setupClientTaxConfiguration(context, {
    regionCode: "US-NY",
    regionName: "New York",
    description: "Simulator integration tax",
    startDate: "2020-01-01T00:00:00.000Z",
    taxPercentage: 10,
  });
  await ensureClientBillingSettingsRow(context.db, {
    tenant: context.tenantId,
    clientId: context.clientId,
  });
  await context
    .db("clients")
    .where({
      tenant: context.tenantId,
      client_id: context.clientId,
    })
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

  const location = await context
    .db("client_locations")
    .where({ tenant: context.tenantId, client_id: context.clientId })
    .first("location_id");
  if (!location?.location_id)
    throw new Error("Fixture client location is missing");

  const services = {
    fixed: await createPricedService(
      context,
      "Managed support",
      "fixed",
      10_000,
      taxRateId,
    ),
    hourly: await createPricedService(
      context,
      "Engineering",
      "hourly",
      5_000,
      taxRateId,
    ),
    usage: await createPricedService(
      context,
      "Cloud backup",
      "usage",
      200,
      taxRateId,
      "GB",
    ),
    product: await createPricedService(
      context,
      "Managed appliance",
      "fixed",
      2_500,
      taxRateId,
    ),
    license: await createPricedService(
      context,
      "Security license",
      "fixed",
      1_000,
      taxRateId,
    ),
  };
  await context
    .db("service_catalog")
    .where({ tenant: context.tenantId, service_id: services.product })
    .update({ item_kind: "product", is_license: false });
  await context
    .db("service_catalog")
    .where({ tenant: context.tenantId, service_id: services.license })
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
  };
  const fixed = await createFixedPlanAssignment(context, services.fixed, {
    ...common,
    planName: "Managed support",
    baseRateCents: 10_000,
  });
  const hourly = await createFixedPlanAssignment(context, services.hourly, {
    ...common,
    planName: "Engineering",
    baseRateCents: 5_000,
  });
  const usage = await createFixedPlanAssignment(context, services.usage, {
    ...common,
    planName: "Cloud backup",
    baseRateCents: 200,
  });
  const product = await createFixedPlanAssignment(context, services.product, {
    ...common,
    planName: "Managed appliance",
    baseRateCents: 2_500,
    quantity: 2,
  });
  const license = await createFixedPlanAssignment(context, services.license, {
    ...common,
    planName: "Security license",
    baseRateCents: 1_000,
    quantity: 5,
  });

  await context
    .db("contract_lines")
    .where({ tenant: context.tenantId, contract_line_id: fixed.contractLineId })
    .update({ location_id: location.location_id });
  const hourlyConfig = await convertLineConfiguration(
    context,
    hourly.contractLineId,
    services.hourly,
    "Hourly",
  );
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
    enable_overtime: true,
    overtime_rate: 7_500,
    overtime_threshold: 8,
    enable_after_hours_rate: false,
    after_hours_multiplier: null,
  });
  await addBucketOverlay(
    context,
    hourly.contractLineId,
    services.hourly,
    60,
    1_000,
  );

  const usageConfig = await convertLineConfiguration(
    context,
    usage.contractLineId,
    services.usage,
    "Usage",
  );
  await context.db("contract_line_service_usage_config").insert({
    tenant: context.tenantId,
    config_id: usageConfig,
    unit_of_measure: "GB",
    enable_tiered_pricing: true,
    minimum_usage: 2,
    base_rate: 200,
  });
  await context.db("contract_line_service_rate_tiers").insert([
    {
      tenant: context.tenantId,
      tier_id: uuidv4(),
      config_id: usageConfig,
      min_quantity: 0,
      max_quantity: 10,
      rate: 200,
    },
    {
      tenant: context.tenantId,
      tier_id: uuidv4(),
      config_id: usageConfig,
      min_quantity: 10,
      max_quantity: null,
      rate: 150,
    },
  ]);

  await context.db("contract_pricing_schedules").insert({
    tenant: context.tenantId,
    schedule_id: uuidv4(),
    contract_id: contractId,
    effective_date: "2025-07-01",
    end_date: null,
    custom_rate: 12_500,
  });

  const scenario = await snapshotContractToScenario(
    context.db,
    context.tenantId,
    { contractId, clientContractId },
  );
  return {
    contractId,
    clientContractId,
    locationId: location.location_id,
    scenario,
    services,
    lines: {
      fixed: fixed.contractLineId,
      hourly: hourly.contractLineId,
      usage: usage.contractLineId,
      product: product.contractLineId,
      license: license.contractLineId,
    },
    configs: { hourly: hourlyConfig, usage: usageConfig },
  };
}

async function createPricedService(
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
    })
    .onConflict(["tenant", "service_id", "currency_code"])
    .merge({ rate });
  return serviceId;
}

async function convertLineConfiguration(
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
  if (!config?.config_id)
    throw new Error(`Missing config for ${contractLineId}`);
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

async function addBucketOverlay(
  context: TestContext,
  contractLineId: string,
  serviceId: string,
  totalMinutes: number,
  overageRate: number,
): Promise<void> {
  const configId = uuidv4();
  await context.db("contract_line_service_configuration").insert({
    tenant: context.tenantId,
    config_id: configId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    configuration_type: "Bucket",
    custom_rate: null,
    quantity: null,
  });
  await context.db("contract_line_service_bucket_config").insert({
    tenant: context.tenantId,
    config_id: configId,
    total_minutes: totalMinutes,
    billing_period: "monthly",
    overage_rate: overageRate,
    allow_rollover: true,
  });
  await context.db("contract_line_buckets").insert({
    tenant: context.tenantId,
    bucket_id: configId,
    contract_line_id: contractLineId,
    bucket_name: "Included support",
    total_minutes: totalMinutes,
    overage_rate: overageRate,
    allow_rollover: true,
    billing_period: "monthly",
    covers_all_services: false,
  });
  await context.db("contract_line_bucket_services").insert({
    tenant: context.tenantId,
    bucket_id: configId,
    contract_line_id: contractLineId,
    service_id: serviceId,
    burn_multiplier: 1,
  });
}

async function seedHistoricalActivity(
  context: TestContext,
  fixture: SimulatorFixture,
): Promise<void> {
  const timeEntry = (
    date: string,
    minutes: number,
  ): Record<string, unknown> => ({
    tenant: context.tenantId,
    entry_id: uuidv4(),
    client_id: context.clientId,
    contract_line_id: fixture.lines.hourly,
    user_id: context.userId,
    service_id: fixture.services.hourly,
    entry_date: date,
    work_date: date,
    start_time: `${date}T09:00:00Z`,
    end_time: new Date(
      new Date(`${date}T09:00:00Z`).getTime() + minutes * 60_000,
    ).toISOString(),
    billable_duration: minutes,
    is_billable: true,
    approval_status: "APPROVED",
    work_timezone: "UTC",
  });
  await insertSupportedRows(context.db, "time_entries", [
    timeEntry("2025-01-20", 60),
    timeEntry("2025-02-20", 120),
  ]);
  await insertSupportedRows(context.db, "usage_tracking", [
    {
      tenant: context.tenantId,
      usage_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: fixture.lines.usage,
      service_id: fixture.services.usage,
      usage_date: "2025-01-21",
      quantity: 3,
      is_billable: true,
      invoiced: false,
    },
    {
      tenant: context.tenantId,
      usage_id: uuidv4(),
      client_id: context.clientId,
      contract_line_id: fixture.lines.usage,
      service_id: fixture.services.usage,
      usage_date: "2025-03-21",
      quantity: 9,
      is_billable: true,
      invoiced: false,
    },
  ]);
}

async function seedIssuedInvoice(
  context: TestContext,
  fixture: SimulatorFixture,
): Promise<string> {
  const invoiceId = uuidv4();
  await insertSupportedRows(context.db, "invoices", [
    {
      tenant: context.tenantId,
      invoice_id: invoiceId,
      client_id: context.clientId,
      company_id: context.clientId,
      invoice_number: "SIM-ACTUAL-001",
      invoice_date: "2025-02-15T00:00:00Z",
      due_date: "2025-03-15T00:00:00Z",
      billing_period_start: "2025-01-15",
      billing_period_end: "2025-02-15",
      subtotal: 10_000,
      tax: 1_000,
      total_amount: 11_000,
      credit_applied: 0,
      currency_code: "USD",
      status: "sent",
      is_manual: false,
      tax_source: "internal",
    },
  ]);
  await insertSupportedRows(context.db, "invoice_charges", [
    {
      tenant: context.tenantId,
      item_id: uuidv4(),
      invoice_id: invoiceId,
      service_id: fixture.services.hourly,
      description: "Engineering",
      quantity: 2,
      unit_price: 5_000,
      net_amount: 10_000,
      tax_amount: 1_000,
      tax_rate: 10,
      tax_region: "US-NY",
      is_taxable: true,
      is_discount: false,
      is_manual: false,
      total_price: 11_000,
      created_by: context.userId,
      updated_by: context.userId,
    },
  ]);
  return invoiceId;
}

async function insertSupportedRows(
  db: Knex,
  table: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> {
  const columns = await db(table).columnInfo();
  await db(table).insert(
    rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([column]) => column in columns),
      ),
    ),
  );
}

async function fingerprintTenantTables(
  db: Knex,
  tenant: string,
  tables: string[],
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const table of tables) {
    if (!(await db.schema.hasTable(table))) continue;
    const columns = await db(table).columnInfo();
    const query = db(table).select("*");
    if ("tenant" in columns) query.where({ tenant });
    const rows = await query;
    result[table] = JSON.stringify(
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).sort(([left], [right]) =>
            left.localeCompare(right),
          ),
        ),
      ),
    );
  }
  return result;
}

async function persistScenarioServicePeriods(
  context: TestContext,
  scenario: ContractScenario,
): Promise<void> {
  for (const line of scenario.lines) {
    const product = line.services.find((service) => service.item_kind === "product");
    const chargeFamily = product
      ? product.is_license ? "license" : "product"
      : line.contract_line_type.toLowerCase();
    await insertSupportedRows(
      context.db,
      "recurring_service_periods",
      [{
        tenant: context.tenantId,
        record_id: uuidv4(),
        schedule_key: `parity:${line.key}`,
        period_key: `2025-01-15:2025-02-15`,
        revision: 1,
        obligation_id: line.origin_contract_line_id ?? line.key,
        obligation_type: "client_contract_line",
        charge_family: chargeFamily,
        cadence_owner: "contract",
        due_position: "arrears",
        lifecycle_state: "generated",
        service_period_start: "2025-01-15",
        service_period_end: "2025-02-15",
        invoice_window_start: "2025-02-15",
        invoice_window_end: "2025-03-15",
        provenance_kind: "generated",
        source_rule_version: "parity-v1",
        reason_code: "initial_materialization",
        source_run_key: "contract-simulator-parity",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }],
    );
  }
}

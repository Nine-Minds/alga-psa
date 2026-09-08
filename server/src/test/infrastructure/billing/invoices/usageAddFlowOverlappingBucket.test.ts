import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import "../../../../../test-utils/nextApiMock";
import { setupCommonMocks } from "../../../../../test-utils/testMocks";
import { previewInvoice } from "@alga-psa/billing/actions/invoiceGeneration";
import {
  createUsageRecord,
  getEligibleContractLinesForUI,
} from "@alga-psa/billing/actions/usageActions";
import { v4 as uuidv4 } from "uuid";
import { TextEncoder as NodeTextEncoder } from "util";
import { TestContext } from "../../../../../test-utils/testContext";
import { createTestDateISO } from "../../../../../test-utils/dateUtils";
import {
  setupClientTaxConfiguration,
  assignServiceTaxRate,
  assignContractLineToClient,
  createTestService,
  createBucketOverlayForPlan,
  createFixedPlanAssignment,
  ensureClientPlanBundlesTable,
} from "../../../../../test-utils/billingTestHelpers";

// Force connection directly to PostgreSQL (not pgbouncer on 6432)
process.env.DB_PORT =
  process.env.DB_PORT === "6432" ? "5432" : process.env.DB_PORT;

let mockedTenantId = "11111111-1111-1111-1111-111111111111";
let mockedUserId = "mock-user-id";

vi.mock("@alga-psa/auth", async () => {
  const { createAuthModuleMock } =
    await import("../../../../../test-utils/authModuleMock");
  return createAuthModuleMock();
});

vi.mock("server/src/lib/analytics/posthog", () => ({
  analytics: {
    capture: vi.fn(),
    identify: vi.fn(),
    trackPerformance: vi.fn(),
    getClient: () => null,
  },
}));

vi.mock("@alga-psa/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@alga-psa/db")>()),
  withTransaction: vi.fn(async (knex, callback) => callback(knex)),
  withAdminTransaction: vi.fn(async (callback, existingConnection) =>
    callback(existingConnection as any),
  ),
}));

vi.mock("@alga-psa/core/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@alga-psa/core/secrets", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => "MockSecretProvider",
    close: async () => {},
  }),
}));

vi.mock("@alga-psa/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSecretProviderInstance: () => ({
    getSecret: async () => undefined,
    getAppSecret: async () => undefined,
    setSecret: async () => {},
    getProviderName: () => "MockSecretProvider",
    close: async () => {},
  }),
}));

vi.mock("@alga-psa/workflows/persistence", () => ({
  WorkflowEventModel: {
    create: vi.fn(),
  },
}));

vi.mock("@alga-psa/workflow-streams", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@alga-psa/workflow-streams")>()),
  getRedisStreamClient: () => ({
    publishEvent: vi.fn(),
  }),
  toStreamEvent: (event: unknown) => event,
}));

vi.mock("server/src/lib/auth/rbac", () => ({
  hasPermission: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@alga-psa/users/actions", () => ({
  getCurrentUser: vi.fn(async () => ({
    user_id: mockedUserId,
    tenant: mockedTenantId,
    user_type: "internal",
    roles: [],
  })),
}));

const globalForVitest = globalThis as { TextEncoder: typeof NodeTextEncoder };
globalForVitest.TextEncoder = NodeTextEncoder;

/**
 * Behavioral regression coverage for the Usage Tracking "Add Usage" mitigation:
 * a client/service that has BOTH an eligible record-driven usage line AND an
 * overlapping bucket line must load its eligible lines under the authenticated
 * tenant (no HTTP 500 from a bare tenant-less server action), let the intended
 * usage line be selected explicitly (never silently resolved to the bucket
 * line), persist a dated quantity with the right tenant and contract_line_id,
 * and have invoice preview bill that record — with no bucket date exception
 * rolling the insert back and no invoice mutation during preview.
 */
describe("Usage contracts – add-usage flow with overlapping usage + bucket lines", () => {
  const {
    beforeAll: setupContext,
    beforeEach: resetContext,
    afterEach: rollbackContext,
    afterAll: cleanupContext,
  } = TestContext.createHelpers();

  let context: TestContext;

  async function ensureDefaultTaxConfiguration() {
    await setupClientTaxConfiguration(context, {
      regionCode: "US-NY",
      regionName: "New York",
      description: "NY State + City Tax",
      startDate: "2023-01-01T00:00:00.000Z",
      taxPercentage: 10,
    });
    await assignServiceTaxRate(context, "*", "US-NY", { onlyUnset: true });
  }

  /**
   * Builds a usage-config line AND an overlapping bucket line for the SAME
   * service on the SAME contract/assignment, both active from Jan 2023 and
   * invoiced (arrears) in the Feb 1 – Mar 1 window.
   */
  async function setupOverlappingUsageAndBucketLines() {
    const serviceId = await createTestService(context, {
      service_name: "Rabbit Tracking",
      billing_method: "usage",
      default_rate: 1000, // $10.00 per unit
      unit_of_measure: "unit",
      tax_region: "US-NY",
    });

    const usageLineId = await context.createEntity(
      "contract_lines",
      {
        contract_line_name: "Usage Contract Line",
        billing_frequency: "monthly",
        is_custom: false,
        contract_line_type: "Usage",
      },
      "contract_line_id",
    );

    const usageConfigId = uuidv4();
    await context.db("contract_line_service_configuration").insert({
      config_id: usageConfigId,
      contract_line_id: usageLineId,
      service_id: serviceId,
      configuration_type: "Usage",
      quantity: null,
      tenant: context.tenantId,
    });

    await context.db("contract_line_services").insert({
      contract_line_id: usageLineId,
      service_id: serviceId,
      tenant: context.tenantId,
    });

    const billingCycleId = await context.createEntity(
      "client_billing_cycles",
      {
        client_id: context.clientId,
        billing_cycle: "monthly",
        effective_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_start_date: createTestDateISO({ year: 2023, month: 2, day: 1 }),
        period_end_date: createTestDateISO({ year: 2023, month: 3, day: 1 }),
      },
      "billing_cycle_id",
    );

    const assignment = await assignContractLineToClient(context, usageLineId, {
      startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
    });

    // Overlapping bucket line on the SAME contract + assignment: it pools the
    // same service, so the Add Usage dialog lists both lines as eligible.
    const bucketAssignment = await createFixedPlanAssignment(
      context,
      serviceId,
      {
        contractId: assignment.contractId,
        clientContractId: assignment.clientContractId,
        planName: "Bucket Pool Line",
        baseRateCents: 0,
        detailBaseRateCents: 0,
        quantity: 1,
        billingFrequency: "monthly",
        billingTiming: "arrears",
        startDate: createTestDateISO({ year: 2023, month: 1, day: 1 }),
        contractHeaderStatus: "Active",
        assignmentStatus: "pending",
        ensureBillingEmail: true,
        materializeServicePeriods: true,
      },
    );
    await createBucketOverlayForPlan(context, bucketAssignment.contractLineId, {
      serviceId,
      totalHours: 40,
      overageRateCents: 7500,
      allowRollover: false,
      billingPeriod: "monthly",
    });

    return {
      serviceId,
      usageLineId,
      bucketLineId: bucketAssignment.contractLineId,
      billingCycleId,
    };
  }

  beforeAll(async () => {
    context = await setupContext({
      runSeeds: true,
      cleanupTables: [
        "invoice_charges",
        "invoices",
        "usage_tracking",
        "bucket_usage",
        "time_entries",
        "tickets",
        "client_billing_cycles",
        "client_contract_lines",
        "contract_line_services",
        "contract_line_bucket_services",
        "contract_line_buckets",
        "service_catalog",
        "contract_lines",
        "tax_rates",
        "tax_regions",
        "client_tax_settings",
        "client_tax_rates",
        "next_number",
      ],
      clientName: "Usage Add Flow Client",
      userType: "internal",
    });

    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await ensureDefaultTaxConfiguration();
    await ensureClientPlanBundlesTable(context);
  }, 120000);

  beforeEach(async () => {
    context = await resetContext();
    const mockContext = setupCommonMocks({
      tenantId: context.tenantId,
      userId: context.userId,
      permissionCheck: () => true,
    });
    mockedTenantId = mockContext.tenantId;
    mockedUserId = mockContext.userId;

    await context.db("next_number").insert({
      tenant: context.tenantId,
      entity_type: "INVOICE",
      prefix: "INV-",
      last_number: 0,
      initial_value: 1,
      padding_length: 6,
    });

    await ensureDefaultTaxConfiguration();
    await ensureClientPlanBundlesTable(context);
  }, 60000);

  afterEach(async () => {
    await rollbackContext();
  }, 30000);

  afterAll(async () => {
    await cleanupContext();
  }, 30000);

  it("loads eligible lines under tenant, persists an explicitly selected usage line, and previews its billing", async () => {
    const { serviceId, usageLineId, bucketLineId, billingCycleId } =
      await setupOverlappingUsageAndBucketLines();

    // 1. Eligible-line loading succeeds under the authenticated tenant context
    //    (regression: this used to be a bare server action that 500'd with
    //    "Tenant context not found", so the selector never appeared).
    const eligible = await getEligibleContractLinesForUI(
      context.clientId,
      serviceId,
      "2023-01-15T00:00:00.000Z",
    );

    expect(eligible).not.toBeNull();
    if (Array.isArray(eligible)) {
      const lineIds = eligible.map((line) => line.client_contract_line_id);
      expect(lineIds).toEqual(
        expect.arrayContaining([usageLineId, bucketLineId]),
      );
    } else {
      throw new Error(
        `getEligibleContractLinesForUI returned an error envelope: ${JSON.stringify(eligible)}`,
      );
    }

    // 2+3. The intended USAGE line is selected explicitly; a dated quantity
    //    persists with the right tenant and contract_line_id (regression: the
    //    bucket-draw boundary rejected the non-ISO Date and rolled back).
    const created = await createUsageRecord({
      client_id: context.clientId,
      service_id: serviceId,
      quantity: 4,
      usage_date: "2023-01-15T00:00:00.000Z",
      contract_line_id: usageLineId,
    });

    expect(created).not.toBeNull();
    if (typeof created === "object" && "usage_id" in created) {
      expect(created.usage_id).toBeTruthy();
      expect(created.contract_line_id).toBe(usageLineId);
      expect(created.tenant).toBe(context.tenantId);
      expect(created.client_id).toBe(context.clientId);
      expect(created.service_id).toBe(serviceId);
    } else {
      throw new Error(
        `createUsageRecord returned an error envelope: ${JSON.stringify(created)}`,
      );
    }

    const persisted = await context
      .db("usage_tracking")
      .where({
        tenant: context.tenantId,
        usage_id: (created as { usage_id: string }).usage_id,
      })
      .first();
    expect(persisted).toBeTruthy();
    expect(persisted.contract_line_id).toBe(usageLineId);
    expect(persisted.tenant).toBe(context.tenantId);
    // The stored timestamptz materializes as a JS Date; assert it round-trips
    // to the canonical ISO day (no "Thu Sep 03 2026 …" garbage anywhere).
    expect(persisted.usage_date).toBeInstanceOf(Date);
    expect(new Date(persisted.usage_date).toISOString().slice(0, 10)).toBe(
      "2023-01-15",
    );

    // 4+5. Invoice preview bills that record and mutates nothing.
    const preview = await previewInvoice(billingCycleId);

    expect(preview.success).toBe(true);
    if (!preview.success)
      throw new Error(`preview failed: ${JSON.stringify(preview)}`);
    expect(preview.usageServicePeriodStatuses ?? []).toHaveLength(0);
    expect(preview.data.total).toBeGreaterThan(0);

    const invoices = await context
      .db("invoices")
      .where({ tenant: context.tenantId });
    expect(invoices).toHaveLength(0);
    const charges = await context
      .db("invoice_charges")
      .where({ tenant: context.tenantId });
    expect(charges).toHaveLength(0);
  });
});

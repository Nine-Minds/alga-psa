import { expect, test, type Page } from "@playwright/test";
import type { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import {
  applyTestEnvDefaults,
  createTenantAndLogin,
  createTestDbConnection,
  getBaseUrl,
  type TenantTestData,
} from "./helpers/testSetup";
import {
  createFixedPlanAssignment,
  createTestService,
} from "../../../test-utils/billingTestHelpers";

applyTestEnvDefaults();

const baseUrl = getBaseUrl();

interface SeededSimulator {
  contractId: string;
  clientContractId: string;
  hourlyLineId: string;
  hourlyServiceId: string;
}

async function seedSimulatorContract(
  db: Knex,
  tenantData: TenantTestData,
  asTemplate = false,
): Promise<SeededSimulator> {
  const tenantId = tenantData.tenant.tenantId;
  const clientId = tenantData.client!.clientId;
  const context = { db, tenantId, clientId } as never;
  const fixedServiceId = await createTestService(context, {
    service_name: `Managed support ${uuidv4().slice(0, 6)}`,
    billing_method: "fixed",
    default_rate: 10_000,
  });
  const hourlyServiceId = await createTestService(context, {
    service_name: `Engineering ${uuidv4().slice(0, 6)}`,
    billing_method: "hourly",
    default_rate: 5_000,
  });
  await db("service_prices").insert([
    {
      tenant: tenantId,
      service_id: fixedServiceId,
      currency_code: "USD",
      rate: 10_000,
    },
    {
      tenant: tenantId,
      service_id: hourlyServiceId,
      currency_code: "USD",
      rate: 5_000,
    },
  ]);

  const contractId = uuidv4();
  const clientContractId = uuidv4();
  const common = {
    contractId,
    clientContractId,
    clientId,
    startDate: "2026-01-01",
    endDate: "2027-12-31",
    billingFrequency: "monthly" as const,
    billingTiming: "arrears" as const,
  };
  await createFixedPlanAssignment(context, fixedServiceId, {
    ...common,
    planName: `Simulator contract ${uuidv4().slice(0, 6)}`,
    baseRateCents: 10_000,
  });
  const hourly = await createFixedPlanAssignment(context, hourlyServiceId, {
    ...common,
    planName: "Engineering hours",
    baseRateCents: 5_000,
  });
  const config = await db("contract_line_service_configuration")
    .where({
      tenant: tenantId,
      contract_line_id: hourly.contractLineId,
      service_id: hourlyServiceId,
      configuration_type: "Fixed",
    })
    .first("config_id");
  await db("contract_line_service_fixed_config")
    .where({ tenant: tenantId, config_id: config.config_id })
    .delete();
  await db("contract_line_service_configuration")
    .where({ tenant: tenantId, config_id: config.config_id })
    .update({ configuration_type: "Hourly" });
  await db("contract_lines")
    .where({ tenant: tenantId, contract_line_id: hourly.contractLineId })
    .update({ contract_line_type: "Hourly" });
  await db("contract_line_service_hourly_configs").insert({
    tenant: tenantId,
    config_id: config.config_id,
    hourly_rate: 5_000,
    minimum_billable_time: 15,
    round_up_to_nearest: 15,
  });
  await db("contract_line_service_hourly_config").insert({
    tenant: tenantId,
    config_id: config.config_id,
    minimum_billable_time: 15,
    round_up_to_nearest: 15,
    enable_overtime: false,
    overtime_rate: null,
    overtime_threshold: null,
    enable_after_hours_rate: false,
    after_hours_multiplier: null,
  });

  if (asTemplate) {
    const templateId = uuidv4();
    const templateLineId = uuidv4();
    await db("contract_templates").insert({
      tenant: tenantId,
      template_id: templateId,
      template_name: `Simulator template ${uuidv4().slice(0, 6)}`,
      template_description: "Template simulator fixture",
      default_billing_frequency: "monthly",
      template_status: "active",
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db("contract_template_lines").insert({
      tenant: tenantId,
      template_line_id: templateLineId,
      template_id: templateId,
      template_line_name: "Template managed support",
      description: "Template simulator fixed line",
      billing_frequency: "monthly",
      billing_timing: "arrears",
      cadence_owner: "contract",
      line_type: "Fixed",
      custom_rate: 10_000,
      is_active: true,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
    await db("contract_template_line_services").insert({
      tenant: tenantId,
      template_line_id: templateLineId,
      service_id: fixedServiceId,
      quantity: 1,
      custom_rate: 10_000,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    return {
      contractId: templateId,
      clientContractId,
      hourlyLineId: templateLineId,
      hourlyServiceId: fixedServiceId,
    };
  }

  return {
    contractId,
    clientContractId,
    hourlyLineId: hourly.contractLineId,
    hourlyServiceId,
  };
}

async function openSimulator(
  page: Page,
  tenantData: TenantTestData,
  seeded: SeededSimulator,
): Promise<void> {
  const tenantQuery = `&tenantId=${tenantData.tenant.tenantId}`;
  await page.goto(
    `${baseUrl}/msp/billing?tab=client-contracts&contractId=${seeded.contractId}&clientContractId=${seeded.clientContractId}${tenantQuery}`,
    { waitUntil: "domcontentloaded", timeout: 60_000 },
  );
  await page.getByRole("tab", { name: /Simulate/ }).click();
  await expect(
    page.getByRole("heading", { name: "Assumed activity" }),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("Contract simulator journeys", () => {
  test.setTimeout(300_000);

  test("edits, simulates, expands, explains, compares, prefills, and replays", async ({
    page,
  }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    try {
      tenantData = await createTenantAndLogin(db, page, {
        companyName: `Simulator EE ${uuidv4().slice(0, 6)}`,
        baseUrl,
      });
      await grantBillingRead(db, tenantData);
      const seeded = await seedSimulatorContract(db, tenantData);
      await openSimulator(page, tenantData, seeded);

      await expect(page.getByText("Pricing schedules")).not.toBeVisible();
      const projectedHours = page.getByLabel(
        /Assumed hrs per service period — Engineering/,
      );
      await expect(projectedHours).toBeVisible();
      await projectedHours.fill("2");
      await page.locator("#simulate-scenario-button").click();
      await expect(page.locator('[id^="period-card-"]').first()).toBeVisible({
        timeout: 30_000,
      });
      // The first period can legitimately be a zero-dollar arrears stub when the
      // simulation begins mid-cycle. Use the first fully billable period.
      await page.locator('[id^="period-card-"]').nth(1).click();
      await expect(page.getByText(/simulated invoice/)).toBeVisible();
      await expect(page.getByText("2 hrs", { exact: true })).toBeVisible();
      await expect(
        page.getByText(/Service period: .* – .*/).first(),
      ).toBeVisible();
      const hourlyRow = page.locator("tr").filter({ hasText: "2 hrs" });
      await expect(hourlyRow).toContainText("$100.00");
      await hourlyRow.locator('[id^="explain-invoice-line-"]').click();
      await expect(
        page.getByRole("dialog", { name: "Charge breakdown" }),
      ).toBeVisible();
      await expect(page.getByText("2 hrs × $50.00 = $100.00")).toBeVisible();
      await page.locator("#close-explanation-panel-button").click();
      await expect(
        page.getByRole("row").filter({ hasText: "Total" }).getByText("$200.00"),
      ).toBeVisible();

      await page
        .getByRole("switch", {
          name: "Show changes from current contract",
        })
        .click();
      await page.locator("#simulate-scenario-button").click();
      await expect(
        page.getByText(/Total change over .* billing periods/),
      ).toBeVisible({
        timeout: 30_000,
      });

      await page.locator("#use-recent-averages-button").click();
      await expect(
        page.getByText(/Activity average loaded from/),
      ).toBeVisible();
      await expect(page.getByText(/Loaded value:/).first()).toBeVisible();
      await projectedHours.fill("3");
      await expect(page.getByText(/Loaded value:/)).not.toBeVisible();
      await page.getByText("Compare with past invoices").click();
      await page.getByLabel("From").fill("2026-01-01");
      await page.getByLabel("From").press("Enter");
      await page.getByLabel("Through").fill("2026-01-31");
      await page.getByLabel("Through").press("Enter");
      await page.locator("#load-historical-replay-button").click();
      await expect(
        page.getByText(/Historical activity loaded from/),
      ).toBeVisible();
      await expect(
        page.getByText(/Update the simulation to recalculate invoices/),
      ).toBeVisible();
      await expect(page.locator("#simulate-scenario-button")).toBeEnabled({
        timeout: 30_000,
      });
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test("opens unsaved draft and template simulation entry points", async ({
    page,
  }) => {
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;
    try {
      tenantData = await createTenantAndLogin(db, page, {
        companyName: `Simulator entries ${uuidv4().slice(0, 6)}`,
        baseUrl,
      });
      await grantBillingRead(db, tenantData);
      const seeded = await seedSimulatorContract(db, tenantData, true);
      const tenantQuery = `&tenantId=${tenantData.tenant.tenantId}`;
      await page.goto(
        `${baseUrl}/msp/billing?tab=contract-templates&contractId=${seeded.contractId}${tenantQuery}`,
        { waitUntil: "domcontentloaded", timeout: 60_000 },
      );
      await page.locator("#toggle-template-simulator").click();
      await expect(page.getByText("Template simulation")).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Assumed activity" }),
      ).toBeVisible({ timeout: 30_000 });

      await page.goto(`${baseUrl}/msp/billing?tab=contracts${tenantQuery}`, {
        waitUntil: "domcontentloaded",
      });
      await page.getByRole("button", { name: "Create Contract" }).click();
      await expect(
        page.getByRole("heading", { name: "Contract Basics" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Select a client" }).click();
      await page
        .getByRole("option", { name: tenantData.client!.clientName })
        .click();
      await page
        .getByRole("textbox", { name: "Contract Name *" })
        .fill(`Unsaved simulator draft ${uuidv4().slice(0, 6)}`);
      await page.getByRole("button", { name: "Select date" }).first().click();
      await page.getByRole("gridcell", { name: /\d/ }).first().click();
      const frequency = page.getByRole("combobox", {
        name: /Select billing frequency/i,
      });
      if (await frequency.isVisible().catch(() => false)) {
        await frequency.click();
        await page.getByRole("option", { name: /Monthly/i }).click();
      }
      for (let step = 0; step < 5; step += 1) {
        await page.getByRole("button", { name: "Next", exact: true }).click();
      }
      await expect(page.getByText("Simulate before creating")).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByRole("heading", { name: "Assumed activity" }),
      ).toBeVisible();
      await page.locator("#simulate-scenario-button").click();
      await expect(page.locator('[id^="period-card-"]').first()).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

async function grantBillingRead(
  db: Knex,
  tenantData: TenantTestData,
): Promise<void> {
  const tenantId = tenantData.tenant.tenantId;
  const role = await db("user_roles")
    .where({ tenant: tenantId, user_id: tenantData.adminUser.userId })
    .first("role_id");
  const permissionId = uuidv4();
  await db("permissions").insert({
    tenant: tenantId,
    permission_id: permissionId,
    resource: "billing",
    action: "read",
    msp: true,
    client: false,
  });
  await db("role_permissions").insert({
    tenant: tenantId,
    role_id: role.role_id,
    permission_id: permissionId,
  });
}

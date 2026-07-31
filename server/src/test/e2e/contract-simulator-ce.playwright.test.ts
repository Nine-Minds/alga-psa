import { expect, test } from "@playwright/test";
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

test("CE contract and wizard simulator entries render the upgrade placeholder", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;
  try {
    tenantData = await createTenantAndLogin(db, page, {
      companyName: `Simulator CE ${uuidv4().slice(0, 6)}`,
      baseUrl: getBaseUrl(),
    });
    const tenantId = tenantData.tenant.tenantId;
    const clientId = tenantData.client!.clientId;
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

    const context = { db, tenantId, clientId } as never;
    const serviceId = await createTestService(context, {
      service_name: `CE support ${uuidv4().slice(0, 6)}`,
      billing_method: "fixed",
      default_rate: 10_000,
    });
    const contractId = uuidv4();
    const clientContractId = uuidv4();
    await createFixedPlanAssignment(context, serviceId, {
      contractId,
      clientContractId,
      clientId,
      planName: "CE simulator contract",
      baseRateCents: 10_000,
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      billingFrequency: "monthly",
      billingTiming: "arrears",
    });

    await page.goto(
      `${getBaseUrl()}/msp/billing?tab=client-contracts&contractId=${contractId}&clientContractId=${clientContractId}&tenantId=${tenantId}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    const simulatorTab = page.getByRole("tab", { name: /Simulate/ });
    await expect(simulatorTab).toBeVisible({ timeout: 60_000 });
    await simulatorTab.click();
    await expect(
      page.getByRole("heading", { name: "Contract Simulator requires Pro" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("link", { name: "View Plans" })).toBeVisible();

    await page.goto(
      `${getBaseUrl()}/msp/billing?tab=contracts&tenantId=${tenantId}`,
      { waitUntil: "domcontentloaded" },
    );
    const createContractButton = page.getByRole("button", { name: "Create Contract" });
    await expect(createContractButton).toBeVisible({ timeout: 60_000 });
    await createContractButton.click();
    await expect(page.getByRole("heading", { name: "Contract Basics" })).toBeVisible();
    await page.getByRole("button", { name: "Select a client" }).click();
    await page
      .getByRole("option", { name: tenantData.client!.clientName })
      .click();
    await page
      .getByRole("textbox", { name: "Contract Name *" })
      .fill(`CE unsaved simulator draft ${uuidv4().slice(0, 6)}`);
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
      page.getByRole("heading", { name: "Contract Simulator requires Pro" }),
    ).toBeVisible();
  } finally {
    await db.destroy().catch(() => undefined);
  }
});

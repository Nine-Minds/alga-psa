import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
  setupAuthenticatedSession,
} from './helpers/playwrightAuthSessionHelper';
import {
  grantAllPermissionsToRole,
  seedPermissionsForTenant,
} from './helpers/permissionTestHelper';

applyPlaywrightAuthEnvDefaults();

const BASE_URL = resolvePlaywrightBaseUrl();

type ProjectFixture = {
  tenantData: TenantTestData;
  tenantId: string;
  clientId: string;
  projectId: string;
  phaseId: string;
  projectName: string;
  phaseName: string;
};

let db: Knex;

test.beforeAll(() => {
  db = createTestDbConnection();
});

test.afterAll(async () => {
  await db?.destroy().catch(() => undefined);
});

async function createProjectFixture(page: Page, grantAll = true): Promise<ProjectFixture> {
  const suffix = uuidv4().slice(0, 8);
  const tenantData = await createTenantAndLogin(db, page, {
    tenantOptions: { companyName: `Project Billing Client ${suffix}` },
    completeOnboarding: { completedAt: new Date() },
    permissions: grantAll
      ? undefined
      : [{
          roleName: 'Admin',
          permissions: [
            { resource: 'project', action: 'read' },
            { resource: 'project', action: 'update' },
            { resource: 'client', action: 'read' },
          ],
        }],
  });
  if (!tenantData.client?.clientId) throw new Error('Project billing fixture requires a client');

  const tenantId = tenantData.tenant.tenantId;
  const clientId = tenantData.client.clientId;
  if (grantAll) {
    await seedPermissionsForTenant(db, tenantId);
    await grantAllPermissionsToRole(db, tenantId, 'Admin');
  }

  await db('clients').where({ tenant: tenantId, client_id: clientId }).update({ default_currency_code: 'USD' });

  const projectId = uuidv4();
  const phaseId = uuidv4();
  const projectName = `Project Billing ${suffix}`;
  const phaseName = `Discovery ${suffix}`;
  await db('projects').insert({
    tenant: tenantId,
    project_id: projectId,
    client_id: clientId,
    project_name: projectName,
    wbs_code: `PB-${suffix}`,
    is_inactive: false,
    client_portal_config: {},
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('project_phases').insert({
    tenant: tenantId,
    phase_id: phaseId,
    project_id: projectId,
    phase_name: phaseName,
    wbs_code: 'DISC',
    order_number: 1,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { tenantData, tenantId, clientId, projectId, phaseId, projectName, phaseName };
}

async function insertConfig(
  fixture: ProjectFixture,
  values: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const configId = uuidv4();
  await db('project_billing_configs').insert({
    tenant: fixture.tenantId,
    config_id: configId,
    project_id: fixture.projectId,
    billing_model: 'fixed_price',
    total_price: 1_000_000,
    currency: 'USD',
    invoice_mode: 'standalone',
    cap_notify_thresholds: JSON.stringify([75, 90, 100]),
    deposit_treatment: 'credit',
    is_taxable: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...values,
  });
  return configId;
}

async function insertEntry(
  fixture: ProjectFixture,
  configId: string,
  values: Partial<Record<string, unknown>> = {},
): Promise<string> {
  const entryId = uuidv4();
  await db('project_billing_schedule_entries').insert({
    tenant: fixture.tenantId,
    schedule_entry_id: entryId,
    config_id: configId,
    entry_type: 'milestone',
    description: `Milestone ${entryId.slice(0, 6)}`,
    amount: 1_000_000,
    percentage: null,
    trigger_type: 'manual',
    phase_id: null,
    trigger_date: null,
    status: 'pending',
    display_order: 0,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...values,
  });
  return entryId;
}

async function openProjectBilling(page: Page, projectId: string): Promise<void> {
  await page.goto(`${BASE_URL}/msp/projects/${projectId}?view=billing`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await expect(page.locator('[data-automation-id="billing-view-btn"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible({ timeout: 60_000 });
}

async function choose(page: Page, automationId: string, optionName: string): Promise<void> {
  await page.locator(`[data-automation-id="${automationId}"]`).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

async function addScheduleEntry(
  page: Page,
  input: {
    description: string;
    valueMode: 'Fixed amount' | 'Percentage of total';
    value: string;
    trigger: 'Phase completion' | 'On a date' | 'Manual';
    phaseName?: string;
  },
): Promise<void> {
  await page.locator('[data-automation-id="billing-add-entry"]').click();
  await page.locator('[data-automation-id="billing-entry-description"]').fill(input.description);
  await choose(page, 'billing-entry-value-mode', input.valueMode);
  await page.locator(
    input.valueMode === 'Fixed amount'
      ? '[data-automation-id="billing-entry-amount"]'
      : '[data-automation-id="billing-entry-percentage"]',
  ).fill(input.value);
  await choose(page, 'billing-entry-trigger', input.trigger);
  if (input.trigger === 'Phase completion') {
    await choose(page, 'billing-entry-phase', input.phaseName!);
  } else if (input.trigger === 'On a date') {
    await page.locator('[data-automation-id="billing-entry-date"]').click();
    await page.getByRole('button', { name: 'Select today' }).click();
  }
  await page.locator('[data-automation-id="billing-entry-save"]').click();
  await expect(page.locator('#project-billing-entry-dialog')).toBeHidden({ timeout: 30_000 });
}

test('T028: enable-billing wizard creates fixed-price config and schedule workspace', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createProjectFixture(page);
  await openProjectBilling(page, fixture.projectId);

  await expect(page.locator('[data-automation-id="project-billing-setup"]')).toBeVisible();
  await page.locator('[data-automation-id="billing-setup-open"]').click();
  await page.locator('[data-automation-id="billing-setup-total"]').fill('10000');
  await page.locator('[data-automation-id="billing-setup-create"]').click();

  await expect(page.getByText('$10,000.00 fixed price', { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No milestones or deposits yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('Under-allocated by $10,000.00 (0%)', { exact: true })).toBeVisible();
});

test('T029: schedule dialog supports percentage, amount, phase, date, and manual entries', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createProjectFixture(page);
  await insertConfig(fixture);
  await openProjectBilling(page, fixture.projectId);

  await addScheduleEntry(page, {
    description: 'Discovery milestone',
    valueMode: 'Percentage of total',
    value: '40',
    trigger: 'Phase completion',
    phaseName: fixture.phaseName,
  });
  await addScheduleEntry(page, {
    description: 'Delivery milestone',
    valueMode: 'Fixed amount',
    value: '3000',
    trigger: 'On a date',
  });
  await addScheduleEntry(page, {
    description: 'Acceptance milestone',
    valueMode: 'Fixed amount',
    value: '3000',
    trigger: 'Manual',
  });

  await expect(page.getByText('✓ Schedule allocates 100% of contract value', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Billing milestone')).toBeVisible();
});

test('T030: completing a phase makes its milestone ready and updates ambient billing', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createProjectFixture(page);
  const configId = await insertConfig(fixture);
  const entryId = await insertEntry(fixture, configId, {
    description: 'Phase completion milestone',
    trigger_type: 'phase',
    phase_id: fixture.phaseId,
  });
  await openProjectBilling(page, fixture.projectId);

  const phaseItem = page.locator('li', { hasText: fixture.phaseName });
  await phaseItem.hover();
  await page.locator(`#complete-phase-${fixture.phaseId}`).click();

  await expect(page.getByText('Phase marked complete', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(`#billing-schedule-row-${entryId}`)).toContainText('Ready');
  await expect(page.getByText('1 ready to bill', { exact: true })).toBeVisible();
  await expect(page.getByText('Billed:', { exact: true })).toBeVisible();
  await expect(page.locator('[data-automation-id="project-billing-budget-card"]')).toContainText('Ready to bill');
});

test('T031: standalone Approve & invoice marks the entry invoiced and links the invoice', async ({ page }) => {
  test.setTimeout(240_000);
  const fixture = await createProjectFixture(page);
  const configId = await insertConfig(fixture);
  const entryId = await insertEntry(fixture, configId, {
    description: 'Ready standalone milestone',
    status: 'ready',
    ready_at: db.fn.now(),
  });
  await openProjectBilling(page, fixture.projectId);

  await page.locator(`[data-automation-id="billing-approve-invoice-${entryId}"]`).click();
  const row = page.locator(`#billing-schedule-row-${entryId}`);
  await expect(row).toContainText('Invoiced', { timeout: 60_000 });
  await expect(page.locator(`#billing-invoice-link-${entryId}`)).toBeVisible();
});

test('T032: Invoicing Hub bulk-approves ready entries and hides invoice-now for recurring mode', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createProjectFixture(page);
  const configId = await insertConfig(fixture, { invoice_mode: 'recurring' });
  const firstId = await insertEntry(fixture, configId, {
    description: 'Recurring milestone one',
    amount: 500_000,
    status: 'ready',
    ready_at: db.fn.now(),
  });
  const secondId = await insertEntry(fixture, configId, {
    description: 'Recurring milestone two',
    amount: 500_000,
    status: 'ready',
    ready_at: db.fn.now(),
    display_order: 1,
  });

  await page.goto(`${BASE_URL}/msp/billing?tab=invoicing&subtab=project-billing`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await expect(page.locator('[data-automation-id="project-billing-review-table"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('tab', { name: /Project Billing\s+2/ })).toBeVisible();

  await page.locator(`[data-automation-id="project-billing-row-actions-${firstId}"]`).click();
  await expect(page.locator(`[data-automation-id="project-billing-approve-invoice-${firstId}"]`)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.locator('[data-automation-id="select-all-project-billing"]').click();
  await page.locator('[data-automation-id="project-billing-bulk-actions-trigger"]').click();
  await page.locator('[data-automation-id="project-billing-bulk-approve"]').click();

  await expect(page.locator(`[data-automation-id="project-billing-select-${firstId}"]`)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator(`[data-automation-id="project-billing-select-${secondId}"]`)).toHaveCount(0);
});

test('T033: T&M cap, thresholds, and hard-cap behavior persist and render budget markers', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createProjectFixture(page);
  await openProjectBilling(page, fixture.projectId);

  await page.locator('[data-automation-id="billing-setup-open"]').click();
  await choose(page, 'billing-setup-model', 'Time & materials');
  await page.locator('[data-automation-id="billing-setup-cap"]').fill('25000');
  await page.locator('[data-automation-id="billing-setup-thresholds"]').fill('50, 75, 100');
  await choose(page, 'billing-setup-cap-behavior', 'Hard cap (write down)');
  await page.locator('[data-automation-id="billing-setup-create"]').click();

  await expect(page.locator('[data-automation-id="project-billing-cap-panel"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-automation-id="project-billing-budget-card"]')).toContainText('$25,000.00 hard cap');
  await expect(page.locator('[title="50% notify threshold"]')).toBeVisible();
  await expect(page.locator('[title="75% notify threshold"]')).toBeVisible();
  await expect(page.locator('[title="100% notify threshold"]')).toBeVisible();

  await page.locator('[data-automation-id="billing-cap-thresholds"]').fill('60, 80, 100');
  await page.locator('[data-automation-id="billing-cap-save"]').click();
  await expect(page.getByText('Budget cap updated', { exact: true })).toBeVisible();
  await expect(page.locator('[title="60% notify threshold"]')).toBeVisible({ timeout: 30_000 });
});

test('T034: users without billing read permission cannot see the billing view', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createProjectFixture(page, false);
  await page.goto(`${BASE_URL}/msp/projects/${fixture.projectId}?view=billing`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  await expect(page.locator('[data-automation-id="kanban-view-btn"]')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-automation-id="billing-view-btn"]')).toHaveCount(0);
  await expect(page.locator('[data-automation-id="project-billing-setup"]')).toHaveCount(0);
});

test('T035: client portal billing summary is hidden by default and shown only when enabled', async ({ page }) => {
  test.setTimeout(180_000);
  const fixture = await createProjectFixture(page);
  const configId = await insertConfig(fixture);
  await insertEntry(fixture, configId, { description: 'Portal-visible milestone' });

  const contactId = uuidv4();
  await db('contacts').insert({
    tenant: fixture.tenantId,
    contact_name_id: contactId,
    client_id: fixture.clientId,
    full_name: 'Project Billing Portal Contact',
    email: `project-billing-${uuidv4().slice(0, 8)}@example.com`,
    is_inactive: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('users')
    .where({ tenant: fixture.tenantId, user_id: fixture.tenantData.adminUser.userId })
    .update({ user_type: 'client', contact_id: contactId });
  await setupAuthenticatedSession(page, fixture.tenantData, {
    baseUrl: BASE_URL,
    sessionClaims: { user_type: 'client', contact_id: contactId },
  });

  const portalUrl = `${BASE_URL}/client-portal/projects/${fixture.projectId}`;
  await page.goto(portalUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page.getByText(fixture.projectName, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#client-portal-project-billing')).toHaveCount(0);

  await db('projects')
    .where({ tenant: fixture.tenantId, project_id: fixture.projectId })
    .update({ client_portal_config: { show_billing: true } });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const summary = page.locator('#client-portal-project-billing');
  await expect(summary).toBeVisible({ timeout: 60_000 });
  await expect(summary).toContainText('Payment Schedule');
  await expect(summary).toContainText('Portal-visible milestone');
});

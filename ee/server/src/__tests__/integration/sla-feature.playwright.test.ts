/**
 * Playwright E2E tests for SLA (Service Level Agreement) Feature
 *
 * Tests cover:
 * 1. SLA Settings Page (/msp/settings/sla)
 *    - Navigate to SLA settings
 *    - View Dashboard tab (default)
 *    - Switch between tabs (Policies, Business Hours, Pause Rules, Escalation)
 *    - Create a new SLA policy
 *    - Edit an existing policy
 *
 * 2. SLA in Ticket List (/msp/tickets)
 *    - Verify SLA column is visible
 *    - Check SLA indicator displays for tickets with SLA policies
 *
 * 3. SLA on Ticket Detail
 *    - Open a ticket with an SLA policy
 *    - Verify SLA Status section is displayed
 *    - Check SLA badge shows correct status
 */

import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../lib/testing/db-test-utils';
import type { TenantTestData } from '../../lib/testing/tenant-test-factory';
import {
  applyPlaywrightAuthEnvDefaults,
  createTenantAndLogin,
  resolvePlaywrightBaseUrl,
} from './helpers/playwrightAuthSessionHelper';

applyPlaywrightAuthEnvDefaults();

const TEST_CONFIG = {
  baseUrl: resolvePlaywrightBaseUrl(),
};

/**
 * Wait for SLA settings page to load
 */
async function waitForSlaSettingsPage(page: Page): Promise<void> {
  await page.waitForSelector('h1:has-text("SLA Settings")', { timeout: 30_000 });
}

/**
 * Wait for tickets table to be ready
 */
async function waitForTicketsTableIdle(page: Page): Promise<void> {
  const table = page.locator('[data-automation-id="ticketing-dashboard-tickets-table"]:visible');
  await expect(table).toBeVisible({ timeout: 60_000 });

  const loading = page.getByRole('status', { name: 'Loading' });
  await expect(loading).toHaveCount(0, { timeout: 60_000 }).catch(async () => {
    await expect(loading).toBeHidden({ timeout: 60_000 });
  });
}

/**
 * Ensure required reference data exists for tickets
 */
async function ensureTicketRefs(db: Knex, tenantId: string, createdByUserId: string) {
  const existingBoard = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
  if (!existingBoard?.board_id) {
    await db('boards').insert({
      tenant: tenantId,
      board_id: uuidv4(),
      board_name: 'Test Board',
      display_order: 0,
      is_default: true,
      is_inactive: false,
      category_type: 'custom',
      priority_type: 'custom',
    });
  }

  const existingOpenStatus = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket', is_closed: false })
    .first<{ status_id: string }>('status_id');
  if (!existingOpenStatus?.status_id) {
    await db('statuses').insert({
      tenant: tenantId,
      status_id: uuidv4(),
      name: 'Open',
      status_type: 'ticket',
      order_number: 1,
      created_by: createdByUserId,
      created_at: db.fn.now(),
      is_closed: false,
      is_default: true,
    });
  }

  const existingPriority = await db('priorities').where({ tenant: tenantId }).first<{ priority_id: string }>('priority_id');
  if (!existingPriority?.priority_id) {
    await db('priorities').insert({
      tenant: tenantId,
      priority_id: uuidv4(),
      priority_name: 'Normal',
      created_by: createdByUserId,
      created_at: db.fn.now(),
      order_number: 50,
      item_type: 'ticket',
      color: '#6B7280',
    });
  }

  const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
  const statusOpen = await db('statuses')
    .where({ tenant: tenantId, is_closed: false })
    .andWhere(function () {
      this.where('item_type', 'ticket').orWhere('status_type', 'ticket');
    })
    .orderBy('is_default', 'desc')
    .orderBy('order_number', 'asc')
    .first<{ status_id: string }>('status_id');
  const priority = await db('priorities')
    .where({ tenant: tenantId })
    .orderBy('order_number', 'asc')
    .first<{ priority_id: string }>('priority_id');

  if (!board?.board_id || !statusOpen?.status_id || !priority?.priority_id) {
    throw new Error('Failed to ensure board/status/priority reference data');
  }

  return {
    boardId: board.board_id,
    statusId: statusOpen.status_id,
    priorityId: priority.priority_id,
  };
}

/**
 * Ensure default client location exists
 */
async function ensureDefaultClientLocation(db: Knex, tenantId: string, clientId: string, email: string) {
  const existing = await db('client_locations')
    .where({ tenant: tenantId, client_id: clientId, is_default: true, is_active: true })
    .first('location_id');
  if (existing) return;

  await db('client_locations').insert({
    tenant: tenantId,
    location_id: uuidv4(),
    client_id: clientId,
    location_name: 'Default',
    address_line1: '123 Test St',
    city: 'Test City',
    country_code: 'US',
    country_name: 'United States',
    is_default: true,
    is_active: true,
    email,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

/**
 * Create a contact for a client
 */
async function createContact(db: Knex, tenantId: string, clientId: string, email: string, fullName: string) {
  const id = uuidv4();
  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: id,
    full_name: fullName,
    client_id: clientId,
    email,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return id;
}

/**
 * Create an SLA policy
 */
async function createSlaPolicy(
  db: Knex,
  tenantId: string,
  options: {
    policyName: string;
    description?: string;
    isDefault?: boolean;
  }
) {
  const policyId = uuidv4();
  await db('sla_policies').insert({
    tenant: tenantId,
    sla_policy_id: policyId,
    policy_name: options.policyName,
    description: options.description,
    is_default: options.isDefault ?? false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return policyId;
}

/**
 * Create SLA policy targets for a priority
 */
async function createSlaPolicyTarget(
  db: Knex,
  tenantId: string,
  policyId: string,
  priorityId: string,
  options: {
    responseTimeMinutes?: number;
    resolutionTimeMinutes?: number;
  }
) {
  const targetId = uuidv4();
  await db('sla_policy_targets').insert({
    tenant: tenantId,
    target_id: targetId,
    sla_policy_id: policyId,
    priority_id: priorityId,
    response_time_minutes: options.responseTimeMinutes,
    resolution_time_minutes: options.resolutionTimeMinutes,
    escalation_1_percent: 70,
    escalation_2_percent: 90,
    escalation_3_percent: 110,
    is_24x7: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  return targetId;
}

/**
 * Insert a test ticket with SLA policy
 */
async function insertTicketWithSla(db: Knex, params: {
  tenant: string;
  ticketId: string;
  ticketNumber: string;
  title: string;
  clientId: string;
  contactId: string;
  statusId: string;
  priorityId: string;
  boardId: string;
  slaPolicyId?: string;
  slaResponseDueAt?: Date;
  slaResolutionDueAt?: Date;
}) {
  const now = new Date();
  await db('tickets').insert({
    tenant: params.tenant,
    ticket_id: params.ticketId,
    ticket_number: params.ticketNumber,
    title: params.title,
    client_id: params.clientId,
    contact_name_id: params.contactId,
    status_id: params.statusId,
    priority_id: params.priorityId,
    board_id: params.boardId,
    sla_policy_id: params.slaPolicyId,
    sla_response_due_at: params.slaResponseDueAt,
    sla_resolution_due_at: params.slaResolutionDueAt,
    sla_started_at: params.slaPolicyId ? now : null,
    entered_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
}

test.describe('SLA Settings Page Tests', () => {
  test('Navigate to SLA settings and view Dashboard tab', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA Settings Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'settings', action: 'read' },
              { resource: 'settings', action: 'update' },
            ],
          },
        ],
      });

      // Navigate to SLA settings
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/settings/sla`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForSlaSettingsPage(page);

      // Verify Dashboard tab is visible and active by default
      const dashboardTab = page.locator('[id="sla-settings-tab-Dashboard"]');
      await expect(dashboardTab).toBeVisible({ timeout: 10_000 });

      // Verify dashboard content is showing
      await expect(page.getByText('SLA Settings')).toBeVisible();
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('Switch between SLA settings tabs', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA Tabs Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'settings', action: 'read' },
              { resource: 'settings', action: 'update' },
            ],
          },
        ],
      });

      await page.goto(`${TEST_CONFIG.baseUrl}/msp/settings/sla`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForSlaSettingsPage(page);

      // Click on Policies tab
      const policiesTab = page.locator('[id="sla-settings-tab-Policies"]');
      await policiesTab.click();
      await expect(page.getByText('SLA Policies')).toBeVisible({ timeout: 10_000 });

      // Click on Business Hours tab
      const businessHoursTab = page.locator('[id="sla-settings-tab-Business Hours"]');
      await businessHoursTab.click();
      // Business Hours tab should be active
      await page.waitForTimeout(1000);

      // Click on Pause Rules tab
      const pauseRulesTab = page.locator('[id="sla-settings-tab-Pause Rules"]');
      await pauseRulesTab.click();
      await page.waitForTimeout(1000);

      // Click on Escalation tab
      const escalationTab = page.locator('[id="sla-settings-tab-Escalation"]');
      await escalationTab.click();
      await page.waitForTimeout(1000);

      // Go back to Dashboard
      const dashboardTab = page.locator('[id="sla-settings-tab-Dashboard"]');
      await dashboardTab.click();
      await page.waitForTimeout(1000);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('Create a new SLA policy', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA Create Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'settings', action: 'read' },
              { resource: 'settings', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;

      // Ensure priority exists for the policy targets
      await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

      await page.goto(`${TEST_CONFIG.baseUrl}/msp/settings/sla?tab=policies`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForSlaSettingsPage(page);

      // Click Add Policy button
      const addPolicyButton = page.locator('#add-sla-policy-button');
      await addPolicyButton.waitFor({ state: 'visible', timeout: 30_000 });
      await addPolicyButton.click();

      // Fill in policy name
      const policyNameInput = page.locator('#sla-policy-name');
      await policyNameInput.waitFor({ state: 'visible', timeout: 10_000 });
      await policyNameInput.fill('Test SLA Policy');

      // Fill in description
      const descriptionInput = page.locator('#sla-policy-description');
      await descriptionInput.fill('A test SLA policy created via E2E test');

      // Set as default
      const isDefaultCheckbox = page.locator('#sla-policy-is-default');
      await isDefaultCheckbox.check();

      // Select a response time for a priority (find first priority section)
      const firstResponseTimeSelect = page.locator('[id^="sla-target-response-"]').first();
      if (await firstResponseTimeSelect.isVisible()) {
        await firstResponseTimeSelect.click();
        const oneHourOption = page.getByRole('option', { name: '1 hour' });
        if (await oneHourOption.isVisible()) {
          await oneHourOption.click();
        }
      }

      // Save the policy
      const saveButton = page.locator('#sla-policy-save');
      await saveButton.click();

      // Wait for success and return to list
      await page.waitForTimeout(2000);

      // Verify policy was created in database
      const policy = await db('sla_policies')
        .where({ tenant: tenantId, policy_name: 'Test SLA Policy' })
        .first();
      expect(policy).toBeTruthy();
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('Edit an existing SLA policy', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA Edit Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'settings', action: 'read' },
              { resource: 'settings', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;

      // Ensure refs exist
      const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

      // Create an existing policy to edit
      const policyId = await createSlaPolicy(db, tenantId, {
        policyName: 'Existing Policy',
        description: 'Original description',
        isDefault: false,
      });

      await page.goto(`${TEST_CONFIG.baseUrl}/msp/settings/sla?tab=policies`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForSlaSettingsPage(page);

      // Wait for policies table to load
      await page.waitForTimeout(2000);

      // Click on the policy row to edit
      const policyRow = page.locator('tr:has-text("Existing Policy")');
      await policyRow.waitFor({ state: 'visible', timeout: 10_000 });
      await policyRow.click();

      // Wait for form to load
      const policyNameInput = page.locator('#sla-policy-name');
      await policyNameInput.waitFor({ state: 'visible', timeout: 10_000 });

      // Update the policy name
      await policyNameInput.fill('Updated Policy Name');

      // Save the changes
      const saveButton = page.locator('#sla-policy-save');
      await saveButton.click();

      // Wait for save and return to list
      await page.waitForTimeout(2000);

      // Verify policy was updated in database
      const updatedPolicy = await db('sla_policies')
        .where({ tenant: tenantId, sla_policy_id: policyId })
        .first();
      expect(updatedPolicy?.policy_name).toBe('Updated Policy Name');
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

test.describe('SLA in Ticket List Tests', () => {
  test('Verify SLA column is visible in ticket list', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA List Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'ticket', action: 'read' },
              { resource: 'ticket', action: 'update' },
            ],
          },
        ],
      });

      await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForTicketsTableIdle(page);

      // Verify SLA column header is visible
      const slaColumnHeader = page.locator('th:has-text("SLA")');
      await expect(slaColumnHeader).toBeVisible({ timeout: 10_000 });
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('SLA indicator displays for tickets with SLA policies', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA Indicator Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'ticket', action: 'read' },
              { resource: 'ticket', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;
      const primaryClientId = tenantData.client!.clientId;

      await ensureDefaultClientLocation(db, tenantId, primaryClientId, `test-${uuidv4().slice(0, 6)}@example.com`);
      const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

      // Create an SLA policy
      const policyId = await createSlaPolicy(db, tenantId, {
        policyName: 'Standard SLA',
        isDefault: true,
      });

      // Create SLA policy target
      await createSlaPolicyTarget(db, tenantId, policyId, refs.priorityId, {
        responseTimeMinutes: 60,
        resolutionTimeMinutes: 480,
      });

      // Create a contact
      const contactId = await createContact(db, tenantId, primaryClientId, `contact-${uuidv4().slice(0, 6)}@example.com`, 'Test Contact');

      // Create a ticket with SLA
      const ticketId = uuidv4();
      const ticketNumber = `SLA-${uuidv4().slice(0, 6)}`;
      const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now

      await insertTicketWithSla(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title: 'Ticket with SLA',
        clientId: primaryClientId,
        contactId,
        statusId: refs.statusId,
        priorityId: refs.priorityId,
        boardId: refs.boardId,
        slaPolicyId: policyId,
        slaResponseDueAt: futureDate,
        slaResolutionDueAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours from now
      });

      await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForTicketsTableIdle(page);

      // Find the ticket row
      const ticketRow = page.locator(`tr:has-text("${ticketNumber}")`);
      await expect(ticketRow).toBeVisible({ timeout: 10_000 });

      // The SLA indicator should show some status (on_track icon or remaining time)
      // SlaIndicator uses lucide icons (CheckCircle for on_track)
      const slaCell = ticketRow.locator('td').nth(4); // SLA is typically the 5th column
      await expect(slaCell).toBeVisible();
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('Tickets without SLA policy show dash in SLA column', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA No Policy Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'ticket', action: 'read' },
              { resource: 'ticket', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;
      const primaryClientId = tenantData.client!.clientId;

      await ensureDefaultClientLocation(db, tenantId, primaryClientId, `test-${uuidv4().slice(0, 6)}@example.com`);
      const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

      // Create a contact
      const contactId = await createContact(db, tenantId, primaryClientId, `contact-${uuidv4().slice(0, 6)}@example.com`, 'No SLA Contact');

      // Create a ticket WITHOUT SLA policy
      const ticketId = uuidv4();
      const ticketNumber = `NOSLA-${uuidv4().slice(0, 6)}`;

      await insertTicketWithSla(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title: 'Ticket without SLA',
        clientId: primaryClientId,
        contactId,
        statusId: refs.statusId,
        priorityId: refs.priorityId,
        boardId: refs.boardId,
        // No SLA policy
      });

      await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForTicketsTableIdle(page);

      // Find the ticket row
      const ticketRow = page.locator(`tr:has-text("${ticketNumber}")`);
      await expect(ticketRow).toBeVisible({ timeout: 10_000 });

      // The SLA cell should contain a dash "-" for tickets without SLA
      const dashIndicator = ticketRow.locator('span.text-gray-400:has-text("-")');
      await expect(dashIndicator).toBeVisible({ timeout: 5_000 });
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

test.describe('SLA on Ticket Detail Tests', () => {
  test('Ticket detail shows SLA Status section for ticket with SLA policy', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA Detail Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'ticket', action: 'read' },
              { resource: 'ticket', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;
      const primaryClientId = tenantData.client!.clientId;

      await ensureDefaultClientLocation(db, tenantId, primaryClientId, `test-${uuidv4().slice(0, 6)}@example.com`);
      const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

      // Create an SLA policy
      const policyId = await createSlaPolicy(db, tenantId, {
        policyName: 'Detail Test SLA',
        isDefault: true,
      });

      // Create SLA policy target
      await createSlaPolicyTarget(db, tenantId, policyId, refs.priorityId, {
        responseTimeMinutes: 120,
        resolutionTimeMinutes: 960,
      });

      // Create a contact
      const contactId = await createContact(db, tenantId, primaryClientId, `contact-${uuidv4().slice(0, 6)}@example.com`, 'Detail Test Contact');

      // Create a ticket with SLA
      const ticketId = uuidv4();
      const ticketNumber = `DETAIL-${uuidv4().slice(0, 6)}`;
      const responseDate = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
      const resolutionDate = new Date(Date.now() + 16 * 60 * 60 * 1000); // 16 hours from now

      await insertTicketWithSla(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title: 'Ticket Detail SLA Test',
        clientId: primaryClientId,
        contactId,
        statusId: refs.statusId,
        priorityId: refs.priorityId,
        boardId: refs.boardId,
        slaPolicyId: policyId,
        slaResponseDueAt: responseDate,
        slaResolutionDueAt: resolutionDate,
      });

      // Navigate to ticket detail page
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });

      // Verify SLA Status section is displayed
      const slaStatusHeading = page.locator('h5:has-text("SLA Status")');
      await expect(slaStatusHeading).toBeVisible({ timeout: 15_000 });

      // Verify SLA badge is showing (it should show the SlaStatusBadge component)
      // The badge contains status text like "On Track" and an icon
      const slaBadge = page.locator('.gap-1\\.5.font-medium'); // SlaStatusBadge uses these classes
      await expect(slaBadge.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('Ticket detail does NOT show SLA Status section for ticket without SLA policy', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA No Detail Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'ticket', action: 'read' },
              { resource: 'ticket', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;
      const primaryClientId = tenantData.client!.clientId;

      await ensureDefaultClientLocation(db, tenantId, primaryClientId, `test-${uuidv4().slice(0, 6)}@example.com`);
      const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

      // Create a contact
      const contactId = await createContact(db, tenantId, primaryClientId, `contact-${uuidv4().slice(0, 6)}@example.com`, 'No SLA Detail Contact');

      // Create a ticket WITHOUT SLA policy
      const ticketId = uuidv4();
      const ticketNumber = `NODETAIL-${uuidv4().slice(0, 6)}`;

      await insertTicketWithSla(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title: 'Ticket Without SLA Detail Test',
        clientId: primaryClientId,
        contactId,
        statusId: refs.statusId,
        priorityId: refs.priorityId,
        boardId: refs.boardId,
        // No SLA policy
      });

      // Navigate to ticket detail page
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });

      // Verify SLA Status section is NOT displayed (since there's no SLA policy)
      const slaStatusHeading = page.locator('h5:has-text("SLA Status")');
      await expect(slaStatusHeading).toHaveCount(0, { timeout: 10_000 });
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });

  test('SLA badge shows correct status based on time remaining', async ({ page }) => {
    test.setTimeout(180_000);
    const db = createTestDbConnection();
    let tenantData: TenantTestData | null = null;

    try {
      tenantData = await createTenantAndLogin(db, page, {
        tenantOptions: {
          companyName: `SLA Badge Status Test ${uuidv4().slice(0, 6)}`,
        },
        completeOnboarding: { completedAt: new Date() },
        permissions: [
          {
            roleName: 'Admin',
            permissions: [
              { resource: 'ticket', action: 'read' },
              { resource: 'ticket', action: 'update' },
            ],
          },
        ],
      });

      const tenantId = tenantData.tenant.tenantId;
      const primaryClientId = tenantData.client!.clientId;

      await ensureDefaultClientLocation(db, tenantId, primaryClientId, `test-${uuidv4().slice(0, 6)}@example.com`);
      const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

      // Create an SLA policy
      const policyId = await createSlaPolicy(db, tenantId, {
        policyName: 'Badge Status Test SLA',
        isDefault: true,
      });

      // Create SLA policy target
      await createSlaPolicyTarget(db, tenantId, policyId, refs.priorityId, {
        responseTimeMinutes: 60,
        resolutionTimeMinutes: 480,
      });

      // Create a contact
      const contactId = await createContact(db, tenantId, primaryClientId, `contact-${uuidv4().slice(0, 6)}@example.com`, 'Badge Status Contact');

      // Create a ticket with SLA that is "On Track" (plenty of time remaining)
      const ticketId = uuidv4();
      const ticketNumber = `BADGE-${uuidv4().slice(0, 6)}`;
      // Set response due in 50 minutes (more than 20% remaining of 60 minute SLA)
      const responseDate = new Date(Date.now() + 50 * 60 * 1000);
      const resolutionDate = new Date(Date.now() + 8 * 60 * 60 * 1000);

      await insertTicketWithSla(db, {
        tenant: tenantId,
        ticketId,
        ticketNumber,
        title: 'Badge Status Test Ticket',
        clientId: primaryClientId,
        contactId,
        statusId: refs.statusId,
        priorityId: refs.priorityId,
        boardId: refs.boardId,
        slaPolicyId: policyId,
        slaResponseDueAt: responseDate,
        slaResolutionDueAt: resolutionDate,
      });

      // Navigate to ticket detail page
      await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForLoadState('networkidle', { timeout: 30_000 });

      // Verify SLA Status badge is visible
      const slaStatusHeading = page.locator('h5:has-text("SLA Status")');
      await expect(slaStatusHeading).toBeVisible({ timeout: 15_000 });

      // The badge should have emerald/green color for "On Track" status
      // SlaStatusBadge uses bg-emerald-100 for on_track status
      const onTrackBadge = page.locator('.bg-emerald-100');
      await expect(onTrackBadge.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

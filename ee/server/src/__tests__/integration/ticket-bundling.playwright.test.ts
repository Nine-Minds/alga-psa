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

async function waitForUIState(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean((window as any).__UI_STATE__), null, { timeout: 30_000 });
}

async function waitForTicketsTableIdle(page: Page): Promise<void> {
  // Ticket list data is server-driven; filter changes temporarily replace the DataTable with a Spinner.
  // Wait for the loading spinner to clear and the DataTable to be visible again.
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0, { timeout: 60_000 });
  await page.locator('[data-automation-id="ticketing-dashboard-tickets-table"]:visible').waitFor({ timeout: 60_000 });
}

async function waitForDialogOverlaysToClear(page: Page): Promise<void> {
  // Alga's Dialog uses Radix overlay with these Tailwind classes. When any dialog is open,
  // the overlay can intercept clicks even after the dialog content begins closing.
  const overlay = page.locator('div.fixed.inset-0.bg-black\\/50.z-50');
  await expect(overlay).toHaveCount(0, { timeout: 20_000 });
}

async function selectTicketById(page: Page, ticketId: string): Promise<void> {
  const checkbox = page.locator(`[data-automation-id="ticketing-dashboard-select-${ticketId}"]:visible`);
  await checkbox.waitFor({ state: 'visible', timeout: 30_000 });
  await checkbox.check({ timeout: 30_000 });
  await expect(checkbox).toBeChecked({ timeout: 30_000 });
}

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

  const existingClosedStatus = await db('statuses')
    .where({ tenant: tenantId, status_type: 'ticket', is_closed: true })
    .first<{ status_id: string }>('status_id');
  if (!existingClosedStatus?.status_id) {
    await db('statuses').insert({
      tenant: tenantId,
      status_id: uuidv4(),
      name: 'Closed',
      status_type: 'ticket',
      order_number: 99,
      created_by: createdByUserId,
      created_at: db.fn.now(),
      is_closed: true,
      is_default: false,
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
    throw new Error('Failed to ensure board/status/priority reference data for Playwright ticket bundling test');
  }

  return {
    boardId: board.board_id,
    statusId: statusOpen.status_id,
    priorityId: priority.priority_id,
  };
}

async function insertTicket(db: Knex, params: {
  tenant: string;
  ticketId: string;
  ticketNumber: string;
  title: string;
  clientId: string;
  contactId: string;
  statusId: string;
  priorityId: string;
  boardId: string;
  updatedAtOffsetMs?: number;
}) {
  const now = new Date(Date.now() + (params.updatedAtOffsetMs ?? 0));
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
    email_metadata: JSON.stringify({
      messageId: `message-${uuidv4()}@mail`,
      threadId: `thread-${uuidv4()}`,
      references: [],
    }),
    entered_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
}

test('Ticket bundling: list toggle, bundling, grouping, and child banners', async ({ page }) => {
  test.setTimeout(300_000);
  page.on('console', (msg) => {
    // Useful for debugging async loading issues in the ticket dashboard container.
    // (Kept minimal: just surface text.)
    // eslint-disable-next-line no-console
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: {
        companyName: `Bundling Co ${uuidv4().slice(0, 6)}`,
      },
      completeOnboarding: { completedAt: new Date() },
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'user', action: 'read' },
            { resource: 'ticket', action: 'read' },
            { resource: 'ticket', action: 'update' },
          ],
        },
      ],
    });

    const tenantId = tenantData.tenant.tenantId;
    const primaryClientId = tenantData.client!.clientId;
    await ensureDefaultClientLocation(db, tenantId, primaryClientId, `primary-${uuidv4().slice(0, 6)}@example.com`);
    const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

    const masterId = uuidv4();
    const childId = uuidv4();
    const masterNumber = `PW-${uuidv4().slice(0, 6)}`;
    const childNumber = `PW-${uuidv4().slice(0, 6)}`;
    const masterContactId = await createContact(db, tenantId, primaryClientId, `m-${uuidv4().slice(0, 6)}@example.com`, 'Master Contact');
    const childContactId = await createContact(db, tenantId, primaryClientId, `c-${uuidv4().slice(0, 6)}@example.com`, 'Child Contact');

    await insertTicket(db, {
      tenant: tenantId,
      ticketId: masterId,
      ticketNumber: masterNumber,
      title: 'Master ticket',
      clientId: primaryClientId,
      contactId: masterContactId,
      statusId: refs.statusId,
      priorityId: refs.priorityId,
      boardId: refs.boardId,
    });
    await insertTicket(db, {
      tenant: tenantId,
      ticketId: childId,
      ticketNumber: childNumber,
      title: 'Child ticket',
      clientId: primaryClientId,
      contactId: childContactId,
      statusId: refs.statusId,
      priorityId: refs.priorityId,
      boardId: refs.boardId,
    });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForTicketsTableIdle(page);
    await waitForUIState(page);

    // Select tickets and open bundle modal.
    await selectTicketById(page, masterId);
    await selectTicketById(page, childId);

    const bundleButton = page.locator('[data-automation-id="ticketing-dashboard-bundle-tickets-button"]');
    await bundleButton.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(bundleButton).toBeEnabled({ timeout: 30_000 });
    await bundleButton.click();
    await page.locator('[data-automation-id="ticketing-dashboard-bundle-dialog-dialog"]').waitFor({ timeout: 10_000 });

    // Pick master and confirm (default sync_updates checked).
    await page.locator('[data-automation-id="ticketing-dashboard-bundle-master-select"]').click();
    await page.getByRole('option', { name: masterNumber }).click();
    await page.locator('[data-automation-id="ticketing-dashboard-bundle-confirm"]').click();

    // In bundled view, child ticket row is hidden.
    await expect(page.getByText(childNumber, { exact: false })).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText(`Bundle · 1`)).toBeVisible({ timeout: 10_000 });

    // Search by child number returns the master in bundled view.
    await page.locator('[data-automation-id="ticketing-dashboard-search-tickets-input"]').fill(childNumber);
    await waitForTicketsTableIdle(page);
    await expect(page.getByText(masterNumber)).toBeVisible({ timeout: 10_000 });

    // Switch to individual view and expand bundle to see child.
    await page.getByRole('switch', { name: 'Bundled view' }).click();
    await page.waitForURL(/bundleView=individual/, { timeout: 30_000 });
    await waitForTicketsTableIdle(page);
    await page.waitForLoadState('networkidle', { timeout: 30_000 }); // settle client-side effects
    await waitForUIState(page);
    await page.locator('[data-automation-id="ticketing-dashboard-search-tickets-input"]').fill('');
    await waitForTicketsTableIdle(page);
    await expect(page.getByText(masterNumber)).toBeVisible({ timeout: 10_000 });

    // Expand.
    await page.getByRole('button', { name: 'Toggle bundle children' }).first().click();
    await expect(page.getByText(childNumber)).toBeVisible({ timeout: 10_000 });

    // Child row shows bundled indicator referencing master.
    await expect(page.getByText(`Bundled → ${masterNumber}`)).toBeVisible({ timeout: 10_000 });

    // Open child and verify child banner.
    await page.getByText(childNumber).first().click();
    await expect(page.locator('#ticket-bundle-child-banner')).toBeVisible({ timeout: 15_000 });
  } finally {
    await db.destroy().catch(() => undefined);
  }
});

test('Ticket bundling: multi-client confirmation, add-child confirmation, promote/remove/unbundle', async ({ page }) => {
  test.setTimeout(300_000);
  page.on('console', (msg) => {
    // eslint-disable-next-line no-console
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  const db = createTestDbConnection();
  let tenantData: TenantTestData | null = null;

  try {
    tenantData = await createTenantAndLogin(db, page, {
      tenantOptions: {
        companyName: `Bundling Multi ${uuidv4().slice(0, 6)}`,
      },
      completeOnboarding: { completedAt: new Date() },
      permissions: [
        {
          roleName: 'Admin',
          permissions: [
            { resource: 'user', action: 'read' },
            { resource: 'ticket', action: 'read' },
            { resource: 'ticket', action: 'update' },
          ],
        },
      ],
    });

    const tenantId = tenantData.tenant.tenantId;
    const refs = await ensureTicketRefs(db, tenantId, tenantData.adminUser.userId);

    const clientA = tenantData.client!.clientId;
    await ensureDefaultClientLocation(db, tenantId, clientA, `a-${uuidv4().slice(0, 6)}@example.com`);
    const clientB = uuidv4();
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientB,
      client_name: `Client B ${uuidv4().slice(0, 6)}`,
      billing_cycle: 'monthly',
      is_tax_exempt: false,
      url: '',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
      is_inactive: false,
      credit_balance: 0,
      properties: {},
    });
    await ensureDefaultClientLocation(db, tenantId, clientB, `b-${uuidv4().slice(0, 6)}@example.com`);

    const masterId = uuidv4();
    const childAId = uuidv4();
    const otherClientTicketId = uuidv4();
    const otherClientTicket2Id = uuidv4();
    const masterNumber = `MC-${uuidv4().slice(0, 6)}`;
    const childANumber = `MC-${uuidv4().slice(0, 6)}`;
    const otherClientNumber = `MC-${uuidv4().slice(0, 6)}`;
    const otherClientNumber2 = `MC-${uuidv4().slice(0, 6)}`;
    const contactA = await createContact(db, tenantId, clientA, `ma-${uuidv4().slice(0, 6)}@example.com`, 'Master Contact');
    const contactChildA = await createContact(db, tenantId, clientA, `ca-${uuidv4().slice(0, 6)}@example.com`, 'Child A Contact');
    const contactB = await createContact(db, tenantId, clientB, `cb-${uuidv4().slice(0, 6)}@example.com`, 'Child B Contact');

    await insertTicket(db, { tenant: tenantId, ticketId: masterId, ticketNumber: masterNumber, title: 'Master', clientId: clientA, contactId: contactA, statusId: refs.statusId, priorityId: refs.priorityId, boardId: refs.boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: childAId, ticketNumber: childANumber, title: 'Child A', clientId: clientA, contactId: contactChildA, statusId: refs.statusId, priorityId: refs.priorityId, boardId: refs.boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: otherClientTicketId, ticketNumber: otherClientNumber, title: 'Other client', clientId: clientB, contactId: contactB, statusId: refs.statusId, priorityId: refs.priorityId, boardId: refs.boardId });
    await insertTicket(db, { tenant: tenantId, ticketId: otherClientTicket2Id, ticketNumber: otherClientNumber2, title: 'Other client 2', clientId: clientB, contactId: contactB, statusId: refs.statusId, priorityId: refs.priorityId, boardId: refs.boardId });

    await page.goto(`${TEST_CONFIG.baseUrl}/msp/tickets`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await waitForTicketsTableIdle(page);
    await waitForUIState(page);

    // Multi-client bundle requires confirmation.
    await selectTicketById(page, masterId);
    await selectTicketById(page, otherClientTicketId);

    const bundleButton = page.locator('[data-automation-id="ticketing-dashboard-bundle-tickets-button"]');
    await bundleButton.waitFor({ state: 'visible', timeout: 30_000 });
    await expect(bundleButton).toBeEnabled({ timeout: 30_000 });
    await bundleButton.click();
    await page.locator('[data-automation-id="ticketing-dashboard-bundle-master-select"]').click();
    await page.getByRole('option', { name: masterNumber }).click();
    await page.locator('[data-automation-id="ticketing-dashboard-bundle-confirm"]').click();
    await page.locator('[data-automation-id="ticketing-dashboard-bundle-multi-client-confirm-dialog"]').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Proceed' }).click();
    await expect(page.locator('[data-automation-id="ticketing-dashboard-bundle-multi-client-confirm-dialog"]')).toBeHidden({ timeout: 15_000 });
    await expect(page.locator('[data-automation-id="ticketing-dashboard-bundle-dialog-dialog"]')).toBeHidden({ timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await waitForDialogOverlaysToClear(page);
    await waitForTicketsTableIdle(page);

    // Open master details and verify multi-client badge.
    await page.getByRole('link', { name: masterNumber }).first().click();
    await expect(page.locator('#ticket-bundle-master-banner')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Multiple clients')).toBeVisible();

    // Add child by number from different client requires confirmation.
    await page.locator('[data-automation-id="ticket-bundle-add-child-input"]').fill(otherClientNumber2);
    await page.locator('[data-automation-id="ticket-bundle-add-child-button"]').click();
    await page.locator('[data-automation-id="ticket-details-bundle-add-child-multi-client-confirm-dialog"]').waitFor({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Proceed' }).click();
    await expect(page.getByText(otherClientNumber2)).toBeVisible({ timeout: 15_000 });

    // Add same-client ticket without confirmation.
    await page.locator('[data-automation-id="ticket-bundle-add-child-input"]').fill(childANumber);
    await page.locator('[data-automation-id="ticket-bundle-add-child-button"]').click();
    await expect(page.getByText(childANumber)).toBeVisible({ timeout: 15_000 });

    // Remove a child.
    await page.locator(`#ticket-bundle-remove-child-${childAId}`).click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await expect(page.getByText(childANumber)).toBeHidden({ timeout: 15_000 });

    // Promote other-client ticket to master.
    await page.locator(`#ticket-bundle-promote-child-${otherClientTicketId}`).click();
    await page.waitForURL(new RegExp(`/msp/tickets/${otherClientTicketId}$`), { timeout: 30_000 });
    await expect(page.locator('#ticket-bundle-master-banner')).toBeVisible({ timeout: 15_000 });

    // Unbundle.
    await page.locator('[data-automation-id="ticket-bundle-unbundle-button"]').click();
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
    await expect(page.locator('#ticket-bundle-master-banner')).toBeHidden({ timeout: 15_000 });
  } finally {
    await db.destroy().catch(() => undefined);
  }
});

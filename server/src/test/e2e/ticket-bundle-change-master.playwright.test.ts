/**
 * T005 (bundle change master, F004 + F005): Make master on a child ticket, and Promote on a master ticket.
 *
 * - On a child's page, Make master asks for confirmation (ticket numbers named), and confirming turns that
 *   ticket into the master (master banner) with the former master listed as a child.
 * - On the master's page, Promote asks for confirmation first, and cancelling changes nothing.
 *
 * Run against a running app with PLAYWRIGHT_SKIP_WEB_SERVER=true and BASE_URL/NEXTAUTH_URL/PORT set to that app.
 * The server halves (promotion semantics, rollback, permission refusal) are covered by
 * server/src/test/integration/ticketBundling.integration.test.ts.
 */
import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';

import {
  applyTestEnvDefaults,
  createTenantAndLogin,
  createTestDbConnection,
  getBaseUrl,
} from './helpers/testSetup';

applyTestEnvDefaults();

const baseUrl = getBaseUrl();

type Db = ReturnType<typeof createTestDbConnection>;

async function seedBundle(db: Db, tenant: string, clientId: string) {
  const scoped = tenantDb(db, tenant);
  const status = await scoped.table('statuses').where({ is_closed: false, status_type: 'ticket' }).first('status_id');
  const priority = await scoped.table('priorities').first('priority_id');
  const board = await scoped.table('boards').first('board_id');
  const make = async (title: string, masterId: string | null) => {
    const ticketId = uuidv4();
    const ticketNumber = `BCM-${uuidv4().slice(0, 6).toUpperCase()}`;
    await scoped.table('tickets').insert({
      ticket_id: ticketId, tenant, ticket_number: ticketNumber, title,
      status_id: status?.status_id, priority_id: priority?.priority_id, board_id: board?.board_id,
      client_id: clientId, master_ticket_id: masterId, entered_at: new Date(), updated_at: new Date(),
    });
    return { ticketId, ticketNumber };
  };
  const master = await make('Bundle master', null);
  const child = await make('Bundle child', master.ticketId);
  await scoped.table('ticket_bundle_settings').insert({
    tenant, master_ticket_id: master.ticketId, mode: 'link_only', reopen_on_child_reply: false,
  });
  return { master, child };
}

test.describe('Bundle: change master from the child and master ticket pages (T005)', () => {
  test('Make master on a child confirms, then shows the master banner with the former master as a child', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    try {
      const tenantData = await createTenantAndLogin(db, page, { companyName: `Bundle master ${uuidv4().slice(0, 6)}` });
      const { master, child } = await seedBundle(db, tenantData.tenant.tenantId, tenantData.client!.clientId);

      await page.goto(`${baseUrl}/msp/tickets/${child.ticketId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#ticket-bundle-child-banner')).toBeVisible({ timeout: 30_000 });
      await page.locator('#ticket-bundle-make-master').click();

      const dialog = page.locator('#ticket-bundle-promote-confirm');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(child.ticketNumber);
      await expect(dialog).toContainText(master.ticketNumber);
      await dialog.locator('#ticket-bundle-promote-confirm-confirm').click();

      await expect(page.locator('#ticket-bundle-master-banner')).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('#ticket-bundle-child-banner')).toHaveCount(0);
      await expect(page.locator('#ticket-bundle-master-panel')).toContainText(master.ticketNumber);
    } finally {
      await db.destroy();
    }
  });

  test('Promote on a master asks for confirmation, and cancelling changes nothing', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    try {
      const tenantData = await createTenantAndLogin(db, page, { companyName: `Bundle promote ${uuidv4().slice(0, 6)}` });
      const tenant = tenantData.tenant.tenantId;
      const { master, child } = await seedBundle(db, tenant, tenantData.client!.clientId);

      await page.goto(`${baseUrl}/msp/tickets/${master.ticketId}`, { waitUntil: 'domcontentloaded' });
      await page.locator(`#ticket-bundle-promote-child-${child.ticketId}`).click({ timeout: 30_000 });

      const dialog = page.locator('#ticket-bundle-promote-confirm');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(master.ticketNumber);
      await expect(dialog).toContainText(child.ticketNumber);
      await dialog.locator('#ticket-bundle-promote-confirm-cancel').click();
      await expect(dialog).toHaveCount(0);

      const scoped = tenantDb(db, tenant);
      const childRow = await scoped.table('tickets').where({ ticket_id: child.ticketId }).first();
      const masterRow = await scoped.table('tickets').where({ ticket_id: master.ticketId }).first();
      expect(childRow?.master_ticket_id).toBe(master.ticketId);
      expect(masterRow?.master_ticket_id).toBeNull();
    } finally {
      await db.destroy();
    }
  });
});

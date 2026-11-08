/**
 * alga-2026-0002683 C4 follow-up 1/3: receiving equipment on a ticket shows the item in the
 * ticket's Assets panel with no navigation (the panel shares the asset SWR cache families).
 *
 * Written against the app server; NOT run in the draft that added it (the app server was not started).
 * The cache-invalidation path itself is covered by the vitest suite
 * packages/assets/src/components/AssociatedAssets.test.tsx.
 */
import { test, expect } from '@playwright/test';
import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { applyTestEnvDefaults, createTenantAndLogin, createTestDbConnection, getBaseUrl } from './helpers/testSetup';

applyTestEnvDefaults();

function table(db: Knex, tenantId: string, name: string) {
  return tenantDb(db, tenantId).table(name);
}

async function seedTicket(db: Knex, tenantId: string): Promise<string> {
  const clientId = uuidv4();
  await table(db, tenantId, 'clients').insert({
    client_id: clientId, tenant: tenantId, client_name: 'Receive Client', created_at: new Date(), updated_at: new Date(),
  });
  const statusId = uuidv4();
  await table(db, tenantId, 'statuses').insert({
    status_id: statusId, tenant: tenantId, name: 'Open', is_closed: false, status_type: 'ticket', order_number: 1,
  });
  const user = await table(db, tenantId, 'users').where({ tenant: tenantId }).first();
  const priorityId = uuidv4();
  await table(db, tenantId, 'priorities').insert({
    priority_id: priorityId, tenant: tenantId, priority_name: 'Normal', color: '#808080', order_number: 1, created_by: user?.user_id ?? tenantId,
  });
  const boardId = uuidv4();
  await table(db, tenantId, 'boards').insert({ board_id: boardId, tenant: tenantId, board_name: 'Receive Board', is_default: true });
  const ticketId = uuidv4();
  await table(db, tenantId, 'tickets').insert({
    ticket_id: ticketId, tenant: tenantId, ticket_number: `RCV-${Date.now().toString().slice(-6)}`, title: 'Receive equipment ticket',
    status_id: statusId, priority_id: priorityId, board_id: boardId, client_id: clientId, entered_at: new Date(), updated_at: new Date(),
  });
  return ticketId;
}

test.describe('Receive equipment on a ticket', () => {
  test('the received item appears in the Assets panel without a reload', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    const db = createTestDbConnection();
    try {
      const tenant = await createTenantAndLogin(db, page);
      const ticketId = await seedTicket(db, tenant.tenant.tenantId);
      await page.goto(`${getBaseUrl()}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' });

      await page.locator('#ticket-layout-toggle-entry').click();

      await page.locator(`#receive-equipment-${ticketId}-button`).click();
      await page.locator(`#receive-equipment-${ticketId}-mode-new`).click();
      await page.locator(`#receive-equipment-${ticketId}-name`).fill('Dell WD19 Dock');
      await page.locator(`#receive-equipment-${ticketId}-submit`).click();
      await expect(page.getByText('is now in MSP custody')).toBeVisible();
      await page.locator(`#receive-equipment-${ticketId}-close`).click();

      // No page.reload() / goto: the panel revalidates through the shared SWR keys.
      const row = page.getByRole('button', { name: 'Dell WD19 Dock' });
      await expect(row).toBeVisible();
      const card = page.locator('#ticket-details-associated-assets').last();
      await expect(card.getByText('Held by MSP')).toBeVisible();
      await expect(card.locator('[id^="associated-asset-custody-"]')).toContainText('In office');
      expect((await row.boundingBox())!.width).toBeGreaterThanOrEqual(120);

      await page.locator('#ticket-layout-toggle-grid').click();
      // The narrow Grid board keeps Assets in Details and the card can be collapsed.
      await page.getByRole('button', { name: 'Details', exact: true }).click();
      if (!await row.isVisible()) {
        const shelf = page.locator('#ticket-details-associated-assets-open');
        if (await shelf.isVisible()) await shelf.click();
        else await page.locator('#ticket-details-associated-assets-toggle').click();
      }
      await expect(row).toBeVisible();
      await expect(card.getByText('Held by MSP')).toBeVisible();
      await expect(card.locator('[id^="associated-asset-custody-"]')).toContainText('In office');
      expect((await row.boundingBox())!.width).toBeGreaterThanOrEqual(120);

      await page.locator('#ticket-layout-toggle-entry').click();
      await expect(row).toBeVisible();
      await expect(card.getByText('Held by MSP')).toBeVisible();
    } finally {
      await db.destroy();
    }
  });
});

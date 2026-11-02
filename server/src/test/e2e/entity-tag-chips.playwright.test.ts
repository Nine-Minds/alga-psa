/**
 * T025: entity tag chips and path filters, end to end.
 *
 * Tag a contact VIP, expect the VIP badge on that requester's ticket row and on
 * the ticket header, filter "Requester tags: any of VIP", and confirm the result
 * set survives saving a named view and reloading. Also covers AC12 on a fresh
 * load: a malformed or unknown-version `where` shows the dropped-filters toast
 * and is removed from the URL.
 *
 * Tags and display rules are seeded straight into the database: the subject is
 * the rendering and the filter, not the tag editor.
 */
import { test, expect } from '@playwright/test';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { v4 as uuidv4 } from 'uuid';
import {
  applyTestEnvDefaults,
  createTestDbConnection,
  createTenantAndLogin,
  getBaseUrl,
} from './helpers/testSetup';

applyTestEnvDefaults();

const BASE_URL = getBaseUrl();

function tenantTable(db: Knex, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

test.describe('Entity tag chips and path filters', () => {
  test('T025: VIP contact badge on rows and header, requester-tag filter, saved view survives reload', async ({ page }) => {
    test.setTimeout(300000);
    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, {
        companyName: `Tag Chips ${uuidv4().slice(0, 6)}`,
      });
      const tenantId = tenantData.tenant.tenantId;

      const board = await tenantTable(db, tenantId, 'boards').where({ tenant: tenantId }).first();
      const status = await tenantTable(db, tenantId, 'statuses').where({ tenant: tenantId, status_type: 'ticket', is_closed: false }).first();
      const priority = await tenantTable(db, tenantId, 'priorities').where({ tenant: tenantId }).first();
      const client = await tenantTable(db, tenantId, 'clients').where({ tenant: tenantId }).first();
      if (!board || !status || !priority || !client) throw new Error('Missing seeded board/status/priority/client');

      const vipContactId = uuidv4();
      const plainContactId = uuidv4();
      for (const [contactId, name] of [[vipContactId, 'Vera Important'], [plainContactId, 'Pat Ordinary']]) {
        await tenantTable(db, tenantId, 'contacts').insert({
          tenant: tenantId,
          contact_name_id: contactId,
          full_name: name,
          client_id: client.client_id,
          email: `${contactId.slice(0, 8)}@example.com`,
        });
      }

      const vipTagId = uuidv4();
      await tenantTable(db, tenantId, 'tag_definitions').insert({
        tenant: tenantId,
        tag_id: vipTagId,
        tag_text: 'VIP',
        tagged_type: 'contact',
        background_color: '#FDE68A',
        text_color: '#92400E',
      });
      await tenantTable(db, tenantId, 'tag_mappings').insert({
        tenant: tenantId,
        mapping_id: uuidv4(),
        tag_id: vipTagId,
        tagged_id: vipContactId,
        tagged_type: 'contact',
      });
      await tenantTable(db, tenantId, 'tag_display_rules').insert({
        tenant: tenantId,
        rule_id: uuidv4(),
        tagged_type: 'contact',
        audience: 'internal',
        tag_id: vipTagId,
        position: 0,
      });

      const titles: Record<string, string> = {
        [vipContactId]: `VIP request ${uuidv4().slice(0, 6)}`,
        [plainContactId]: `Plain request ${uuidv4().slice(0, 6)}`,
      };
      const ticketIds: Record<string, string> = {};
      let number = 900100;
      for (const contactId of [vipContactId, plainContactId]) {
        const ticketId = uuidv4();
        ticketIds[contactId] = ticketId;
        await tenantTable(db, tenantId, 'tickets').insert({
          tenant: tenantId,
          ticket_id: ticketId,
          ticket_number: `E2E-${number++}`,
          title: titles[contactId],
          board_id: board.board_id,
          status_id: status.status_id,
          priority_id: priority.priority_id,
          client_id: client.client_id,
          contact_name_id: contactId,
          entered_at: new Date().toISOString(),
        });
      }

      // Badge on the requester's row only.
      await page.goto(`${BASE_URL}/msp/tickets`, { waitUntil: 'domcontentloaded' });
      const vipRow = page.locator('tr', { hasText: titles[vipContactId] });
      const plainRow = page.locator('tr', { hasText: titles[plainContactId] });
      await expect(vipRow.getByTestId('entity-chip-tag').filter({ hasText: 'VIP' })).toBeVisible({ timeout: 30000 });
      await expect(plainRow.getByTestId('entity-chip-tag')).toHaveCount(0);

      // Badge in the ticket header.
      await page.goto(`${BASE_URL}/msp/tickets/${ticketIds[vipContactId]}`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('entity-chip-tag').filter({ hasText: 'VIP' }).first()).toBeVisible({ timeout: 30000 });

      // Requester tags: any of VIP.
      await page.goto(`${BASE_URL}/msp/tickets`, { waitUntil: 'domcontentloaded' });
      await page.locator('#ticketing-dashboard-where-contact-tags-tags').click();
      await page.getByRole('option', { name: 'VIP' }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByText(titles[vipContactId]).first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(titles[plainContactId])).toHaveCount(0);

      // Save as a named view, then reload: the filter and result set survive.
      await page.locator('#tickets-view-picker-save-as-new-button').click();
      await page.getByRole('dialog').getByRole('textbox').first().fill(`VIP only ${uuidv4().slice(0, 4)}`);
      await page.locator('#tickets-view-picker-dialog-save-button').click();
      await page.waitForURL(/view=/, { timeout: 30000 });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByText(titles[vipContactId]).first()).toBeVisible({ timeout: 30000 });
      await expect(page.getByText(titles[plainContactId])).toHaveCount(0);

      // AC12 fresh load: an invalid `where` is toasted once and stripped from the URL.
      for (const bad of ['v1:contact.tags:bogus_op:x', 'v9:contact.tags:in:abc']) {
        await page.goto(`${BASE_URL}/msp/tickets?where=${encodeURIComponent(bad)}`, { waitUntil: 'domcontentloaded' });
        await expect(
          page.getByText('Some filters in this link are not valid and were ignored.'),
        ).toHaveCount(1, { timeout: 30000 });
        await expect.poll(() => new URL(page.url()).searchParams.has('where')).toBe(false);
      }
    } finally {
      await db.destroy();
    }
  });
});

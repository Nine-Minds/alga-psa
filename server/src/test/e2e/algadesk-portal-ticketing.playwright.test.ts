import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tenantDb } from '@alga-psa/db';

import {
  applyTestEnvDefaults,
  createTenantAndLogin,
  createTestDbConnection,
  createClientUser,
  getBaseUrl,
  setupClientAuthSession,
  type TenantTestData,
} from './helpers/testSetup';

applyTestEnvDefaults();

const TEST_CONFIG = {
  baseUrl: getBaseUrl(),
};

function tenantTable(db: ReturnType<typeof createTestDbConnection>, tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function tenantRows(db: ReturnType<typeof createTestDbConnection>, tenantId: string) {
  return tenantDb(db, tenantId).unscoped('tenants', 'AlgaDesk portal e2e test fixture removes tenant rows');
}

async function cleanupPortalTestTenant(db: ReturnType<typeof createTestDbConnection>, tenantId: string): Promise<void> {
  // Delete child records first for SQLite/Postgres compatibility in local runs.
  const tablesInDeleteOrder = [
    'comments',
    'ticket_documents',
    'tickets',
    'contacts',
    'users',
    'clients',
    'statuses',
    'priorities',
    'boards',
    'tenants',
  ];

  for (const table of tablesInDeleteOrder) {
    try {
      const rows = table === 'tenants'
        ? tenantRows(db, tenantId)
        : tenantTable(db, tenantId, table);
      await rows.where({ tenant: tenantId }).del();
    } catch (error) {
      console.warn(`[T015 cleanup] Failed deleting ${table} rows for tenant ${tenantId}`, error);
    }
  }
}

test.describe('AlgaDesk portal ticketing happy path', () => {
  test('T015: portal contact creates ticket with attachment, sees technician public reply, replies, and cannot see internal comments', async ({ page }) => {
    test.setTimeout(300000);

    const db = createTestDbConnection();
    const uploadPath = path.join(os.tmpdir(), `algadesk-portal-${uuidv4()}.txt`);
    let tenantData: TenantTestData | null = null;

    try {
      await fs.writeFile(uploadPath, 'portal ticket attachment', 'utf8');

      tenantData = await createTenantAndLogin(db, page, {
        companyName: `AlgaDesk Portal ${uuidv4().slice(0, 6)}`,
      });

      const tenantId = tenantData.tenant.tenantId;
      await tenantTable(db, tenantId, 'tenants').where({ tenant: tenantId }).update({ product_code: 'algadesk' });

      const board = await tenantTable(db, tenantId, 'boards').where({ tenant: tenantId }).first();
      const status = await tenantTable(db, tenantId, 'statuses').where({ tenant: tenantId, status_type: 'ticket', is_closed: false }).first();
      const priority = await tenantTable(db, tenantId, 'priorities').where({ tenant: tenantId }).first();
      const client = await tenantTable(db, tenantId, 'clients').where({ tenant: tenantId }).first();

      if (!board || !status || !priority || !client) {
        throw new Error('Missing seeded board/status/priority/client for portal test');
      }

      const portalContactEmail = `portal-${uuidv4().slice(0, 8)}@example.com`;
      const portalUser = await createClientUser(db, {
        tenantId,
        clientId: client.client_id,
        contactEmail: portalContactEmail,
        firstName: 'Portal',
        lastName: 'Contact',
      });

      await setupClientAuthSession(
        page,
        portalUser.userId,
        portalContactEmail,
        tenantId,
        TEST_CONFIG.baseUrl,
      );

      await page.goto(`${TEST_CONFIG.baseUrl}/client-portal/tickets`, {
        waitUntil: 'domcontentloaded',
      });

      const subject = `Portal Happy Path ${uuidv4().slice(0, 6)}`;
      await page.locator('#create-ticket-button').click();
      await page.locator('#client-ticket-title').fill(subject);
      await page.getByText(/description/i).first().click();
      await page.keyboard.type('Client-visible issue details from portal contact');

      const attachmentInput = page.locator('input[type="file"]').first();
      await attachmentInput.setInputFiles(uploadPath);

      await page.getByRole('button', { name: /create|submit/i }).first().click();

      await page.goto(`${TEST_CONFIG.baseUrl}/client-portal/tickets`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByText(subject).first()).toBeVisible({ timeout: 15000 });

      const createdTicket = await tenantTable(db, tenantId, 'tickets')
        .where({ tenant: tenantId, title: subject })
        .orderBy('entered_at', 'desc')
        .first();

      expect(createdTicket?.ticket_id).toBeTruthy();

      const technicianId = (await tenantTable(db, tenantId, 'users').where({ tenant: tenantId, user_type: 'internal' }).first())?.user_id;
      if (!technicianId) {
        throw new Error('Expected internal technician user for portal reply setup');
      }

      await tenantTable(db, tenantId, 'comments').insert([
        {
          tenant: tenantId,
          comment_id: uuidv4(),
          ticket_id: createdTicket.ticket_id,
          note: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Internal-only note' }] }] }),
          is_internal: true,
          is_resolution: false,
          user_id: technicianId,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        },
        {
          tenant: tenantId,
          comment_id: uuidv4(),
          ticket_id: createdTicket.ticket_id,
          note: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Public technician reply' }] }] }),
          is_internal: false,
          is_resolution: false,
          user_id: technicianId,
          created_at: db.fn.now(),
          updated_at: db.fn.now(),
        },
      ]);

      await page.goto(`${TEST_CONFIG.baseUrl}/client-portal/tickets/${createdTicket.ticket_id}`, {
        waitUntil: 'domcontentloaded',
      });

      await expect(page.getByText('Public technician reply')).toBeVisible({ timeout: 15000 });
      await expect(page.getByText('Internal-only note')).toHaveCount(0);

      await page.getByLabel(/reply|message|comment/i).first().fill('Portal follow-up reply from contact');
      await page.getByRole('button', { name: /reply|send|post/i }).first().click();

      await expect(page.getByText('Portal follow-up reply from contact')).toBeVisible({ timeout: 15000 });

      const portalReply = await tenantTable(db, tenantId, 'comments')
        .where({ tenant: tenantId, ticket_id: createdTicket.ticket_id, is_internal: false })
        .orderBy('created_at', 'desc')
        .first();

      expect(portalReply).toBeTruthy();
    } finally {
      if (tenantData?.tenant?.tenantId) {
        await cleanupPortalTestTenant(db, tenantData.tenant.tenantId);
      }
      await fs.rm(uploadPath, { force: true }).catch(() => undefined);
      await db.destroy().catch(() => undefined);
    }
  });
});

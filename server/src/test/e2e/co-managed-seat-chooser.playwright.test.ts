/**
 * T044 (S34, F084 + F085 + F086, with F013): the seat/workspace shape chooser, the seat arrangement panel
 * and the combined overview.
 *
 * On a client with no arrangement an administrator opens the Co-managed IT tab, chooses Seat, sets the
 * number of seats, the boards in scope and the first technician, and confirms. The tab then shows the seat
 * arrangement panel, and the Co-managed IT overview lists the client as shape Seat with seats used and
 * allocated while the pool's available total is reduced. Choosing Workspace opens the existing provisioning
 * flow, unchanged.
 *
 * STATUS: written, NOT RUN. It needs the app server and the e2e database, and this slice was built without
 * starting either. Start the server with both capabilities forced on (the pool and the sponsor are seeded
 * below, so eligibility is real; only the release flag is bypassed):
 *
 *   FORCE_CAPABILITIES=co-managed:on,co-managed-seat:on NEXT_PUBLIC_FORCE_CAPABILITIES=co-managed:on,co-managed-seat:on
 *
 * The server-side halves are covered by tests that did run:
 *   server/src/test/unit/co-managed/coManagedSeatActions.gate.test.ts   capability and permission gating, command order
 *   server/src/test/unit/co-managed/CoManagedShapeChooser.test.tsx      chooser, blockers, Workspace hand-over
 *   server/src/test/unit/co-managed/CoManagedSeatPanel.test.tsx         panel actions
 *   server/src/test/unit/co-managed/CoManagedOverview.test.tsx          both shapes in one table
 *   server/src/test/integration/coManagedSeatAdministration.db.test.ts  reads and commands on real Postgres
 */
import { test, expect } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import {
  applyTestEnvDefaults,
  createTenantAndLogin,
  createTestDbConnection,
  getBaseUrl,
} from './helpers/testSetup';

applyTestEnvDefaults();

const baseUrl = getBaseUrl();
const DAY = 86_400_000;
const POOL = 5;
const SEATS = 2;

test.describe('Co-managed seat: shape chooser, panel and overview (T044)', () => {
  test('an administrator enables a seat arrangement and sees it in the overview; Workspace opens the existing flow', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, { companyName: `Seat chooser ${uuidv4().slice(0, 6)}` });
      const tenant = tenantData.tenant.tenantId;
      const client = tenantData.client!;

      // A pool of five seats for a Pro sponsor, and two boards to choose between.
      await db('tenants').where({ tenant }).update({ product_code: 'psa', plan: 'pro' });
      await db('co_managed_entitlements').insert({
        tenant, source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: POOL,
        verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
      });
      const boardName = `Service desk ${uuidv4().slice(0, 4)}`;
      for (const name of [boardName, `Projects ${uuidv4().slice(0, 4)}`]) {
        await db('boards').insert({ tenant, board_id: uuidv4(), board_name: name, is_default: false });
      }

      await page.goto(`${baseUrl}/msp/clients/${client.clientId}?tab=co-managed`, { waitUntil: 'domcontentloaded' });

      // The chooser: two shapes with one sentence each, and the pool.
      const seatOption = page.locator('[id$="-choose-seat"]');
      const workspaceOption = page.locator('[id$="-choose-workspace"]');
      await expect(seatOption).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("The client's technicians work in your PSA, limited to their company.")).toBeVisible();
      await expect(page.getByText("The client's IT team gets its own service desk and escalates to you.")).toBeVisible();
      await expect(page.locator('[id$="-pool"]')).toContainText(`${POOL} of ${POOL} seats available`);

      // Workspace: the existing provisioning flow, not the seat form.
      await workspaceOption.click();
      await expect(page.locator('[id$="-workspace-name"]')).toBeVisible();
      await expect(page.locator('[id$="-seat-count"]')).toHaveCount(0);

      // Seat: seats, board scope, first technician.
      await seatOption.click();
      await page.locator('[id$="-seat-count"]').fill(String(SEATS));
      await page.getByLabel(boardName).check();
      await page.locator('[id*="-board-create-"]').first().click();
      await page.locator('[id$="-tech-name"]').fill('Dana Reyes');
      await page.locator('[id$="-tech-email"]').fill(`dana.${uuidv4().slice(0, 8)}@client.example`);
      await page.locator('[id$="-seat-submit"]').click();

      // The panel replaces the chooser: seats used (the invited technician holds one) and allocated.
      await expect(page.locator('[id$="-seat-usage"]')).toHaveText(`1 of ${SEATS} seats used`, { timeout: 30_000 });
      await expect(page.getByText('Dana Reyes')).toBeVisible();
      await expect(seatOption).toHaveCount(0);

      // The overview: the client as shape Seat, seats used and allocated, and the pool reduced.
      await page.goto(`${baseUrl}/msp/co-managed`, { waitUntil: 'domcontentloaded' });
      const row = page.locator('#co-managed-client-overview tr', { hasText: client.clientName });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await expect(row).toContainText('Seat');
      await expect(row).toContainText('Active');
      await expect(row.locator('td').nth(3)).toHaveText('1');
      await expect(row.locator('td').nth(4)).toHaveText(String(SEATS));
      await expect(page.locator('#co-managed-overview-pool')).toContainText(String(POOL - SEATS));

      // The database agrees: one live arrangement for the client, bound to a two-seat allocation.
      const arrangement = await db('co_managed_seat_arrangements').where({ tenant, client_id: client.clientId }).first();
      expect(arrangement?.state).toBe('active');
      const allocation = await db('co_managed_allocations').where({ tenant, allocation_id: arrangement.allocation_id }).first();
      expect(Number(allocation.seats)).toBe(SEATS);
    } finally {
      await db.destroy();
    }
  });
});

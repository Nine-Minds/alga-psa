/**
 * T027 (S20, F047 + F048 + F049): the native ticket screen is reduced for a seat technician.
 *
 * A seat technician opens `/msp/tickets/[id]` and sees no billing, materials, credentials, bundle, delete or
 * scheduling affordance and no billing profile picker, and the browser makes no billing-rollup or materials
 * request. The MSP admin opening the same ticket is the control: the affordances are there for them.
 *
 * STATUS: written, type-checked, NOT RUN. It needs the app server and the e2e database, which this slice was
 * built without starting. The reduced set follows the seat principal alone (it fails closed), so no release
 * flag is needed to see the reduction; seeding the seat rows is enough.
 * The server-side halves are covered by tests that did run:
 *   packages/tickets/src/lib/__tests__/ticketPreloads.test.ts    a gated loader is never called
 *   server/src/lib/tickets/ticketViewerCapabilities.test.ts       native / seat / flag-off resolution
 *   packages/tickets/.../TicketBentoLayout.billingCapability.test.tsx   no billing profile picker
 * The page's server preloads run inside the Next server, so they never appear in the browser's network log;
 * the browser-side check below covers the requests the client itself could make.
 */
import { test, expect, type Page } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { createCoManagedSeatArrangement, setCoManagedSeatBoardScope } from '@alga-psa/co-managed/seatArrangement';
import { admitCoManagedSeatRole } from '@alga-psa/co-managed/seatRole';
import { CO_MANAGED_SEAT_RESOLVER_ID } from '@alga-psa/co-managed/seatAuthority';
import { retainBuiltinResolverSubject } from '@alga-psa/authorization/subject';

import {
  applyTestEnvDefaults,
  createTenantAndLogin,
  createTestDbConnection,
  getBaseUrl,
  setupAuthSession,
  type TenantTestData,
} from './helpers/testSetup';

applyTestEnvDefaults();

const baseUrl = getBaseUrl();
const DAY = 86_400_000;

type Db = ReturnType<typeof createTestDbConnection>;

// Affordances the reduced capability set removes. Matched by id suffix so the test does not depend on the
// screen's id prefix.
const REMOVED_AFFORDANCES: Record<string, string> = {
  billing: '[id$="-billing"], [id$="-billing-loading"]',
  'billing profile picker': '[id$="-billing-profile-picker"]',
  materials: '[id$="-materials"]',
  credentials: '[id*="credentials"]',
  bundle: '[id^="ticket-bundle-"], [id$="-bundle-closed-master-choice-dialog"]',
  delete: '[id$="-delete-ticket-button"]',
  duplicate: '[id$="-duplicate-ticket-button"]',
  scheduling: '[id$="-scheduled-work-tile"], [id$="-scheduled-work-tile-loading"]',
};

// LEVERAGE: pattern seat-e2e-seed — the same seat-technician row seeding as co-managed-seat-surface.playwright.test.ts (T017)
async function seedSeatTechnicianWithTicket(db: Db, tenantData: TenantTestData) {
  const tenant = tenantData.tenant.tenantId;
  const clientId = tenantData.client!.clientId;
  const scoped = tenantDb(db, tenant);

  await db('co_managed_entitlements').insert({
    tenant, source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: 3,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
  });
  await db('tenants').where({ tenant }).update({ product_code: 'psa' });

  const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: uuidv4(), seats: 1 });

  const userId = uuidv4();
  const email = `seat-${userId.slice(0, 8)}@example.com`;
  await scoped.table('users').insert({
    tenant, user_id: userId, username: email, email, first_name: 'Seat', last_name: 'Technician',
    hashed_password: 'not-used-the-session-is-injected', user_type: 'internal', is_inactive: false,
  });
  await db.transaction(async (trx) => {
    const roleId = await admitCoManagedSeatRole(trx, tenant);
    await tenantDb(trx, tenant).table('user_roles').insert({ tenant, user_id: userId, role_id: roleId });
    await retainBuiltinResolverSubject(trx, { tenant, userId }, CO_MANAGED_SEAT_RESOLVER_ID);
    await tenantDb(trx, tenant).table('co_managed_seat_assignments').insert({
      tenant, assignment_id: uuidv4(), arrangement_id: arrangement.arrangement_id, user_id: userId, state: 'active',
    });
  });

  // A ticket on a board the seat is scoped to.
  const status = await scoped.table('statuses').where({ is_closed: false, status_type: 'ticket' }).first('status_id');
  const priority = await scoped.table('priorities').first('priority_id');
  const boardId = uuidv4();
  await scoped.table('boards').insert({ board_id: boardId, tenant, board_name: 'Seat screen board', is_default: false });
  await setCoManagedSeatBoardScope(db, {
    sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: false }],
  });
  const ticketId = uuidv4();
  await scoped.table('tickets').insert({
    ticket_id: ticketId, tenant, ticket_number: `SEAT-${Date.now().toString().slice(-6)}`,
    title: 'Seat technician ticket screen', status_id: status?.status_id, priority_id: priority?.priority_id,
    board_id: boardId, client_id: clientId, entered_at: new Date(), updated_at: new Date(),
  });

  return { seat: { userId, email }, ticketId };
}

async function signInAs(page: Page, db: Db, tenantData: TenantTestData, user: { userId: string; email: string }) {
  await page.context().clearCookies();
  await setupAuthSession(page, { ...tenantData, adminUser: user }, baseUrl, db);
}

test.describe('Co-managed seat: reduced ticket screen (T027)', () => {
  test('a seat technician sees no billing, materials, credentials, bundle, delete or scheduling affordance', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, { companyName: `Seat ticket ${uuidv4().slice(0, 6)}` });
      const { seat, ticketId } = await seedSeatTechnicianWithTicket(db, tenantData);

      // Control: MSP staff keep the full screen on the same ticket.
      await page.goto(`${baseUrl}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('[id$="-delete-ticket-button"]').first(), 'MSP staff keep delete').toBeAttached({ timeout: 30_000 });

      await signInAs(page, db, tenantData, seat);

      const requests: string[] = [];
      page.on('request', (request) => requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));

      const response = await page.goto(`${baseUrl}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' });
      expect(response?.status()).toBe(200);
      // The screen is up: the conversation and status are still there.
      await expect(page.locator('[id$="-status-select"], [id*="status"]').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForLoadState('networkidle');

      for (const [name, selector] of Object.entries(REMOVED_AFFORDANCES)) {
        await expect(page.locator(selector), `no ${name} affordance for a seat technician`).toHaveCount(0);
      }

      const forbidden = requests.filter((entry) => /billing[-_]?rollup|\/materials?\b|ticket[-_]?materials/i.test(entry));
      expect(forbidden, 'no billing rollup or materials request from the browser').toEqual([]);
    } finally {
      await db.destroy();
    }
  });
});

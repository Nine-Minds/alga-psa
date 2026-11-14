/**
 * T035 (S27, F066 + F067): a seat technician logs time operationally.
 *
 * The technician opens the time-entry dialog from a ticket and saves an entry. The dialog renders no service,
 * contract-line or billable control and makes no service-catalog, tax-region, client or contract server-action
 * request; the stored row is operational: `billing_mode = 'operational'`, no service, contract line or tax,
 * `billable_duration = 0`, `invoiced = false`, with the real effort kept in `start_time` / `end_time`.
 *
 * The control is the MSP admin opening the same dialog: it DOES make those reads. Server actions are POSTs to the
 * page URL carrying a hashed `next-action` id, so names are not visible in the browser. The test therefore records
 * the action ids each principal's dialog open fires and proves, by difference, that the reads the admin makes
 * (at least the service catalog and the tax regions) never fire for the seat, and also scans every request's URL and
 * body for the commercial reader names a REST call would carry.
 *
 * The mode follows the seat principal alone (it fails closed), so no release flag is needed; seeding the seat rows
 * is enough, as in T027. Run against a running app with PLAYWRIGHT_SKIP_WEB_SERVER=true and BASE_URL/NEXTAUTH_URL/PORT
 * set to that app. NOT RUN in the step that wrote it (no app server was available). The server-side halves are
 * covered by tests that did run:
 *   packages/scheduling/src/actions/timeEntryCrudActions.operationalMode.test.ts   mode decided from the principal
 *   packages/scheduling/src/lib/__tests__/timeEntryWriteCore.operationalMode.test.ts   operational row, no allocation
 *   packages/scheduling/tests/timeEntryDialog.operationalMode.test.tsx             dialog invokes no commercial reader
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

// LEVERAGE: pattern seat-e2e-seed — the same seat-technician row seeding as co-managed-seat-surface.playwright.test.ts (T017)
async function seedSeatTechnicianWithTicketAndPeriod(db: Db, tenantData: TenantTestData) {
  const tenant = tenantData.tenant.tenantId;
  const clientId = tenantData.client!.clientId;
  const scoped = tenantDb(db, tenant);

  await db('co_managed_entitlements').insert({
    tenant, source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: 3,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
  });
  // A hosted entitlement sponsors seats only on a Pro PSA workspace (readEligibleSponsor).
  await db('tenants').where({ tenant }).update({ product_code: 'psa', plan: 'pro' });

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

  // The launcher needs a time period covering today to open the dialog (end date is exclusive).
  const dateOnly = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
  await scoped.table('time_periods').insert({
    period_id: uuidv4(), tenant, start_date: dateOnly(-3), end_date: dateOnly(4), is_closed: false,
    created_at: new Date(), updated_at: new Date(),
  });

  return { seat: { userId, email }, ticketId };
}

const ADD_TIME = '[id$="-add-time-entry-btn"]';
const SAVE = '[id$="-save-dialog-btn"]';
// Controls the operational dialog does not render.
const COMMERCIAL_CONTROLS = '[id*="-service-"], [id*="-billable-duration-"], [id^="contract-line-"]';
// Reader names a request URL or body would carry; server actions hide theirs behind a hash (see the file header).
const COMMERCIAL_READERS = /service[-_]?catalog|fetchServicesForTimeEntry|fetchTaxRegions|tax[-_]?rates?|tax[-_]?regions?|contract[-_]?lines?|resolveDefaultTicketTimeEntryService/i;

async function signInAs(page: Page, db: Db, tenantData: TenantTestData, user: { userId: string; email: string }) {
  await page.context().clearCookies();
  await setupAuthSession(page, { ...tenantData, adminUser: user }, baseUrl, db);
}

/** Opens the ticket's time-entry dialog and returns the server-action ids and request log it produced. */
async function openDialogRecording(page: Page, ticketId: string) {
  const actionIds: string[] = [];
  const requests: string[] = [];
  const onRequest = (request: import('@playwright/test').Request) => {
    const actionId = request.headers()['next-action'];
    if (actionId) actionIds.push(actionId);
    requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`);
  };
  await page.goto(`${baseUrl}/msp/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  page.on('request', onRequest);
  await page.locator(ADD_TIME).first().click({ timeout: 30_000 });
  await expect(page.locator(SAVE).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle');
  page.off('request', onRequest);
  return { actionIds: new Set(actionIds), requests };
}

test.describe('Co-managed seat: operational time entry (T035)', () => {
  test('a seat technician saves an operational entry and the dialog reads no service, tax or contract data', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, { companyName: `Seat time ${uuidv4().slice(0, 6)}` });
      const tenant = tenantData.tenant.tenantId;
      const { seat, ticketId } = await seedSeatTechnicianWithTicketAndPeriod(db, tenantData);

      // Control: MSP staff open the same dialog and DO read the catalog and tax regions.
      const staff = await openDialogRecording(page, ticketId);
      await expect(page.locator(COMMERCIAL_CONTROLS).first(), 'MSP staff keep the service control').toBeAttached();
      await page.keyboard.press('Escape');

      await signInAs(page, db, tenantData, seat);
      const technician = await openDialogRecording(page, ticketId);

      // No commercial control in the dialog.
      await expect(page.locator(COMMERCIAL_CONTROLS), 'no service, billable or contract-line control').toHaveCount(0);

      // No commercial read: the reads staff made (service catalog, tax regions, ...) never fire for the technician.
      const staffOnly = [...staff.actionIds].filter((id) => !technician.actionIds.has(id));
      expect(staffOnly.length, 'the control must show the commercial reads that the seat skips').toBeGreaterThanOrEqual(2);
      expect(technician.requests.filter((entry) => COMMERCIAL_READERS.test(entry)),
        'no service-catalog, tax or contract request from the seat dialog').toEqual([]);

      // Save. Only the note is filled in; there is no service to choose.
      await page.locator('[id$="-notes-0"]').first().fill('Reset the printer queue');
      const saveRequests: string[] = [];
      page.on('request', (request) => saveRequests.push(`${request.method()} ${request.url()} ${request.postData() ?? ''}`));
      await page.locator(SAVE).first().click();
      await expect(page.locator(SAVE)).toHaveCount(0, { timeout: 30_000 });
      expect(saveRequests.filter((entry) => COMMERCIAL_READERS.test(entry)), 'saving makes no commercial request').toEqual([]);

      // The stored row.
      const rows = await tenantDb(db, tenant).table('time_entries').where({ user_id: seat.userId, work_item_id: ticketId });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        billing_mode: 'operational', service_id: null, contract_line_id: null, contract_line_source: null,
        tax_rate_id: null, tax_region: null, billable_duration: 0, invoiced: false,
      });
      // Actual effort is kept in the instants, not in billable minutes.
      expect(new Date(rows[0].end_time).getTime()).toBeGreaterThan(new Date(rows[0].start_time).getTime());
    } finally {
      await db.destroy();
    }
  });
});

/**
 * T032 (S25, F059 + F060 + F061): three-audience composers and the Client IT assignee group.
 *
 * On a ticket of a client with a live seat arrangement:
 *   - the MSP composer replaces the Internal toggle with Requester, Shared IT and Private, defaulting to Private;
 *   - the MSP assignee picker lists that client's seat technicians under a Client IT group;
 *   - a seat technician's composer offers Requester and Shared IT only.
 * On a ticket of any other client, the composer keeps the Internal toggle and the picker has no Client IT group and
 * no seat technician in it.
 *
 * STATUS: written, NOT RUN. It needs the app server and the e2e database, and this slice was built without starting
 * either. Start the server with `FORCE_CAPABILITIES=co-managed-seat:on` (the capability is otherwise gated by the
 * `release-v2-0-feature` flag, which is off by default). Seeding is from rows, like the S12 surface test
 * (co-managed-seat-surface.playwright.test.ts). The server-side halves are covered by tests that did run:
 *   shared/lib/humanWork/__tests__/ticketSeatContext.test.ts        seat context, flag-off neutrality, picker filter
 *   packages/tickets/src/components/ticket/TicketConversation.audienceComposer.test.tsx   composer option sets + default
 *   packages/ui/src/components/UserAndTeamPicker.userGroups.test.tsx                      picker grouping
 *   packages/tickets/src/actions/comment-actions/commentAudienceRead.test.ts              audience labels
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

/** Either layout's composer audience select (the classic composer and the bento timeline name it differently). */
const AUDIENCE_SELECT = '[id$="-audience-select"], [id$="-composer-audience"]';
const INTERNAL_TOGGLE = '[id$="-internal-toggle"]';
const ASSIGNEE_PICKER = '[data-automation-type="user-and-team-picker"]';

async function seedUser(db: Db, tenant: string, firstName: string, lastName: string) {
  const userId = uuidv4();
  const email = `${firstName.toLowerCase()}-${userId.slice(0, 8)}@example.com`;
  await tenantDb(db, tenant).table('users').insert({
    tenant, user_id: userId, username: email, email, first_name: firstName, last_name: lastName,
    hashed_password: 'not-used-the-session-is-injected', user_type: 'internal', is_inactive: false,
  });
  return { userId, email };
}

async function seedSeatTechnician(db: Db, tenant: string, arrangementId: string, firstName: string) {
  const user = await seedUser(db, tenant, firstName, 'Technician');
  await db.transaction(async (trx) => {
    const roleId = await admitCoManagedSeatRole(trx, tenant);
    await tenantDb(trx, tenant).table('user_roles').insert({ tenant, user_id: user.userId, role_id: roleId });
    await retainBuiltinResolverSubject(trx, { tenant, userId: user.userId }, CO_MANAGED_SEAT_RESOLVER_ID);
    await tenantDb(trx, tenant).table('co_managed_seat_assignments').insert({
      tenant, assignment_id: uuidv4(), arrangement_id: arrangementId, user_id: user.userId, state: 'active',
    });
  });
  return user;
}

async function seedTicket(db: Db, tenant: string, clientId: string, boardId: string, title: string) {
  const ticketId = uuidv4();
  await db('tickets').insert({
    tenant, ticket_id: ticketId, ticket_number: `S25-${ticketId.slice(0, 6)}`, title, client_id: clientId, board_id: boardId,
    entered_at: new Date(), updated_at: new Date(),
  });
  return ticketId;
}

async function signInAs(page: Page, db: Db, tenantData: TenantTestData, user: { userId: string; email: string }) {
  await page.context().clearCookies();
  await setupAuthSession(page, { ...tenantData, adminUser: user }, baseUrl, db);
}

/** Opens the comment composer on whichever layout the ticket screen renders. */
async function openComposer(page: Page) {
  const trigger = page.locator('[id$="-show-comment-editor-btn"], [id$="-add-comment-btn"]').first();
  await expect(trigger).toBeVisible();
  await trigger.click();
}

async function selectedAudience(page: Page) {
  const select = page.locator(AUDIENCE_SELECT).first();
  await expect(select).toBeVisible();
  return select;
}

test.describe('Co-managed seat: ticket composers and the Client IT group (T032)', () => {
  test('MSP and technician composers and the assignee picker follow the ticket\'s client', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, { companyName: `Seat composers ${uuidv4().slice(0, 6)}` });
      const tenant = tenantData.tenant.tenantId;
      const arrangedClientId = tenantData.client!.clientId;

      // Seat shape: entitlement, a live arrangement for the first client, a board in its scope.
      await db('co_managed_entitlements').insert({
        tenant, source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: 3,
        verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
      });
      await db('tenants').where({ tenant }).update({ product_code: 'psa' });
      const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId: arrangedClientId, operationId: uuidv4(), seats: 2 });

      const boardId = uuidv4();
      await db('boards').insert({ tenant, board_id: boardId, board_name: `Seat board ${boardId.slice(0, 6)}`, is_default: false });
      await setCoManagedSeatBoardScope(db, { sponsorTenant: tenant, arrangementId: arrangement.arrangement_id, boards: [{ boardId, canCreate: true }] });

      // A second client with no arrangement.
      const otherClientId = uuidv4();
      await db('clients').insert({
        ...(await db('clients').where({ tenant, client_id: arrangedClientId }).first()),
        client_id: otherClientId, client_name: `No arrangement ${otherClientId.slice(0, 6)}`,
      });

      const technician = await seedSeatTechnician(db, tenant, arrangement.arrangement_id, 'Tinman');
      const arrangedTicket = await seedTicket(db, tenant, arrangedClientId, boardId, 'Arranged client ticket');
      const otherTicket = await seedTicket(db, tenant, otherClientId, boardId, 'Other client ticket');

      // --- MSP staff on the arranged client's ticket ---
      await page.goto(`${baseUrl}/msp/tickets/${arrangedTicket}`, { waitUntil: 'domcontentloaded' });
      await openComposer(page);
      const mspSelect = await selectedAudience(page);
      await expect(page.locator(INTERNAL_TOGGLE)).toHaveCount(0);
      await expect(mspSelect).toContainText('Private'); // the default
      await mspSelect.click();
      for (const label of ['Requester', 'Shared IT', 'Private']) {
        await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape');

      await page.locator(ASSIGNEE_PICKER).first().click();
      await expect(page.getByText('Client IT', { exact: true })).toBeVisible();
      await expect(page.getByText('Tinman Technician')).toBeVisible();
      await page.keyboard.press('Escape');

      // --- MSP staff on another client's ticket: both unchanged ---
      await page.goto(`${baseUrl}/msp/tickets/${otherTicket}`, { waitUntil: 'domcontentloaded' });
      await openComposer(page);
      await expect(page.locator(INTERNAL_TOGGLE).first()).toBeVisible();
      await expect(page.locator(AUDIENCE_SELECT)).toHaveCount(0);
      await page.locator(ASSIGNEE_PICKER).first().click();
      await expect(page.getByText('Client IT', { exact: true })).toHaveCount(0);
      await expect(page.getByText('Tinman Technician')).toHaveCount(0);
      await page.keyboard.press('Escape');

      // --- The seat technician on the arranged client's ticket: two audiences, never Private ---
      await signInAs(page, db, tenantData, technician);
      await page.goto(`${baseUrl}/msp/tickets/${arrangedTicket}`, { waitUntil: 'domcontentloaded' });
      await openComposer(page);
      const techSelect = await selectedAudience(page);
      await expect(techSelect).toContainText('Shared IT'); // the default
      await techSelect.click();
      await expect(page.getByRole('option', { name: 'Requester', exact: true })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Shared IT', exact: true })).toBeVisible();
      await expect(page.getByRole('option', { name: 'Private', exact: true })).toHaveCount(0);
    } finally {
      await db.destroy();
    }
  });
});

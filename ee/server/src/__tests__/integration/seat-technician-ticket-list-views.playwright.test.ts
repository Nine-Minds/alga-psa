import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

/**
 * T026 (co-managed seat, S19 / F046). A seat technician opens the native ticket list and sees only
 * their client's tickets on boards their arrangement covers, in four views, and each view's count
 * matches its rows.
 *
 * The session user is made the seat technician (assignment + arrangement + board scope rows), so the
 * whole path is the real one: resolver facts, kernel narrowing, view predicates, counts.
 * Requires the app server (EE_BASE_URL), the test database and `FORCE_CAPABILITIES=co-managed-seat:on`
 * on the server. NOT RUN in the S19 draft: it needs the app server, which that slice was told not to start.
 */
test.describe('seat technician ticket list views (T026)', () => {
  test('four views, every count equals its rows, nothing out of scope', async ({ page }) => {
    const db = createTestDbConnection();
    try {
      const tenantData = await createTenantAndLogin(db, page, {
        completeOnboarding: true,
        sessionOptions: { baseUrl: BASE_URL },
        permissions: [{ roleName: 'Admin', permissions: [{ resource: 'ticket', action: 'read' }] }],
      });
      const tenant = tenantData.tenant.tenantId;
      const userId = tenantData.adminUser.userId;
      const mk = async (table: string, row: Record<string, unknown>) => db(table).insert({ tenant, ...row });

      const clientA = uuidv4(); const clientC = uuidv4();
      for (const [id, n] of [[clientA, 'Seat Client A'], [clientC, 'Other Client C']]) {
        await mk('clients', { client_id: id, client_name: n, is_inactive: false });
      }
      const boards: Record<string, string> = {};
      for (const key of ['B1', 'B2', 'B3']) {
        boards[key] = uuidv4();
        await mk('boards', { board_id: boards[key], board_name: `Board ${key}`, is_default: false, is_inactive: false });
      }
      const arrangement = uuidv4();
      await mk('co_managed_entitlements', { source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: 2,
        verified_at: new Date(Date.now() - 400 * 86_400_000), valid_until: new Date(Date.now() + 365 * 86_400_000) });
      await mk('co_managed_seat_arrangements', { arrangement_id: arrangement, client_id: clientA, state: 'active', seats: 1 });
      for (const key of ['B1', 'B2']) {
        await mk('co_managed_seat_board_scopes', { arrangement_id: arrangement, board_id: boards[key], can_create: false });
      }
      await mk('co_managed_seat_assignments', { assignment_id: uuidv4(), arrangement_id: arrangement, user_id: userId, state: 'active' });

      const tickets: Array<[string, string, string, 'client_it' | 'msp', string | null]> = [
        ['A1 client it', clientA, 'B1', 'client_it', userId], ['A2 with msp', clientA, 'B1', 'msp', null],
        ['A3 client it', clientA, 'B2', 'client_it', null], ['A4 out of scope', clientA, 'B3', 'client_it', null],
        ['C1 other client', clientC, 'B1', 'msp', null],
      ];
      for (const [title, client, board, responsibility, assignee] of tickets) {
        const ticketId = uuidv4();
        await mk('tickets', { ticket_id: ticketId, ticket_number: `T-${ticketId.slice(0, 8)}`, title, client_id: client,
          board_id: boards[board], assigned_to: assignee });
        if (client === clientA) await mk('co_managed_seat_ticket_work', { ticket_id: ticketId, arrangement_id: arrangement,
          responsibility, revision: 1, last_transition_at: new Date() });
      }

      await page.goto(`${BASE_URL}/msp/tickets?boardFilterState=all&statusId=all`);
      const tabs = page.locator('[id$="-list-view-tabs"] [role="tab"]');
      await expect(tabs).toHaveCount(4);
      await expect(page.getByText('Other Client C')).toHaveCount(0);
      await expect(page.getByText('A4 out of scope')).toHaveCount(0);

      for (const label of ['Client IT', 'With MSP', 'Unassigned', 'All']) {
        const tab = tabs.filter({ hasText: label });
        const count = Number((await tab.innerText()).match(/\d+/)?.[0]);
        await tab.click();
        await expect(tab).toHaveAttribute('data-state', 'active');
        await expect(page.locator('[id$="-tickets-table"] tbody tr')).toHaveCount(count);
      }
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

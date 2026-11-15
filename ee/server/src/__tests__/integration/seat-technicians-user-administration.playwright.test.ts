import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

const CLIENT_NAME = 'Seat Client Northwind';
const IN_SCOPE_TICKET = 'Printer queue is stuck';
const OUT_OF_SCOPE_TICKET = 'Payroll server migration';

/**
 * T046 (co-managed seat, S36 / F088, F089). User administration lists a seat technician under their client,
 * apart from MSP staff, and the licence usage figure is the same before and after the technician exists.
 * The effective access view explains a denial caused by board scope, and allows an in-scope ticket.
 *
 * The signed-in user is the MSP administrator; the seat technician is a second internal user with a live seat
 * assignment, an arrangement for the client and a board scope that covers one board. The decision shown is the
 * authorization simulator's, run through the real kernel and the seat resolver.
 *
 * Requires the app server (EE_BASE_URL), the test database and `FORCE_CAPABILITIES=co-managed-seat:on` on the
 * server. NOT RUN in the S36 draft: that step was told not to start the app server.
 */
test.describe('seat technicians in user administration (T046)', () => {
  test('lists the technician under their client with usage unchanged, and explains a board-scope denial', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();
    try {
      const tenantData = await createTenantAndLogin(db, page, {
        completeOnboarding: true,
        sessionOptions: { baseUrl: BASE_URL },
        permissions: [{ roleName: 'Admin', permissions: [
          { resource: 'user', action: 'read' }, { resource: 'ticket', action: 'read' }, { resource: 'system_settings', action: 'read' },
        ] }],
      });
      const tenant = tenantData.tenant.tenantId;
      const mk = (table: string, row: Record<string, unknown>) => db(table).insert({ tenant, ...row });

      const clientId = uuidv4();
      await mk('clients', { client_id: clientId, client_name: CLIENT_NAME, is_inactive: false });
      const [inScopeBoard, outOfScopeBoard] = [uuidv4(), uuidv4()];
      await mk('boards', { board_id: inScopeBoard, board_name: 'Shared Board', is_default: false, is_inactive: false });
      await mk('boards', { board_id: outOfScopeBoard, board_name: 'MSP Only Board', is_default: false, is_inactive: false });
      for (const [title, board] of [[IN_SCOPE_TICKET, inScopeBoard], [OUT_OF_SCOPE_TICKET, outOfScopeBoard]]) {
        await mk('tickets', { ticket_id: uuidv4(), ticket_number: `T-${uuidv4().slice(0, 8)}`, title, client_id: clientId, board_id: board });
      }

      // The usage figure with the administrator alone.
      await page.goto(`${BASE_URL}/msp/settings?tab=users`, { waitUntil: 'networkidle' });
      const usage = page.getByText(/MSP users:/);
      await expect(usage).toBeVisible();
      const usageBefore = (await usage.innerText()).trim();
      await expect(page.locator('#seat-technician-users')).toHaveCount(0);

      // A seat technician: an internal user with a live assignment in an arrangement for the client.
      const technicianId = uuidv4();
      await mk('users', { user_id: technicianId, username: `sam.${technicianId.slice(0, 6)}`, first_name: 'Sam', last_name: 'Seat',
        email: `sam-${technicianId.slice(0, 6)}@example.com`, hashed_password: 'not-used', user_type: 'internal', is_inactive: false });
      const readRole = await db('permissions').where({ tenant, resource: 'ticket', action: 'read', msp: true }).first();
      const roleId = uuidv4();
      await mk('roles', { role_id: roleId, role_name: `Seat read only ${roleId.slice(0, 6)}`, msp: true, client: false });
      await mk('role_permissions', { role_id: roleId, permission_id: readRole.permission_id });
      await mk('user_roles', { user_id: technicianId, role_id: roleId });

      const arrangement = uuidv4();
      await mk('co_managed_entitlements', { source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: 2,
        verified_at: new Date(Date.now() - 400 * 86_400_000), valid_until: new Date(Date.now() + 365 * 86_400_000) });
      await mk('co_managed_seat_arrangements', { arrangement_id: arrangement, client_id: clientId, state: 'active', seats: 1 });
      await mk('co_managed_seat_board_scopes', { arrangement_id: arrangement, board_id: inScopeBoard, can_create: false });
      await mk('co_managed_seat_assignments', { assignment_id: uuidv4(), arrangement_id: arrangement, user_id: technicianId, state: 'active' });

      // 1. Listed under their client, apart from staff, with the figure where it was.
      await page.goto(`${BASE_URL}/msp/settings?tab=users`, { waitUntil: 'networkidle' });
      const section = page.locator('#seat-technician-users');
      await expect(section).toBeVisible();
      await expect(section).toContainText('Sam Seat');
      await expect(section).toContainText(CLIENT_NAME);
      await expect(section).not.toContainText(technicianId);
      await expect(page.locator(`#user-actions-menu-${technicianId}`)).toHaveCount(0);
      await expect(page.getByText(/MSP users:/)).toHaveText(usageBefore);

      // 2. Effective access: an out-of-scope ticket is denied, and the board scope is the reason.
      await page.locator(`#seat-technician-effective-access-${technicianId}`).click();
      // The Dialog component suffixes its id with -dialog.
      const dialog = page.locator('#seat-technician-effective-access-dialog-dialog');
      await expect(dialog).toBeVisible();
      const pick = async (title: string) => {
        await dialog.getByRole('combobox').click();
        await page.getByRole('option', { name: new RegExp(title) }).click();
      };
      await pick(OUT_OF_SCOPE_TICKET);
      await expect(page.locator('#seat-technician-effective-access-denied')).toBeVisible();
      await expect(page.locator('#seat-technician-effective-access-reason-resolver_board_scope')).toContainText(/board scope/i);
      await expect(dialog).not.toContainText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

      // 3. An in-scope ticket is allowed, with no reasons.
      await pick(IN_SCOPE_TICKET);
      await expect(page.locator('#seat-technician-effective-access-allowed')).toBeVisible();
      await expect(page.locator('#seat-technician-effective-access-reasons')).toHaveCount(0);
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

import { expect, test } from '@playwright/test';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin, setupAuthenticatedSession } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

/**
 * T031 (co-managed seat, S24 / F058 F062 F063). An MSP technician hands a ticket of a seat-arrangement
 * client to client IT from the native ticket screen; the seat technician sees it under Client IT and
 * hands it back; the MSP's chip changes with it, and the MSP's SLA clock pauses and resumes.
 *
 * The session user is the MSP technician; a second browser context is signed in as the seat technician
 * (assignment + arrangement + board scope rows), so the whole path is the real one.
 * Requires the app server (EE_BASE_URL), the test database and `FORCE_CAPABILITIES=co-managed-seat:on`
 * on the server. NOT RUN in the S24 draft: it needs the app server, which that slice was told not to start.
 */
test.describe('seat ticket handoff, responsibility chip and SLA pause (T031)', () => {
  test('MSP hands to client IT, the technician hands back, the MSP sees the chip change', async ({ page, browser }) => {
    const db = createTestDbConnection();
    try {
      const tenantData = await createTenantAndLogin(db, page, {
        completeOnboarding: true,
        sessionOptions: { baseUrl: BASE_URL },
        permissions: [{ roleName: 'Admin', permissions: [
          { resource: 'ticket', action: 'read' }, { resource: 'ticket', action: 'update' }] }],
      });
      const tenant = tenantData.tenant.tenantId;
      const mk = async (table: string, row: Record<string, unknown>) => db(table).insert({ tenant, ...row });

      const clientId = uuidv4();
      await mk('clients', { client_id: clientId, client_name: 'Seat Client', is_inactive: false });
      const boardId = uuidv4();
      await mk('boards', { board_id: boardId, board_name: 'Support', is_default: false, is_inactive: false });

      const technicianId = uuidv4();
      const technicianEmail = `seat-tech-${technicianId.slice(0, 8)}@example.com`;
      await mk('users', { user_id: technicianId, username: technicianEmail, email: technicianEmail, hashed_password: 'x',
        first_name: 'Sam', last_name: 'Seat', user_type: 'internal', is_inactive: false });

      const arrangementId = uuidv4();
      await mk('co_managed_entitlements', { source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: 2,
        verified_at: new Date(Date.now() - 400 * 86_400_000), valid_until: new Date(Date.now() + 365 * 86_400_000) });
      await mk('co_managed_seat_arrangements', { arrangement_id: arrangementId, client_id: clientId, state: 'active', seats: 1 });
      await mk('co_managed_seat_board_scopes', { arrangement_id: arrangementId, board_id: boardId, can_create: false });
      await mk('co_managed_seat_assignments', { assignment_id: uuidv4(), arrangement_id: arrangementId, user_id: technicianId, state: 'active' });

      const ticketId = uuidv4();
      await mk('tickets', { ticket_id: ticketId, ticket_number: `T-${ticketId.slice(0, 8)}`, title: 'Printer offline', client_id: clientId, board_id: boardId });

      // MSP technician: the chip says MSP, and the ticket screen offers the handoff.
      await page.goto(`${BASE_URL}/msp/tickets/${ticketId}`);
      const chip = page.locator('#ticket-responsibility-chip');
      await expect(chip).toContainText('MSP');
      await page.locator('#ticket-hand-to-client-it').click();
      // The note is required; the picker offers the arrangement's technicians by name.
      await expect(page.locator('#ticket-hand-to-client-it-confirm')).toBeDisabled();
      await page.locator('#ticket-hand-to-client-it-note').fill('Needs a firewall change we cannot make.');
      await page.locator('#ticket-hand-to-client-it-technician').click();
      await page.getByRole('option', { name: /Sam Seat/ }).click();
      await page.locator('#ticket-hand-to-client-it-confirm').click();
      await expect(chip).toContainText('Client IT');
      await expect(page.locator('#ticket-hand-to-client-it')).toHaveCount(0);

      // The MSP list shows the column and the filter.
      await page.goto(`${BASE_URL}/msp/tickets?boardFilterState=all&statusId=all`);
      await expect(page.locator('[id$="-responsibility-filter"]')).toBeVisible();

      // Seat technician: sees it under Client IT and hands it back.
      const technicianContext = await browser.newContext();
      const technicianPage = await technicianContext.newPage();
      try {
        await setupAuthenticatedSession(technicianPage, tenantData, {
          baseUrl: BASE_URL,
          sessionClaims: { id: technicianId, email: technicianEmail, name: 'Sam Seat', username: technicianEmail, user_type: 'internal' },
        });
        await technicianPage.goto(`${BASE_URL}/msp/tickets?boardFilterState=all&statusId=all`);
        await technicianPage.locator('[id$="-list-view-tabs"] [role="tab"]').filter({ hasText: 'Client IT' }).click();
        await expect(technicianPage.getByText('Printer offline')).toBeVisible();
        await technicianPage.getByText('Printer offline').click();
        await technicianPage.getByRole('button', { name: /Hand to MSP/ }).click();
        await technicianPage.getByRole('textbox').last().fill('Firewall change done.');
        await technicianPage.getByRole('button', { name: /Hand to MSP/ }).last().click();
      } finally {
        await technicianContext.close();
      }

      // MSP technician: the chip changed back, and the action is offered again.
      await page.goto(`${BASE_URL}/msp/tickets/${ticketId}`);
      await expect(chip).toContainText('MSP');
      await expect(page.locator('#ticket-hand-to-client-it')).toBeVisible();
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

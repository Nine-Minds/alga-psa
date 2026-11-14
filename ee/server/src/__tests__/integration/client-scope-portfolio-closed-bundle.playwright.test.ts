import { expect, test, type Page } from '@playwright/test';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { applyPlaywrightAuthEnvDefaults, createTenantAndLogin } from './helpers/playwrightAuthSessionHelper';
import { createTestDbConnection } from '../../lib/testing/db-test-utils';

const BASE_URL = process.env.EE_BASE_URL || 'http://localhost:3000';

applyPlaywrightAuthEnvDefaults();

/**
 * T022 (authorization-client-scope-completion, S21). An administrator limits a technician to two clients:
 *   1. sets the technician's client portfolio to two clients, on the user's record;
 *   2. adds the "Single-client technician" starter bundle and assigns it;
 *   3. sees the bundle marked closed in the library, with a preview of what it denies;
 *   4. runs the simulator and gets a plain-language denial for a third client's ticket, and for creating a
 *      ticket for that client.
 *
 * Requires the EE app server (EE_BASE_URL) and the test database; it is not run by the unit suites.
 */

const TECHNICIAN_NAME = 'Tina Technician';
const BUNDLE_NAME = 'Single-client technician';
const CLIENTS = { first: 'Acme Plumbing', second: 'Birch Dental', third: 'Cedar Logistics' } as const;
const THIRD_CLIENT_TICKET = 'Cedar printer outage';

type Seeded = { tenantId: string; technicianId: string; thirdClientId: string };

async function seed(db: Knex, page: Page): Promise<Seeded> {
  const tenantData = await createTenantAndLogin(db, page, {
    completeOnboarding: true,
    // Bundles and portfolios are Pro: the session claim feeds the tier context, the column feeds the server actions.
    sessionOptions: { baseUrl: BASE_URL, sessionClaims: { plan: 'pro' } },
    permissions: [
      {
        roleName: 'Admin',
        permissions: [
          { resource: 'system_settings', action: 'read' },
          { resource: 'system_settings', action: 'update' },
          { resource: 'user', action: 'read' },
          { resource: 'user', action: 'update' },
          { resource: 'client', action: 'read' },
          { resource: 'ticket', action: 'read' },
          { resource: 'ticket', action: 'create' },
        ],
      },
    ],
  });
  const tenantId = tenantData.tenant.tenantId;
  await db('tenants').where({ tenant: tenantId }).update({ plan: 'pro' });

  const clientIds: Record<string, string> = {};
  for (const name of Object.values(CLIENTS)) {
    const clientId = uuidv4();
    clientIds[name] = clientId;
    await db('clients').insert({
      tenant: tenantId,
      client_id: clientId,
      client_name: name,
      is_inactive: false,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });
  }

  // The technician holds the Admin role only so RBAC grants the ticket actions; the bundle is what narrows them.
  const technicianId = uuidv4();
  await db('users').insert({
    tenant: tenantId,
    user_id: technicianId,
    username: `tina.${technicianId.slice(0, 6)}`,
    first_name: 'Tina',
    last_name: 'Technician',
    email: `tina-${technicianId.slice(0, 6)}@example.com`,
    hashed_password: 'not-used',
    user_type: 'internal',
    is_inactive: false,
    created_at: db.fn.now(),
  });
  const adminRole = await db('roles').where({ tenant: tenantId, role_name: 'Admin' }).first<{ role_id: string }>('role_id');
  await db('user_roles').insert({ tenant: tenantId, user_id: technicianId, role_id: adminRole!.role_id });

  await db('tickets').insert({
    tenant: tenantId,
    ticket_id: uuidv4(),
    ticket_number: `T-${uuidv4().slice(0, 8)}`,
    title: THIRD_CLIENT_TICKET,
    client_id: clientIds[CLIENTS.third],
  });

  return { tenantId, technicianId, thirdClientId: clientIds[CLIENTS.third] };
}

async function pickClient(page: Page, name: string) {
  await page.locator('#user-client-portfolio-add-client').click();
  await page.getByRole('option', { name }).or(page.getByText(name, { exact: true })).first().click();
  await expect(page.locator('#user-client-portfolio-clients')).toContainText(name);
}

test.describe('Client portfolio and closed bundles (T022)', () => {
  test('administrator limits a technician to two clients and the simulator explains the denials', async ({ page }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();

    try {
      const seeded = await seed(db, page);

      // 1. Portfolio: two clients, by name, on the user's record.
      await page.goto(`${BASE_URL}/msp/settings?tab=users`, { waitUntil: 'networkidle' });
      await page.locator(`#user-actions-menu-${seeded.technicianId}`).click();
      await page.locator(`#edit-user-menu-item-${seeded.technicianId}`).click();
      const editor = page.locator('#user-client-portfolio-editor');
      await expect(editor).toBeVisible();

      await pickClient(page, CLIENTS.first);
      await pickClient(page, CLIENTS.second);
      await expect(editor).not.toContainText(seeded.thirdClientId);
      await page.locator('#user-client-portfolio-save').click();
      await expect(page.locator('#user-client-portfolio-save')).toBeDisabled();

      await expect
        .poll(async () => {
          const rows = await db('user_client_portfolios')
            .join('clients', function join() {
              this.on('clients.tenant', 'user_client_portfolios.tenant').andOn('clients.client_id', 'user_client_portfolios.client_id');
            })
            .where({ 'user_client_portfolios.tenant': seeded.tenantId, 'user_client_portfolios.user_id': seeded.technicianId })
            .select<{ client_name: string }[]>('clients.client_name');
          return rows.map((row) => row.client_name).sort();
        })
        .toEqual([CLIENTS.first, CLIENTS.second]);

      // 2. Starter bundle: add it to the library and assign it to the technician.
      await page.goto(`${BASE_URL}/msp/security-settings?tab=policies`, { waitUntil: 'networkidle' });
      await page.locator('#authorization-bundle-seed-starters-button').click();
      const findBundleId = async () =>
        (
          await db('authorization_bundles')
            .where({ tenant: seeded.tenantId, bundle_key: 'single-client-technician' })
            .first<{ bundle_id: string }>('bundle_id')
        )?.bundle_id ?? null;
      await expect.poll(findBundleId).not.toBeNull();
      const bundleId = (await findBundleId())!;

      // 3. Closed, visibly, with a preview of what it denies.
      await expect(page.locator(`#authorization-bundle-closed-badge-${bundleId}`)).toBeVisible();

      await page.locator(`#authorization-bundle-actions-${bundleId}`).click();
      await page.locator(`#authorization-bundle-assignments-${bundleId}`).click();
      await page.locator('#authorization-bundle-assignment-target-type').click();
      await page.getByRole('option', { name: 'User' }).click();
      await page.locator('#authorization-bundle-assignment-target-id').click();
      await page.getByText(TECHNICIAN_NAME).first().click();
      await page.locator('#authorization-bundle-assignment-add-button').click();
      await expect
        .poll(async () =>
          Number(
            (
              await db('authorization_bundle_assignments')
                .where({ tenant: seeded.tenantId, bundle_id: bundleId, target_type: 'user', target_id: seeded.technicianId, status: 'active' })
                .count<{ count: string }>('assignment_id as count')
                .first()
            )?.count ?? 0
          )
        )
        .toBe(1);

      await page.locator(`#authorization-bundle-actions-${bundleId}`).click();
      await page.locator(`#authorization-bundle-edit-${bundleId}`).click();
      const preview = page.locator('#authorization-bundle-closed-denial-preview');
      await expect(preview).toBeVisible();
      // Billing is the catalog type the starter bundle does not name.
      await expect(page.locator('#authorization-bundle-closed-denial-billing')).toBeVisible();
      await expect(page.locator('#authorization-bundle-closed-denial-ticket')).toHaveCount(0);

      // 4. Simulator: the third client's ticket, then creating a ticket for that client.
      await page.locator(`#authorization-bundle-simulator-${bundleId}`).or(page.getByRole('tab', { name: 'Simulator' })).first().click();
      await page.locator('#authorization-bundle-simulator-principal').click();
      await page.getByText(TECHNICIAN_NAME).first().click();

      await page.locator('#authorization-bundle-simulator-resource').click();
      await page.getByRole('option', { name: 'Tickets' }).click();
      await page.locator('#authorization-bundle-simulator-action').click();
      await page.getByRole('option', { name: 'read', exact: true }).click();
      await page.locator('#authorization-bundle-simulator-record').click();
      await page.getByRole('option', { name: THIRD_CLIENT_TICKET }).click();
      await page.locator('#authorization-bundle-simulator-run-button').click();

      await expect(page.locator('#authorization-bundle-simulator-explanation-published-client_portfolio')).toContainText('client portfolio');

      await page.locator('#authorization-bundle-simulator-action').click();
      await page.getByRole('option', { name: 'create', exact: true }).click();
      await page.locator('#authorization-bundle-simulator-run-button').click();

      await expect(page.locator('#authorization-bundle-simulator-explanation-published-create_out_of_scope')).toBeVisible();
    } finally {
      await db.destroy().catch(() => undefined);
    }
  });
});

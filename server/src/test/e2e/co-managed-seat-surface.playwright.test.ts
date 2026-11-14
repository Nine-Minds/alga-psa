/**
 * T017 (S12, F029 + F030): the operational surface resolves per principal.
 *
 * A seat technician signs in to the MSP application and sees the operational surface only: tickets, projects,
 * devices, documents and time. Billing, settings, user administration, dispatch, reports and the co-managed
 * administration answer not found. The technician cannot be given an API key, and a REST request made with a key
 * that predates the seat is refused.
 *
 * STATUS: written, NOT RUN. It needs the app server and the e2e database, and this slice was built without
 * starting either. Seeding is deliberately done from rows, with the same S10-independent helpers the seat
 * authority integration test uses (arrangement, assignment, membership index, seat role): the invitation and
 * acceptance flow belongs to a later slice, so this test does not depend on it. The server-side halves of every
 * assertion below are covered by unit and database tests that did run:
 *   server/src/test/unit/productSurfacePrincipal.test.ts      routes, menu, API and capability resolution
 *   server/src/test/unit/product/serverProductRouteGuard.test.tsx
 *   server/src/test/unit/product/principalActionGuard.test.ts server-action guards
 *   server/src/test/unit/api/seatPrincipalCredentials.test.ts key issuance and REST refusal
 *   server/src/test/integration/coManagedSeatPrincipal.db.test.ts principal derivation on real Postgres
 */
import { test, expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { tenantDb } from '@alga-psa/db';
import { admitCoManagedSeatRole, createCoManagedSeatArrangement } from '@alga-psa/co-managed';
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

const OPERATIONAL_HREFS = ['/msp/tickets', '/msp/projects', '/msp/assets', '/msp/documents', '/msp/time-entry'];
const CLOSED_ROUTES = [
  '/msp/billing',
  '/msp/settings',
  '/msp/settings/users',
  '/msp/technician-dispatch',
  '/msp/schedule',
  '/msp/reports',
  '/msp/co-managed',
  '/msp/clients',
  '/msp/tickets/customer',
];

type Db = ReturnType<typeof createTestDbConnection>;

/** An active seat technician of a sponsor tenant, seeded from rows; returns the technician as a signed-in session's user. */
async function seedSeatTechnician(db: Db, tenantData: TenantTestData) {
  const tenant = tenantData.tenant.tenantId;
  const clientId = tenantData.client!.clientId;

  await db('co_managed_entitlements').insert({
    tenant, source: 'hosted', source_reference: `sub_${uuidv4()}`, capacity: 3,
    verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY),
  });
  await db('tenants').where({ tenant }).update({ product_code: 'psa' });

  const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: uuidv4(), seats: 1 });

  const userId = uuidv4();
  const email = `seat-${userId.slice(0, 8)}@example.com`;
  await tenantDb(db, tenant).table('users').insert({
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

  return { userId, email };
}

/** A key row as an earlier life of the user would have left it: hashed like every key, plaintext known to the test. */
async function seedKey(db: Db, tenant: string, userId: string) {
  const plaintext = crypto.randomBytes(24).toString('hex');
  await tenantDb(db, tenant).table('api_keys').insert({
    tenant, api_key_id: uuidv4(), user_id: userId, api_key: crypto.createHash('sha256').update(plaintext).digest('hex'),
    description: 'key that predates the seat', active: true, purpose: 'general',
  });
  return plaintext;
}

async function signInAs(page: Page, db: Db, tenantData: TenantTestData, user: { userId: string; email: string }) {
  await page.context().clearCookies();
  await setupAuthSession(page, { ...tenantData, adminUser: user }, baseUrl, db);
}

test.describe('Co-managed seat: the operational surface resolves per principal (T017)', () => {
  test('a seat technician sees only the operational surface, cannot hold an API key, and is refused on REST', async ({ page, request }) => {
    test.setTimeout(300_000);
    const db = createTestDbConnection();

    try {
      const tenantData = await createTenantAndLogin(db, page, { companyName: `Seat surface ${uuidv4().slice(0, 6)}` });
      const tenant = tenantData.tenant.tenantId;

      // The control: MSP staff (the admin) have a key and use it. A refusal below is the seat's, not the setup's.
      const adminKey = await seedKey(db, tenant, tenantData.adminUser.userId);
      const adminRest = await request.get(`${baseUrl}/api/v1/tickets`, { headers: { 'x-api-key': adminKey, 'x-tenant-id': tenant } });
      expect(adminRest.status(), 'MSP staff REST access must not change').not.toBe(401);

      const seat = await seedSeatTechnician(db, tenantData);
      // A key the technician held before becoming a seat technician.
      const priorKey = await seedKey(db, tenant, seat.userId);

      await signInAs(page, db, tenantData, seat);

      // The menu: the operational surface and nothing else.
      const landing = await page.goto(`${baseUrl}/msp/tickets`, { waitUntil: 'domcontentloaded' });
      expect(landing?.status()).toBe(200);
      for (const href of OPERATIONAL_HREFS) {
        await expect(page.locator(`a[href^="${href}"]`).first(), `menu offers ${href}`).toBeVisible();
      }
      for (const href of ['/msp/billing', '/msp/settings', '/msp/technician-dispatch', '/msp/schedule', '/msp/reports', '/msp/clients', '/msp/co-managed']) {
        await expect(page.locator(`a[href^="${href}"]`), `menu hides ${href}`).toHaveCount(0);
      }

      // Every closed route is not found, reached directly by URL.
      for (const route of CLOSED_ROUTES) {
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${route} is not found for a seat technician`).toBe(404);
      }

      // The MSP home (where sign-in, `/` and the logo send everyone) lands a seat technician in its own home.
      for (const home of ['/msp', '/msp/dashboard']) {
        const response = await page.goto(`${baseUrl}${home}`, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${home} lands a seat technician in its surface`).toBe(200);
        expect(new URL(page.url()).pathname).toBe('/msp/tickets');
      }

      // The operational routes still open.
      for (const route of OPERATIONAL_HREFS) {
        const response = await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
        expect(response?.status(), `${route} opens for a seat technician`).toBe(200);
      }

      // No API key can be issued: the issuance boundary refuses, whatever the caller. (The profile screen that
      // issues keys is itself not found for a seat technician, so the boundary is exercised directly.)
      const { ApiKeyService } = await import('@alga-psa/auth');
      await expect(ApiKeyService.createApiKey(seat.userId, 'attempt', undefined, { tenantId: tenant })).rejects.toMatchObject({
        code: 'API_CREDENTIALS_REFUSED',
      });
      const issued = await tenantDb(db, tenant).table('api_keys').where({ user_id: seat.userId, description: 'attempt' });
      expect(issued).toHaveLength(0);

      // REST: the key that predates the seat is refused, with and without the tenant header.
      const headerVariants: Array<Record<string, string>> = [{ 'x-api-key': priorKey, 'x-tenant-id': tenant }, { 'x-api-key': priorKey }];
      for (const headers of headerVariants) {
        const rest = await request.get(`${baseUrl}/api/v1/tickets`, { headers });
        expect(rest.status()).toBe(401);
      }
    } finally {
      await db.destroy();
    }
  });
});

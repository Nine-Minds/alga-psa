/**
 * Protect the co-managed Seat Technician role (plan pl-f68bfdf9, alga-2026-0003429): deleting a
 * sponsor tenant that owns the managed seat role. The tenant-deletion activity deletes table by
 * table through `tenantDb`; the ownership guard must admit that teardown, for this tenant only.
 *
 * Lives with the worker (not in `server`) because it drives the worker's own activity: a server
 * test importing worker source would make `server` depend on `temporal-workflows`, a cycle.
 * Runs in the database lane (`vitest.database.config.ts`) against the CI-supplied migrated database.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterAll, expect, it, vi } from 'vitest';

vi.mock('@temporalio/activity', () => ({
  Context: { current: () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }) },
}));
vi.mock('../../services/stripe-service.js', () => ({ updateSubscriptionMetadata: vi.fn() }));
vi.mock('../tenant-email-ingestion-activities.js', () => ({}));
vi.mock('../tenant-suspension-activities.js', () => ({}));

import { destroyAdminConnection, getAdminConnection } from '@alga-psa/db/admin';
import { createCoManagedSeatArrangement } from '../../../../../packages/co-managed/src/seatArrangement';
import { acceptCoManagedSeatInvitation, inviteCoManagedSeatTechnician } from '../../../../../packages/co-managed/src/seatInvitation';
import { createClient, createContact, createTenant } from '../../../../../server/test-utils/testDataFactory';
import { deleteTenantData } from '../tenant-deletion-activities';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../../../server/migrations/utils/permissions');
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const DAY = 86_400_000;

// Seat acceptance hashes the technician's password, which needs a signing secret.
vi.stubEnv('NEXTAUTH_SECRET', 'managed-seat-role-deletion-test-secret');

afterAll(async () => { vi.unstubAllEnvs(); await destroyAdminConnection(); });

it('deletes a sponsor that owns the managed seat role, leaving no role, grant or membership rows, and leaves another tenant alone', async () => {
  const db = await getAdminConnection();
  const seeded = async (name: string) => {
    const sponsor = await createTenant(db, `${name} ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant: sponsor, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, sponsor, 'psa');
    await db('co_managed_entitlements').insert({ tenant: sponsor, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity: 10, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, sponsor, `Seat client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 2 });
    const contactId = await createContact(db, sponsor, clientId, { fullName: 'Dana Reyes', email: `tech.${randomUUID().slice(0, 12)}@client.example` });
    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, contactId });
    const tech = await acceptCoManagedSeatInvitation(db, { token: invitation.token, password: 'Correct-horse-9-battery' });
    return { sponsor, tech };
  };
  const target = await seeded('Deleted sponsor');
  const survivor = await seeded('Surviving sponsor');
  const count = async (table: string, tenant: string) => Number((await db(table).where({ tenant }).count('* as count').first())!.count);
  expect(await count('user_roles', target.sponsor)).toBeGreaterThan(0);
  expect(await db('roles').where({ tenant: target.sponsor, managed_by: 'co-managed-seat' }).first()).toBeTruthy();
  const survivorBefore = [await count('roles', survivor.sponsor), await count('role_permissions', survivor.sponsor), await count('user_roles', survivor.sponsor)];

  const result = await deleteTenantData(target.sponsor, randomUUID());

  expect(result.errors ?? []).toEqual([]);
  expect(result.success).toBe(true);
  for (const table of ['roles', 'role_permissions', 'user_roles']) expect(await count(table, target.sponsor), table).toBe(0);
  expect(await db('tenants').where({ tenant: target.sponsor }).first()).toBeUndefined();
  expect([await count('roles', survivor.sponsor), await count('role_permissions', survivor.sponsor), await count('user_roles', survivor.sponsor)]).toEqual(survivorBefore);
}, 300_000);

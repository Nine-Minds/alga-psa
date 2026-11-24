/**
 * Protect the co-managed Seat Technician role (plan pl-f68bfdf9, alga-2026-0003429): T003 on real
 * Postgres. The role is inspectable, read-only, where the seat capability is served, hidden from
 * ordinary role discovery where it is not, and never offered by a manual role choice.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ tenant: '', userId: '' }));

vi.mock('../../../../packages/auth/src/lib/withAuth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: testState.userId, tenant: testState.tenant, user_type: 'internal' }, { tenant: testState.tenant }, ...args),
}));
vi.mock('../../../../packages/users/src/lib/withAuth', () => ({
  withAuth: (action: any) => (...args: any[]) =>
    action({ user_id: testState.userId, tenant: testState.tenant, user_type: 'internal' }, { tenant: testState.tenant }, ...args),
}), { virtual: true } as any);
vi.mock('../../../../packages/auth/src/lib/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async () => {
  const actual = await vi.importActual<any>('@alga-psa/db');
  return { ...actual, createTenantKnex: async () => ({ knex: (globalThis as any).__seatRoleVisibilityDb, tenant: testState.tenant }) };
});

import { admitCoManagedSeatRole, acceptCoManagedSeatInvitation, createCoManagedSeatArrangement, inviteCoManagedSeatTechnician } from '@alga-psa/co-managed';
import { coManagedSeatParticipants } from '@alga-psa/co-managed/seatCapability';
import { registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache } from '../../../../packages/core/src/capability/testing';
import { MANAGED_ROLE_MANAGE_PATHS } from '../../../../packages/auth/src/lib/managedRoles';
import { filterRolesByServedCapabilities, omitManagedRoles } from '../../../../packages/auth/src/lib/permissionCapabilities';
import {
  getInspectableRoles, getRolePermissions, getRoles, getUserRoles, getUserRolesBatch,
} from '../../../../packages/auth/src/actions/policyActions';
import { PermissionRoleService } from '../../lib/api/services/PermissionRoleService';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createContact, createTenant, createUser } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));
const english = require('../../../public/locales/en/msp/settings.json');

const DAY = 86_400_000;
const describeDb = await describeWithDb();

describeDb('inspecting the seat role, and never choosing it (T003)', { shuffle: false }, () => {
  let db: Knex;

  const psaTenant = async (label: string) => {
    const tenant = await createTenant(db, `${label} ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, tenant, 'psa');
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity: 10, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    return tenant;
  };
  const actAs = async (tenant: string) => {
    const admin = await createUser(db, tenant, { user_type: 'internal' });
    testState.tenant = tenant;
    testState.userId = admin;
    return admin;
  };
  const names = (roles: Array<{ role_name: string }>) => roles.map((role) => role.role_name);

  beforeAll(async () => {
    db = await createTestDbConnection({ databaseName: 'managed_seat_role_visibility_3429' });
    (globalThis as any).__seatRoleVisibilityDb = db;
    registerCapabilityParticipation('co-managed-seat', ({ tenantIds }) => coManagedSeatParticipants(tenantIds, db));
    process.env.CAPABILITY_CACHE_TTL_MS = '0';
    clearCapabilityCache();
  }, 300_000);
  afterAll(async () => { delete process.env.CAPABILITY_CACHE_TTL_MS; await db?.destroy(); });

  it('shows the role read-only in a served tenant, and nowhere a manual choice is made', async () => {
    const sponsor = await psaTenant('Served sponsor');
    const clientId = await createClient(db, sponsor, `Seat client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: sponsor, clientId, operationId: randomUUID(), seats: 2 });
    const admin = await actAs(sponsor);
    const contactId = await createContact(db, sponsor, clientId, { fullName: 'Dana Reyes', email: `t.${randomUUID().slice(0, 12)}@client.example` });
    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: sponsor, arrangementId: arrangement.arrangement_id, contactId });
    const tech = await acceptCoManagedSeatInvitation(db, { token: invitation.token, password: 'Correct-horse-9-battery' });
    const seatRole = await db('roles').where({ tenant: sponsor, managed_by: 'co-managed-seat' }).first();

    // Manual choices and editable lists never offer it.
    expect(names(await getRoles())).not.toContain('Seat Technician');
    expect(names(await getRoles())).toEqual(expect.arrayContaining(['Admin', 'Technician']));
    const { getAllRoles } = await import('../../../../packages/user-composition/src/actions/userQueryActions');
    expect(names(await getAllRoles())).not.toContain('Seat Technician');
    const { getRoles: getAssignableRoles } = await import('../../../../packages/users/src/lib/roleActions');
    expect(names(await getAssignableRoles())).not.toContain('Seat Technician');
    expect(names(omitManagedRoles(await db('roles').where({ tenant: sponsor })))).not.toContain('Seat Technician');

    // Inspection shows it, marked read-only, with its grants.
    const inspectable = await getInspectableRoles();
    expect(inspectable.find((role) => role.role_name === 'Seat Technician')).toMatchObject({ role_id: seatRole.role_id, managed_by: 'co-managed-seat' });
    const grants = await getRolePermissions(seatRole.role_id);
    expect(grants.map((grant) => `${grant.resource}:${grant.action}`)).toContain('ticket:read');
    // The REST listing marks it too.
    const service = new PermissionRoleService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: sponsor });
    const listed = await service.listRoles({ page: 1, limit: 50 } as any, { tenant: sponsor, userId: admin } as any);
    expect(listed.data.find((role: any) => role.role_name === 'Seat Technician')).toMatchObject({ managed_by: 'co-managed-seat' });

    // A technician's assigned role is shown, marked, so the profile can explain where access is managed.
    expect((await getUserRoles(tech.user_id)).find((role) => role.role_id === seatRole.role_id)).toMatchObject({ managed_by: 'co-managed-seat' });
    expect((await getUserRolesBatch([tech.user_id]))[tech.user_id][0]).toMatchObject({ managed_by: 'co-managed-seat' });

    // The explanation the UI renders exists in the locale, and the arrangement pointer resolves.
    expect(english.managedRole.badge).toBe('Managed by Co-managed IT');
    expect(english.managedRole.scopeHint).toMatch(/boards and projects/);
    expect(MANAGED_ROLE_MANAGE_PATHS['co-managed-seat']).toBe('/msp/co-managed');
    expect(english.errors.roles.managedRole).toMatch(/Co-managed IT/);
  }, 120_000);

  it('hides the role from ordinary discovery in a tenant without the capability, and enforces ownership regardless', async () => {
    const stale = await psaTenant('Unserved tenant');
    await db.transaction((trx) => admitCoManagedSeatRole(trx, stale)); // a role row, but no arrangement: not served
    const admin = await actAs(stale);
    const seatRole = await db('roles').where({ tenant: stale, managed_by: 'co-managed-seat' }).first();

    expect(names(await getInspectableRoles())).not.toContain('Seat Technician');
    expect(names(await getRoles())).not.toContain('Seat Technician');
    expect(names(await filterRolesByServedCapabilities(stale, await db('roles').where({ tenant: stale })))).not.toContain('Seat Technician');
    const service = new PermissionRoleService();
    vi.spyOn(service as any, 'getKnex').mockResolvedValue({ knex: db, tenant: stale });
    const listed = await service.listRoles({ page: 1, limit: 50 } as any, { tenant: stale, userId: admin } as any);
    expect(listed.data.map((role: any) => role.role_name)).not.toContain('Seat Technician');
    expect(listed.total).toBe(listed.data.length);

    // Hidden is not unprotected: the guard does not consult visibility.
    await expect(service.updateRole(seatRole.role_id, { description: 'x' } as any, { tenant: stale, userId: admin } as any))
      .rejects.toMatchObject({ code: 'MANAGED_ROLE_DEFINITION' });

    // A lookalike without the owner marker is an ordinary role to every surface.
    await db('roles').insert({ tenant: stale, role_id: randomUUID(), role_name: 'Seat Technician', msp: true, client: false });
    expect((await getRoles()).filter((role) => role.role_name === 'Seat Technician')).toHaveLength(1);
    expect((await getInspectableRoles()).filter((role) => role.role_name === 'Seat Technician')).toHaveLength(1);
  }, 120_000);
});

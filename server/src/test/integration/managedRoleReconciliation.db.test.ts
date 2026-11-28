/**
 * Reconciliation of legacy seat roles (plan pl-f68bfdf9, alga-2026-0003429): T004 on real Postgres.
 *
 * The migration that introduced `roles.managed_by` derives ownership from evidence, resets the
 * role's grants to exactly the catalog set, keeps legitimate seat assignments, and reports what it
 * cannot decide instead of touching it. A second run changes nothing.
 */
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { Knex } from 'knex';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  acceptCoManagedSeatInvitation, createCoManagedSeatArrangement, CO_MANAGED_SEAT_ROLE_GRANTS, inviteCoManagedSeatTechnician,
} from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { createClient, createContact, createTenant, createUser } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { getDefaultRoles } = require(path.join(permissionsDir, 'roleGrants.cjs'));
const { reconcileManagedRoles } = require('../../../migrations/utils/managedRoleReconciliation.cjs');

const DAY = 86_400_000;
const PASSWORD = 'Correct-horse-9-battery';
const describeDb = await describeWithDb();

describeDb('reconciling legacy seat roles (T004)', { shuffle: false }, () => {
  let db: Knex;

  const sponsorWithArrangement = async (label: string) => {
    const tenant = await createTenant(db, `${label} ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    await db('roles').insert(getDefaultRoles('psa').filter((role: any) => !role.legacy).map((role: any) => ({
      tenant, role_id: randomUUID(), role_name: role.roleName, msp: role.msp, client: role.client,
    })));
    await syncPermissionCatalog(db, tenant, 'psa');
    await db('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`,
      capacity: 10, verified_at: new Date(Date.now() - 400 * DAY), valid_until: new Date(Date.now() + 365 * DAY) });
    const clientId = await createClient(db, tenant, `Seat client ${randomUUID().slice(0, 8)}`);
    const arrangement = await createCoManagedSeatArrangement(db, { sponsorTenant: tenant, clientId, operationId: randomUUID(), seats: 4 });
    return { tenant, clientId, arrangementId: arrangement.arrangement_id };
  };
  const technician = async (s: { tenant: string; clientId: string; arrangementId: string }) => {
    const contactId = await createContact(db, s.tenant, s.clientId, { fullName: 'Dana Reyes', email: `t.${randomUUID().slice(0, 12)}@client.example` });
    const invitation = await inviteCoManagedSeatTechnician(db, { sponsorTenant: s.tenant, arrangementId: s.arrangementId, contactId });
    return acceptCoManagedSeatInvitation(db, { token: invitation.token, password: PASSWORD });
  };
  const seatRoleOf = (tenant: string) => db('roles').where({ tenant, managed_by: 'co-managed-seat' }).first();
  /** The state before ownership existed: the role is a plain row. */
  const makeLegacy = (tenant: string, roleId: string, patch: Record<string, unknown> = {}) =>
    db('roles').where({ tenant, role_id: roleId }).update({ managed_by: null, ...patch });
  const permissionId = async (tenant: string, resource: string, action: string) =>
    (await db('permissions').where({ tenant, resource, action, msp: true, client: false }).first()).permission_id;
  const grantKeys = async (tenant: string, roleId: string) => (await db('role_permissions as rp')
    .join('permissions as p', function () { this.on('p.tenant', 'rp.tenant').andOn('p.permission_id', 'rp.permission_id'); })
    .where({ 'rp.tenant': tenant, 'rp.role_id': roleId }).select('p.resource', 'p.action'))
    .map((row: any) => `${row.resource}:${row.action}`).sort();
  const tenantState = async (tenant: string) => ({
    roles: await db('roles').where({ tenant }).orderBy('role_id'),
    grants: await db('role_permissions').where({ tenant }).orderBy(['role_id', 'permission_id']),
    members: await db('user_roles').where({ tenant }).orderBy(['user_id', 'role_id']),
  });
  const findings = (tenant: string) => db('managed_role_reconciliation_findings').where({ tenant }).whereNull('resolved_at').orderBy('kind');
  const canonical = [...CO_MANAGED_SEAT_ROLE_GRANTS].sort();

  beforeAll(async () => { db = await createTestDbConnection({ databaseName: 'managed_role_reconciliation_3429' }); }, 300_000);
  afterAll(async () => { await db?.destroy(); });

  it('repairs, adopts, reports and leaves alone, then does nothing on a second run', async () => {
    // A. A canonical role with a missing and an extra grant, a live technician, and a hand-assigned non-seat user.
    const a = await sponsorWithArrangement('A canonical');
    const techA = await technician(a);
    const roleA = await seatRoleOf(a.tenant);
    await makeLegacy(a.tenant, roleA.role_id, { description: 'edited by an admin' });
    await db('role_permissions').where({ tenant: a.tenant, role_id: roleA.role_id, permission_id: await permissionId(a.tenant, 'ticket', 'read') }).del();
    await db('role_permissions').insert({ tenant: a.tenant, role_id: roleA.role_id, permission_id: await permissionId(a.tenant, 'user', 'update') });
    const manual = await createUser(db, a.tenant, { user_type: 'internal' });
    await db('user_roles').insert({ tenant: a.tenant, user_id: manual, role_id: roleA.role_id });

    // B. A role renamed long ago, still held by the live technician, beside an unrelated lookalike holding the old name.
    const b = await sponsorWithArrangement('B renamed');
    const techB = await technician(b);
    const roleB = await seatRoleOf(b.tenant);
    await makeLegacy(b.tenant, roleB.role_id, { role_name: 'Client Techs' });
    const lookalikeB = randomUUID();
    await db('roles').insert({ tenant: b.tenant, role_id: lookalikeB, role_name: 'Seat Technician', msp: true, client: false, description: 'mine' });
    await db('role_permissions').insert({ tenant: b.tenant, role_id: lookalikeB, permission_id: await permissionId(b.tenant, 'billing', 'read') });

    // C. No seat history at all: a custom role that happens to share the name.
    const c = await createTenant(db, `C lookalike ${randomUUID().slice(0, 8)}`, { productCode: 'psa' });
    const lookalikeC = randomUUID();
    await db('roles').insert({ tenant: c, role_id: lookalikeC, role_name: 'Seat Technician', msp: true, client: false });
    const memberC = await createUser(db, c, { user_type: 'internal' });
    await db('user_roles').insert({ tenant: c, user_id: memberC, role_id: lookalikeC });

    // D. Seat history, no live technician and two candidates: ambiguous.
    const d = await sponsorWithArrangement('D ambiguous');
    const roleD = await seatRoleOf(d.tenant);
    await makeLegacy(d.tenant, roleD.role_id);
    await db('roles').insert({ tenant: d.tenant, role_id: randomUUID(), role_name: 'Seat Technician', msp: true, client: false });

    // E. A live technician who holds a built-in role: never adopted.
    const e = await sponsorWithArrangement('E builtin');
    const techE = await technician(e);
    const roleE = await seatRoleOf(e.tenant);
    await makeLegacy(e.tenant, roleE.role_id);
    const adminE = (await db('roles').where({ tenant: e.tenant, role_name: 'Admin', msp: true }).first()).role_id;
    await db('user_roles').where({ tenant: e.tenant, user_id: techE.user_id }).del();
    await db('user_roles').insert({ tenant: e.tenant, user_id: techE.user_id, role_id: adminE });

    const stateBefore = {
      b: await tenantState(b.tenant), c: await tenantState(c), d: await tenantState(d.tenant), e: await tenantState(e.tenant),
    };
    const result = await reconcileManagedRoles(db);
    expect(result.reports.length).toBeGreaterThan(0);

    // A: adopted in place (same id), canonical description, exactly the catalog grants, both members kept.
    const afterA = await seatRoleOf(a.tenant);
    expect(afterA).toMatchObject({ role_id: roleA.role_id, role_name: 'Seat Technician', description: expect.stringContaining('Client technician') });
    expect(await grantKeys(a.tenant, roleA.role_id)).toEqual(canonical);
    expect((await db('user_roles').where({ tenant: a.tenant, role_id: roleA.role_id }).pluck('user_id')).sort()).toEqual([techA.user_id, manual].sort());
    expect((await findings(a.tenant)).map((f: any) => f.kind)).toEqual(['non_seat_member']);
    expect((await findings(a.tenant))[0].user_ids).toEqual([manual]);

    // B: the renamed role is the owner (identity preserved), the lookalike is untouched, and the name clash is reported.
    const afterB = await seatRoleOf(b.tenant);
    expect(afterB).toMatchObject({ role_id: roleB.role_id, role_name: 'Client Techs' });
    expect(await grantKeys(b.tenant, roleB.role_id)).toEqual(canonical);
    expect(await db('roles').where({ tenant: b.tenant, role_id: lookalikeB }).first()).toMatchObject({ managed_by: null, description: 'mine' });
    expect(await grantKeys(b.tenant, lookalikeB)).toEqual(['billing:read']);
    expect(await db('user_roles').where({ tenant: b.tenant, role_id: roleB.role_id }).pluck('user_id')).toEqual([techB.user_id]);
    expect((await findings(b.tenant)).map((f: any) => f.kind)).toEqual(['canonical_name_taken']);

    // C: an unrelated lookalike in a tenant with no seat history is untouched, with no finding.
    expect(await tenantState(c)).toEqual(stateBefore.c);
    expect(await findings(c)).toEqual([]);
    expect(stateBefore.b.roles.length).toBeGreaterThan(0);

    // D and E: ambiguity is reported and every row stays as it was.
    expect(await tenantState(d.tenant)).toEqual(stateBefore.d);
    expect((await findings(d.tenant)).map((f: any) => f.kind)).toEqual(['duplicate_candidates']);
    expect(await tenantState(e.tenant)).toEqual(stateBefore.e);
    expect((await findings(e.tenant)).map((f: any) => f.kind)).toEqual(['evidence_role_is_default_role']);
    expect(await db('roles').where({ tenant: e.tenant, managed_by: 'co-managed-seat' }).first()).toBeUndefined();

    // A second run is a no-op: identical rows, identical findings, no repairs reported.
    const settled = {
      a: await tenantState(a.tenant), b: await tenantState(b.tenant), c: await tenantState(c), d: await tenantState(d.tenant), e: await tenantState(e.tenant),
    };
    const findingRows = await db('managed_role_reconciliation_findings').whereIn('tenant', [a.tenant, b.tenant, c, d.tenant, e.tenant]).orderBy(['tenant', 'finding_key']);
    const second = await reconcileManagedRoles(db);
    expect(second.reports.filter((report: any) => [a.tenant, b.tenant, c, d.tenant, e.tenant].includes(report.tenant)).map((report: any) => report.action))
      .toEqual(expect.not.arrayContaining(['adopted', 'repaired']));
    expect({
      a: await tenantState(a.tenant), b: await tenantState(b.tenant), c: await tenantState(c), d: await tenantState(d.tenant), e: await tenantState(e.tenant),
    }).toEqual(settled);
    expect(await db('managed_role_reconciliation_findings').whereIn('tenant', [a.tenant, b.tenant, c, d.tenant, e.tenant]).orderBy(['tenant', 'finding_key']))
      .toEqual(findingRows);

    // Tenant scoping: one tenant's run touches only that tenant.
    await db('role_permissions').insert({ tenant: a.tenant, role_id: roleA.role_id, permission_id: await permissionId(a.tenant, 'user', 'read') });
    await db('role_permissions').insert({ tenant: b.tenant, role_id: roleB.role_id, permission_id: await permissionId(b.tenant, 'user', 'read') });
    await reconcileManagedRoles(db, { tenantId: a.tenant });
    expect(await grantKeys(a.tenant, roleA.role_id)).toEqual(canonical);
    expect(await grantKeys(b.tenant, roleB.role_id)).toEqual([...canonical, 'user:read'].sort());
  }, 300_000);
});

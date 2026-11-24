'use strict';

/**
 * Reconciles capability-owned ("managed") roles with the data deployed before ownership existed
 * (plan pl-f68bfdf9, alga-2026-0003429). Used by the migration that introduced `roles.managed_by`,
 * and safe to run again at any time: a healthy tenant is left exactly as it is.
 *
 * Today the only managed role is the co-managed Seat Technician (`CAPABILITY_ROLES` in
 * `permissions/roleGrants.cjs` is the one list of owners, identities and grants).
 *
 * Ownership is decided from evidence, never from the name alone:
 *
 *   1. A role already marked `managed_by` is the owner's. Nothing else is searched.
 *   2. Otherwise the roles held by users with a LIVE seat assignment are the evidence. When every
 *      live technician holds the same one MSP role, that role is the seat role, whatever it is
 *      called now (it may have been renamed). A default role (Admin, Technician, ...), a role
 *      with client scope, or technicians split across roles is NOT adopted: it is reported.
 *   3. With no live technician but a seat arrangement on record, a single unowned role with the
 *      seat role's exact identity is adopted; several are reported.
 *   4. A tenant with no seat arrangements at all has no seat history: a role that merely has the
 *      name is an unrelated lookalike and is left alone (the guard reserves the name from now on).
 *
 * An adopted role is made canonical: marked, given its canonical name (when free) and description,
 * and its grants are reset to exactly the catalog set (missing added, extra removed). Memberships
 * are never touched: a legitimate seat assignment keeps its role, and a non-seat user who holds
 * the role is reported, not stripped. Whatever cannot be decided is written to
 * `managed_role_reconciliation_findings` for an operator, and nothing it concerns is changed.
 *
 * Tenant-scoped (every statement names its tenant), one transaction per tenant, and no statement
 * updates or deletes by a non-distribution column alone, so it is Citus-safe.
 */

const crypto = require('crypto');
const { tenantDb } = require('./tenantDb.cjs');
const { CAPABILITY_ROLES, getDefaultRoles } = require('./permissions/roleGrants.cjs');

const FINDINGS = 'managed_role_reconciliation_findings';

function managedRoleDefinitions() {
  return Object.values(CAPABILITY_ROLES).flat().filter((role) => role.owner)
    .filter((role, index, all) => all.findIndex((other) => other.owner === role.owner) === index);
}

const lower = (value) => String(value ?? '').trim().toLowerCase();

async function candidateTenants(knex, tenantId, definition) {
  const query = knex.raw(`
    SELECT DISTINCT tenant FROM (
      SELECT tenant FROM roles WHERE managed_by = ? OR (lower(role_name) = ? AND msp = true AND client = false)
      UNION
      SELECT tenant FROM co_managed_seat_arrangements
      UNION
      SELECT tenant FROM co_managed_seat_assignments
    ) evidence
    ${tenantId ? 'WHERE tenant = ?' : ''}
    ORDER BY tenant
  `, tenantId ? [definition.owner, lower(definition.roleName), tenantId] : [definition.owner, lower(definition.roleName)]);
  return (await query).rows.map((row) => row.tenant);
}

const findingKey = (kind, ids) => `${kind}:${crypto.createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 24)}`;

async function reconcileTenant(trx, tenant, definition, log) {
  const db = tenantDb(trx, tenant);
  const defaultIdentities = new Set(getDefaultRoles('psa').map((role) => `${role.msp}:${role.client}:${lower(role.roleName)}`));
  const canonicalName = lower(definition.roleName);
  const report = { tenant, owner: definition.owner, roleId: null, action: 'none', findings: [], changes: { grantsAdded: 0, grantsRemoved: 0, renamed: false, redescribed: false } };
  const find = (kind, detail, roleIds = [], userIds = []) =>
    report.findings.push({ kind, detail, roleIds, userIds, key: findingKey(kind, [...roleIds, ...userIds]) });

  const roles = await db.table('roles').select('role_id', 'role_name', 'description', 'msp', 'client', 'managed_by', 'created_at');
  const [owned, ...extraOwned] = roles.filter((role) => role.managed_by === definition.owner);
  const live = await db.table('co_managed_seat_assignments').whereNot('state', 'revoked').whereNotNull('user_id').pluck('user_id');
  const arrangements = await db.table('co_managed_seat_arrangements').first('arrangement_id');
  const history = Boolean(arrangements) || live.length > 0;

  let role = owned;
  if (extraOwned.length) find('duplicate_owned_role', 'More than one role is marked as owned by the capability; the unique index should prevent this.', [owned, ...extraOwned].map((r) => r.role_id));

  if (!role) {
    const heldByLive = live.length
      ? await db.table('user_roles').whereIn('user_id', live).select('user_id', 'role_id')
      : [];
    const evidenceRoleIds = [...new Set(heldByLive.map((row) => row.role_id))];
    const unowned = roles.filter((candidate) => !candidate.managed_by);
    const lookalikes = unowned.filter((candidate) => candidate.msp === true && candidate.client === false && lower(candidate.role_name) === canonicalName);

    if (evidenceRoleIds.length === 1) {
      const evidence = roles.find((candidate) => candidate.role_id === evidenceRoleIds[0]);
      const identity = `${evidence?.msp}:${evidence?.client}:${lower(evidence?.role_name)}`;
      const everyoneHoldsIt = live.every((userId) => heldByLive.some((row) => row.user_id === userId));
      if (!evidence || evidence.msp !== true || evidence.client !== false) {
        find('evidence_role_wrong_scope', 'The role held by the live seat technicians is not an MSP-only role.', [evidenceRoleIds[0]], live);
      } else if (evidence.managed_by) {
        find('evidence_role_owned_elsewhere', 'The role held by the live seat technicians belongs to another owner.', [evidence.role_id], live);
      } else if (defaultIdentities.has(identity)) {
        find('evidence_role_is_default_role', 'Live seat technicians hold a built-in role; it was not adopted.', [evidence.role_id], live);
      } else if (!everyoneHoldsIt) {
        find('seat_technicians_without_role', 'Some live seat technicians hold no role.', [evidence.role_id], live);
      } else {
        role = evidence;
      }
    } else if (evidenceRoleIds.length > 1) {
      find('seat_technicians_split_across_roles', 'Live seat technicians hold different roles; the seat role cannot be told apart.', evidenceRoleIds, live);
    } else if (history && lookalikes.length === 1) {
      role = lookalikes[0];
    } else if (history && lookalikes.length > 1) {
      find('duplicate_candidates', 'Several roles carry the seat role identity and no seat technician identifies one.', lookalikes.map((r) => r.role_id));
    }
    // No history: a lookalike is an unrelated custom role. Nothing is read from it or written to it.
    // Seat admission (packages/co-managed/src/seatRole.ts, admitCoManagedSeatRole) applies the same rule.

    if (role) {
      await db.table('roles').where({ role_id: role.role_id }).update({ managed_by: definition.owner });
      report.action = 'adopted';
    }
  }

  if (role) {
    report.roleId = role.role_id;
    // Canonical identity: name only while it is free, so a lookalike keeps whatever it holds.
    const others = roles.filter((candidate) => candidate.role_id !== role.role_id);
    const sameName = others.filter((candidate) => candidate.msp === true && candidate.client === false && lower(candidate.role_name) === canonicalName);
    if (role.role_name !== definition.roleName) {
      if (sameName.length) find('canonical_name_taken', 'The seat role cannot take its canonical name: another role holds it.', [role.role_id, ...sameName.map((r) => r.role_id)]);
      else {
        await db.table('roles').where({ role_id: role.role_id }).update({ role_name: definition.roleName });
        report.changes.renamed = true;
      }
    }
    if (role.description !== definition.description) {
      await db.table('roles').where({ role_id: role.role_id }).update({ description: definition.description });
      report.changes.redescribed = true;
    }

    // Exactly the catalog set.
    const wanted = new Set(definition.grants);
    const catalogPermissions = async () => (await db.table('permissions').where({ msp: definition.msp, client: definition.client }).select('permission_id', 'resource', 'action'))
      .filter((permission) => wanted.has(`${permission.resource}:${permission.action}`));
    let permissions = await catalogPermissions();
    if (permissions.length < wanted.size) {
      // A tenant that predates some catalog permissions gets them from catalog synchronization, the one writer of `permissions`.
      const { syncPermissionCatalog } = require('./permissions/syncPermissionCatalog.cjs');
      const synced = await syncPermissionCatalog(trx, tenant, undefined, { onDrift: 'skip' });
      if (synced.skipped) find('catalog_sync_skipped', `Permission catalog synchronization skipped this tenant: ${(synced.reasons || []).join('; ')}`, [role.role_id]);
      permissions = await catalogPermissions();
    }
    const wantedIds = new Set(permissions.map((permission) => permission.permission_id));
    const held = await db.table('role_permissions').where({ role_id: role.role_id }).pluck('permission_id');
    const heldSet = new Set(held);
    const extra = held.filter((id) => !wantedIds.has(id));
    const missing = permissions.filter((permission) => !heldSet.has(permission.permission_id));
    if (extra.length) {
      await db.table('role_permissions').where({ role_id: role.role_id }).whereIn('permission_id', extra).del();
      report.changes.grantsRemoved = extra.length;
    }
    if (missing.length) {
      await db.table('role_permissions').insert(missing.map((permission) => ({ tenant, role_id: role.role_id, permission_id: permission.permission_id })))
        .onConflict(['tenant', 'role_id', 'permission_id']).ignore();
      report.changes.grantsAdded = missing.length;
    }
    if (wantedIds.size < wanted.size) {
      find('catalog_permissions_missing', `${wanted.size - wantedIds.size} catalog permissions do not exist in this tenant; permission catalog synchronization will grant them.`, [role.role_id]);
    }

    // Membership is never rewritten. Report what the lifecycle does not account for.
    const members = await db.table('user_roles').where({ role_id: role.role_id }).pluck('user_id');
    const liveSet = new Set(live);
    const nonSeat = members.filter((userId) => !liveSet.has(userId));
    if (nonSeat.length) find('non_seat_member', 'Users who are not live seat technicians hold the seat role (assigned by hand before ownership existed).', [role.role_id], nonSeat);
    const memberSet = new Set(members);
    const without = live.filter((userId) => !memberSet.has(userId));
    if (without.length) find('seat_technician_without_seat_role', 'Live seat technicians do not hold the seat role.', [role.role_id], without);
    if (report.action === 'none' && (report.changes.grantsAdded || report.changes.grantsRemoved || report.changes.renamed || report.changes.redescribed)) report.action = 'repaired';
  }

  // Findings: record the new ones, resolve the ones that no longer apply. A re-run changes nothing.
  const current = new Set(report.findings.map((finding) => finding.key));
  const existing = await db.table(FINDINGS).where({ owner: definition.owner }).whereNull('resolved_at').select('finding_key');
  for (const row of existing) {
    if (!current.has(row.finding_key)) {
      await db.table(FINDINGS).where({ owner: definition.owner, finding_key: row.finding_key }).whereNull('resolved_at').update({ resolved_at: trx.fn.now() });
    }
  }
  const open = new Set(existing.map((row) => row.finding_key));
  for (const finding of report.findings) {
    if (open.has(finding.key)) continue;
    await db.table(FINDINGS).insert({
      tenant, finding_id: crypto.randomUUID(), owner: definition.owner, kind: finding.kind, finding_key: finding.key,
      detail: finding.detail, role_ids: JSON.stringify(finding.roleIds), user_ids: JSON.stringify(finding.userIds),
    });
    if (log) log(`[managed-role] ${tenant} ${definition.owner}: ${finding.kind}: ${finding.detail}`);
  }
  return report;
}

/**
 * @param {import('knex').Knex} knex
 * @param {{ tenantId?: string, log?: (message: string) => void }} [options]
 * @returns {Promise<{ reports: object[], changed: number, findings: number }>}
 */
async function reconcileManagedRoles(knex, options = {}) {
  const reports = [];
  for (const definition of managedRoleDefinitions()) {
    for (const tenant of await candidateTenants(knex, options.tenantId, definition)) {
      reports.push(await knex.transaction((trx) => reconcileTenant(trx, tenant, definition, options.log)));
    }
  }
  return {
    reports,
    changed: reports.filter((report) => report.action !== 'none').length,
    findings: reports.reduce((total, report) => total + report.findings.length, 0),
  };
}

module.exports = { FINDINGS, reconcileManagedRoles, managedRoleDefinitions };

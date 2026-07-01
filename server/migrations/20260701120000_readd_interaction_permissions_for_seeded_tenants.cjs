/**
 * Re-run the 'interaction' permission backfill for tenants that were provisioned
 * AFTER migration 20260622120000_add_interaction_permissions ran.
 *
 * That migration backfills interaction permission rows for every tenant that
 * exists at migration time. On appliance/on-prem (CE) installs the bootstrap
 * order is: run all migrations against an EMPTY database, then create the first
 * tenant via the onboarding seeds (ee/server/seeds/onboarding/psa). So the
 * backfill was recorded as applied without inserting anything, and the
 * onboarding seeds had no 'interaction' permission defs — leaving the default
 * Admin (and every other role) with no interaction:* grants. Every read of
 * interaction types then failed the ABAC check, which broke the MSP Contacts
 * page and the client-portal invite flow with
 * "Permission denied: Cannot read interaction types" (ticket alga0002048).
 * The same gap applies to any hosted tenant created between 20260622120000 and
 * the onboarding-seed fix that ships alongside this migration.
 *
 * The onboarding seeds now include the interaction defs, so tenants created
 * from this build onward are correct; this migration repairs tenants that were
 * already provisioned. Same idempotent logic as 20260622120000: safe to re-run
 * and a no-op for tenants that already have the rows.
 *
 * Uses raw knex (every query already passes `tenant` explicitly) so the
 * migration runner does not load the @alga-psa/db ESM package.
 */

const INTERACTION_PERMISSION_DEFS = [
  { resource: 'interaction', action: 'create', msp: true, client: false, description: 'Create interactions (calls, notes, check-ins, activity)' },
  { resource: 'interaction', action: 'read', msp: true, client: false, description: 'View interactions' },
  { resource: 'interaction', action: 'update', msp: true, client: false, description: 'Update interactions' },
  { resource: 'interaction', action: 'delete', msp: true, client: false, description: 'Delete interactions' },
];

// Per standard MSP role: which interaction actions to grant. Mirrors the
// distribution used by 20260622120000 and the onboarding/dev seeds: every role
// gets at least 'read'; delete is reserved to Admin/Finance.
const ROLE_ACTIONS = {
  'Admin': ['create', 'read', 'update', 'delete'],
  'Finance': ['create', 'read', 'update', 'delete'],
  'Manager': ['create', 'read', 'update'],
  'Project Manager': ['create', 'read', 'update'],
  'Dispatcher': ['create', 'read', 'update'],
  'Technician': ['create', 'read', 'update'],
};

async function ensurePermission(knex, tenant, def) {
  const existing = await knex('permissions')
    .where({ tenant, resource: def.resource, action: def.action })
    .first();

  if (existing) {
    if (existing.msp !== def.msp || existing.client !== def.client || existing.description !== def.description) {
      await knex('permissions')
        .where({ tenant, permission_id: existing.permission_id })
        .update({
          msp: def.msp,
          client: def.client,
          description: def.description,
          updated_at: knex.fn.now(),
        });
    }

    return existing.permission_id;
  }

  const [inserted] = await knex('permissions')
    .insert({
      tenant,
      resource: def.resource,
      action: def.action,
      msp: def.msp,
      client: def.client,
      description: def.description,
      created_at: knex.fn.now(),
    })
    .returning('permission_id');

  return inserted.permission_id;
}

async function assignPermission(knex, tenant, roleId, permissionId) {
  const existing = await knex('role_permissions')
    .where({ tenant, role_id: roleId, permission_id: permissionId })
    .first('tenant');

  if (existing) {
    return;
  }

  await knex('role_permissions').insert({
    tenant,
    role_id: roleId,
    permission_id: permissionId,
    created_at: knex.fn.now(),
  });
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    // 1) Ensure all four interaction permission rows exist for this tenant.
    const permissionIdByAction = {};
    for (const def of INTERACTION_PERMISSION_DEFS) {
      permissionIdByAction[def.action] = await ensurePermission(knex, tenant, def);
    }

    // 2) Grant the per-role action set to each matching MSP role.
    const roles = await knex('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', Object.keys(ROLE_ACTIONS))
      .select('role_id', 'role_name');

    for (const role of roles) {
      const actions = ROLE_ACTIONS[role.role_name] || [];
      for (const action of actions) {
        const permissionId = permissionIdByAction[action];
        if (permissionId) {
          await assignPermission(knex, tenant, role.role_id, permissionId);
        }
      }
    }
  }
};

exports.down = async function down(knex) {
  // Intentionally a no-op: the permission rows may predate this migration
  // (created by 20260622120000 or the onboarding seeds), so deleting them here
  // could strip grants this migration did not create.
};

/**
 * Add RBAC permissions for the 'interaction' resource.
 *
 * The interaction server actions (getRecentInteractions, getInteractionsForEntity,
 * getInteractionTypes, getInteractionStatuses, addInteraction, updateInteraction,
 * deleteInteraction in packages/clients/src/actions/interactionActions.ts) authorize
 * against resource 'interaction' via assertMspPermission(user, 'interaction', <action>).
 * Those gates were introduced by the server-action RBAC audit (#2743 and related),
 * but no tenant ever received permission rows for the 'interaction' resource:
 *   - The comprehensive-permissions migration (20250619120000) that defines them was
 *     first applied to existing tenants from an image built before the 'interaction'
 *     defs were committed, so knex marked it complete and never inserted those rows.
 *   - New-tenant provisioning has no 'interaction' entry in its permission set.
 * Result: every interaction read/write returned "Permission denied: Cannot read
 * interactions" for ALL MSP users in ALL tenants — even Admins, with nothing to grant
 * through the UI. Interactions silently rendered empty (the client feed swallows the
 * action error), so customers reported that their interactions had "vanished" even
 * though the underlying rows were intact.
 *
 * This migration backfills the 'interaction' permission rows for every tenant and
 * grants them to MSP roles, mirroring the existing 'contact'/'ticket' (CRM activity)
 * distribution so prior behaviour — every internal user can at least read interactions
 * — is restored. Idempotent: safe to re-run and safe for tenants that already have
 * some/all of the rows. Adjust ROLE_ACTIONS if a tenant uses custom role names.
 */

const INTERACTION_PERMISSION_DEFS = [
  { resource: 'interaction', action: 'create', msp: true, client: false, description: 'Create interactions (calls, notes, check-ins, activity)' },
  { resource: 'interaction', action: 'read', msp: true, client: false, description: 'View interactions' },
  { resource: 'interaction', action: 'update', msp: true, client: false, description: 'Update interactions' },
  { resource: 'interaction', action: 'delete', msp: true, client: false, description: 'Delete interactions' },
];

// Per standard MSP role: which interaction actions to grant. Mirrors the existing
// contact/ticket CRM-activity model. Every role gets at least 'read' so interactions
// stop rendering empty; delete is reserved to Admin/Finance.
const ROLE_ACTIONS = {
  'Admin': ['create', 'read', 'update', 'delete'],
  'Finance': ['create', 'read', 'update', 'delete'],
  'Manager': ['create', 'read', 'update'],
  'Project Manager': ['create', 'read', 'update'],
  'Dispatcher': ['create', 'read', 'update'],
  'Technician': ['create', 'read', 'update'],
};
const MIGRATION_TENANT = 'migration:20260622120000_add_interaction_permissions';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for interaction permission backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

async function ensurePermission(knex, db, tenant, def) {
  const existing = await db.table('permissions')
    .where({ tenant, resource: def.resource, action: def.action })
    .first();

  if (existing) {
    if (existing.msp !== def.msp || existing.client !== def.client || existing.description !== def.description) {
      await db.table('permissions')
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

  const [inserted] = await db.table('permissions')
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

async function assignPermission(knex, db, tenant, roleId, permissionId) {
  const existing = await db.table('role_permissions')
    .where({ tenant, role_id: roleId, permission_id: permissionId })
    .first('tenant');

  if (existing) {
    return;
  }

  await db.table('role_permissions').insert({
    tenant,
    role_id: roleId,
    permission_id: permissionId,
    created_at: knex.fn.now(),
  });
}

exports.up = async function up(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    // 1) Ensure all four interaction permission rows exist for this tenant.
    const permissionIdByAction = {};
    for (const def of INTERACTION_PERMISSION_DEFS) {
      permissionIdByAction[def.action] = await ensurePermission(knex, db, tenant, def);
    }

    // 2) Grant the per-role action set to each matching MSP role.
    const roles = await db.table('roles')
      .where({ tenant, msp: true })
      .whereIn('role_name', Object.keys(ROLE_ACTIONS))
      .select('role_id', 'role_name');

    for (const role of roles) {
      const actions = ROLE_ACTIONS[role.role_name] || [];
      for (const action of actions) {
        const permissionId = permissionIdByAction[action];
        if (permissionId) {
          await assignPermission(knex, db, tenant, role.role_id, permissionId);
        }
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  const actions = INTERACTION_PERMISSION_DEFS.map((def) => def.action);

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = await db.table('permissions')
      .where({ tenant, resource: 'interaction' })
      .whereIn('action', actions)
      .pluck('permission_id');

    if (!permissionIds.length) {
      continue;
    }

    await db.table('role_permissions')
      .where({ tenant })
      .whereIn('permission_id', permissionIds)
      .del();

    await db.table('permissions')
      .where({ tenant, resource: 'interaction' })
      .whereIn('action', actions)
      .del();
  }
};

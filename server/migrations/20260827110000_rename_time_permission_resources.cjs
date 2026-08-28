/**
 * Rename the three RBAC resources whose stored spelling disagreed with the rest
 * of the system: `timeentry` -> `time_entry`, `timesheet` -> `time_sheet` and
 * `timeperiod` -> `time_period`.
 *
 * Everything else already used the underscored names — the `time_entries` /
 * `time_sheets` / `time_periods` tables, the search object types, the
 * authorization kernel's resource types, the v1 API resources, the
 * deletion-config keys. RBAC bridged the gap at check time with a
 * RESOURCE_CANONICAL_MAP that had been copy-pasted into six modules and was NOT
 * present in all of them, so the same permission resolved differently depending
 * on which hasPermission() a caller reached — and it never listed `timeperiod`
 * at all, so every v1 time-period endpoint denied every caller. This migration
 * makes the stored names match the code so that translation layer can be (and
 * is) deleted.
 *
 * A rename, not a re-provision: `permission_id` is preserved, so every existing
 * grant — including grants on tenant-authored custom roles — follows the
 * permission. Rows are only removed where a tenant already carries BOTH
 * spellings of one identity; there the grants are merged onto the canonical row
 * first, so no role loses access.
 *
 * `timeentry_settings` is a different resource (retired, unenforced) and is
 * deliberately left alone.
 */

const { RENAMED_RESOURCES } = require('./utils/permissions/catalog.cjs');

const PERMISSION_COLUMNS = ['permission_id', 'tenant', 'action', 'msp', 'client'];

function identityKey(row) {
  return [row.tenant, row.action, row.msp ? 'msp' : '-', row.client ? 'client' : '-'].join('|');
}

exports.up = async function up(knex) {
  for (const [legacy, canonical] of Object.entries(RENAMED_RESOURCES)) {
    const legacyRows = await knex('permissions').where({ resource: legacy }).select(PERMISSION_COLUMNS);
    if (legacyRows.length === 0) continue;

    const canonicalRows = await knex('permissions').where({ resource: canonical }).select(PERMISSION_COLUMNS);
    const canonicalByIdentity = new Map(canonicalRows.map((row) => [identityKey(row), row.permission_id]));

    let renamed = 0;
    let merged = 0;

    for (const row of legacyRows) {
      const twin = canonicalByIdentity.get(identityKey(row));

      if (!twin) {
        await knex('permissions')
          .where({ tenant: row.tenant, permission_id: row.permission_id })
          .update({ resource: canonical });
        canonicalByIdentity.set(identityKey(row), row.permission_id);
        renamed += 1;
        continue;
      }

      // Both spellings exist for this tenant: move the legacy grants onto the
      // surviving row before dropping it, so no role loses the permission.
      const grants = await knex('role_permissions')
        .where({ tenant: row.tenant, permission_id: row.permission_id })
        .select('role_id');

      if (grants.length > 0) {
        await knex('role_permissions')
          .insert(grants.map((grant) => ({ tenant: row.tenant, role_id: grant.role_id, permission_id: twin })))
          .onConflict(['tenant', 'role_id', 'permission_id'])
          .ignore();
        await knex('role_permissions')
          .where({ tenant: row.tenant, permission_id: row.permission_id })
          .del();
      }

      await knex('permissions').where({ tenant: row.tenant, permission_id: row.permission_id }).del();
      merged += 1;
    }

    console.log(
      `[rename_time_permission_resources] ${legacy} -> ${canonical}: ${renamed} renamed, `
      + `${merged} merged into an existing ${canonical} row`,
    );
  }
};

exports.down = async function down(knex) {
  // Reversible: the inverse rename restores the legacy spelling. Rows merged on
  // the way up stay merged — the duplicate they collided with was never the
  // catalog identity, and recreating it would reintroduce the ambiguity this
  // migration exists to remove.
  for (const [legacy, canonical] of Object.entries(RENAMED_RESOURCES)) {
    await knex('permissions').where({ resource: canonical }).update({ resource: legacy });
  }
};

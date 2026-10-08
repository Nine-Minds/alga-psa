'use strict';

/**
 * Client-portal manager scope (alga-2026-0002577).
 *
 *  - contacts.manager_contact_id: reports-to hierarchy ("my staff"). Same-client
 *    and acyclic are enforced by the application (assertValidContactManager);
 *    the database guarantees the manager exists in the tenant and is not self.
 *  - client_portal_visibility_groups.asset_scope / project_scope: opt-in, default
 *    'client' (no behaviour change for existing groups).
 *  - assets.contact_name_id: the one contact an asset is assigned to.
 *
 * Both new FKs are composite on (tenant, ...) with NO ACTION. SET NULL on a
 * composite FK also nulls `tenant` (and Citus refuses it), so the application
 * clears these references itself on contact delete / client change.
 *
 * Idempotent and safe to re-run: every step is guarded.
 */
exports.config = { transaction: false };

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = ? AND conrelid = ?::regclass
     ) AS present`,
    [constraintName, tableName],
  );
  return Boolean(result.rows?.[0]?.present);
}

async function isDistributed(knex, tableName) {
  const result = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
     ) AS is_distributed`,
    [tableName],
  );
  return Boolean(result.rows?.[0]?.is_distributed);
}

/**
 * An FK between a distributed and a non-distributed table is rejected by Citus
 * (outside reference-table cases). Mirror 20260518120000_add_location_id_to_assets:
 * add the FK on plain Postgres, or when both tables share the same status.
 */
async function distributionCompatible(knex, a, b) {
  const citus = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS has_citus`);
  if (!citus.rows?.[0]?.has_citus) return true;
  const [aDistributed, bDistributed] = [await isDistributed(knex, a), await isDistributed(knex, b)];
  return aDistributed === bDistributed;
}

async function addConstraint(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

exports.up = async function up(knex) {
  // --- contacts.manager_contact_id -----------------------------------------
  await knex.raw('ALTER TABLE contacts ADD COLUMN IF NOT EXISTS manager_contact_id uuid NULL');

  if (await distributionCompatible(knex, 'contacts', 'contacts')) {
    await addConstraint(
      knex,
      'contacts',
      'contacts_tenant_manager_contact_id_foreign',
      // NO ACTION on purpose; see header.
      'FOREIGN KEY (tenant, manager_contact_id) REFERENCES contacts (tenant, contact_name_id)',
    );
  }
  await addConstraint(
    knex,
    'contacts',
    'contacts_manager_not_self_check',
    'CHECK (manager_contact_id IS NULL OR manager_contact_id <> contact_name_id)',
  );
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contacts_tenant_manager_contact_id
    ON contacts (tenant, manager_contact_id) WHERE manager_contact_id IS NOT NULL`);

  // --- visibility group scopes ---------------------------------------------
  for (const column of ['asset_scope', 'project_scope']) {
    if (!(await knex.schema.hasColumn('client_portal_visibility_groups', column))) {
      await knex.raw(
        `ALTER TABLE client_portal_visibility_groups ADD COLUMN ${column} text NOT NULL DEFAULT 'client'`,
      );
    }
    await addConstraint(
      knex,
      'client_portal_visibility_groups',
      `client_portal_visibility_groups_${column}_check`,
      `CHECK (${column} IN ('client', 'contact'))`,
    );
  }

  // --- assets.contact_name_id ----------------------------------------------
  await knex.raw('ALTER TABLE assets ADD COLUMN IF NOT EXISTS contact_name_id uuid NULL');

  if (await distributionCompatible(knex, 'assets', 'contacts')) {
    await addConstraint(
      knex,
      'assets',
      'assets_tenant_contact_name_id_foreign',
      'FOREIGN KEY (tenant, contact_name_id) REFERENCES contacts (tenant, contact_name_id)',
    );
  } else {
    console.log('assets and contacts have incompatible distribution - skipping assets.contact_name_id foreign key');
  }
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_tenant_client_contact
    ON assets (tenant, client_id, contact_name_id)`);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_assets_tenant_client_contact');
  await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_tenant_contact_name_id_foreign');
  await knex.raw('ALTER TABLE assets DROP COLUMN IF EXISTS contact_name_id');

  for (const column of ['project_scope', 'asset_scope']) {
    await knex.raw(
      `ALTER TABLE client_portal_visibility_groups DROP CONSTRAINT IF EXISTS client_portal_visibility_groups_${column}_check`,
    );
    await knex.raw(`ALTER TABLE client_portal_visibility_groups DROP COLUMN IF EXISTS ${column}`);
  }

  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_contacts_tenant_manager_contact_id');
  await knex.raw('ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_manager_not_self_check');
  await knex.raw('ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_tenant_manager_contact_id_foreign');
  await knex.raw('ALTER TABLE contacts DROP COLUMN IF EXISTS manager_contact_id');
};

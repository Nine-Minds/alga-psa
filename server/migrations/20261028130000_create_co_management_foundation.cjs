/**
 * Co-managed IT foundation (CM L1a): relationships, sponsor entitlements, seat
 * allocations and the proposed board scopes.
 *
 * Design of record: docs/plans/2026-10-26-cm-l1a-plan.md Annex A.1.
 *
 * - Every table carries `tenant`, is distributed on it (colocated with `tenants`
 *   on Citus) and has NO foreign keys. `reserveCoManagedWorkspace` inserts the
 *   relationship before the customer `tenants` row exists, and cross-tenant
 *   FKs are deliberately not modelled. Invariants live in CHECKs and app code
 *   (no triggers: Citus skips them).
 * - `co_management_relationships.tenant` is the CUSTOMER workspace;
 *   `co_managed_entitlements.tenant` and `co_managed_allocations.tenant` are the
 *   SPONSOR.
 * - Widens `tenants.product_code` to admit 'co_managed' as a NOT VALID CHECK
 *   under a temporary name. 20261028133000 validates it and re-adds the
 *   original name with the widened check; 20261028134000 validates that and
 *   drops the temporary one (no RENAME: Citus refuses it on distributed
 *   tables). Skipped when the live constraint already admits 'co_managed'.
 * - No permission or role_permission is written here (DO-NOT-PORT #27);
 *   permissions are seeded per sponsor at admission.
 *
 * Idempotent; safe to re-run over an already migrated database.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLES = [
  'co_management_relationships',
  'co_managed_entitlements',
  'co_managed_allocations',
  'co_management_board_scopes',
];

const PRODUCT_CHECK = 'tenants_product_code_check';
const PRODUCT_CHECK_NEXT = 'tenants_product_code_check_co_managed';

async function constraintDef(knex, name) {
  const { rows } = await knex.raw(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ? AND conrelid = 'tenants'::regclass`,
    [name]
  );
  return rows.length ? rows[0].def : null;
}

async function widenTenantProductCheck(knex) {
  if (!(await knex.schema.hasTable('tenants')) || !(await knex.schema.hasColumn('tenants', 'product_code'))) return;
  const live = await constraintDef(knex, PRODUCT_CHECK);
  if (live && live.includes('co_managed')) return;
  if (await constraintDef(knex, PRODUCT_CHECK_NEXT)) return;
  // One utility statement per raw call: `tenants` is distributed on Citus.
  await knex.raw(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${PRODUCT_CHECK_NEXT}`);
  await knex.raw(`
    ALTER TABLE tenants ADD CONSTRAINT ${PRODUCT_CHECK_NEXT}
      CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk', 'co_managed')) NOT VALID
  `);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('co_management_relationships'))) {
    await knex.schema.createTable('co_management_relationships', (table) => {
      table.uuid('tenant').notNullable(); // Owning customer workspace.
      table.uuid('relationship_id').notNullable();
      table.uuid('sponsor_tenant').notNullable();
      table.uuid('sponsor_client_id').notNullable();
      table.text('state').notNullable().defaultTo('provisioning');
      table.text('visibility_mode').notNullable().defaultTo('board_scope');
      table.uuid('escalation_board_id').nullable(); // Sponsor-local board; qualified by sponsor_tenant.
      table.integer('revision').notNullable().defaultTo(1);
      table.uuid('accepted_by').nullable(); // Customer-local user identity.
      table.timestamp('accepted_at', { useTz: true }).nullable();
      table.timestamp('ended_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'relationship_id']);
      table.check('tenant <> sponsor_tenant', [], 'co_management_distinct_parties');
      table.check("state IN ('provisioning', 'pending_acceptance', 'active', 'terminated')");
      table.check("visibility_mode IN ('board_scope', 'escalation_only')");
      table.check('revision > 0');
      table.check('(accepted_at IS NULL) = (accepted_by IS NULL)');
      table.check("state <> 'active' OR accepted_at IS NOT NULL");
      table.check("(state = 'terminated') = (ended_at IS NOT NULL)");
    });
  }
  await knex.raw(`CREATE INDEX IF NOT EXISTS co_management_relationships_sponsor_tenant_tenant_index
    ON co_management_relationships (sponsor_tenant, tenant)`);
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_management_one_live_sponsor
    ON co_management_relationships (tenant) WHERE ended_at IS NULL`);

  if (!(await knex.schema.hasTable('co_managed_entitlements'))) {
    await knex.schema.createTable('co_managed_entitlements', (table) => {
      table.uuid('tenant').primary(); // Sponsoring MSP.
      table.text('source').notNullable();
      table.text('source_reference').notNullable();
      table.integer('capacity').notNullable();
      // Self-host capacity is reverified from this token, never the unsigned counter.
      table.text('signed_license').nullable();
      // Signed license issue time prevents delayed refreshes replacing a newer license.
      table.bigInteger('source_version').notNullable().defaultTo(0);
      table.timestamp('verified_at', { useTz: true }).notNullable();
      table.timestamp('valid_until', { useTz: true }).notNullable();
      table.timestamp('lapse_started_at', { useTz: true }).nullable();
      table.timestamp('read_only_after', { useTz: true }).nullable();
      table.integer('revision').notNullable().defaultTo(1);
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.check("source IN ('hosted', 'self_host', 'admin_grant')");
      table.check('capacity >= 0');
      table.check('revision > 0');
      table.check("source <> 'self_host' OR signed_license IS NOT NULL");
      table.check('(lapse_started_at IS NULL) = (read_only_after IS NULL)');
    });
  }

  if (!(await knex.schema.hasTable('co_managed_allocations'))) {
    await knex.schema.createTable('co_managed_allocations', (table) => {
      table.uuid('tenant').notNullable(); // Sponsoring MSP; lock its entitlement row.
      table.uuid('allocation_id').notNullable();
      table.uuid('operation_id').notNullable();
      table.text('request_fingerprint').notNullable(); // Immutable original provisioning request.
      table.uuid('customer_tenant').notNullable();
      table.uuid('relationship_id').notNullable();
      table.integer('seats').notNullable();
      table.text('state').notNullable().defaultTo('reserved');
      table.timestamp('released_at', { useTz: true }).nullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'allocation_id']);
      table.unique(['tenant', 'operation_id']); // The idempotency record.
      table.check('tenant <> customer_tenant');
      table.check('seats >= 1'); // Reserves the initial customer administrator.
      table.check("request_fingerprint ~ '^[0-9a-f]{64}$'");
      table.check("state IN ('reserved', 'active', 'released')");
      table.check("(state = 'released') = (released_at IS NOT NULL)");
    });
  }
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_managed_one_live_allocation
    ON co_managed_allocations (tenant, customer_tenant) WHERE state <> 'released'`);

  if (!(await knex.schema.hasTable('co_management_board_scopes'))) {
    await knex.schema.createTable('co_management_board_scopes', (table) => {
      table.uuid('tenant').notNullable(); // Customer-owned, explicitly selected boards.
      table.uuid('relationship_id').notNullable();
      table.uuid('board_id').notNullable();
      table.boolean('can_collaborate').notNullable().defaultTo(true);
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'relationship_id', 'board_id']);
    });
  }

  for (const table of TABLES) await ensureTenantDistribution(knex, table);

  await widenTenantProductCheck(knex);
};

exports.down = async function down(knex) {
  // Never silently turn customer workspaces into unrestricted PSA tenants, or
  // discard live trust/capacity when an operator rolls back a migration.
  if (await knex.schema.hasColumn('tenants', 'product_code')) {
    const customers = await knex('tenants').where('product_code', 'co_managed').first();
    if (customers) throw new Error('Cannot roll back co-management while customer workspaces exist');
  }
  for (const table of TABLES) {
    if ((await knex.schema.hasTable(table)) && (await knex(table).first())) {
      throw new Error(`Cannot roll back nonempty ${table}`);
    }
  }
  for (const table of [...TABLES].reverse()) await knex.schema.dropTable(table);
  await knex.raw(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${PRODUCT_CHECK_NEXT}`);
  const live = await constraintDef(knex, PRODUCT_CHECK);
  if (live && live.includes('co_managed')) {
    await knex.raw(`ALTER TABLE tenants DROP CONSTRAINT IF EXISTS ${PRODUCT_CHECK}`);
    await knex.raw(`
      ALTER TABLE tenants ADD CONSTRAINT ${PRODUCT_CHECK}
        CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk'))
    `);
  }
};

// Citus distribution is performed outside Knex's migration transaction.
exports.config = { transaction: false };

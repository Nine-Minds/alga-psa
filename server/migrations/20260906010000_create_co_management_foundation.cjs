/**
 * Relationships belong to customers; capacity and reservations belong to sponsors.
 * Qualified foreign identities deliberately have no cross-tenant foreign keys.
 * A sponsor-locked service must enforce capacity sums and cross-tenant eligibility.
 */
const TABLES = [
  'co_management_relationships',
  'co_managed_entitlements',
  'co_managed_allocations',
];

exports.up = async function up(knex) {
  await knex.raw(`
    ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_product_code_check;
    ALTER TABLE tenants ADD CONSTRAINT tenants_product_code_check
      CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk', 'co_managed'));
  `);

  if (!await knex.schema.hasTable('co_management_relationships')) await knex.schema.createTable('co_management_relationships', (table) => {
    table.uuid('tenant').notNullable(); // Owning customer workspace.
    table.uuid('relationship_id').notNullable();
    table.uuid('sponsor_tenant').notNullable();
    table.uuid('sponsor_client_id').notNullable();
    table.text('state').notNullable().defaultTo('provisioning');
    table.text('visibility_mode').notNullable().defaultTo('board_scope');
    table.integer('revision').notNullable().defaultTo(1);
    table.uuid('accepted_by').nullable(); // Customer-local user identity.
    table.timestamp('accepted_at', { useTz: true }).nullable();
    table.timestamp('ended_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'relationship_id']);
    table.index(['sponsor_tenant', 'tenant']);
    table.check('tenant <> sponsor_tenant', [], 'co_management_distinct_parties');
    table.check("state IN ('provisioning', 'pending_acceptance', 'active', 'terminated')");
    table.check("visibility_mode IN ('board_scope', 'escalation_only')");
    table.check('revision > 0');
    table.check('(accepted_at IS NULL) = (accepted_by IS NULL)');
    table.check("state <> 'active' OR accepted_at IS NOT NULL");
    table.check("(state = 'terminated') = (ended_at IS NOT NULL)");
  });
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_management_one_live_sponsor
    ON co_management_relationships (tenant) WHERE ended_at IS NULL`);

  if (!await knex.schema.hasTable('co_managed_entitlements')) await knex.schema.createTable('co_managed_entitlements', (table) => {
    table.uuid('tenant').primary(); // Sponsoring MSP.
    table.text('source').notNullable();
    table.text('source_reference').notNullable();
    table.integer('capacity').notNullable();
    // Self-host capacity is reverified from this token, never the unsigned counter.
    table.text('signed_license').nullable();
    table.timestamp('verified_at', { useTz: true }).notNullable();
    table.timestamp('valid_until', { useTz: true }).notNullable();
    table.timestamp('lapse_started_at', { useTz: true }).nullable();
    table.timestamp('read_only_after', { useTz: true }).nullable();
    table.integer('revision').notNullable().defaultTo(1);
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.check("source IN ('hosted', 'self_host')");
    table.check('capacity >= 0');
    table.check('revision > 0');
    table.check("source <> 'self_host' OR signed_license IS NOT NULL");
    table.check('(lapse_started_at IS NULL) = (read_only_after IS NULL)');
    table.check("read_only_after IS NULL OR read_only_after = lapse_started_at + interval '720 hours'");
  });

  if (!await knex.schema.hasTable('co_managed_allocations')) await knex.schema.createTable('co_managed_allocations', (table) => {
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
    table.unique(['tenant', 'operation_id']);
    table.check('tenant <> customer_tenant');
    table.check('seats >= 1'); // Reserves the initial customer administrator.
    table.check("request_fingerprint ~ '^[0-9a-f]{64}$'");
    table.check("state IN ('reserved', 'active', 'released')");
    table.check("(state = 'released') = (released_at IS NOT NULL)");
  });
  await knex.raw(`CREATE UNIQUE INDEX IF NOT EXISTS co_managed_one_live_allocation
    ON co_managed_allocations (tenant, customer_tenant) WHERE state <> 'released'`);

  const citus = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS installed");
  if (citus.rows[0].installed) {
    for (const table of TABLES) {
      const distributed = await knex.raw('SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass', [table]);
      if (!distributed.rows.length) {
        await knex.raw("SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'tenants')", [table]);
      }
    }
  }
};

exports.down = async function down(knex) {
  // Never silently turn customer workspaces into unrestricted PSA tenants, or
  // discard live trust/capacity when an operator rolls back a migration.
  const customers = await knex('tenants').where('product_code', 'co_managed').first();
  if (customers) throw new Error('Cannot roll back co-management while customer workspaces exist');
  for (const table of TABLES) {
    if (await knex(table).first()) throw new Error(`Cannot roll back nonempty ${table}`);
  }
  for (const table of [...TABLES].reverse()) await knex.schema.dropTable(table);
  await knex.raw(`
    ALTER TABLE tenants DROP CONSTRAINT tenants_product_code_check;
    ALTER TABLE tenants ADD CONSTRAINT tenants_product_code_check
      CHECK (product_code IS NOT NULL AND product_code IN ('psa', 'algadesk'));
  `);
};

// Citus distribution is performed outside Knex's migration transaction.
exports.config = { transaction: false };

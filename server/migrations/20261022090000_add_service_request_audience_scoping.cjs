/**
 * Service request audience scoping (2026-10-22)
 *
 * See docs/plans/2026-10-22-service-requests-form-client-scoping.md §2.
 *
 *  - service_request_definitions.audience_mode ('all' | 'scoped', default 'all')
 *  - service_request_audience_clients        definition -> allowed clients
 *  - service_request_audience_client_groups  definition -> allowed client portal visibility groups
 *
 * 'all' means everyone (existing forms unchanged); 'scoped' with zero rows means nobody.
 * No backfill; versions table is untouched (audience is a live access policy).
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

async function addForeignKeyIfMissing(knex, constraintName, sql) {
  await knex.raw(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = '${constraintName}'
      ) THEN
        ${sql};
      END IF;
    END $$;
  `);
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('service_request_definitions', 'audience_mode'))) {
    await knex.raw(`
      ALTER TABLE service_request_definitions
      ADD COLUMN audience_mode text NOT NULL DEFAULT 'all'
    `);
    await knex.raw(`
      ALTER TABLE service_request_definitions
      ADD CONSTRAINT service_request_definitions_audience_mode_check
      CHECK (audience_mode IN ('all', 'scoped'))
    `);
  }

  if (!(await knex.schema.hasTable('service_request_audience_clients'))) {
    await knex.schema.createTable('service_request_audience_clients', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('definition_id').notNullable();
      table.uuid('client_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'definition_id', 'client_id']);
    });
    await knex.raw(`
      CREATE INDEX idx_service_request_audience_clients_tenant_client
      ON service_request_audience_clients (tenant, client_id)
    `);
  }

  if (!(await knex.schema.hasTable('service_request_audience_client_groups'))) {
    await knex.schema.createTable('service_request_audience_client_groups', (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('definition_id').notNullable();
      table.uuid('group_id').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'definition_id', 'group_id']);
    });
    await knex.raw(`
      CREATE INDEX idx_service_request_audience_client_groups_tenant_group
      ON service_request_audience_client_groups (tenant, group_id)
    `);
  }

  // Distribute before FKs — Citus requires both sides distributed first.
  await ensureTenantDistribution(knex, 'service_request_audience_clients');
  await ensureTenantDistribution(knex, 'service_request_audience_client_groups');

  await addForeignKeyIfMissing(knex, 'service_request_audience_clients_tenant_fkey', `
    ALTER TABLE service_request_audience_clients
      ADD CONSTRAINT service_request_audience_clients_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_audience_clients_definition_fkey', `
    ALTER TABLE service_request_audience_clients
      ADD CONSTRAINT service_request_audience_clients_definition_fkey
      FOREIGN KEY (tenant, definition_id)
      REFERENCES service_request_definitions (tenant, definition_id) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_audience_clients_client_fkey', `
    ALTER TABLE service_request_audience_clients
      ADD CONSTRAINT service_request_audience_clients_client_fkey
      FOREIGN KEY (tenant, client_id)
      REFERENCES clients (tenant, client_id) ON DELETE CASCADE
  `);

  await addForeignKeyIfMissing(knex, 'service_request_audience_client_groups_tenant_fkey', `
    ALTER TABLE service_request_audience_client_groups
      ADD CONSTRAINT service_request_audience_client_groups_tenant_fkey
      FOREIGN KEY (tenant) REFERENCES tenants(tenant) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_audience_client_groups_definition_fkey', `
    ALTER TABLE service_request_audience_client_groups
      ADD CONSTRAINT service_request_audience_client_groups_definition_fkey
      FOREIGN KEY (tenant, definition_id)
      REFERENCES service_request_definitions (tenant, definition_id) ON DELETE CASCADE
  `);
  await addForeignKeyIfMissing(knex, 'service_request_audience_client_groups_group_fkey', `
    ALTER TABLE service_request_audience_client_groups
      ADD CONSTRAINT service_request_audience_client_groups_group_fkey
      FOREIGN KEY (tenant, group_id)
      REFERENCES client_portal_visibility_groups (tenant, group_id) ON DELETE CASCADE
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('service_request_audience_client_groups');
  await knex.schema.dropTableIfExists('service_request_audience_clients');
  await knex.raw(`
    ALTER TABLE service_request_definitions
    DROP CONSTRAINT IF EXISTS service_request_definitions_audience_mode_check
  `);
  await knex.raw(`ALTER TABLE service_request_definitions DROP COLUMN IF EXISTS audience_mode`);
};

// Citus requires FK manipulation to run outside a transaction block.
exports.config = { transaction: false };

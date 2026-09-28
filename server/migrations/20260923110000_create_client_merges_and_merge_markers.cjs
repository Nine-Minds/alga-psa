'use strict';

/**
 * Client merge audit trail and tombstone markers (M003, M004).
 *
 * A merge is not reversible (operator decision Q4) — which raises the bar on
 * being *explainable*. Six months later someone will ask why an invoice for a
 * site they have never heard of is attached to this client. `client_merges`
 * answers that: which client was absorbed, which billing profiles came with it,
 * how many rows of each kind moved, what was decided about each contract, who
 * did it and when.
 *
 * `clients.merged_into_client_id` is the other half. A stale bookmark, an old
 * API caller or a report still holding the source's id lands on an inactive
 * client; the marker turns that dead end into a forwarding address.
 *
 * Nothing here is a foreign key onto `clients.merged_into_client_id`: the
 * target could itself later be merged, and a restrict-mode FK would turn an
 * ordinary deletion into a puzzle. The column is a breadcrumb, not a relation.
 */

const TABLE = 'client_merges';

async function constraintExists(knex, tableName, constraintName) {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
}

async function addForeignKey(knex, tableName, constraintName, definition) {
  if (await constraintExists(knex, tableName, constraintName)) return;
  await knex.raw(`ALTER TABLE ${tableName} ADD CONSTRAINT ${constraintName} ${definition}`);
}

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('merge_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
      table.uuid('source_client_id').notNullable();
      table.uuid('target_client_id').notNullable();
      table.text('source_client_name').notNullable();
      // The profiles that changed owner. Keeping the ids (rather than a count)
      // is what makes "where did this invoice come from" answerable.
      table.specificType('moved_profile_ids', 'uuid[]').notNullable().defaultTo(knex.raw("'{}'::uuid[]"));
      table.jsonb('moved_counts').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
      table.jsonb('contract_decisions').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
      table.text('strategy').notNullable().defaultTo('merge_into_billing_profile');
      table.uuid('merged_by').nullable();
      table.timestamp('merged_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'merge_id']);
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_source
    ON ${TABLE} (tenant, source_client_id)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${TABLE}_target
    ON ${TABLE} (tenant, target_client_id)
  `);

  const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
  await ensureTenantDistribution(knex, TABLE);

  await addForeignKey(knex, TABLE, `${TABLE}_tenant_foreign`,
    'FOREIGN KEY (tenant) REFERENCES tenants(tenant)');

  if (!(await hasColumn(knex, 'clients', 'merged_into_client_id'))) {
    await knex.schema.alterTable('clients', (table) => {
      table.uuid('merged_into_client_id').nullable();
    });
  }
  if (!(await hasColumn(knex, 'clients', 'merged_at'))) {
    await knex.schema.alterTable('clients', (table) => {
      table.timestamp('merged_at', { useTz: true }).nullable();
    });
  }

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_clients_merged_into
    ON clients (tenant, merged_into_client_id)
    WHERE merged_into_client_id IS NOT NULL
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS idx_clients_merged_into');
  if (await hasColumn(knex, 'clients', 'merged_at')) {
    await knex.schema.alterTable('clients', (table) => {
      table.dropColumn('merged_at');
    });
  }
  if (await hasColumn(knex, 'clients', 'merged_into_client_id')) {
    await knex.schema.alterTable('clients', (table) => {
      table.dropColumn('merged_into_client_id');
    });
  }
  await knex.schema.dropTableIfExists(TABLE);
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };

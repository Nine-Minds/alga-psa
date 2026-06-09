/**
 * Migration: Create hudu_integrations (EE-only Hudu connection state).
 *
 * One row per tenant (unique(tenant)) — Phase 1 supports a single Hudu
 * instance per tenant. Greenfield Citus tenant table: `tenant` is the first
 * column and the table is distributed inline under the citus guard, following
 * the Entra precedent (20260220143000_create_entra_phase1_schema.cjs).
 */

const TABLE = 'hudu_integrations';

const isCitusEnabled = async (knex) => {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'citus'
    ) AS enabled
  `);

  return Boolean(result.rows?.[0]?.enabled);
};

const isTableDistributed = async (knex, tableName) => {
  const result = await knex.raw(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_dist_partition
        WHERE logicalrelid = ?::regclass
      ) AS distributed
    `,
    [tableName]
  );

  return Boolean(result.rows?.[0]?.distributed);
};

const ensureDistributedTable = async (knex, tableName) => {
  const exists = await knex.schema.hasTable(tableName);
  if (!exists) {
    return;
  }

  const distributed = await isTableDistributed(knex, tableName);
  if (distributed) {
    return;
  }

  await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
};

exports.up = async function up(knex) {
  const exists = await knex.schema.hasTable(TABLE);
  if (!exists) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table
        .uuid('integration_id')
        .defaultTo(knex.raw('gen_random_uuid()'))
        .notNullable();
      table.text('base_url');
      table.boolean('is_active').notNullable().defaultTo(false);
      table.timestamp('connected_at', { useTz: true });
      table.timestamp('last_synced_at', { useTz: true });
      table.jsonb('settings').notNullable().defaultTo(knex.raw(`'{}'::jsonb`));
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

      table.primary(['tenant', 'integration_id']);
      table.foreign('tenant').references('tenants.tenant').onDelete('CASCADE');
      // One Hudu connection per tenant (Phase 1).
      table.unique(['tenant']);
    });
  }

  await knex.raw(`
    DROP TRIGGER IF EXISTS update_${TABLE}_updated_at ON ${TABLE};
    CREATE TRIGGER update_${TABLE}_updated_at
    BEFORE UPDATE ON ${TABLE}
    FOR EACH ROW
    EXECUTE PROCEDURE on_update_timestamp();
  `);

  const inRecovery = await knex.raw(`SELECT pg_is_in_recovery() AS in_recovery`);
  if (!inRecovery.rows?.[0]?.in_recovery && await isCitusEnabled(knex)) {
    await ensureDistributedTable(knex, TABLE);
  } else {
    console.warn(`[create_hudu_integrations] Skipping create_distributed_table for ${TABLE} (citus unavailable)`);
  }

  const dbUserServer = process.env.DB_USER_SERVER;
  if (dbUserServer) {
    const escapedUser = dbUserServer.replace(/"/g, '""');
    await knex.schema.raw(`GRANT ALL PRIVILEGES ON TABLE ${TABLE} TO "${escapedUser}"`);
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };

/**
 * Create installation metadata store and persist a DB-owned edition marker.
 *
 * Edition seeding rule (DB-only):
 * - More than one tenant => enterprise
 * - One or zero tenants => community
 *
 * This removes migration-time dependence on process env for edition-sensitive backfills.
 */

const INSTALLATION_METADATA_TABLE = 'installation_metadata';

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(INSTALLATION_METADATA_TABLE);
  if (!hasTable) {
    await knex.schema.createTable(INSTALLATION_METADATA_TABLE, (table) => {
      table.text('key').primary().notNullable();
      table.text('value').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    });
  }

  await knex.raw(`
    INSERT INTO ${INSTALLATION_METADATA_TABLE} (key, value, created_at, updated_at)
    SELECT
      'edition',
      CASE
        WHEN (SELECT COUNT(*)::int FROM tenants) > 1 THEN 'enterprise'
        ELSE 'community'
      END,
      now(),
      now()
    ON CONFLICT (key) DO NOTHING;
  `);
};

exports.down = async function down(knex) {
  const hasTable = await knex.schema.hasTable(INSTALLATION_METADATA_TABLE);
  if (!hasTable) return;

  await knex(INSTALLATION_METADATA_TABLE).where({ key: 'edition' }).del();

  const remaining = await knex(INSTALLATION_METADATA_TABLE).count('* as count').first();
  const rowCount = Number((remaining && (remaining.count ?? remaining['count'])) || 0);
  if (rowCount === 0) {
    await knex.schema.dropTableIfExists(INSTALLATION_METADATA_TABLE);
  }
};

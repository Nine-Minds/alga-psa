exports.up = async function up(knex) {
  if (await knex.schema.hasTable('migration_staged_records')) {
    await knex.raw(`ALTER TABLE migration_staged_records ADD COLUMN IF NOT EXISTS custom_field_values jsonb NOT NULL DEFAULT '{}'`);
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('migration_staged_records')) {
    await knex.raw('ALTER TABLE migration_staged_records DROP COLUMN IF EXISTS custom_field_values');
  }
};

async function ensureSequentialMode(knex) {
  await knex.raw(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') THEN
        EXECUTE 'SET citus.multi_shard_modify_mode TO ''sequential''';
      END IF;
    END $$;
  `);
}

exports.up = async function up(knex) {
  await ensureSequentialMode(knex);
  if (await knex.schema.hasTable('default_billing_settings') &&
      !(await knex.schema.hasColumn('default_billing_settings', 'default_quote_validity_days'))) {
    await knex.schema.alterTable('default_billing_settings', (table) => {
      table.integer('default_quote_validity_days').notNullable().defaultTo(30);
    });
  }

  if (await knex.schema.hasTable('default_billing_settings')) {
    const constraint = 'default_billing_settings_default_quote_validity_days_check';
    const { rows } = await knex.raw(
      'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
      [constraint, 'default_billing_settings'],
    );
    if (rows.length === 0 && await knex.schema.hasColumn('default_billing_settings', 'default_quote_validity_days')) {
      await knex.raw(`ALTER TABLE default_billing_settings ADD CONSTRAINT ${constraint} CHECK (default_quote_validity_days BETWEEN 1 AND 365)`);
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('default_billing_settings') &&
      await knex.schema.hasColumn('default_billing_settings', 'default_quote_validity_days')) {
    await knex.raw('ALTER TABLE default_billing_settings DROP CONSTRAINT IF EXISTS default_billing_settings_default_quote_validity_days_check');
    await knex.schema.alterTable('default_billing_settings', (table) => {
      table.dropColumn('default_quote_validity_days');
    });
  }
};

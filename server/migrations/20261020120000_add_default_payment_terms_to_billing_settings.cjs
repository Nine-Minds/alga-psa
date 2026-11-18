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

// Tenant-level default payment terms (alga-2026-0002607 follow-up).
// NULL means "not set" and resolves to Net 30. No CHECK constraint on purpose:
// the vocabulary lives in code (PAYMENT_TERMS) and reads are normalized.
exports.up = async function up(knex) {
  await ensureSequentialMode(knex);
  if (await knex.schema.hasTable('default_billing_settings') &&
      !(await knex.schema.hasColumn('default_billing_settings', 'default_payment_terms'))) {
    await knex.schema.alterTable('default_billing_settings', (table) => {
      table.text('default_payment_terms').nullable();
    });
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('default_billing_settings') &&
      await knex.schema.hasColumn('default_billing_settings', 'default_payment_terms')) {
    await knex.schema.alterTable('default_billing_settings', (table) => {
      table.dropColumn('default_payment_terms');
    });
  }
};

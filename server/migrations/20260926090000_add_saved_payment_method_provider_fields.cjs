exports.up = async function up(knex) {
  const columns = [
    ['provider_type', (t) => t.string('provider_type', 50)],
    ['external_payment_method_id', (t) => t.string('external_payment_method_id', 255)],
    ['external_customer_id', (t) => t.string('external_customer_id', 255)],
    ['brand', (t) => t.string('brand', 50)],
    ['fingerprint', (t) => t.string('fingerprint', 255)],
    ['status', (t) => t.string('status', 30).notNullable().defaultTo('active')],
  ];
  for (const [name, add] of columns) {
    if (!(await knex.schema.hasColumn('payment_methods', name))) await knex.schema.alterTable('payment_methods', add);
  }
  await knex.raw(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_methods_status_check' AND conrelid = 'payment_methods'::regclass) THEN
      ALTER TABLE payment_methods ADD CONSTRAINT payment_methods_status_check CHECK (status IN ('active','expired','detached','requires_update'));
    END IF;
  END $$`);
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_external_id_unique ON payment_methods (tenant, provider_type, external_payment_method_id) WHERE external_payment_method_id IS NOT NULL');
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS payment_methods_external_id_unique');
  await knex.raw('ALTER TABLE payment_methods DROP CONSTRAINT IF EXISTS payment_methods_status_check');
  for (const name of ['status', 'fingerprint', 'brand', 'external_customer_id', 'external_payment_method_id', 'provider_type']) {
    if (await knex.schema.hasColumn('payment_methods', name)) await knex.schema.alterTable('payment_methods', (t) => t.dropColumn(name));
  }
};

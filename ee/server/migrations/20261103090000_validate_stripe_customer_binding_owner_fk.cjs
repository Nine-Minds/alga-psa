exports.up = async function up(knex) {
  const check = await knex.raw(`SELECT convalidated FROM pg_constraint WHERE conname = 'stripe_customer_bindings_nonempty_id' AND conrelid = 'stripe_customer_bindings'::regclass`);
  if (!check.rows.length) throw new Error('Cannot validate missing stripe_customer_bindings_nonempty_id constraint; run the Stripe customer binding enforcement migration first.');
  if (!check.rows[0].convalidated) await knex.raw('ALTER TABLE stripe_customer_bindings VALIDATE CONSTRAINT stripe_customer_bindings_nonempty_id');

  const owner = await knex.raw(`SELECT convalidated FROM pg_constraint WHERE conname = 'stripe_customers_binding_owner_fk' AND conrelid = 'stripe_customers'::regclass`);
  if (!owner.rows.length) throw new Error('Cannot validate missing stripe_customers_binding_owner_fk constraint; run the Stripe customer binding enforcement migration first.');
  if (!owner.rows[0].convalidated) await knex.raw('ALTER TABLE stripe_customers VALIDATE CONSTRAINT stripe_customers_binding_owner_fk');
};

exports.down = async function down() {
  // Validation is monotonic; the preceding migration owns constraint removal.
};

exports.config = { transaction: false };

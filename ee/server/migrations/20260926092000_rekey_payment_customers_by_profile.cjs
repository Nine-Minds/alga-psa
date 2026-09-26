exports.up = async function up(knex) {
  if (!(await knex.schema.hasColumn('client_payment_customers', 'billing_profile_id'))) {
    await knex.schema.alterTable('client_payment_customers', (t) => t.uuid('billing_profile_id').nullable());
  }
  await knex.raw(`
    UPDATE client_payment_customers cpc
       SET billing_profile_id = cbp.billing_profile_id
      FROM client_billing_profiles cbp
     WHERE cbp.tenant = cpc.tenant AND cbp.client_id = cpc.client_id
       AND cbp.is_default = true AND cpc.billing_profile_id IS NULL
  `);
  const missing = await knex('client_payment_customers').whereNull('billing_profile_id').count('* as count').first();
  if (Number(missing?.count ?? 0) > 0) throw new Error('Cannot re-key Stripe customers: a client has no default billing profile');
  await knex.raw('ALTER TABLE client_payment_customers DROP CONSTRAINT IF EXISTS client_payment_customers_tenant_client_id_provider_type_unique');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS client_payment_customers_profile_unique ON client_payment_customers (tenant, client_id, billing_profile_id, provider_type)');
  await knex.raw('ALTER TABLE client_payment_customers ALTER COLUMN billing_profile_id SET NOT NULL');
  await knex.raw(`ALTER TABLE client_payment_customers ADD CONSTRAINT client_payment_customers_profile_fk FOREIGN KEY (tenant, billing_profile_id) REFERENCES client_billing_profiles (tenant, billing_profile_id) ON DELETE CASCADE`);
};
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE client_payment_customers DROP CONSTRAINT IF EXISTS client_payment_customers_profile_fk');
  await knex.raw('DROP INDEX IF EXISTS client_payment_customers_profile_unique');
  await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS client_payment_customers_tenant_client_id_provider_type_unique ON client_payment_customers (tenant, client_id, provider_type)');
  await knex.schema.alterTable('client_payment_customers', (t) => t.dropColumn('billing_profile_id'));
};

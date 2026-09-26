exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('billing_profile_autopay'))) {
    await knex.schema.createTable('billing_profile_autopay', (t) => {
      t.uuid('tenant').notNullable(); t.uuid('billing_profile_id').notNullable(); t.uuid('client_id').notNullable();
      t.boolean('is_enabled').notNullable().defaultTo(false); t.uuid('payment_method_id');
      t.timestamp('authorized_at', { useTz: true }); t.uuid('authorized_by_user_id');
      t.string('authorization_source', 30); t.string('authorization_ip', 64); t.text('authorization_user_agent'); t.string('consent_text_version', 100);
      t.timestamp('disabled_at', { useTz: true }); t.uuid('disabled_by_user_id'); t.text('disabled_reason');
      t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()); t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['tenant', 'billing_profile_id']); t.foreign(['tenant', 'billing_profile_id']).references(['tenant', 'billing_profile_id']).inTable('client_billing_profiles').onDelete('CASCADE');
      t.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients').onDelete('CASCADE');
      t.foreign(['tenant', 'payment_method_id']).references(['tenant', 'payment_method_id']).inTable('payment_methods');
      t.check("authorization_source IS NULL OR authorization_source IN ('client_portal','msp')");
    });
  }
  if (!(await knex.schema.hasTable('invoice_autopay_attempts'))) {
    await knex.schema.createTable('invoice_autopay_attempts', (t) => {
      t.uuid('tenant').notNullable(); t.uuid('attempt_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      t.uuid('invoice_id').notNullable(); t.uuid('billing_profile_id').notNullable(); t.uuid('payment_method_id').notNullable();
      t.integer('attempt_number').notNullable(); t.timestamp('scheduled_for', { useTz: true }).notNullable(); t.string('status', 30).notNullable().defaultTo('scheduled');
      t.integer('amount').notNullable(); t.string('currency', 3).notNullable(); t.string('provider_type', 50).notNullable(); t.string('payment_intent_id', 255);
      t.string('idempotency_key', 255).notNullable(); t.string('failure_code', 100); t.text('failure_message'); t.string('decline_code', 100);
      t.timestamp('processed_at', { useTz: true }); t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now()); t.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      t.primary(['tenant', 'attempt_id']); t.unique(['tenant', 'idempotency_key']);
      t.foreign(['tenant', 'invoice_id']).references(['tenant', 'invoice_id']).inTable('invoices').onDelete('CASCADE');
      t.foreign(['tenant', 'billing_profile_id']).references(['tenant', 'billing_profile_id']).inTable('client_billing_profiles');
      t.foreign(['tenant', 'payment_method_id']).references(['tenant', 'payment_method_id']).inTable('payment_methods');
      t.check("status IN ('scheduled','processing','succeeded','failed','requires_action','cancelled')");
    });
    await knex.raw("CREATE UNIQUE INDEX invoice_autopay_one_open_per_invoice ON invoice_autopay_attempts (tenant, invoice_id) WHERE status IN ('scheduled','processing')");
    await knex.raw('CREATE INDEX invoice_autopay_due_idx ON invoice_autopay_attempts (tenant, status, scheduled_for)');
  }
};
exports.down = async function down(knex) { await knex.schema.dropTableIfExists('invoice_autopay_attempts'); await knex.schema.dropTableIfExists('billing_profile_autopay'); };

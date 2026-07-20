/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('auto_topup_jobs', (table) => {
    table.uuid('job_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('account_id').inTable('ai_accounts');
    table.text('pack_price_id').notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('payment_intent_id').nullable();
    table.text('last_error').nullable();
    table.timestamp('locked_at', { useTz: true }).nullable();
    table.timestamp('completed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['status', 'next_attempt_at']);
    table.index('payment_intent_id');
  });

  await knex.raw(`
    ALTER TABLE auto_topup_jobs
      ADD CONSTRAINT auto_topup_jobs_status_check
        CHECK (status IN ('pending', 'processing', 'awaiting_webhook', 'succeeded', 'failed')),
      ADD CONSTRAINT auto_topup_jobs_attempt_count_check CHECK (attempt_count >= 0),
      ADD CONSTRAINT auto_topup_jobs_pack_price_id_check CHECK (length(pack_price_id) > 0)
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX auto_topup_jobs_one_active_per_account
      ON auto_topup_jobs (account_id)
      WHERE status IN ('pending', 'processing', 'awaiting_webhook')
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX credit_ledger_unique_stripe_grant
      ON credit_ledger (stripe_ref)
      WHERE stripe_ref IS NOT NULL
        AND entry_type IN ('grant_included', 'grant_topup')
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS credit_ledger_unique_stripe_grant');
  await knex.schema.dropTableIfExists('auto_topup_jobs');
};

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('ai_accounts', (table) => {
    table.uuid('account_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('tenant_id').notNullable();
    table.text('deployment_type').notNullable();
    table.text('stripe_customer_id').nullable();
    table.text('stripe_subscription_id').nullable();
    table.text('subscription_status').notNullable().defaultTo('none');
    table.bigInteger('included_balance').notNullable().defaultTo('0');
    table.bigInteger('topup_balance').notNullable().defaultTo('0');
    table.bigInteger('grace_limit_credits').notNullable().defaultTo('0');
    table.timestamp('cycle_started_at', { useTz: true }).nullable();
    table.bigInteger('low_balance_threshold').notNullable().defaultTo('0');
    table.boolean('auto_topup_enabled').notNullable().defaultTo(false);
    table.bigInteger('auto_topup_threshold_credits').nullable();
    table.text('auto_topup_pack_price_id').nullable();
    table.integer('auto_topup_failure_count').notNullable().defaultTo(0);
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.unique(['tenant_id', 'deployment_type']);
    table.index('stripe_customer_id');
    table.index('stripe_subscription_id');
  });

  await knex.raw(`
    ALTER TABLE ai_accounts
      ADD CONSTRAINT ai_accounts_deployment_type_check
        CHECK (deployment_type IN ('hosted', 'appliance')),
      ADD CONSTRAINT ai_accounts_grace_limit_check
        CHECK (grace_limit_credits >= 0),
      ADD CONSTRAINT ai_accounts_low_balance_threshold_check
        CHECK (low_balance_threshold >= 0),
      ADD CONSTRAINT ai_accounts_auto_topup_threshold_check
        CHECK (auto_topup_threshold_credits IS NULL OR auto_topup_threshold_credits >= 0),
      ADD CONSTRAINT ai_accounts_auto_topup_failure_count_check
        CHECK (auto_topup_failure_count >= 0)
  `);

  await knex.schema.createTable('ai_usage_events', (table) => {
    table.uuid('usage_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('account_id').inTable('ai_accounts');
    table.text('feature').notNullable();
    table.text('model').notNullable();
    table.text('provider').notNullable();
    table.bigInteger('prompt_tokens').notNullable();
    table.bigInteger('completion_tokens').notNullable();
    table.bigInteger('total_tokens').notNullable();
    table.bigInteger('credits_charged').notNullable();
    table.text('request_id').notNullable();
    table.bigInteger('duration_ms').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['account_id', 'created_at']);
    table.index(['account_id', 'feature', 'created_at']);
    table.index('request_id');
  });

  await knex.raw(`
    ALTER TABLE ai_usage_events
      ADD CONSTRAINT ai_usage_events_prompt_tokens_check CHECK (prompt_tokens >= 0),
      ADD CONSTRAINT ai_usage_events_completion_tokens_check CHECK (completion_tokens >= 0),
      ADD CONSTRAINT ai_usage_events_total_tokens_check CHECK (total_tokens >= 0),
      ADD CONSTRAINT ai_usage_events_credits_charged_check CHECK (credits_charged > 0),
      ADD CONSTRAINT ai_usage_events_duration_ms_check CHECK (duration_ms >= 0),
      ADD CONSTRAINT ai_usage_events_token_sum_check
        CHECK (total_tokens = prompt_tokens + completion_tokens)
  `);

  await knex.schema.createTable('credit_ledger', (table) => {
    table.bigIncrements('entry_id').primary();
    table.uuid('account_id').notNullable().references('account_id').inTable('ai_accounts');
    table.text('entry_type').notNullable();
    table.text('bucket').notNullable();
    table.bigInteger('credits').notNullable();
    table.bigInteger('balance_after').notNullable();
    table.text('stripe_ref').nullable();
    table.uuid('usage_id').nullable().references('usage_id').inTable('ai_usage_events');
    table.text('note').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['account_id', 'entry_id']);
    table.index('usage_id');
    table.index('stripe_ref');
  });

  await knex.raw(`
    ALTER TABLE credit_ledger
      ADD CONSTRAINT credit_ledger_entry_type_check
        CHECK (entry_type IN ('grant_included', 'grant_topup', 'usage_debit', 'expiry', 'adjustment')),
      ADD CONSTRAINT credit_ledger_bucket_check
        CHECK (bucket IN ('included', 'topup')),
      ADD CONSTRAINT credit_ledger_credits_nonzero_check CHECK (credits <> 0)
  `);

  await knex.schema.createTable('pricing_config', (table) => {
    table.uuid('pricing_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('model_pattern').notNullable();
    table.bigInteger('credits_per_1k_input_tokens').notNullable();
    table.bigInteger('credits_per_1k_output_tokens').notNullable();
    table.timestamp('effective_from', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['model_pattern', 'effective_from']);
  });

  await knex.raw(`
    ALTER TABLE pricing_config
      ADD CONSTRAINT pricing_config_model_pattern_check CHECK (length(model_pattern) > 0),
      ADD CONSTRAINT pricing_config_input_rate_check CHECK (credits_per_1k_input_tokens > 0),
      ADD CONSTRAINT pricing_config_output_rate_check CHECK (credits_per_1k_output_tokens > 0)
  `);

  await knex.schema.createTable('consent_records', (table) => {
    table.uuid('consent_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('account_id').notNullable().references('account_id').inTable('ai_accounts');
    table.text('granted_by').notNullable();
    table.text('terms_version').notNullable();
    table.timestamp('granted_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('revoked_at', { useTz: true }).nullable();
    table.text('revoked_by').nullable();

    table.index(['account_id', 'granted_at']);
  });

  await knex.raw(`
    ALTER TABLE consent_records
      ADD CONSTRAINT consent_records_revocation_check
        CHECK (
          (revoked_at IS NULL AND revoked_by IS NULL)
          OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
        )
  `);

  await knex.schema.createTable('stripe_webhook_events', (table) => {
    table.text('event_id').primary();
    table.text('type').notNullable();
    table.timestamp('processed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('payload_hash').notNullable();
  });

  await knex.schema.createTable('tier_config', (table) => {
    table.uuid('tier_id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('tier_key').notNullable().unique();
    table.text('stripe_subscription_price_id').nullable();
    table.bigInteger('monthly_included_credits').notNullable();
    table.integer('grace_percent_basis_points').notNullable();
    table.jsonb('topup_packs').notNullable().defaultTo(knex.raw(`'[]'::jsonb`));
    table.bigInteger('low_balance_threshold').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE tier_config
      ADD CONSTRAINT tier_config_monthly_credits_check CHECK (monthly_included_credits > 0),
      ADD CONSTRAINT tier_config_grace_percent_check
        CHECK (grace_percent_basis_points >= 0 AND grace_percent_basis_points <= 10000),
      ADD CONSTRAINT tier_config_topup_packs_check CHECK (jsonb_typeof(topup_packs) = 'array'),
      ADD CONSTRAINT tier_config_low_balance_threshold_check CHECK (low_balance_threshold >= 0)
  `);
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('tier_config');
  await knex.schema.dropTableIfExists('stripe_webhook_events');
  await knex.schema.dropTableIfExists('consent_records');
  await knex.schema.dropTableIfExists('pricing_config');
  await knex.schema.dropTableIfExists('credit_ledger');
  await knex.schema.dropTableIfExists('ai_usage_events');
  await knex.schema.dropTableIfExists('ai_accounts');
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('opportunities', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('opportunity_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('opportunity_number').notNullable();
    table.uuid('client_id').notNullable();
    table.uuid('contact_id').nullable();
    table.text('title').notNullable();
    table.text('opportunity_type').notNullable();
    table.uuid('owner_id').notNullable();
    table.text('status').notNullable().defaultTo('open');
    table.text('stage').notNullable().defaultTo('identified');
    table.text('confidence').notNullable().defaultTo('medium');
    table.bigInteger('mrr_cents').notNullable().defaultTo(0);
    table.bigInteger('nrr_cents').notNullable().defaultTo(0);
    table.bigInteger('hardware_cents').notNullable().defaultTo(0);
    table.string('currency_code', 3).notNullable();
    table.boolean('values_locked_by_quote').notNullable().defaultTo(false);
    table.date('expected_close_date').nullable();
    table.text('next_action').nullable();
    table.timestamp('next_action_due', { useTz: true }).nullable();
    table.timestamp('last_activity_at', { useTz: true }).notNullable();
    table.text('loss_reason').nullable();
    table.text('loss_notes').nullable();
    table.text('lost_to').nullable();
    table.text('generator_key').nullable();
    table.jsonb('generator_context').nullable();
    table.uuid('suggestion_id').nullable();
    table.uuid('converted_contract_id').nullable();
    table.uuid('converted_project_id').nullable();
    table.timestamp('won_at', { useTz: true }).nullable();
    table.timestamp('lost_at', { useTz: true }).nullable();
    table.uuid('created_by').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'opportunity_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
    table.foreign(['tenant', 'owner_id']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'converted_contract_id']).references(['tenant', 'contract_id']).inTable('contracts');
    table.foreign(['tenant', 'converted_project_id']).references(['tenant', 'project_id']).inTable('projects');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_status_check
    CHECK (status IN ('open', 'won', 'lost'))
  `);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_stage_check
    CHECK (stage IN ('identified', 'qualified', 'assessment', 'proposed', 'verbal', 'won', 'lost'))
  `);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_confidence_check
    CHECK (confidence IN ('low', 'medium', 'high', 'committed'))
  `);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_type_check
    CHECK (opportunity_type IN ('new_logo', 'expansion', 'renewal', 'project'))
  `);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_loss_reason_check
    CHECK (
      loss_reason IS NULL OR loss_reason IN (
        'no_response',
        'chose_competitor',
        'price',
        'timing',
        'no_budget',
        'not_a_fit',
        'other'
      )
    )
  `);
  await knex.raw(`
    ALTER TABLE opportunities
    ADD CONSTRAINT opportunities_generator_key_check
    CHECK (generator_key IS NULL OR generator_key IN ('renewal', 'tm_conversion', 'whitespace', 'asset_aging'))
  `);

  await knex.raw(`
    CREATE UNIQUE INDEX idx_opportunities_tenant_opportunity_number
    ON opportunities (tenant, opportunity_number)
  `);
  await knex.raw('CREATE INDEX idx_opportunities_tenant_client ON opportunities (tenant, client_id)');
  await knex.raw('CREATE INDEX idx_opportunities_tenant_status_next_action_due ON opportunities (tenant, status, next_action_due)');
  await knex.raw('CREATE INDEX idx_opportunities_tenant_status_last_activity_at ON opportunities (tenant, status, last_activity_at)');

  await knex.schema.createTable('opportunity_evidence', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('evidence_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('opportunity_id').notNullable();
    table.text('checkpoint').notNullable();
    table.text('source').notNullable();
    table.text('ref_type').nullable();
    table.uuid('ref_id').nullable();
    table.text('detail').nullable();
    table.text('correction_note').nullable();
    table.uuid('corrected_by').nullable();
    table.timestamp('corrected_at', { useTz: true }).nullable();
    table.uuid('recorded_by').nullable();
    table.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'evidence_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'opportunity_id']).references(['tenant', 'opportunity_id']).inTable('opportunities').onDelete('CASCADE');
    table.foreign(['tenant', 'corrected_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'recorded_by']).references(['tenant', 'user_id']).inTable('users');
  });

  await knex.raw(`
    ALTER TABLE opportunity_evidence
    ADD CONSTRAINT opportunity_evidence_checkpoint_check
    CHECK (checkpoint IN ('qualified', 'assessment', 'proposed', 'verbal', 'won'))
  `);
  await knex.raw(`
    ALTER TABLE opportunity_evidence
    ADD CONSTRAINT opportunity_evidence_source_check
    CHECK (source IN ('system', 'declared'))
  `);
  await knex.raw(`
    ALTER TABLE opportunity_evidence
    ADD CONSTRAINT opportunity_evidence_ref_type_check
    CHECK (ref_type IS NULL OR ref_type IN ('quote', 'contract', 'project', 'schedule_entry', 'interaction'))
  `);
  await knex.raw('CREATE INDEX idx_opportunity_evidence_tenant_opportunity ON opportunity_evidence (tenant, opportunity_id)');

  await knex.schema.createTable('opportunity_suggestions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('suggestion_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('generator_key').notNullable();
    table.uuid('client_id').notNullable();
    table.text('title').notNullable();
    table.jsonb('evidence').notNullable();
    table.bigInteger('mrr_cents').notNullable().defaultTo(0);
    table.bigInteger('nrr_cents').notNullable().defaultTo(0);
    table.string('currency_code', 3).notNullable();
    table.text('status').notNullable().defaultTo('pending');
    table.timestamp('snoozed_until', { useTz: true }).nullable();
    table.text('dedupe_key').notNullable();
    table.uuid('created_opportunity_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'suggestion_id']);
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'client_id']).references(['tenant', 'client_id']).inTable('clients');
    table.foreign(['tenant', 'created_opportunity_id']).references(['tenant', 'opportunity_id']).inTable('opportunities');
  });

  await knex.raw(`
    ALTER TABLE opportunity_suggestions
    ADD CONSTRAINT opportunity_suggestions_generator_key_check
    CHECK (generator_key IN ('renewal', 'tm_conversion', 'whitespace', 'asset_aging'))
  `);
  await knex.raw(`
    ALTER TABLE opportunity_suggestions
    ADD CONSTRAINT opportunity_suggestions_status_check
    CHECK (status IN ('pending', 'accepted', 'dismissed', 'snoozed'))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_opportunity_suggestions_tenant_generator_dedupe
    ON opportunity_suggestions (tenant, generator_key, dedupe_key)
  `);
  await knex.raw('CREATE INDEX idx_opportunity_suggestions_tenant_status ON opportunity_suggestions (tenant, status)');

  await knex.schema.alterTable('opportunities', (table) => {
    table.foreign(['tenant', 'suggestion_id'], 'fk_opportunities_suggestion')
      .references(['tenant', 'suggestion_id'])
      .inTable('opportunity_suggestions');
  });
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE opportunities DROP CONSTRAINT IF EXISTS fk_opportunities_suggestion');
  await knex.schema.dropTableIfExists('opportunity_evidence');
  await knex.schema.dropTableIfExists('opportunity_suggestions');
  await knex.schema.dropTableIfExists('opportunities');
};

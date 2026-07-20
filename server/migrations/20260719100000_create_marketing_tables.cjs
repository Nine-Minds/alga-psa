// marketing_engagements is deliberately NOT distributed: it cascades from
// interactions, which is a plain (coordinator-local) table on Citus, and a
// distributed table cannot reference a local one. As a local table it may
// reference both interactions (local -> local) and the distributed marketing
// tables (local -> distributed, same shape as interactions -> opportunities).
const MARKETING_TABLES = [
  'marketing_campaigns',
  'marketing_content',
  'marketing_channels',
  'marketing_capture_forms',
  'social_posts',
  'social_post_targets',
  'marketing_sequences',
  'marketing_sequence_steps',
  'marketing_sequence_enrollments',
  'marketing_contact_state',
  'marketing_suppressions',
];

async function hasCitus(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS available
  `);
  return Boolean(result.rows?.[0]?.available);
}

async function distributeMarketingTables(knex) {
  if (!await hasCitus(knex)) return;
  for (const table of MARKETING_TABLES) {
    await knex.raw(
      `SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'tenants')`,
      [table],
    );
  }
}

// Composite (tenant, X) FKs must never use bare ON DELETE SET NULL: Postgres
// nulls EVERY referencing column, including tenant, silently stripping
// tenancy (see 20260611150000_fix_tenant_nulling_foreign_keys.cjs). PG 15+
// on plain Postgres gets the column-targeted SET NULL (X); Citus refuses
// SET NULL when the distribution key is part of the FK, so there the FK
// degrades to NO ACTION and unlinking stays app-level.
async function addUnlinkOnDeleteFk(knex, table, column, refTable, refColumn) {
  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const columnTargeted = versionRow.rows[0].v >= 150000 && !(await hasCitus(knex));
  const action = columnTargeted ? ` ON DELETE SET NULL (${column})` : '';
  await knex.raw(`
    ALTER TABLE ${table}
    ADD CONSTRAINT ${table}_tenant_${column}_foreign
    FOREIGN KEY (tenant, ${column})
    REFERENCES ${refTable} (tenant, ${refColumn})${action}
  `);
}

/**
 * Marketing module tables. FK direction is marketing -> core only; no core
 * table ever references these, so the whole set is droppable.
 *
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('marketing_campaigns', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('campaign_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.text('goal').nullable();
    table.text('source_channel').nullable();
    table.text('status').notNullable().defaultTo('draft');
    table.date('start_date').nullable();
    table.date('end_date').nullable();
    table.uuid('created_by').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'campaign_id']);
  });

  await knex.raw(`
    ALTER TABLE marketing_campaigns
    ADD CONSTRAINT marketing_campaigns_status_check
    CHECK (status IN ('draft', 'active', 'completed', 'archived'))
  `);

  await knex.schema.createTable('marketing_content', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('content_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('campaign_id').nullable();
    table.text('title').notNullable();
    table.text('body_markdown').notNullable().defaultTo('');
    table.jsonb('channel_variants').notNullable().defaultTo('{}');
    table.uuid('created_by').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'content_id']);
  });

  await knex.schema.createTable('marketing_channels', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('channel_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.text('platform').notNullable();
    table.text('handle_or_url').nullable();
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('created_by').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'channel_id']);
  });

  // Capture form definitions: hosted public endpoints (e.g. newsletter,
  // demo-request) with an embeddable URL keyed by slug. v1 collects a fixed
  // field set (name/email/company/message); definitions carry attribution.
  await knex.schema.createTable('marketing_capture_forms', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('form_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.text('slug').notNullable();
    table.text('description').nullable();
    table.uuid('campaign_id').nullable();
    table.boolean('creates_suggestion').notNullable().defaultTo(true);
    table.boolean('is_active').notNullable().defaultTo(true);
    table.uuid('created_by').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'form_id']);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_marketing_capture_forms_tenant_slug
    ON marketing_capture_forms (tenant, slug)
  `);

  await knex.schema.createTable('social_posts', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('post_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('content_id').notNullable();
    table.uuid('campaign_id').nullable();
    table.text('status').notNullable().defaultTo('draft');
    table.timestamp('scheduled_at', { useTz: true }).nullable();
    table.uuid('created_by').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'post_id']);
  });

  await knex.raw(`
    ALTER TABLE social_posts
    ADD CONSTRAINT social_posts_status_check
    CHECK (status IN ('draft', 'scheduled', 'awaiting-manual-publish', 'published', 'expired'))
  `);
  await knex.raw(`
    CREATE INDEX idx_social_posts_tenant_status_scheduled
    ON social_posts (tenant, status, scheduled_at)
  `);

  await knex.schema.createTable('social_post_targets', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('target_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('post_id').notNullable();
    table.uuid('channel_id').notNullable();
    table.text('status').notNullable().defaultTo('scheduled');
    table.text('permalink').nullable();
    table.timestamp('published_at', { useTz: true }).nullable();
    table.uuid('published_by').nullable();
    table.text('published_via').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'target_id']);
  });

  await knex.raw(`
    ALTER TABLE social_post_targets
    ADD CONSTRAINT social_post_targets_status_check
    CHECK (status IN ('scheduled', 'awaiting-manual-publish', 'published', 'skipped', 'expired'))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_social_post_targets_tenant_post_channel
    ON social_post_targets (tenant, post_id, channel_id)
  `);
  await knex.raw(`
    CREATE INDEX idx_social_post_targets_tenant_status
    ON social_post_targets (tenant, status)
  `);

  await knex.schema.createTable('marketing_sequences', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('sequence_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('name').notNullable();
    table.text('description').nullable();
    table.text('status').notNullable().defaultTo('draft');
    table.uuid('created_by').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'sequence_id']);
  });

  await knex.raw(`
    ALTER TABLE marketing_sequences
    ADD CONSTRAINT marketing_sequences_status_check
    CHECK (status IN ('draft', 'active', 'paused', 'archived'))
  `);

  await knex.schema.createTable('marketing_sequence_steps', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('step_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('sequence_id').notNullable();
    table.integer('step_order').notNullable();
    table.integer('delay_minutes').notNullable().defaultTo(0);
    table.text('subject').notNullable();
    table.text('body_template').notNullable().defaultTo('');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'step_id']);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_marketing_sequence_steps_tenant_sequence_order
    ON marketing_sequence_steps (tenant, sequence_id, step_order)
  `);

  await knex.schema.createTable('marketing_sequence_enrollments', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('enrollment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('sequence_id').notNullable();
    table.uuid('contact_id').notNullable();
    table.integer('current_step_order').notNullable().defaultTo(0);
    table.text('state').notNullable().defaultTo('active');
    table.timestamp('next_send_at', { useTz: true }).nullable();
    table.uuid('enrolled_by').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'enrollment_id']);
  });

  await knex.raw(`
    ALTER TABLE marketing_sequence_enrollments
    ADD CONSTRAINT marketing_sequence_enrollments_state_check
    CHECK (state IN ('active', 'completed', 'stopped'))
  `);
  await knex.raw(`
    CREATE INDEX idx_marketing_sequence_enrollments_tenant_state_next_send
    ON marketing_sequence_enrollments (tenant, state, next_send_at)
  `);
  await knex.raw(`
    CREATE INDEX idx_marketing_sequence_enrollments_tenant_contact
    ON marketing_sequence_enrollments (tenant, contact_id)
  `);

  // Per-contact marketing state hangs off contacts; contacts is never modified.
  await knex.schema.createTable('marketing_contact_state', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('contact_id').notNullable();
    table.boolean('consent').notNullable().defaultTo(false);
    table.text('source').nullable();
    table.timestamp('unsubscribed_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'contact_id']);
  });

  // Global suppression list: honored by every send, survives contact
  // deletion/re-import (keyed by lowercased email, not contact id).
  await knex.schema.createTable('marketing_suppressions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('suppression_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.text('email').notNullable();
    table.uuid('contact_id').nullable();
    table.text('reason').notNullable();
    table.text('source').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'suppression_id']);
  });

  await knex.raw(`
    ALTER TABLE marketing_suppressions
    ADD CONSTRAINT marketing_suppressions_reason_check
    CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'manual'))
  `);
  await knex.raw(`
    ALTER TABLE marketing_suppressions
    ADD CONSTRAINT marketing_suppressions_source_check
    CHECK (source IN ('link', 'reply', 'import', 'admin'))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX idx_marketing_suppressions_tenant_email
    ON marketing_suppressions (tenant, email)
  `);

  // Join table: interactions (the log) <-> marketing entities (the machine).
  await knex.schema.createTable('marketing_engagements', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('engagement_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('interaction_id').notNullable();
    table.uuid('campaign_id').nullable();
    table.uuid('content_id').nullable();
    table.uuid('post_id').nullable();
    table.uuid('step_id').nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'engagement_id']);
  });

  await knex.raw(`
    CREATE UNIQUE INDEX idx_marketing_engagements_tenant_interaction
    ON marketing_engagements (tenant, interaction_id)
  `);
  await knex.raw(`
    CREATE INDEX idx_marketing_engagements_tenant_campaign
    ON marketing_engagements (tenant, campaign_id)
  `);

  // Citus requires tenant tables to be distributed and colocated before
  // cross-table foreign keys are added. On plain Postgres this is a no-op.
  await distributeMarketingTables(knex);

  await knex.schema.alterTable('marketing_campaigns', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await knex.schema.alterTable('marketing_content', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await addUnlinkOnDeleteFk(knex, 'marketing_content', 'campaign_id', 'marketing_campaigns', 'campaign_id');
  await knex.schema.alterTable('marketing_channels', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await knex.schema.alterTable('marketing_capture_forms', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await addUnlinkOnDeleteFk(knex, 'marketing_capture_forms', 'campaign_id', 'marketing_campaigns', 'campaign_id');
  await knex.schema.alterTable('social_posts', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'content_id']).references(['tenant', 'content_id']).inTable('marketing_content');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await addUnlinkOnDeleteFk(knex, 'social_posts', 'campaign_id', 'marketing_campaigns', 'campaign_id');
  await knex.schema.alterTable('social_post_targets', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'post_id']).references(['tenant', 'post_id']).inTable('social_posts').onDelete('CASCADE');
    table.foreign(['tenant', 'channel_id']).references(['tenant', 'channel_id']).inTable('marketing_channels');
    table.foreign(['tenant', 'published_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await knex.schema.alterTable('marketing_sequences', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'created_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await knex.schema.alterTable('marketing_sequence_steps', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'sequence_id']).references(['tenant', 'sequence_id']).inTable('marketing_sequences').onDelete('CASCADE');
  });
  await knex.schema.alterTable('marketing_sequence_enrollments', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'sequence_id']).references(['tenant', 'sequence_id']).inTable('marketing_sequences').onDelete('CASCADE');
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts');
    table.foreign(['tenant', 'enrolled_by']).references(['tenant', 'user_id']).inTable('users');
  });
  await knex.schema.alterTable('marketing_contact_state', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'contact_id']).references(['tenant', 'contact_name_id']).inTable('contacts').onDelete('CASCADE');
  });
  await knex.schema.alterTable('marketing_suppressions', (table) => {
    table.foreign('tenant').references('tenants.tenant');
  });
  await addUnlinkOnDeleteFk(knex, 'marketing_suppressions', 'contact_id', 'contacts', 'contact_name_id');
  await knex.schema.alterTable('marketing_engagements', (table) => {
    table.foreign('tenant').references('tenants.tenant');
    table.foreign(['tenant', 'interaction_id']).references(['tenant', 'interaction_id']).inTable('interactions').onDelete('CASCADE');
  });
  await addUnlinkOnDeleteFk(knex, 'marketing_engagements', 'campaign_id', 'marketing_campaigns', 'campaign_id');
  await addUnlinkOnDeleteFk(knex, 'marketing_engagements', 'content_id', 'marketing_content', 'content_id');
  await addUnlinkOnDeleteFk(knex, 'marketing_engagements', 'post_id', 'social_posts', 'post_id');
  await addUnlinkOnDeleteFk(knex, 'marketing_engagements', 'step_id', 'marketing_sequence_steps', 'step_id');
};

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<void>}
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('marketing_engagements');
  await knex.schema.dropTableIfExists('marketing_suppressions');
  await knex.schema.dropTableIfExists('marketing_contact_state');
  await knex.schema.dropTableIfExists('marketing_sequence_enrollments');
  await knex.schema.dropTableIfExists('marketing_sequence_steps');
  await knex.schema.dropTableIfExists('marketing_sequences');
  await knex.schema.dropTableIfExists('social_post_targets');
  await knex.schema.dropTableIfExists('social_posts');
  await knex.schema.dropTableIfExists('marketing_capture_forms');
  await knex.schema.dropTableIfExists('marketing_channels');
  await knex.schema.dropTableIfExists('marketing_content');
  await knex.schema.dropTableIfExists('marketing_campaigns');
};

// create_distributed_table cannot run inside a transaction on Citus.
exports.config = { transaction: false };

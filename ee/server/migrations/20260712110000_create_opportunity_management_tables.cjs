const TABLES = [
  'opportunity_meeting_sessions',
  'opportunity_meeting_reviews',
  'opportunity_commitments',
  'opportunity_qbr_triggers',
];

async function hasCitus(knex) {
  const result = await knex.raw(`
    SELECT EXISTS (
      SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table'
    ) AS available
  `);
  return Boolean(result.rows?.[0]?.available);
}

async function distribute(knex, table) {
  if (!await hasCitus(knex)) return;
  await knex.raw(
    `SELECT create_distributed_table(?::regclass, 'tenant', colocate_with => 'opportunities')`,
    [table],
  );
}

exports.up = async function up(knex) {
  await knex.schema.createTable('opportunity_meeting_sessions', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('session_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('started_by').notNullable();
    table.timestamp('started_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'session_id']);
  });

  await knex.schema.createTable('opportunity_meeting_reviews', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('review_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('session_id').notNullable();
    table.uuid('opportunity_id').notNullable();
    table.timestamp('reviewed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('note').nullable();
    table.primary(['tenant', 'review_id']);
    table.unique(['tenant', 'session_id', 'opportunity_id']);
  });

  await knex.schema.createTable('opportunity_commitments', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('commitment_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('opportunity_id').notNullable();
    table.text('description').notNullable();
    table.uuid('made_by').notNullable();
    table.timestamp('made_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.text('resolution_status').notNullable().defaultTo('open');
    table.uuid('resolution_ref_id').nullable();
    table.uuid('resolved_by').nullable();
    table.timestamp('resolved_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'commitment_id']);
  });

  await knex.schema.createTable('opportunity_qbr_triggers', (table) => {
    table.uuid('tenant').notNullable();
    table.uuid('trigger_id').defaultTo(knex.raw('gen_random_uuid()')).notNullable();
    table.uuid('client_id').notNullable();
    table.text('trigger_key').notNullable();
    table.text('trigger_kind').notNullable();
    table.timestamp('fired_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('last_seen_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.uuid('created_opportunity_id').nullable();
    table.timestamp('accepted_at', { useTz: true }).nullable();
    table.primary(['tenant', 'trigger_id']);
    table.unique(['tenant', 'client_id', 'trigger_key']);
  });

  for (const table of TABLES) await distribute(knex, table);

  await knex.raw(`
    ALTER TABLE opportunity_meeting_sessions
      ADD CONSTRAINT opportunity_meeting_sessions_started_by_fk
      FOREIGN KEY (tenant, started_by) REFERENCES users (tenant, user_id)
  `);
  await knex.raw(`
    ALTER TABLE opportunity_meeting_reviews
      ADD CONSTRAINT opportunity_meeting_reviews_session_fk
      FOREIGN KEY (tenant, session_id)
      REFERENCES opportunity_meeting_sessions (tenant, session_id) ON DELETE CASCADE,
      ADD CONSTRAINT opportunity_meeting_reviews_opportunity_fk
      FOREIGN KEY (tenant, opportunity_id)
      REFERENCES opportunities (tenant, opportunity_id) ON DELETE CASCADE
  `);
  await knex.raw(`
    ALTER TABLE opportunity_commitments
      ADD CONSTRAINT opportunity_commitments_opportunity_fk
      FOREIGN KEY (tenant, opportunity_id)
      REFERENCES opportunities (tenant, opportunity_id) ON DELETE CASCADE,
      ADD CONSTRAINT opportunity_commitments_made_by_fk
      FOREIGN KEY (tenant, made_by) REFERENCES users (tenant, user_id),
      ADD CONSTRAINT opportunity_commitments_resolved_by_fk
      FOREIGN KEY (tenant, resolved_by) REFERENCES users (tenant, user_id),
      ADD CONSTRAINT opportunity_commitments_resolution_status_check
      CHECK (resolution_status IN ('open', 'quote_line', 'agreement_line', 'project_task', 'declined')),
      ADD CONSTRAINT opportunity_commitments_resolution_fields_check
      CHECK (
        (resolution_status = 'open' AND resolution_ref_id IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
        OR
        (resolution_status <> 'open' AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
      )
  `);
  await knex.raw(`
    ALTER TABLE opportunity_qbr_triggers
      ADD CONSTRAINT opportunity_qbr_triggers_client_fk
      FOREIGN KEY (tenant, client_id) REFERENCES clients (tenant, client_id) ON DELETE CASCADE,
      ADD CONSTRAINT opportunity_qbr_triggers_opportunity_fk
      FOREIGN KEY (tenant, created_opportunity_id)
      REFERENCES opportunities (tenant, opportunity_id),
      ADD CONSTRAINT opportunity_qbr_triggers_kind_check
      CHECK (trigger_kind IN ('renewal', 'asset_aging', 'ticket_trend', 'whitespace'))
  `);

  await knex.raw(`
    CREATE INDEX idx_opportunity_meeting_sessions_active
    ON opportunity_meeting_sessions (tenant, started_by, started_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX idx_opportunity_commitments_open
    ON opportunity_commitments (tenant, opportunity_id)
    WHERE resolution_status = 'open'
  `);
  await knex.raw(`
    CREATE INDEX idx_opportunity_qbr_triggers_yield
    ON opportunity_qbr_triggers (tenant, client_id, fired_at)
  `);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('opportunity_qbr_triggers');
  await knex.schema.dropTableIfExists('opportunity_commitments');
  await knex.schema.dropTableIfExists('opportunity_meeting_reviews');
  await knex.schema.dropTableIfExists('opportunity_meeting_sessions');
};

exports.config = { transaction: false };

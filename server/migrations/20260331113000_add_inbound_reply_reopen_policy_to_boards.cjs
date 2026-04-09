/**
 * Add inbound email reopen policy settings to boards.
 *
 * - inbound_reply_reopen_enabled: whether closed tickets can reopen from inbound replies.
 * - inbound_reply_reopen_cutoff_hours: max age of closed ticket for reopen-on-reply.
 * - inbound_reply_reopen_status_id: optional explicit open status to use when reopening.
 * - inbound_reply_ai_ack_suppression_enabled: whether client ACK-like replies can stay closed via AI.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasReopenEnabled = await knex.schema.hasColumn('boards', 'inbound_reply_reopen_enabled');
  const hasCutoffHours = await knex.schema.hasColumn('boards', 'inbound_reply_reopen_cutoff_hours');
  const hasReopenStatusId = await knex.schema.hasColumn('boards', 'inbound_reply_reopen_status_id');
  const hasAiAckSuppression = await knex.schema.hasColumn('boards', 'inbound_reply_ai_ack_suppression_enabled');

  await knex.schema.alterTable('boards', (table) => {
    if (!hasReopenEnabled) {
      table.boolean('inbound_reply_reopen_enabled').notNullable().defaultTo(false);
    }
    if (!hasCutoffHours) {
      table.integer('inbound_reply_reopen_cutoff_hours').notNullable().defaultTo(168);
    }
    if (!hasReopenStatusId) {
      table.uuid('inbound_reply_reopen_status_id').nullable();
    }
    if (!hasAiAckSuppression) {
      table.boolean('inbound_reply_ai_ack_suppression_enabled').notNullable().defaultTo(false);
    }
  });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'boards_inbound_reply_reopen_status_fk'
      ) THEN
        ALTER TABLE boards
        ADD CONSTRAINT boards_inbound_reply_reopen_status_fk
        FOREIGN KEY (tenant, inbound_reply_reopen_status_id)
        REFERENCES statuses (tenant, status_id);
      END IF;
    END
    $$;
  `);

  await knex.raw(
    'CREATE INDEX IF NOT EXISTS boards_inbound_reply_reopen_status_idx ON boards (tenant, inbound_reply_reopen_status_id)'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasReopenStatusId = await knex.schema.hasColumn('boards', 'inbound_reply_reopen_status_id');
  const hasAiAckSuppression = await knex.schema.hasColumn('boards', 'inbound_reply_ai_ack_suppression_enabled');
  const hasCutoffHours = await knex.schema.hasColumn('boards', 'inbound_reply_reopen_cutoff_hours');
  const hasReopenEnabled = await knex.schema.hasColumn('boards', 'inbound_reply_reopen_enabled');

  if (hasReopenStatusId) {
    await knex.raw('DROP INDEX IF EXISTS boards_inbound_reply_reopen_status_idx');
    await knex.raw('ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_inbound_reply_reopen_status_fk');
  }

  await knex.schema.alterTable('boards', (table) => {
    if (hasAiAckSuppression) {
      table.dropColumn('inbound_reply_ai_ack_suppression_enabled');
    }
    if (hasReopenStatusId) {
      table.dropColumn('inbound_reply_reopen_status_id');
    }
    if (hasCutoffHours) {
      table.dropColumn('inbound_reply_reopen_cutoff_hours');
    }
    if (hasReopenEnabled) {
      table.dropColumn('inbound_reply_reopen_enabled');
    }
  });
};

// Citus requires ALTER TABLE with foreign key constraints outside transaction block.
exports.config = { transaction: false };

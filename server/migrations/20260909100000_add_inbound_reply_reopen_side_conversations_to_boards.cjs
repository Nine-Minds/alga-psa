/**
 * Add the board-level opt-in that extends the existing inbound reply reopen
 * policy to named-conversation side (vendor / Shared IT) email replies.
 *
 * - inbound_reply_reopen_side_conversations_enabled: default false. Has no
 *   effect unless the master `inbound_reply_reopen_enabled` switch is also on
 *   (see 20260331113000_add_inbound_reply_reopen_policy_to_boards.cjs). When
 *   both are on, side-conversation replies reuse the existing cutoff, status
 *   fallback, acknowledgment classification, automated-reply and rate-limit
 *   policy rather than introducing a parallel one.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasSideConversationsEnabled = await knex.schema.hasColumn(
    'boards',
    'inbound_reply_reopen_side_conversations_enabled'
  );

  await knex.schema.alterTable('boards', (table) => {
    if (!hasSideConversationsEnabled) {
      table.boolean('inbound_reply_reopen_side_conversations_enabled').notNullable().defaultTo(false);
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  const hasSideConversationsEnabled = await knex.schema.hasColumn(
    'boards',
    'inbound_reply_reopen_side_conversations_enabled'
  );

  await knex.schema.alterTable('boards', (table) => {
    if (hasSideConversationsEnabled) {
      table.dropColumn('inbound_reply_reopen_side_conversations_enabled');
    }
  });
};

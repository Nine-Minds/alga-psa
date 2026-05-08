/**
 * Add sender_display_name to email_providers.
 *
 * Optional per-provider override for the From-name shown on outbound
 * ticket emails. When set, ticket reply / closed paths use this instead of
 * defaulting to the board name. Null preserves existing behavior (board_name fallback).
 */

exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('email_providers', 'sender_display_name');
  if (!hasColumn) {
    await knex.schema.alterTable('email_providers', (table) => {
      table.string('sender_display_name', 255).nullable();
    });
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('email_providers', 'sender_display_name');
  if (hasColumn) {
    await knex.schema.alterTable('email_providers', (table) => {
      table.dropColumn('sender_display_name');
    });
  }
};

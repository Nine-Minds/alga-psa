/**
 * Migration: Add 2FA device recognition
 *
 * Adds support for 2FA device recognition (skip 2FA for known devices)
 *
 * NOTE: Session limits are enforced at the platform level (hardcoded to 5 sessions)
 * to prevent account sharing. This is not configurable to maintain security.
 */

exports.up = async function(knex) {
  // Add 2FA device recognition setting
  await knex.schema.alterTable('users', (table) => {
    table.boolean('two_factor_required_new_device').defaultTo(false);
  });
};

exports.down = async function(knex) {
  await knex.schema.alterTable('users', (table) => {
    table.dropColumn('two_factor_required_new_device');
  });
};

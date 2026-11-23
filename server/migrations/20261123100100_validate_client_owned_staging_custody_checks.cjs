'use strict';

/**
 * Validates the CHECK constraints re-stated NOT VALID by 20261123100000_add_client_owned_staging_custody_values
 * (alga-2026-0002683). Widening a CHECK cannot invalidate an existing row, so this only takes a SHARE UPDATE
 * EXCLUSIVE lock. Idempotent. `down` is a no-op: the previous migration's `down` restates the old constraints.
 */

exports.config = { transaction: false };

exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE asset_custody VALIDATE CONSTRAINT asset_custody_close_reason_check');
  await knex.raw('ALTER TABLE asset_custody_events VALIDATE CONSTRAINT asset_custody_events_type_check');
};

exports.down = async function down() {};

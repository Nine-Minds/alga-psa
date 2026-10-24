'use strict';

/**
 * Backfill: blank optional client_locations fields -> NULL (alga-2026-0002724).
 *
 * The location model now stores '' / whitespace-only optional fields as NULL on
 * write. This clears the same values already stored. Idempotent: rows whose
 * column is NULL or non-blank are untouched, so a re-run updates nothing.
 *
 * Citus-safe: plain UPDATEs filtered by the distribution column (tenant), one
 * tenant at a time (single-shard each). No constraints or indexes are added, so
 * the stale-local-heap trap does not apply.
 */

const OPTIONAL_COLUMNS = [
  'location_name',
  'address_line2',
  'address_line3',
  'state_province',
  'postal_code',
  'region_code',
  'notes',
];

exports.up = async function up(knex) {
  const tenants = await knex('client_locations').distinct('tenant').pluck('tenant');
  for (const tenant of tenants) {
    for (const column of OPTIONAL_COLUMNS) {
      await knex('client_locations')
        .where({ tenant })
        .whereRaw('?? IS NOT NULL AND TRIM(??) = \'\'', [column, column])
        .update({ [column]: null });
    }
  }
};

exports.down = async function down() {
  // No-op: the original '' / whitespace values are not recoverable, and they
  // carried no information (NULL is the canonical "not set" for these fields).
};

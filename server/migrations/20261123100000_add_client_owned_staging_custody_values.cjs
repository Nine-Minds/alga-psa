'use strict';

/**
 * Client-owned staging custody (alga-2026-0002683, C6 follow-up). Design:
 * docs/plans/2026-11-23-client-owned-staging-custody.md (D4).
 *
 * Widens two CHECK constraints, nothing else:
 *   - asset_custody_close_reason_check   + 'installed_at_client'  (device installed on site; leaves custody)
 *   - asset_custody_events_type_check    + 'sealed', 'unsealed'    (staging box sealed / reopened)
 *
 * Re-stated NOT VALID so the ACCESS EXCLUSIVE lock of the DROP/ADD is momentary; the VALIDATE lives in the next
 * migration (a `transaction: false` file, lint rule R2). Idempotent. Pure DDL, so no row access is needed.
 *
 * `down` narrows the constraints back after refusing if any row already uses a new value.
 */

const CLOSE_REASONS = ['returned_to_client', 'disposed', 'transferred_to_rma', 'returned_to_vendor'];
const NEW_CLOSE_REASONS = [...CLOSE_REASONS, 'installed_at_client'];
const EVENT_TYPES = ['received', 'moved', 'handed_off', 'shipped', 'returned'];
const NEW_EVENT_TYPES = [...EVENT_TYPES, 'sealed', 'unsealed'];
const list = (values) => values.map((v) => `'${v}'`).join(', ');

// NOT VALID only; the matching VALIDATE is in 20261123100100_validate_client_owned_staging_custody_checks.cjs.
async function restate(knex, table, constraint, expression) {
  await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${constraint}`);
  await knex.raw(`ALTER TABLE ${table} ADD CONSTRAINT ${constraint} CHECK (${expression}) NOT VALID`);
}

exports.up = async function up(knex) {
  await restate(knex, 'asset_custody', 'asset_custody_close_reason_check', `close_reason IS NULL OR close_reason IN (${list(NEW_CLOSE_REASONS)})`);
  await restate(knex, 'asset_custody_events', 'asset_custody_events_type_check', `event_type IN (${list(NEW_EVENT_TYPES)})`);
};

exports.down = async function down(knex) {
  const used = await knex.raw(
    `SELECT
       (SELECT count(*) FROM asset_custody WHERE close_reason = 'installed_at_client')::int AS custody,
       (SELECT count(*) FROM asset_custody_events WHERE event_type IN ('sealed', 'unsealed'))::int AS events`
  );
  const { custody, events } = used.rows[0];
  if (custody > 0 || events > 0) {
    throw new Error(
      `Cannot roll back: ${custody} custody episode(s) closed as installed_at_client and ${events} sealed/unsealed custody event(s) exist.`
    );
  }
  await restate(knex, 'asset_custody', 'asset_custody_close_reason_check', `close_reason IS NULL OR close_reason IN (${list(CLOSE_REASONS)})`);
  await restate(knex, 'asset_custody_events', 'asset_custody_events_type_check', `event_type IN (${list(EVENT_TYPES)})`);
};

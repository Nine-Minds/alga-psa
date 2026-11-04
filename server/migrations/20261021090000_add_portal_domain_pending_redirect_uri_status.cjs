'use strict';

/**
 * alga-2026-0002799: MSP-surface custom domains.
 *
 * Adds the `pending_redirect_uri` value to portal_domain_status. It is the
 * status an MSP/both-surface domain is parked in when its SSO provider redirect
 * URIs cannot be confirmed as registered (activating silently would hand the
 * tenant a broken SSO login).
 *
 * Kept in its own migration with transaction disabled: a newly added enum value
 * cannot be used in the transaction that added it, and ALTER TYPE ... ADD VALUE
 * is not allowed inside a transaction block on older Postgres / on Citus type
 * propagation. IF NOT EXISTS makes re-runs safe.
 */
exports.config = { transaction: false };

exports.up = async function up(knex) {
  await knex.raw(`ALTER TYPE portal_domain_status ADD VALUE IF NOT EXISTS 'pending_redirect_uri'`);
};

// Postgres cannot drop an enum value. Rows are normalised back to a pre-existing
// status so that rolling the application back never reads an unknown status;
// the (now unused) enum value is intentionally left in place.
exports.down = async function down(knex) {
  await knex.raw(`UPDATE portal_domains SET status = 'pending_dns' WHERE status::text = 'pending_redirect_uri'`);
};

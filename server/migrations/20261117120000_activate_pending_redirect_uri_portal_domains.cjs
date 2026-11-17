'use strict';

/**
 * alga-2026-0002996: MSP custom-domain SSO now runs on the canonical host and hands the
 * session to the custom domain, so a domain serving the MSP app no longer waits on SSO
 * redirect URIs. Every domain parked in `pending_redirect_uri` by the removed gate
 * (alga-2026-0002799) becomes `active`, and the gate's bookkeeping is stripped from its
 * `verification_details`.
 *
 * A row only reached `pending_redirect_uri` after HTTPS and routing were ready (hosted:
 * gateway + virtual service exist; appliance: registered), so it is ready to serve.
 * Rows in any other status are untouched.
 *
 * The enum value stays: Postgres cannot drop one, and no application code writes it any more.
 *
 * Citus: `portal_domains` is tenant-distributed, so this is a multi-shard UPDATE. The
 * timestamp is bound as a parameter (never `now()`, which is not allowed inside CASE /
 * COALESCE on a distributed table) and the statement is a single UPDATE with no subquery,
 * join or CTE, so it runs per shard. Only IMMUTABLE operators touch columns (the enum is compared to a literal, not cast to text): Citus rejects STABLE
 * functions (jsonb_exists, the `?` operator, enum-to-text casts) called with column references in an UPDATE.
 */

const LIVE_MESSAGE_HOSTED = 'Your domain is live and protected by HTTPS.';

exports.up = async function up(knex) {
  // Appliance (direct-mode) rows carry `proxy_target_host` and use the proxy-contract
  // message; hosted rows use the HTTPS message the deployment-status activity writes.
  // migration-lint: allow 5 - one-shot data fix on portal_domains (at most a few rows per tenant, only those parked in pending_redirect_uri); a loop + LIMIT would split a single-statement multi-shard UPDATE for no benefit
  await knex.raw(
    `UPDATE portal_domains
        SET status = 'active',
            status_message = CASE
              WHEN verification_details -> 'proxy_target_host' IS NOT NULL
                THEN 'Active. Ensure ' || domain || ' resolves to this server and that your reverse proxy terminates TLS and forwards the original Host header to it.'
              ELSE ?
            END,
            verification_details = verification_details - 'sso_redirect_uris',
            last_checked_at = ?,
            updated_at = ?
      WHERE status = 'pending_redirect_uri'`,
    [LIVE_MESSAGE_HOSTED, new Date(), new Date()]
  );
};

// The retired status is not restored: nothing can act on it any more. Rolled-back code
// reads these rows as ordinary active domains.
exports.down = async function down() {};

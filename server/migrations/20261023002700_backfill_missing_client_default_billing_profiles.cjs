'use strict';

/**
 * Gap-fill the "every client has exactly one default billing profile" invariant.
 *
 * The S1 migration (20260816000000_create_client_billing_profiles.cjs) backfilled
 * every client that existed at migration time, and createClient provisions one for
 * every client created through the UI/API since. Creation paths that bypassed it —
 * the Entra tenant import being the one that prompted this — left clients with no
 * default profile, which breaks the terminal step of charge attribution.
 *
 * Deliberately generic rather than Entra-only: any straggler from any path gets the
 * same repair. Idempotent (NOT EXISTS guard) and colocated per tenant, so the
 * INSERT...SELECT is a single-shard write on Citus exactly like the S1 backfill.
 */

const TABLE = 'client_billing_profiles';

exports.up = async function up(knex) {
  // migration-lint: allow 5 - retroactive: insert-select of one default billing profile per client lacking one; idempotent, merged before the lint existed
  await knex.raw(`
    INSERT INTO ${TABLE} (
      tenant, billing_profile_id, client_id, name,
      is_default, is_system_managed_default, is_active,
      created_at, updated_at
    )
    SELECT
      c.tenant,
      gen_random_uuid(),
      c.client_id,
      c.client_name,
      true,
      true,
      true,
      now(),
      now()
    FROM clients c
    WHERE NOT EXISTS (
      SELECT 1 FROM ${TABLE} p
      WHERE p.tenant = c.tenant
        AND p.client_id = c.client_id
        AND p.is_default = true
    )
  `);
};

// Irreversible by design: the rows restore an invariant every client must satisfy,
// and there is no way to tell them apart from the ones S1 or createClient wrote.
exports.down = async function down() {};

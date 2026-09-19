/**
 * Add a reversible tenant-wide suspension flag. A suspended tenant's
 * background work (jobs, event-triggered workflows, integrations ingestion,
 * API keys, public endpoints, outbound tenant email) is gated at chokepoints;
 * nothing is torn down, so clearing the flag restores everything.
 *
 * Follows the hasColumn-guarded pattern used by other `tenants` alters
 * (see 20260505140000_add_tenant_product_code.cjs).
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  const hasSuspendedAt = await knex.schema.hasColumn('tenants', 'suspended_at');
  if (!hasSuspendedAt) {
    await knex.raw(`
      ALTER TABLE tenants
      ADD COLUMN suspended_at timestamptz
    `);
  }

  const hasSuspendedReason = await knex.schema.hasColumn('tenants', 'suspended_reason');
  if (!hasSuspendedReason) {
    await knex.raw(`
      ALTER TABLE tenants
      ADD COLUMN suspended_reason text
    `);
  }

  await knex.raw(`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS tenants_suspended_reason_check
  `);

  await knex.raw(`
    ALTER TABLE tenants
    ADD CONSTRAINT tenants_suspended_reason_check
    CHECK (
      (suspended_at IS NULL AND suspended_reason IS NULL)
      OR
      (suspended_at IS NOT NULL AND suspended_reason IN ('tenant_cancelled'))
    )
  `);
};

/** @param { import('knex').Knex } knex */
exports.down = async function down(knex) {
  await knex.raw(`
    ALTER TABLE tenants
    DROP CONSTRAINT IF EXISTS tenants_suspended_reason_check
  `);

  await knex.raw(`
    ALTER TABLE tenants
    DROP COLUMN IF EXISTS suspended_reason
  `);

  await knex.raw(`
    ALTER TABLE tenants
    DROP COLUMN IF EXISTS suspended_at
  `);
};

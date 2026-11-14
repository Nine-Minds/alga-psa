/**
 * Global ownership of Stripe customer ids (alga-2026-0002926).
 *
 * `stripe_customers` is tenant-scoped (PK/unique keys all lead with `tenant`) and may be
 * Citus-distributed on `tenant` in production (no migration in this repo distributes it, but
 * production tables have been distributed out-of-band before). On a distributed table a UNIQUE
 * index that omits the distribution column is impossible, so a plain
 * `UNIQUE (stripe_customer_external_id)` cannot be relied on. Instead this adds a global
 * binding table with PRIMARY KEY (stripe_customer_external_id): one external id, one tenant.
 * It is a Citus *reference* table when Citus is available (reference tables may carry any
 * unique key), and it deliberately has no foreign key to `tenants` (a reference table cannot
 * reference a distributed table). Every writer of `stripe_customers` inserts the binding in the
 * same transaction; the tenant-deletion manifest releases it with the tenant.
 *
 * PRE-FLIGHT: if any external id is already present under more than one tenant the migration
 * FAILS, listing them, and changes nothing. It never picks a winner; resolve the disputes by
 * hand (the captain decides), then re-run.
 */

const TABLE = 'stripe_customer_bindings';

async function findCrossTenantDuplicates(knex) {
  const { rows } = await knex.raw(`
    SELECT stripe_customer_external_id AS external_id,
           array_agg(DISTINCT tenant::text ORDER BY tenant::text) AS tenants
    FROM stripe_customers
    GROUP BY stripe_customer_external_id
    HAVING COUNT(DISTINCT tenant) > 1
    ORDER BY stripe_customer_external_id
  `);
  return rows;
}

exports.up = async function up(knex) {
  const duplicates = await findCrossTenantDuplicates(knex);
  if (duplicates.length > 0) {
    const lines = duplicates.map((d) => `  ${d.external_id} -> tenants [${d.tenants.join(', ')}]`);
    throw new Error(
      `Cannot enforce global uniqueness of stripe_customer_external_id: ${duplicates.length} ` +
        `Stripe customer id(s) are bound to more than one tenant. Resolve each dispute manually ` +
        `(delete or re-point the wrong stripe_customers rows), then re-run this migration:\n` +
        lines.join('\n')
    );
  }

  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
      table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.index(['tenant'], 'stripe_customer_bindings_tenant_idx');
    });
  }

  // Reference table on Citus; no-op on plain Postgres and when already a reference table.
  const hasFn = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_reference_table') AS present`);
  if (hasFn.rows?.[0]?.present) {
    const dist = await knex.raw(
      `SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS present`,
      [TABLE]
    );
    if (!dist.rows?.[0]?.present) {
      await knex.raw(`SELECT create_reference_table('${TABLE}')`);
    }
  }

  // Backfill from existing rows (pre-flight guarantees one tenant per id). Read then insert in
  // batches rather than INSERT..SELECT, which Citus cannot plan from a distributed table into a
  // reference table.
  const existing = await knex('stripe_customers')
    .distinct('stripe_customer_external_id', 'tenant')
    .orderBy('stripe_customer_external_id');
  for (let i = 0; i < existing.length; i += 500) {
    const batch = existing.slice(i, i + 500).map((r) => ({
      stripe_customer_external_id: r.stripe_customer_external_id,
      tenant: r.tenant,
    }));
    await knex(TABLE).insert(batch).onConflict('stripe_customer_external_id').ignore();
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };

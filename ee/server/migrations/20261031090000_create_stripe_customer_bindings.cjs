/** Enforce one global tenant owner for every non-empty Stripe customer id. */
const TABLE = 'stripe_customer_bindings';
const OWNER_CONSTRAINT = 'stripe_customers_binding_owner_fk';

async function up(knex) {
  await knex.transaction(async (trx) => {
    // The exclusion closes the scan/backfill window for both old and new writers.
    await trx.raw('LOCK TABLE stripe_customers IN ACCESS EXCLUSIVE MODE');
    if (!(await trx.schema.hasTable(TABLE))) {
      await trx.schema.createTable(TABLE, (table) => {
        table.text('stripe_customer_external_id').notNullable().primary();
        table.uuid('tenant').notNullable();
        table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(trx.fn.now());
        table.unique(['tenant', 'stripe_customer_external_id'], 'stripe_customer_bindings_owner_key');
        table.check("btrim(stripe_customer_external_id) <> ''", [], 'stripe_customer_bindings_nonempty_id');
        table.index(['tenant'], 'stripe_customer_bindings_tenant_idx');
      });
    } else {
      const check = await trx.raw(`SELECT 1 FROM pg_constraint WHERE conname='stripe_customer_bindings_nonempty_id' AND conrelid='stripe_customer_bindings'::regclass`);
      if (!check.rows.length) await trx.raw(`ALTER TABLE stripe_customer_bindings ADD CONSTRAINT stripe_customer_bindings_nonempty_id CHECK (btrim(stripe_customer_external_id) <> '') NOT VALID`);
    }

    // Reference tables make the global primary key and ownership FK valid on Citus.
    const hasFn = await trx.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_reference_table') AS present`);
    if (hasFn.rows?.[0]?.present) {
      const dist = await trx.raw(`SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS present`, [TABLE]);
      if (!dist.rows?.[0]?.present) await trx.raw(`SELECT create_reference_table(?)`, [TABLE]);
    }

    // Citus requires distributed-table DDL before any distributed query in the
    // transaction. NOT VALID still checks every new insert/update immediately;
    // the locked backfill below establishes the invariant for pre-existing rows.
    const fk = await trx.raw(`SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = 'stripe_customers'::regclass`, [OWNER_CONSTRAINT]);
    if (!fk.rows.length) {
      await trx.raw(`ALTER TABLE stripe_customers ADD CONSTRAINT ${OWNER_CONSTRAINT}
        FOREIGN KEY (tenant, stripe_customer_external_id)
        REFERENCES stripe_customer_bindings (tenant, stripe_customer_external_id) NOT VALID`);
    }

    const invalidBindings = await trx(TABLE)
      .whereRaw(`stripe_customer_external_id IS NULL OR btrim(stripe_customer_external_id) = ''`)
      .select('stripe_customer_external_id', 'tenant');
    if (invalidBindings.length) {
      throw new Error(`Cannot enforce global Stripe customer ownership: binding rows contain null or empty customer ids. Resolve them manually: ${JSON.stringify(invalidBindings)}`);
    }

    const invalid = await trx.raw(`SELECT stripe_customer_external_id AS external_id, array_agg(DISTINCT tenant::text ORDER BY tenant::text) AS tenants
      FROM stripe_customers GROUP BY stripe_customer_external_id
      HAVING stripe_customer_external_id IS NULL OR btrim(stripe_customer_external_id) = '' OR COUNT(DISTINCT tenant) > 1
      ORDER BY stripe_customer_external_id NULLS FIRST`);
    if (invalid.rows.length) {
      const details = invalid.rows.map((row) => `${row.external_id ?? '<null>'} -> tenants [${row.tenants.join(', ')}]`).join('\n');
      throw new Error(`Cannot enforce global Stripe customer ownership. Resolve empty/null ids and cross-tenant mappings manually, then rerun:\n${details}`);
    }

    const rows = await trx('stripe_customers').distinct('stripe_customer_external_id', 'tenant').orderBy('stripe_customer_external_id');
    for (let i = 0; i < rows.length; i += 500) {
      await trx(TABLE).insert(rows.slice(i, i + 500)).onConflict('stripe_customer_external_id').ignore();
    }
    const conflicts = await trx.raw(`SELECT sc.stripe_customer_external_id, sc.tenant AS mapping_tenant, b.tenant AS binding_tenant
      FROM stripe_customers sc LEFT JOIN stripe_customer_bindings b USING (stripe_customer_external_id)
      WHERE b.tenant IS NULL OR b.tenant <> sc.tenant LIMIT 20`);
    if (conflicts.rows.length) throw new Error(`Stripe customer binding backfill mismatch; resolve manually: ${JSON.stringify(conflicts.rows)}`);

  });
}

exports.up = up;
exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS ${OWNER_CONSTRAINT}`);
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };

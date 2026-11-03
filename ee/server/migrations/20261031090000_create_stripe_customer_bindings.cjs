/** Enforce one global tenant owner for every non-empty Stripe customer id. */
const TABLE = 'stripe_customer_bindings';

async function installEnforcement(knex) {
  // Trigger function is SECURITY DEFINER so legacy app roles need not gain write access
  // to the global registry. Dynamic schema qualification supports isolated migration tests.
  const schemaResult = await knex.raw('SELECT current_schema() AS schema');
  const schema = schemaResult.rows[0].schema;
  const q = (name) => `"${String(name).replace(/"/g, '""')}"`;
  const qualifiedFn = `${q(schema)}.${q('claim_stripe_customer_binding')}`;
  await knex.raw(`CREATE OR REPLACE FUNCTION ${qualifiedFn}() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
    DECLARE claimed_tenant uuid;
    BEGIN
      IF NEW.stripe_customer_external_id IS NULL OR btrim(NEW.stripe_customer_external_id) = '' THEN
        RAISE EXCEPTION 'stripe_customers requires a non-empty Stripe customer id' USING ERRCODE = '23514';
      END IF;
      EXECUTE format('INSERT INTO %I.stripe_customer_bindings AS binding (stripe_customer_external_id, tenant) VALUES ($1, $2) ON CONFLICT (stripe_customer_external_id) DO UPDATE SET tenant = EXCLUDED.tenant WHERE binding.tenant = EXCLUDED.tenant RETURNING tenant', TG_TABLE_SCHEMA)
        INTO claimed_tenant USING NEW.stripe_customer_external_id, NEW.tenant;
      IF claimed_tenant IS NULL THEN
        RAISE EXCEPTION 'Stripe customer id % is already bound to another tenant', NEW.stripe_customer_external_id USING ERRCODE = '23505';
      END IF;
      RETURN NEW;
    END $$`);
  await knex.raw(`DROP TRIGGER IF EXISTS stripe_customers_claim_binding_insert ON stripe_customers`);
  await knex.raw(`DROP TRIGGER IF EXISTS stripe_customers_claim_binding_update ON stripe_customers`);
  await knex.raw(`CREATE TRIGGER stripe_customers_claim_binding_insert BEFORE INSERT ON stripe_customers FOR EACH ROW EXECUTE FUNCTION ${qualifiedFn}()`);
  await knex.raw(`CREATE TRIGGER stripe_customers_claim_binding_update BEFORE UPDATE OF tenant, stripe_customer_external_id ON stripe_customers FOR EACH ROW EXECUTE FUNCTION ${qualifiedFn}()`);
}

async function up(knex) {
  await knex.transaction(async (trx) => {
    // Excludes every legacy insert/update while the exact set is checked, backfilled,
    // and protected. The lock is held until triggers are live and the transaction commits.
    await trx.raw('LOCK TABLE stripe_customers IN ACCESS EXCLUSIVE MODE');
    const invalid = await trx.raw(`SELECT stripe_customer_external_id AS external_id, array_agg(DISTINCT tenant::text ORDER BY tenant::text) AS tenants
      FROM stripe_customers GROUP BY stripe_customer_external_id
      HAVING stripe_customer_external_id IS NULL OR btrim(stripe_customer_external_id) = '' OR COUNT(DISTINCT tenant) > 1
      ORDER BY stripe_customer_external_id NULLS FIRST`);
    if (invalid.rows.length) {
      const details = invalid.rows.map((row) => `${row.external_id ?? '<null>'} -> tenants [${row.tenants.join(', ')}]`).join('\n');
      throw new Error(`Cannot enforce global Stripe customer ownership. Resolve empty/null ids and cross-tenant mappings manually, then rerun:\n${details}`);
    }

    if (!(await trx.schema.hasTable(TABLE))) {
      await trx.schema.createTable(TABLE, (table) => {
        table.text('stripe_customer_external_id').primary();
        table.uuid('tenant').notNullable();
        table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(trx.fn.now());
        table.index(['tenant'], 'stripe_customer_bindings_tenant_idx');
      });
    }
    const hasFn = await trx.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_reference_table') AS present`);
    if (hasFn.rows?.[0]?.present) {
      const dist = await trx.raw(`SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS present`, [TABLE]);
      if (!dist.rows?.[0]?.present) await trx.raw(`SELECT create_reference_table(?)`, [TABLE]);
    }
    const rows = await trx('stripe_customers').distinct('stripe_customer_external_id', 'tenant').orderBy('stripe_customer_external_id');
    for (let i = 0; i < rows.length; i += 500) {
      await trx(TABLE).insert(rows.slice(i, i + 500)).onConflict('stripe_customer_external_id').ignore();
    }
    const conflicts = await trx.raw(`SELECT sc.stripe_customer_external_id, sc.tenant AS mapping_tenant, b.tenant AS binding_tenant
      FROM stripe_customers sc LEFT JOIN stripe_customer_bindings b USING (stripe_customer_external_id)
      WHERE b.tenant IS NULL OR b.tenant <> sc.tenant LIMIT 20`);
    if (conflicts.rows.length) throw new Error(`Stripe customer binding backfill mismatch; resolve manually: ${JSON.stringify(conflicts.rows)}`);
    await installEnforcement(trx);
  });
}

exports.up = up;
exports.down = async function down(knex) {
  await knex.raw('DROP TRIGGER IF EXISTS stripe_customers_claim_binding_insert ON stripe_customers');
  await knex.raw('DROP TRIGGER IF EXISTS stripe_customers_claim_binding_update ON stripe_customers');
  const schema = (await knex.raw('SELECT current_schema() AS schema')).rows[0].schema;
  await knex.raw(`DROP FUNCTION IF EXISTS "${schema.replace(/"/g, '""')}"."claim_stripe_customer_binding"()`);
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };

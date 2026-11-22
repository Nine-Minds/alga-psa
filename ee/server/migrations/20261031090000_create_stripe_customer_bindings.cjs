/**
 * Establish a global tenant owner for every Stripe customer id.
 *
 * Global ownership is stored in a Citus reference table and enforced by a
 * composite foreign key where the table topology supports it. Citus local
 * tables whose FK graph includes distributed tables use a global unique key.
 * The
 * reference table must be converted before adding the FK to a distributed
 * table. The migration takes an ACCESS EXCLUSIVE lock on stripe_customers
 * before scanning it, fencing legacy and current writers through backfill and
 * NOT VALID FK creation. A later forward migration validates the constraint.
 */

const TABLE = 'stripe_customer_bindings';
const OWNER_KEY = 'stripe_customer_bindings_owner_key';
const OWNER_CONSTRAINT = 'stripe_customers_binding_owner_fk';
const CITUS_LOCAL_OWNER_KEY = 'stripe_customers_global_owner_key';

async function ensureBindingTable(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.text('stripe_customer_external_id').notNullable().primary();
      table.uuid('tenant').notNullable();
      table.timestamp('bound_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(['stripe_customer_external_id', 'tenant'], OWNER_KEY);
      table.index(['tenant'], 'stripe_customer_bindings_tenant_idx');
    });
  } else {
    const ownerKey = await knex.raw(
      'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass',
      [OWNER_KEY, TABLE]
    );
    if (ownerKey.rows.length === 0) {
      await knex.raw(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT ${OWNER_KEY} UNIQUE (stripe_customer_external_id, tenant)`
      );
    }
  }

  const hasReferenceFunction = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proname = 'create_reference_table') AS present`
  );
  if (hasReferenceFunction.rows?.[0]?.present) {
    const isDistributed = await knex.raw(
      'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_dist_partition WHERE logicalrelid = ?::regclass) AS present',
      [TABLE]
    );
    if (!isDistributed.rows?.[0]?.present) {
      // Citus requires reference-table conversion to finish before distributed
      // table foreign-key DDL, so this intentionally precedes the transaction.
      await knex.raw('SELECT pg_catalog.create_reference_table(?)', [TABLE]);
    }
  }
}

async function enforceOwnership(knex) {
  await ensureBindingTable(knex);

  await knex.transaction(async (trx) => {
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('stripe_customer_bindings_migration'))");

    const citusCatalog = await trx.raw(
      `SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS present`
    );
    let citus = false;
    let customersAreDistributed = false;
    if (citusCatalog.rows?.[0]?.present) {
      citus = true;
      const isDistributed = await trx.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_dist_partition WHERE logicalrelid = 'stripe_customers'::regclass) AS present"
      );
      customersAreDistributed = Boolean(isDistributed.rows?.[0]?.present);
      if (customersAreDistributed) {
        // Citus requires sequential shard modification for FK DDL involving a
        // reference table; PostgreSQL has no such setting, so scope it to Citus.
        await trx.raw("SET LOCAL citus.multi_shard_modify_mode = 'sequential'");
      }
    }

    // Current application writers claim the binding before inserting the
    // mapping. Lock in that same order, then the mapping table, to fence both
    // participating and legacy writers without introducing a lock inversion.
    await trx.raw(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE`);
    // This lock also excludes unmodified legacy writers. Hold both locks
    // through validation, backfill, and constraint creation.
    await trx.raw('LOCK TABLE stripe_customers IN ACCESS EXCLUSIVE MODE');

    const invalidRows = await trx.raw(`
      SELECT stripe_customer_external_id AS external_id,
             array_agg(DISTINCT tenant::text ORDER BY tenant::text)
               FILTER (WHERE tenant IS NOT NULL) AS tenants
      FROM stripe_customers
      GROUP BY stripe_customer_external_id
      HAVING stripe_customer_external_id IS NULL
          OR COUNT(*) FILTER (WHERE tenant IS NULL) > 0
          OR COUNT(DISTINCT tenant) > 1
      ORDER BY stripe_customer_external_id NULLS FIRST`);
    if (invalidRows.rows.length > 0) {
      throw new Error(
        `Cannot enforce Stripe customer tenant ownership: ${invalidRows.rows.length} ` +
          `mapping(s) have a null key or conflicting tenants. Resolve them manually, then re-run:\n` +
          invalidRows.rows
            .map((row) => `  ${row.external_id ?? '<null>'} -> tenants [${(row.tenants ?? []).join(', ')}]`)
            .join('\n')
      );
    }

    const conflicts = await trx.raw(`
      SELECT sc.stripe_customer_external_id AS external_id,
             sc.tenant AS mapping_tenant,
             b.tenant AS binding_tenant
      FROM stripe_customers sc
      JOIN ${TABLE} b USING (stripe_customer_external_id)
      WHERE b.tenant <> sc.tenant
      ORDER BY sc.stripe_customer_external_id`);
    if (conflicts.rows.length > 0) {
      throw new Error(
        `Cannot enforce Stripe customer tenant ownership: existing bindings conflict with mappings: ` +
          JSON.stringify(conflicts.rows)
      );
    }

    const existing = await trx('stripe_customers')
      .distinct('stripe_customer_external_id', 'tenant')
      .orderBy('stripe_customer_external_id');
    for (let offset = 0; offset < existing.length; offset += 500) {
      const batch = existing.slice(offset, offset + 500);
      for (const binding of batch) {
        const current = await trx(TABLE)
          .where({ stripe_customer_external_id: binding.stripe_customer_external_id })
          .first('tenant');
        if (!current) {
          // Do not ignore conflicts: a concurrent or pre-existing different
          // owner must abort, never be silently accepted.
          await trx(TABLE).insert(binding);
        } else if (current.tenant !== binding.tenant) {
          throw new Error(
            `Cannot enforce Stripe customer tenant ownership: ${binding.stripe_customer_external_id} ` +
              `is bound to tenant ${current.tenant}, but its mapping belongs to ${binding.tenant}`
          );
        }
      }
    }

    const mismatch = await trx.raw(`
      SELECT sc.stripe_customer_external_id AS external_id,
             sc.tenant AS mapping_tenant,
             b.tenant AS binding_tenant
      FROM stripe_customers sc
      LEFT JOIN ${TABLE} b USING (stripe_customer_external_id)
      WHERE b.tenant IS NULL OR b.tenant <> sc.tenant
      LIMIT 20`);
    if (mismatch.rows.length > 0) {
      throw new Error(
        `Stripe customer tenant binding backfill mismatch: ${JSON.stringify(mismatch.rows)}`
      );
    }

    if (!citus || customersAreDistributed) {
      const constraint = await trx.raw(
        'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = \'stripe_customers\'::regclass',
        [OWNER_CONSTRAINT]
      );
      if (constraint.rows.length === 0) {
        await trx.raw(`
          ALTER TABLE stripe_customers
          ADD CONSTRAINT ${OWNER_CONSTRAINT}
          FOREIGN KEY (stripe_customer_external_id, tenant)
          REFERENCES ${TABLE} (stripe_customer_external_id, tenant)
          NOT VALID`);
      }
    } else {
      // Citus cannot add a local-to-reference FK when the local table's FK
      // graph includes distributed tables. Local Stripe mappings therefore
      // enforce the global ownership key directly; all supported DB writers
      // still claim the reference binding first, and application reads verify
      // that binding. Distributed stripe_customers retain the composite FK.
      const ownerKey = await trx.raw(
        'SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = \'stripe_customers\'::regclass',
        [CITUS_LOCAL_OWNER_KEY]
      );
      if (ownerKey.rows.length === 0) {
        await trx.raw(`
          ALTER TABLE stripe_customers
          ADD CONSTRAINT ${CITUS_LOCAL_OWNER_KEY}
          UNIQUE (stripe_customer_external_id)`);
      }
    }
  });
}

exports.up = enforceOwnership;
exports.enforceOwnership = enforceOwnership;
exports.ownerConstraint = OWNER_CONSTRAINT;
exports.citusLocalOwnerKey = CITUS_LOCAL_OWNER_KEY;
exports.bindingTable = TABLE;

exports.down = async function down(knex) {
  await knex.raw(`ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS ${OWNER_CONSTRAINT}`);
  await knex.raw(`ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS ${CITUS_LOCAL_OWNER_KEY}`);
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };

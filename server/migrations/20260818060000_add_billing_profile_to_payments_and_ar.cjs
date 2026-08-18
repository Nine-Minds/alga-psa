'use strict';

/**
 * Billing profiles — slices S9 and S10: profile-scoped payment methods and AR
 * (features F102–F104, F107–F110 of the billing-profiles plan).
 *
 * Decision D7 is what these two slices implement: credits, prepayments, aging,
 * and statements are **profile-scoped with client-level rollup**. Sibling
 * profiles routinely have different cards and different owners, so a credit
 * issued to one entity silently paying another entity's invoice is a real AR
 * defect, not a convenience.
 *
 * Every column here is backfilled to the client's default profile and then made
 * NOT NULL, so a client nobody has segmented ends up with exactly the AR it has
 * today — one profile, one balance, one set of cards.
 *
 * `credit_allocations` is the exception: it takes its profile from the
 * transaction it allocates, and is nullable for rows that predate profiles.
 */

const PROFILES = 'client_billing_profiles';

/**
 * `payment_methods` is the only NOT NULL of the three (F102). A stored card
 * belongs to exactly one paying entity — the whole point of the slice — and the
 * F104 uniqueness index below is keyed on the profile, so a null would silently
 * opt a card out of the "one default per profile" rule.
 *
 * `transactions` and `credit_tracking` stay nullable (F107, F108) and are
 * populated by every write path. A transaction is a ledger entry whose profile
 * is a property of the invoice or credit it references, not an independent fact
 * about the money; forcing NOT NULL would make ~20 unrelated ledger call sites
 * answer a question the ledger does not ask. Nullable also means an unhandled
 * path degrades to a client-wide credit rather than throwing inside a payment.
 */
const PROFILE_TABLES = [
  { table: 'payment_methods', clientColumn: 'client_id', notNull: true },
  { table: 'transactions', clientColumn: 'client_id', notNull: false },
  { table: 'credit_tracking', clientColumn: 'client_id', notNull: false },
];

const hasColumn = async (knex, tableName, columnName) => {
  try {
    return await knex.schema.hasColumn(tableName, columnName);
  } catch {
    return false;
  }
};

const hasConstraint = async (knex, tableName, constraintName) => {
  const result = await knex.raw(
    `SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = ? AND conrelid = ?::regclass
    ) AS present`,
    [constraintName, tableName]
  );
  return Boolean(result.rows?.[0]?.present);
};

// Returns true/false for "in pg_dist_partition" and null when Citus is absent
// (plain Postgres). Same probe shape as 20260816010000.
async function distributionState(knex, tableName) {
  try {
    const result = await knex.raw(`
      SELECT EXISTS (
        SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
      ) AS distributed
    `, [tableName]);
    return Boolean(result.rows?.[0]?.distributed);
  } catch {
    return null;
  }
}

async function backfillToDefaultProfile(knex, table, clientColumn) {
  await knex.raw(`
    UPDATE ${table} t
    SET billing_profile_id = p.billing_profile_id
    FROM ${PROFILES} p
    WHERE p.tenant = t.tenant
      AND p.client_id = t.${clientColumn}
      AND p.is_default = true
      AND t.billing_profile_id IS NULL
  `);

  const tableDistributed = await distributionState(knex, table);
  const profilesDistributed = await distributionState(knex, PROFILES);
  if (tableDistributed === profilesDistributed) {
    // Same distribution shape (always the case on plain Postgres): one
    // set-based statement.
    await knex.raw(`
      INSERT INTO ${PROFILES} (tenant, billing_profile_id, client_id, name, is_default, is_system_managed_default, is_active)
      SELECT DISTINCT t.tenant, gen_random_uuid(), t.${clientColumn}, c.client_name, true, true, true
      FROM ${table} t
      JOIN clients c ON c.tenant = t.tenant AND c.client_id = t.${clientColumn}
      WHERE t.billing_profile_id IS NULL
        AND t.${clientColumn} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${PROFILES} p
          WHERE p.tenant = t.tenant AND p.client_id = t.${clientColumn}
        )
    `);
  } else {
    // Citus with mixed shapes (several of these tables are coordinator-local
    // there while profiles are distributed): INSERT...SELECT joining a local
    // table with distributed tables is rejected at plan time. Row-by-row from
    // the migration process instead — identical semantics, Citus-compatible.
    const pending = await knex.raw(`
      SELECT DISTINCT t.tenant, t.${clientColumn} AS client_id
      FROM ${table} t
      WHERE t.billing_profile_id IS NULL
        AND t.${clientColumn} IS NOT NULL
    `);
    for (const row of pending.rows ?? []) {
      const existing = await knex(PROFILES)
        .where({ tenant: row.tenant, client_id: row.client_id })
        .first();
      if (existing) continue;
      const client = await knex('clients')
        .where({ tenant: row.tenant, client_id: row.client_id })
        .first('client_name');
      await knex(PROFILES).insert({
        tenant: row.tenant,
        billing_profile_id: knex.raw('gen_random_uuid()'),
        client_id: row.client_id,
        name: client?.client_name ?? row.client_id,
        is_default: true,
        is_system_managed_default: true,
        is_active: true,
      });
    }
  }
  await knex.raw(`
    UPDATE ${table} t
    SET billing_profile_id = p.billing_profile_id
    FROM ${PROFILES} p
    WHERE p.tenant = t.tenant
      AND p.client_id = t.${clientColumn}
      AND p.is_default = true
      AND t.billing_profile_id IS NULL
  `);
}

exports.up = async function up(knex) {
  for (const { table, clientColumn, notNull } of PROFILE_TABLES) {
    if (!(await knex.schema.hasTable(table))) continue;

    if (!(await hasColumn(knex, table, 'billing_profile_id'))) {
      await knex.schema.alterTable(table, (t) => {
        t.uuid('billing_profile_id').nullable();
      });
    }
    await backfillToDefaultProfile(knex, table, clientColumn);

    if (notNull) {
      // Rows with no client at all cannot be attributed, and a NOT NULL would
      // reject them. Those are pre-existing orphans, so the column stays
      // nullable where any survive rather than deleting AR history to satisfy a
      // constraint.
      const orphans = await knex.raw(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE billing_profile_id IS NULL`
      );
      if ((orphans.rows?.[0]?.count ?? 0) === 0) {
        await knex.raw(`ALTER TABLE ${table} ALTER COLUMN billing_profile_id SET NOT NULL`);
      } else {
        console.log(
          `${table}: ${orphans.rows[0].count} row(s) have no client; leaving billing_profile_id nullable`
        );
      }
    }

    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_${table}_billing_profile
      ON ${table} (tenant, billing_profile_id)
    `);

    const fkName = `${table}_billing_profile_foreign`;
    if (!(await hasConstraint(knex, table, fkName))) {
      await knex.raw(`
        ALTER TABLE ${table}
        ADD CONSTRAINT ${fkName}
        FOREIGN KEY (tenant, billing_profile_id)
        REFERENCES ${PROFILES} (tenant, billing_profile_id)
        ON DELETE RESTRICT
      `);
    }
  }

  // --- F109: credit_allocations ---
  // No client column of its own; the profile comes from the allocated
  // transaction, which is where the credit was issued.
  if (await knex.schema.hasTable('credit_allocations')) {
    if (!(await hasColumn(knex, 'credit_allocations', 'billing_profile_id'))) {
      await knex.schema.alterTable('credit_allocations', (t) => {
        t.uuid('billing_profile_id').nullable();
      });
    }
    await knex.raw(`
      UPDATE credit_allocations ca
      SET billing_profile_id = t.billing_profile_id
      FROM transactions t
      WHERE t.tenant = ca.tenant
        AND t.transaction_id = ca.transaction_id
        AND ca.billing_profile_id IS NULL
    `);
    await knex.raw(`
      CREATE INDEX IF NOT EXISTS idx_credit_allocations_billing_profile
      ON credit_allocations (tenant, billing_profile_id)
    `);
  }

  // --- F104: default payment method uniqueness moves to the profile ---
  // Two separately-billed entities each need their own card on file, and each
  // needs one of them to be the default.
  await knex.raw('DROP INDEX IF EXISTS payment_methods_default_per_client_unique');
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_default_per_profile_unique
    ON payment_methods (tenant, client_id, billing_profile_id)
    WHERE is_default = true AND is_deleted = false
  `);
};

exports.down = async function down(knex) {
  await knex.raw('DROP INDEX IF EXISTS payment_methods_default_per_profile_unique');

  if (await hasColumn(knex, 'credit_allocations', 'billing_profile_id')) {
    await knex.raw('DROP INDEX IF EXISTS idx_credit_allocations_billing_profile');
    await knex.schema.alterTable('credit_allocations', (t) => {
      t.dropColumn('billing_profile_id');
    });
  }

  for (const { table } of [...PROFILE_TABLES].reverse()) {
    if (!(await knex.schema.hasTable(table))) continue;
    const fkName = `${table}_billing_profile_foreign`;
    if (await hasConstraint(knex, table, fkName)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${fkName}`);
    }
    await knex.raw(`DROP INDEX IF EXISTS idx_${table}_billing_profile`);
    if (await hasColumn(knex, table, 'billing_profile_id')) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('billing_profile_id');
      });
    }
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };

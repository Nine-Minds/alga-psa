'use strict';

/**
 * Billing profiles — slice S8: per-profile billing cycles and invoices
 * (features F090–F092, F096 of the billing-profiles plan).
 *
 * This is the point at which invoice *production* changes, and therefore the
 * highest-risk gate in the whole effort. The design that keeps it safe is that
 * `generateInvoice(cycleId)` keeps its shape entirely — it simply runs once per
 * profile-cycle instead of once per client-cycle. Nothing about how an invoice
 * is built changes; only how many cycles exist.
 *
 * Because the S1 backfill made every client single-profile, and this migration
 * backfills every existing cycle to that one profile, a client that nobody has
 * segmented ends up with exactly the cycles it has today. That is what lets the
 * T013 gate keep holding across this slice.
 *
 * `billing_profile_id` is NOT NULL rather than nullable-meaning-client: a cycle
 * without a profile could not say whose invoice it produces, and "null means
 * the whole client" would be a second, competing meaning alongside "the default
 * profile" — the kind of ambiguity that produces duplicate invoices.
 */

const CYCLES = 'client_billing_cycles';
const INVOICES = 'invoices';
const PROFILES = 'client_billing_profiles';

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

async function backfillProfileColumn(knex, table, clientColumn = 'client_id') {
  await knex.raw(`
    UPDATE ${table} t
    SET billing_profile_id = p.billing_profile_id
    FROM ${PROFILES} p
    WHERE p.tenant = t.tenant
      AND p.client_id = t.${clientColumn}
      AND p.is_default = true
      AND t.billing_profile_id IS NULL
  `);

  // A row whose client somehow has no profile would block the NOT NULL. F002
  // says every client has exactly one default; a missing one is a defect to
  // repair, not billing history to discard.
  await knex.raw(`
    INSERT INTO ${PROFILES} (tenant, billing_profile_id, client_id, name, is_default, is_system_managed_default, is_active)
    SELECT DISTINCT t.tenant, gen_random_uuid(), t.${clientColumn}, c.client_name, true, true, true
    FROM ${table} t
    JOIN clients c ON c.tenant = t.tenant AND c.client_id = t.${clientColumn}
    WHERE t.billing_profile_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM ${PROFILES} p
        WHERE p.tenant = t.tenant AND p.client_id = t.${clientColumn}
      )
  `);
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
  // --- F090/F091: client_billing_cycles ---
  if (!(await hasColumn(knex, CYCLES, 'billing_profile_id'))) {
    await knex.schema.alterTable(CYCLES, (table) => {
      table.uuid('billing_profile_id').nullable();
    });
  }
  await backfillProfileColumn(knex, CYCLES);
  await knex.raw(`ALTER TABLE ${CYCLES} ALTER COLUMN billing_profile_id SET NOT NULL`);

  // --- F092: one cycle per profile per period ---
  // Replaces the client-level uniqueness this table relied on. Without the
  // profile in the key, generating a second profile's cycle for the same month
  // would look like a duplicate of the first.
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS client_billing_cycles_profile_period_unique
    ON ${CYCLES} (tenant, client_id, billing_profile_id, period_start_date)
  `);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${CYCLES}_billing_profile
    ON ${CYCLES} (tenant, billing_profile_id)
  `);

  if (!(await hasConstraint(knex, CYCLES, `${CYCLES}_billing_profile_foreign`))) {
    await knex.raw(`
      ALTER TABLE ${CYCLES}
      ADD CONSTRAINT ${CYCLES}_billing_profile_foreign
      FOREIGN KEY (tenant, billing_profile_id)
      REFERENCES ${PROFILES} (tenant, billing_profile_id)
      ON DELETE RESTRICT
    `);
  }

  // --- F096: invoices carry the profile they bill ---
  // Nullable on invoices, unlike cycles: historical invoices predate profiles
  // entirely, and inventing an attribution for them would be a claim the data
  // does not support. New invoices always set it.
  if (!(await hasColumn(knex, INVOICES, 'billing_profile_id'))) {
    await knex.schema.alterTable(INVOICES, (table) => {
      table.uuid('billing_profile_id').nullable();
    });
  }
  await backfillProfileColumn(knex, INVOICES);
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_${INVOICES}_billing_profile
    ON ${INVOICES} (tenant, billing_profile_id)
  `);
  if (!(await hasConstraint(knex, INVOICES, `${INVOICES}_billing_profile_foreign`))) {
    await knex.raw(`
      ALTER TABLE ${INVOICES}
      ADD CONSTRAINT ${INVOICES}_billing_profile_foreign
      FOREIGN KEY (tenant, billing_profile_id)
      REFERENCES ${PROFILES} (tenant, billing_profile_id)
      ON DELETE RESTRICT
    `);
  }
};

exports.down = async function down(knex) {
  for (const [table, constraint, index] of [
    [INVOICES, `${INVOICES}_billing_profile_foreign`, `idx_${INVOICES}_billing_profile`],
    [CYCLES, `${CYCLES}_billing_profile_foreign`, `idx_${CYCLES}_billing_profile`],
  ]) {
    if (await hasConstraint(knex, table, constraint)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    }
    await knex.raw(`DROP INDEX IF EXISTS ${index}`);
  }
  await knex.raw('DROP INDEX IF EXISTS client_billing_cycles_profile_period_unique');

  // Collapse to the default profile's cycles — the ones the pre-S8 schema would
  // have held. A separately-billing profile's cycles have no pre-S8 equivalent.
  await knex.raw(`
    DELETE FROM ${CYCLES} c
    USING ${PROFILES} p
    WHERE p.tenant = c.tenant
      AND p.billing_profile_id = c.billing_profile_id
      AND p.is_default = false
  `);

  for (const table of [CYCLES, INVOICES]) {
    if (await hasColumn(knex, table, 'billing_profile_id')) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn('billing_profile_id');
      });
    }
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };

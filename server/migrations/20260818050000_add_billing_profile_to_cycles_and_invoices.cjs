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

// A distributed table can retain pre-distribution rows in the coordinator's
// physical heap. Citus-routed backfills cannot see those shadow rows, while a
// coordinator ALTER ... SET NOT NULL scans them and fails. Constrain the live
// shard data first, then synchronize the coordinator's column metadata. This
// is the established repository pattern for this Citus condition.
async function setNotNull(knex, tableName, columnName, distributed) {
  if (distributed === true) {
    await knex.raw(`
      SELECT * FROM run_command_on_shards(
        ?,
        $$ALTER TABLE %s ALTER COLUMN ${columnName} SET NOT NULL$$
      )
    `, [tableName]);

    await knex.raw(`
      UPDATE pg_attribute
      SET attnotnull = true
      WHERE attrelid = ?::regclass
        AND attname = ?
        AND attnotnull = false
    `, [tableName, columnName]);
    return;
  }

  await knex.raw(`ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET NOT NULL`);
}

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
        AND NOT EXISTS (
          SELECT 1 FROM ${PROFILES} p
          WHERE p.tenant = t.tenant AND p.client_id = t.${clientColumn}
        )
    `);
  } else {
    // Citus with mixed shapes (e.g. client_billing_cycles is coordinator-local
    // there while profiles are distributed): INSERT...SELECT joining a local
    // table with distributed tables is rejected at plan time. Row-by-row from
    // the migration process instead — identical semantics, Citus-compatible.
    const pending = await knex.raw(`
      SELECT DISTINCT t.tenant, t.${clientColumn} AS client_id
      FROM ${table} t
      WHERE t.billing_profile_id IS NULL
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

// The legacy schema allowed duplicate period starts and retained deactivated
// cycles as history. Preserve every row, but make the live state compatible
// with the per-profile invariant by deactivating all but one active row in each
// duplicate group. Prefer a cycle already referenced by an invoice so a billed
// period remains the canonical active record; otherwise prefer the most
// recently updated/created row. Queries and updates stay tenant-scoped and are
// issued table-by-table so this also works when cycles and invoices have mixed
// Citus distribution shapes.
async function deactivateDuplicateActiveCycles(knex) {
  const duplicateGroups = await knex(CYCLES)
    .select('tenant', 'client_id', 'billing_profile_id', 'period_start_date')
    .where({ is_active: true })
    .groupBy('tenant', 'client_id', 'billing_profile_id', 'period_start_date')
    .havingRaw('COUNT(*) > 1');

  for (const group of duplicateGroups) {
    const cycles = await knex(CYCLES)
      .select('billing_cycle_id', 'created_at', 'updated_at')
      .where({
        tenant: group.tenant,
        client_id: group.client_id,
        billing_profile_id: group.billing_profile_id,
        period_start_date: group.period_start_date,
        is_active: true,
      });

    const cycleIds = cycles.map((cycle) => cycle.billing_cycle_id);
    const invoiceLinks = await knex(INVOICES)
      .distinct('billing_cycle_id')
      .where({ tenant: group.tenant })
      .whereIn('billing_cycle_id', cycleIds)
      .whereNotNull('billing_cycle_id');
    const invoicedCycleIds = new Set(invoiceLinks.map((row) => row.billing_cycle_id));

    const timestamp = (value) => {
      if (value == null) return Number.NEGATIVE_INFINITY;
      const parsed = new Date(value).getTime();
      return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
    };
    cycles.sort((a, b) => {
      const invoiceDifference = Number(invoicedCycleIds.has(b.billing_cycle_id))
        - Number(invoicedCycleIds.has(a.billing_cycle_id));
      if (invoiceDifference !== 0) return invoiceDifference;

      const updatedDifference = timestamp(b.updated_at) - timestamp(a.updated_at);
      if (updatedDifference !== 0) return updatedDifference;

      const createdDifference = timestamp(b.created_at) - timestamp(a.created_at);
      if (createdDifference !== 0) return createdDifference;

      return String(a.billing_cycle_id).localeCompare(String(b.billing_cycle_id));
    });

    const duplicateIds = cycles.slice(1).map((cycle) => cycle.billing_cycle_id);
    if (duplicateIds.length === 0) continue;

    await knex(CYCLES)
      .where({ tenant: group.tenant })
      .whereIn('billing_cycle_id', duplicateIds)
      .update({ is_active: false });

    console.log(
      `${CYCLES}: deactivated ${duplicateIds.length} duplicate active cycle(s) for ` +
      `${group.tenant}/${group.client_id}/${group.billing_profile_id}/${group.period_start_date}`
    );
  }
}

exports.up = async function up(knex) {
  // --- F090/F091: client_billing_cycles ---
  if (!(await hasColumn(knex, CYCLES, 'billing_profile_id'))) {
    await knex.schema.alterTable(CYCLES, (table) => {
      table.uuid('billing_profile_id').nullable();
    });
  }
  await backfillProfileColumn(knex, CYCLES);
  await setNotNull(
    knex,
    CYCLES,
    'billing_profile_id',
    await distributionState(knex, CYCLES),
  );

  // --- F092: one active cycle per profile per period ---
  // Inactive legacy cycles remain as billing history and may share a period
  // start. New/live cycles must be unique per profile so generating a second
  // profile's cycle for the same month is allowed without permitting a second
  // active cycle for that same profile.
  await deactivateDuplicateActiveCycles(knex);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS client_billing_cycles_profile_period_unique
    ON ${CYCLES} (tenant, client_id, billing_profile_id, period_start_date)
    WHERE is_active = true
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

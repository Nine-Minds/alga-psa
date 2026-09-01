'use strict';

/**
 * Billing profiles — slice S1 assignment columns (features F006–F012 of the
 * billing-profiles plan; design source §3.3).
 *
 * Adds nullable billing-profile assignment columns to the phase-1 tables:
 *
 *   client_contracts.billing_profile_id
 *   contract_lines.billing_profile_id
 *   client_locations.default_billing_profile_id
 *   tickets.billing_profile_id
 *   projects.billing_profile_id
 *   invoice_charges.billing_profile_id + billing_profile_source
 *   time_entries.contract_line_source
 *
 * All columns are nullable and carry no engine behaviour in S1 — the resolver
 * and stamping land in S2. The source columns are text + CHECK (not a jsonb
 * blob or a bare enum) so later slices can extend the value set without an
 * ALTER TYPE on a distributed table; NULL means "not yet attributed".
 *
 * FKs are added with the Citus-aware conditional pattern from
 * 20260415120200_add_location_to_contract_lines.cjs: on Citus they are only
 * added when both tables are tenant-distributed (they always are today, since
 * client_billing_profiles is distributed colocated with tenants by
 * 20260816000000), and they are skipped rather than guessed when the
 * distribution states differ.
 */

const PROFILE_COLUMN_FKS = [
  { table: 'client_contracts', column: 'billing_profile_id', constraint: 'client_contracts_billing_profile_id_foreign' },
  { table: 'contract_lines', column: 'billing_profile_id', constraint: 'contract_lines_billing_profile_id_foreign' },
  { table: 'client_locations', column: 'default_billing_profile_id', constraint: 'client_locations_default_billing_profile_id_foreign' },
  { table: 'tickets', column: 'billing_profile_id', constraint: 'tickets_billing_profile_id_foreign' },
  { table: 'projects', column: 'billing_profile_id', constraint: 'projects_billing_profile_id_foreign' },
  { table: 'invoice_charges', column: 'billing_profile_id', constraint: 'invoice_charges_billing_profile_id_foreign' },
];

const PROFILE_INDEXES = [
  { table: 'client_contracts', column: 'billing_profile_id', name: 'idx_client_contracts_billing_profile' },
  { table: 'contract_lines', column: 'billing_profile_id', name: 'idx_contract_lines_billing_profile' },
  { table: 'client_locations', column: 'default_billing_profile_id', name: 'idx_client_locations_default_billing_profile' },
  { table: 'tickets', column: 'billing_profile_id', name: 'idx_tickets_billing_profile' },
  { table: 'projects', column: 'billing_profile_id', name: 'idx_projects_billing_profile' },
  { table: 'invoice_charges', column: 'billing_profile_id', name: 'idx_invoice_charges_billing_profile' },
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

// LEVERAGE: pattern citus-fk-compat-probe — the Citus-aware
// "add FK only when both sides have matching distribution" probe is copied
// verbatim across 2026041512xxxx, 20250613190110 and this migration. It
// deserves a shared helper next to utils/citusDistribution.cjs the next time a
// migration adds a composite FK to an existing tenant-distributed table.

// Mirror of the 20260415120200 compatibility rule: FK is added when Citus is
// absent, when neither table is distributed, or when both are distributed.
async function compatibleForProfileFk(knex, tableName) {
  try {
    const citusCheck = await knex.raw(`
      SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS has_citus
    `);
    const hasCitus = Boolean(citusCheck.rows?.[0]?.has_citus);
    if (!hasCitus) return true;
    const sourceDistributed = await distributionState(knex, tableName);
    const profileDistributed = await distributionState(knex, 'client_billing_profiles');
    return sourceDistributed === profileDistributed;
  } catch {
    return true;
  }
}

exports.up = async function up(knex) {
  // --- invoice_charges: billing_profile_id + billing_profile_source ---
  if (!(await hasColumn(knex, 'invoice_charges', 'billing_profile_id'))) {
    await knex.schema.alterTable('invoice_charges', (table) => {
      table.uuid('billing_profile_id').nullable();
    });
  }
  if (!(await hasColumn(knex, 'invoice_charges', 'billing_profile_source'))) {
    await knex.schema.alterTable('invoice_charges', (table) => {
      table.text('billing_profile_source').nullable();
    });
  }
  if (!(await hasConstraint(knex, 'invoice_charges', 'invoice_charges_billing_profile_source_check'))) {
    await knex.raw(`
      ALTER TABLE invoice_charges
      ADD CONSTRAINT invoice_charges_billing_profile_source_check
      CHECK (billing_profile_source IS NULL OR billing_profile_source IN
        ('explicit', 'contract_line', 'contract', 'work_item', 'client_default'))
    `);
  }

  // --- time_entries: contract_line_source ---
  if (!(await hasColumn(knex, 'time_entries', 'contract_line_source'))) {
    await knex.schema.alterTable('time_entries', (table) => {
      table.text('contract_line_source').nullable();
    });
  }
  if (!(await hasConstraint(knex, 'time_entries', 'time_entries_contract_line_source_check'))) {
    await knex.raw(`
      ALTER TABLE time_entries
      ADD CONSTRAINT time_entries_contract_line_source_check
      CHECK (contract_line_source IS NULL OR contract_line_source IN
        ('explicit', 'auto_unique_service', 'auto_bucket_overlay', 'unresolved', 'reconciled_at_generation'))
    `);
  }

  // --- simple nullable profile columns ---
  const simpleColumns = [
    { table: 'client_contracts', column: 'billing_profile_id' },
    { table: 'contract_lines', column: 'billing_profile_id' },
    { table: 'client_locations', column: 'default_billing_profile_id' },
    { table: 'tickets', column: 'billing_profile_id' },
    { table: 'projects', column: 'billing_profile_id' },
  ];
  for (const { table, column } of simpleColumns) {
    if (!(await hasColumn(knex, table, column))) {
      await knex.schema.alterTable(table, (t) => {
        t.uuid(column).nullable();
      });
    }
  }

  // --- indexes ---
  for (const { table, column, name } of PROFILE_INDEXES) {
    await knex.raw(
      `CREATE INDEX IF NOT EXISTS ${name} ON ${table} (tenant, ${column})`
    );
  }

  // --- composite FKs to client_billing_profiles (Citus-aware, RESTRICT like
  // the location_id precedents; ON UPDATE CASCADE is unsupported by Citus
  // when the distribution key is part of the FK) ---
  for (const { table, column, constraint } of PROFILE_COLUMN_FKS) {
    if (await hasConstraint(knex, table, constraint)) continue;
    if (!(await compatibleForProfileFk(knex, table))) {
      console.log(
        `${table} and client_billing_profiles have incompatible distribution - skipping FK ${constraint}, index only`
      );
      continue;
    }
    await knex.raw(`
      ALTER TABLE ${table}
      ADD CONSTRAINT ${constraint}
      FOREIGN KEY (tenant, ${column})
      REFERENCES client_billing_profiles (tenant, billing_profile_id)
      ON DELETE RESTRICT
    `);
  }
};

exports.down = async function down(knex) {
  for (const { table, column, constraint } of PROFILE_COLUMN_FKS) {
    if (await hasConstraint(knex, table, constraint)) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    }
    if (await hasColumn(knex, table, column)) {
      await knex.schema.alterTable(table, (t) => {
        t.dropColumn(column);
      });
    }
  }

  if (await hasConstraint(knex, 'invoice_charges', 'invoice_charges_billing_profile_source_check')) {
    await knex.raw('ALTER TABLE invoice_charges DROP CONSTRAINT invoice_charges_billing_profile_source_check');
  }
  if (await hasColumn(knex, 'invoice_charges', 'billing_profile_source')) {
    await knex.schema.alterTable('invoice_charges', (t) => {
      t.dropColumn('billing_profile_source');
    });
  }

  if (await hasConstraint(knex, 'time_entries', 'time_entries_contract_line_source_check')) {
    await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT time_entries_contract_line_source_check');
  }
  if (await hasColumn(knex, 'time_entries', 'contract_line_source')) {
    await knex.schema.alterTable('time_entries', (t) => {
      t.dropColumn('contract_line_source');
    });
  }

  for (const { name } of PROFILE_INDEXES) {
    await knex.raw(`DROP INDEX IF EXISTS ${name}`);
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };

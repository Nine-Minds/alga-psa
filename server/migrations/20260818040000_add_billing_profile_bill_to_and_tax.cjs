'use strict';

/**
 * Billing profiles — slice S7: bill-to identity and profile-scoped tax
 * (features F079–F087, F129, F130 of the billing-profiles plan).
 *
 * Every column added here is **nullable, meaning "inherit from the client"**
 * (F087). That is not a default choice, it is what makes the T013 gate hold: a
 * profile with nothing filled in behaves exactly as the client does today, so a
 * single-profile client's invoice cannot move. A `jsonb` blob would default to
 * `{}` and silently stop inheriting the moment anything was written to it —
 * hence nullable scalars.
 *
 * Tax is deliberately split (design source §6.2, decision D9):
 *
 *   - The **tax region chain does not change**. `service region →
 *     contract-line location region → client default region` stands, and a
 *     profile does not participate. A bill-to jurisdiction could only differ
 *     from the delivery jurisdiction in configurations none of the target
 *     customer shapes produce, and destination sourcing says delivery governs
 *     anyway. No column here touches region.
 *   - **Exemption, exemption certificate, tax ID, and reverse charge become
 *     profile-scoped.** This is load-bearing, not a refinement: `is_tax_exempt`
 *     lives on `clients`, so today one client cannot express "this entity is
 *     exempt, that one is not" — and one-site-many-legal-entities is exactly a
 *     mix of exempt and non-exempt entities at one address. Without this, that
 *     customer shape stays unbillable inside a single client, which defeats the
 *     feature.
 *
 * `client_tax_settings` is re-keyed to (tenant, client_id, billing_profile_id)
 * with existing rows backfilled to the client's default profile (F130), so
 * reverse-charge applicability becomes per entity like the rest.
 */

const PROFILES = 'client_billing_profiles';
const TAX_SETTINGS = 'client_tax_settings';

const PROFILE_COLUMNS = [
  // F079 — phase-2 gate. False everywhere until an MSP opts a profile in.
  { name: 'bills_separately', build: (t, knex) => t.boolean('bills_separately').notNullable().defaultTo(false) },
  // F080–F082 — bill-to identity.
  { name: 'bill_to_name', build: (t) => t.text('bill_to_name').nullable() },
  { name: 'bill_to_location_id', build: (t) => t.uuid('bill_to_location_id').nullable() },
  { name: 'billing_contact_id', build: (t) => t.uuid('billing_contact_id').nullable() },
  { name: 'billing_email', build: (t) => t.text('billing_email').nullable() },
  // F083, F129 — tax identity. NULL means inherit from the client.
  { name: 'is_tax_exempt', build: (t) => t.boolean('is_tax_exempt').nullable() },
  { name: 'tax_exemption_certificate', build: (t) => t.text('tax_exemption_certificate').nullable() },
  { name: 'tax_id_number', build: (t) => t.text('tax_id_number').nullable() },
  // F084 — purchase orders.
  { name: 'po_number', build: (t) => t.text('po_number').nullable() },
  { name: 'po_required', build: (t) => t.boolean('po_required').nullable() },
  // F085 — invoice delivery.
  { name: 'invoice_delivery_method', build: (t) => t.text('invoice_delivery_method').nullable() },
  { name: 'invoice_template_id', build: (t) => t.uuid('invoice_template_id').nullable() },
  // F086 — a profile may bill on its own frequency. Franchise-shape customers
  // commonly want staggered billing dates per site.
  { name: 'billing_cycle', build: (t) => t.text('billing_cycle').nullable() },
  { name: 'payment_terms', build: (t) => t.text('payment_terms').nullable() },
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

exports.up = async function up(knex) {
  for (const column of PROFILE_COLUMNS) {
    if (await hasColumn(knex, PROFILES, column.name)) continue;
    await knex.schema.alterTable(PROFILES, (t) => column.build(t, knex));
  }

  // --- F130: client_tax_settings gains the profile dimension ---
  if (!(await hasColumn(knex, TAX_SETTINGS, 'billing_profile_id'))) {
    await knex.schema.alterTable(TAX_SETTINGS, (t) => {
      t.uuid('billing_profile_id').nullable();
    });
  }

  // Backfill every existing row to its client's default profile before the
  // column becomes part of the key: an unbackfilled row would be a client's
  // reverse-charge setting that suddenly applies to no profile at all.
  await knex.raw(`
    UPDATE ${TAX_SETTINGS} cts
    SET billing_profile_id = p.billing_profile_id
    FROM ${PROFILES} p
    WHERE p.tenant = cts.tenant
      AND p.client_id = cts.client_id
      AND p.is_default = true
      AND cts.billing_profile_id IS NULL
  `);

  // Rows whose client somehow has no default profile would block the NOT NULL.
  // Provision one rather than dropping the setting — F002 says every client has
  // exactly one, and a missing one is a defect to repair, not data to discard.
  const taxSettingsDistributed = await distributionState(knex, TAX_SETTINGS);
  const profilesDistributed = await distributionState(knex, PROFILES);
  if (taxSettingsDistributed === profilesDistributed) {
    // Same distribution shape (always the case on plain Postgres): one
    // set-based statement.
    await knex.raw(`
      INSERT INTO ${PROFILES} (tenant, billing_profile_id, client_id, name, is_default, is_system_managed_default, is_active)
      SELECT DISTINCT cts.tenant, gen_random_uuid(), cts.client_id, c.client_name, true, true, true
      FROM ${TAX_SETTINGS} cts
      JOIN clients c ON c.tenant = cts.tenant AND c.client_id = cts.client_id
      WHERE cts.billing_profile_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM ${PROFILES} p
          WHERE p.tenant = cts.tenant AND p.client_id = cts.client_id
        )
    `);
  } else {
    // Citus with mixed shapes (client_tax_settings is a coordinator-local
    // table there): INSERT...SELECT joining a local table with distributed
    // tables is rejected at plan time ("complex joins are only supported
    // when all distributed tables are co-located"). Row-by-row from the
    // migration process instead — identical semantics, Citus-compatible.
    const pending = await knex.raw(`
      SELECT DISTINCT cts.tenant, cts.client_id
      FROM ${TAX_SETTINGS} cts
      WHERE cts.billing_profile_id IS NULL
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
    UPDATE ${TAX_SETTINGS} cts
    SET billing_profile_id = p.billing_profile_id
    FROM ${PROFILES} p
    WHERE p.tenant = cts.tenant
      AND p.client_id = cts.client_id
      AND p.is_default = true
      AND cts.billing_profile_id IS NULL
  `);

  // Any row still unmatched has no client at all; it is orphaned data that the
  // FK below would reject anyway.
  await knex.raw(`DELETE FROM ${TAX_SETTINGS} WHERE billing_profile_id IS NULL`);

  await knex.raw(`ALTER TABLE ${TAX_SETTINGS} ALTER COLUMN billing_profile_id SET NOT NULL`);

  // Re-key: the primary key becomes (tenant, client_id, billing_profile_id).
  // client_id stays in the key even though the profile implies it — it is the
  // distribution-compatible shape the table already had, and every read is by
  // client first.
  const pkName = `${TAX_SETTINGS}_pkey`;
  const currentPk = await knex.raw(
    `SELECT a.attname FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = ?::regclass AND i.indisprimary`,
    [TAX_SETTINGS]
  );
  const pkColumns = (currentPk.rows ?? []).map((row) => row.attname);
  if (!pkColumns.includes('billing_profile_id')) {
    await knex.raw(`ALTER TABLE ${TAX_SETTINGS} DROP CONSTRAINT IF EXISTS ${pkName}`);
    await knex.raw(
      `ALTER TABLE ${TAX_SETTINGS} ADD CONSTRAINT ${pkName} PRIMARY KEY (tenant, client_id, billing_profile_id)`
    );
  }

  if (!(await hasConstraint(knex, TAX_SETTINGS, `${TAX_SETTINGS}_billing_profile_foreign`))) {
    await knex.raw(`
      ALTER TABLE ${TAX_SETTINGS}
      ADD CONSTRAINT ${TAX_SETTINGS}_billing_profile_foreign
      FOREIGN KEY (tenant, billing_profile_id)
      REFERENCES ${PROFILES} (tenant, billing_profile_id)
      ON DELETE CASCADE
    `);
  }
};

exports.down = async function down(knex) {
  if (await hasConstraint(knex, TAX_SETTINGS, `${TAX_SETTINGS}_billing_profile_foreign`)) {
    await knex.raw(`ALTER TABLE ${TAX_SETTINGS} DROP CONSTRAINT ${TAX_SETTINGS}_billing_profile_foreign`);
  }

  // Collapse back to one row per client, keeping the default profile's row —
  // it is the one the pre-S7 schema would have held.
  await knex.raw(`
    DELETE FROM ${TAX_SETTINGS} cts
    USING ${PROFILES} p
    WHERE p.tenant = cts.tenant
      AND p.billing_profile_id = cts.billing_profile_id
      AND p.is_default = false
  `);

  const pkName = `${TAX_SETTINGS}_pkey`;
  await knex.raw(`ALTER TABLE ${TAX_SETTINGS} DROP CONSTRAINT IF EXISTS ${pkName}`);
  await knex.raw(`ALTER TABLE ${TAX_SETTINGS} ADD CONSTRAINT ${pkName} PRIMARY KEY (tenant, client_id)`);

  if (await hasColumn(knex, TAX_SETTINGS, 'billing_profile_id')) {
    await knex.schema.alterTable(TAX_SETTINGS, (t) => {
      t.dropColumn('billing_profile_id');
    });
  }

  for (const column of [...PROFILE_COLUMNS].reverse()) {
    if (await hasColumn(knex, PROFILES, column.name)) {
      await knex.schema.alterTable(PROFILES, (t) => {
        t.dropColumn(column.name);
      });
    }
  }
};

// ALTER TABLE on Citus-distributed tables must not run inside a transaction.
exports.config = { transaction: false };

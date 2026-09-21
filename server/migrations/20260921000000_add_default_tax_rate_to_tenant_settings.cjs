/**
 * Migration: add a tenant-wide default tax rate setting.
 *
 * `tenant_settings.default_tax_rate_id` is a nullable reference to an existing
 * regional rate in `tax_rates`. It stores the assignment only; the region is
 * derived from the selected rate (no second editable default region).
 *
 * The composite foreign key `(tenant, default_tax_rate_id)` references
 * `tax_rates(tenant, tax_rate_id)` — the unique constraint created by
 * `20250413142133_add_unique_tenant_tax_rate_id_to_tax_rates`. This keeps the
 * default inside the owning tenant and refuses deletion (RESTRICT) so a
 * configured default cannot silently become dangling.
 *
 * No seed selection and no data mutation happen here: an administrator must
 * explicitly choose the default, and catalog backfill is a separate
 * preview/apply operation. NULL means "no default configured".
 *
 * Citus note: the composite FK is only valid when `tenant_settings` and
 * `tax_rates` are both distributed on `tenant` and colocated. The billing
 * integration suites run on plain PostgreSQL and DO NOT assert distribution or
 * colocation. This must be verified against a real Citus cluster (the
 * citus-migration-smoke workflow runs the combined chain on single-node Citus);
 * `tax_rates` already carries the same tenant-qualified composite key that the
 * existing `service_catalog` FK references, but that is precedent, not proof.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  console.log('Adding tenant default tax rate setting...');

  const hasColumn = await knex.schema.hasColumn('tenant_settings', 'default_tax_rate_id');
  if (!hasColumn) {
    await knex.schema.alterTable('tenant_settings', (table) => {
      table.uuid('default_tax_rate_id').nullable();
    });
    console.log('  Added tenant_settings.default_tax_rate_id');
  } else {
    console.log('  tenant_settings.default_tax_rate_id already exists');
  }

  // Index the referencing side so FK checks and "is this rate the default?"
  // lookups do not scan the settings table.
  await knex.raw(`
    CREATE INDEX IF NOT EXISTS idx_tenant_settings_default_tax_rate
    ON tenant_settings (tenant, default_tax_rate_id)
  `);

  const hasConstraint = await knex.raw(`
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'tenant_settings'::regclass
      AND conname = 'tenant_settings_default_tax_rate_id_foreign'
  `);
  if (!hasConstraint.rows.length) {
    await knex.raw(`
      ALTER TABLE tenant_settings
      ADD CONSTRAINT tenant_settings_default_tax_rate_id_foreign
      FOREIGN KEY (tenant, default_tax_rate_id)
      REFERENCES tax_rates (tenant, tax_rate_id)
      ON DELETE RESTRICT
    `);
    console.log('  Added composite FK tenant_settings -> tax_rates');
  } else {
    console.log('  Composite FK already exists');
  }

  await knex.raw(`
    COMMENT ON COLUMN tenant_settings.default_tax_rate_id IS
    'Tenant-wide default tax rate applied to new clients and, when unset on create, new catalog items. NULL means no default configured.'
  `);

  console.log('✓ Tenant default tax rate setting added');
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  console.log('Removing tenant default tax rate setting...');

  await knex.raw(`
    ALTER TABLE tenant_settings
    DROP CONSTRAINT IF EXISTS tenant_settings_default_tax_rate_id_foreign
  `);
  await knex.raw('DROP INDEX IF EXISTS idx_tenant_settings_default_tax_rate');

  const hasColumn = await knex.schema.hasColumn('tenant_settings', 'default_tax_rate_id');
  if (hasColumn) {
    await knex.schema.alterTable('tenant_settings', (table) => {
      table.dropColumn('default_tax_rate_id');
    });
  }

  console.log('✓ Tenant default tax rate setting removed');
};

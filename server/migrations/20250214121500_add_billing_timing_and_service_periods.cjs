/**
 * Adds billing timing metadata to contract line term tables and introduces
 * service-period fields on invoice item details so per-line timing can be
 * tracked independently of the invoice header period.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  // --- Contract template line terms ---
  await knex.schema.alterTable('contract_template_line_terms', (table) => {
    table
      .string('billing_timing', 16)
      .notNullable()
      .defaultTo('arrears');
  });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contract_template_line_terms_timing_check'
      ) THEN
        ALTER TABLE contract_template_line_terms
        ADD CONSTRAINT contract_template_line_terms_timing_check
        CHECK (billing_timing IN ('arrears', 'advance'));
      END IF;
    END$$;
  `);

  // --- Client contract line terms ---
  await knex.schema.alterTable('client_contract_line_terms', (table) => {
    table
      .string('billing_timing', 16)
      .notNullable()
      .defaultTo('arrears');
  });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'client_contract_line_terms_timing_check'
      ) THEN
        ALTER TABLE client_contract_line_terms
        ADD CONSTRAINT client_contract_line_terms_timing_check
        CHECK (billing_timing IN ('arrears', 'advance'));
      END IF;
    END$$;
  `);

  // --- Base contract line template terms ---
  await knex.schema.alterTable('contract_line_template_terms', (table) => {
    table
      .string('billing_timing', 16)
      .notNullable()
      .defaultTo('arrears');
  });

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'contract_line_template_terms_timing_check'
      ) THEN
        ALTER TABLE contract_line_template_terms
        ADD CONSTRAINT contract_line_template_terms_timing_check
        CHECK (billing_timing IN ('arrears', 'advance'));
      END IF;
    END$$;
  `);

  // --- Invoice item details service-period metadata ---
  await knex.schema.alterTable('invoice_item_details', (table) => {
    table.date('service_period_start');
    table.date('service_period_end');
    table
      .string('billing_timing', 16)
      .notNullable()
      .defaultTo('arrears');
  });

  // Populate new service-period columns for legacy data using invoice headers
  await knex.raw(`
    UPDATE invoice_item_details AS iid
    SET
      service_period_start = inv.billing_period_start,
      service_period_end = inv.billing_period_end,
      billing_timing = COALESCE(iid.billing_timing, 'arrears')
    FROM invoices AS inv
    WHERE iid.invoice_id = inv.invoice_id
      AND iid.tenant = inv.tenant
      AND (iid.service_period_start IS NULL OR iid.service_period_end IS NULL);
  `);

  await knex.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'invoice_item_details_timing_check'
      ) THEN
        ALTER TABLE invoice_item_details
        ADD CONSTRAINT invoice_item_details_timing_check
        CHECK (billing_timing IN ('arrears', 'advance'));
      END IF;
    END$$;
  `);

  await knex.raw(`
    CREATE INDEX IF NOT EXISTS invoice_item_details_service_period_idx
    ON invoice_item_details (tenant, service_period_start, service_period_end);
  `);
};

/**
 * Rolls back billing timing metadata changes.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS invoice_item_details_service_period_idx;
  `);

  await knex.raw(`
    ALTER TABLE invoice_item_details
    DROP CONSTRAINT IF EXISTS invoice_item_details_timing_check;
  `);

  await knex.schema.alterTable('invoice_item_details', (table) => {
    table.dropColumn('service_period_start');
    table.dropColumn('service_period_end');
    table.dropColumn('billing_timing');
  });

  await knex.raw(`
    ALTER TABLE client_contract_line_terms
    DROP CONSTRAINT IF EXISTS client_contract_line_terms_timing_check;
  `);

  await knex.schema.alterTable('client_contract_line_terms', (table) => {
    table.dropColumn('billing_timing');
  });

  await knex.raw(`
    ALTER TABLE contract_line_template_terms
    DROP CONSTRAINT IF EXISTS contract_line_template_terms_timing_check;
  `);

  await knex.schema.alterTable('contract_line_template_terms', (table) => {
    table.dropColumn('billing_timing');
  });

  await knex.raw(`
    ALTER TABLE contract_template_line_terms
    DROP CONSTRAINT IF EXISTS contract_template_line_terms_timing_check;
  `);

  await knex.schema.alterTable('contract_template_line_terms', (table) => {
    table.dropColumn('billing_timing');
  });
};

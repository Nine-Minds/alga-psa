/**
 * Adds billing timing metadata to contract and invoice tables without relying
 * on legacy billing tables existing in the schema. Intended to run after the
 * contract-template migrations have created the new structures.
 *
 * @param { import('knex').Knex } knex
 */
exports.up = async function up(knex) {
  // contract_lines.billing_timing
  if (await knex.schema.hasTable('contract_lines')) {
    const hasColumn = await knex.schema.hasColumn('contract_lines', 'billing_timing');
    if (!hasColumn) {
      await knex.schema.alterTable('contract_lines', (table) => {
        table.string('billing_timing', 16).notNullable().defaultTo('arrears');
      });
    }
  }

  // contract_template_line_terms.billing_timing
  if (await knex.schema.hasTable('contract_template_line_terms')) {
    const hasColumn = await knex.schema.hasColumn('contract_template_line_terms', 'billing_timing');
    if (!hasColumn) {
      await knex.schema.alterTable('contract_template_line_terms', (table) => {
        table.string('billing_timing', 16).notNullable().defaultTo('arrears');
      });
      await knex.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'contract_template_line_terms_timing_check'
          ) THEN
            ALTER TABLE contract_template_line_terms
            ADD CONSTRAINT contract_template_line_terms_timing_check
            CHECK (billing_timing IN ('arrears', 'advance'));
          END IF;
        END$$;
      `);
    }
  }

  // client_contract_line_terms.billing_timing
  if (await knex.schema.hasTable('client_contract_line_terms')) {
    const hasColumn = await knex.schema.hasColumn('client_contract_line_terms', 'billing_timing');
    if (!hasColumn) {
      await knex.schema.alterTable('client_contract_line_terms', (table) => {
        table.string('billing_timing', 16).notNullable().defaultTo('arrears');
      });
      await knex.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'client_contract_line_terms_timing_check'
          ) THEN
            ALTER TABLE client_contract_line_terms
            ADD CONSTRAINT client_contract_line_terms_timing_check
            CHECK (billing_timing IN ('arrears', 'advance'));
          END IF;
        END$$;
      `);
    }
  }

  // invoice_item_details service period metadata
  if (await knex.schema.hasTable('invoice_item_details')) {
    const hasServiceStart = await knex.schema.hasColumn('invoice_item_details', 'service_period_start');
    const hasServiceEnd = await knex.schema.hasColumn('invoice_item_details', 'service_period_end');
    const hasBillingTiming = await knex.schema.hasColumn('invoice_item_details', 'billing_timing');

    if (!hasServiceStart || !hasServiceEnd || !hasBillingTiming) {
      await knex.schema.alterTable('invoice_item_details', (table) => {
        if (!hasServiceStart) table.date('service_period_start');
        if (!hasServiceEnd) table.date('service_period_end');
        if (!hasBillingTiming) table.string('billing_timing', 16).notNullable().defaultTo('arrears');
      });

      await knex.raw(`
        UPDATE invoice_item_details AS iid
        SET
          service_period_start = inv.billing_period_start,
          service_period_end = inv.billing_period_end,
          billing_timing = COALESCE(iid.billing_timing, 'arrears')
        FROM invoice_items AS ii
        JOIN invoices AS inv
          ON ii.invoice_id = inv.invoice_id
         AND ii.tenant = inv.tenant
        WHERE iid.item_id = ii.item_id
          AND iid.tenant = ii.tenant
          AND (iid.service_period_start IS NULL OR iid.service_period_end IS NULL);
      `);

      await knex.raw(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
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
    }
  }
};

/**
 * @param { import('knex').Knex } knex
 */
exports.down = async function down(knex) {
  if (await knex.schema.hasTable('invoice_item_details')) {
    await knex.raw('DROP INDEX IF EXISTS invoice_item_details_service_period_idx');
    await knex.raw('ALTER TABLE invoice_item_details DROP CONSTRAINT IF EXISTS invoice_item_details_timing_check');

    if (await knex.schema.hasColumn('invoice_item_details', 'service_period_start')) {
      await knex.schema.alterTable('invoice_item_details', (table) => {
        table.dropColumn('service_period_start');
      });
    }
    if (await knex.schema.hasColumn('invoice_item_details', 'service_period_end')) {
      await knex.schema.alterTable('invoice_item_details', (table) => {
        table.dropColumn('service_period_end');
      });
    }
    if (await knex.schema.hasColumn('invoice_item_details', 'billing_timing')) {
      await knex.schema.alterTable('invoice_item_details', (table) => {
        table.dropColumn('billing_timing');
      });
    }
  }

  if (await knex.schema.hasTable('client_contract_line_terms')) {
    await knex.raw('ALTER TABLE client_contract_line_terms DROP CONSTRAINT IF EXISTS client_contract_line_terms_timing_check');
    if (await knex.schema.hasColumn('client_contract_line_terms', 'billing_timing')) {
      await knex.schema.alterTable('client_contract_line_terms', (table) => {
        table.dropColumn('billing_timing');
      });
    }
  }

  if (await knex.schema.hasTable('contract_template_line_terms')) {
    await knex.raw('ALTER TABLE contract_template_line_terms DROP CONSTRAINT IF EXISTS contract_template_line_terms_timing_check');
    if (await knex.schema.hasColumn('contract_template_line_terms', 'billing_timing')) {
      await knex.schema.alterTable('contract_template_line_terms', (table) => {
        table.dropColumn('billing_timing');
      });
    }
  }

  if (await knex.schema.hasTable('contract_lines')) {
    if (await knex.schema.hasColumn('contract_lines', 'billing_timing')) {
      await knex.schema.alterTable('contract_lines', (table) => {
        table.dropColumn('billing_timing');
      });
    }
  }
};

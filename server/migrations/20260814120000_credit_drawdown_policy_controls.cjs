/**
 * Credit draw-down policy controls (task 29.8.17).
 *
 * Adds per-tenant and per-client policy fields for automatic credit
 * application at invoice finalization, plus a per-client-contract opt-out.
 *
 * Behavior-preserving defaults live on `default_billing_settings`:
 *   - credit_auto_apply_enabled  -> true  (auto-apply on)
 *   - credit_application_order   -> 'expiration_first' (today's exact ordering)
 *   - credit_eligible_service_type_ids -> NULL (no service-type restriction)
 *
 * On `client_billing_settings` the same three columns are nullable and mean
 * "inherit the tenant default" (resolved per-field, not per-row).
 *
 * On `client_contracts`, `credit_drawdown_opt_out` is nullable: NULL/false
 * means the contract participates; `true` excludes the contract's charges.
 */

const CREDIT_APPLICATION_ORDERS = ['expiration_first', 'oldest_first', 'newest_first'];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  // --- default_billing_settings -------------------------------------------------
  if (await knex.schema.hasTable('default_billing_settings')) {
    if (!(await knex.schema.hasColumn('default_billing_settings', 'credit_auto_apply_enabled'))) {
      await knex.schema.alterTable('default_billing_settings', (table) => {
        table.boolean('credit_auto_apply_enabled').notNullable().defaultTo(true);
      });
    }
    if (!(await knex.schema.hasColumn('default_billing_settings', 'credit_application_order'))) {
      await knex.schema.alterTable('default_billing_settings', (table) => {
        table.text('credit_application_order').notNullable().defaultTo('expiration_first');
      });
      await knex.raw(
        `ALTER TABLE default_billing_settings ADD CONSTRAINT default_billing_settings_credit_application_order_check CHECK (credit_application_order IN (${CREDIT_APPLICATION_ORDERS.map((o) => `'${o}'`).join(', ')}))`
      );
    }
    if (!(await knex.schema.hasColumn('default_billing_settings', 'credit_eligible_service_type_ids'))) {
      await knex.schema.alterTable('default_billing_settings', (table) => {
        table.jsonb('credit_eligible_service_type_ids').nullable();
      });
    }
  }

  // --- client_billing_settings --------------------------------------------------
  if (await knex.schema.hasTable('client_billing_settings')) {
    if (!(await knex.schema.hasColumn('client_billing_settings', 'credit_auto_apply_enabled'))) {
      await knex.schema.alterTable('client_billing_settings', (table) => {
        table.boolean('credit_auto_apply_enabled').nullable();
      });
    }
    if (!(await knex.schema.hasColumn('client_billing_settings', 'credit_application_order'))) {
      await knex.schema.alterTable('client_billing_settings', (table) => {
        table.text('credit_application_order').nullable();
      });
      await knex.raw(
        `ALTER TABLE client_billing_settings ADD CONSTRAINT client_billing_settings_credit_application_order_check CHECK (credit_application_order IS NULL OR credit_application_order IN (${CREDIT_APPLICATION_ORDERS.map((o) => `'${o}'`).join(', ')}))`
      );
    }
    if (!(await knex.schema.hasColumn('client_billing_settings', 'credit_eligible_service_type_ids'))) {
      await knex.schema.alterTable('client_billing_settings', (table) => {
        table.jsonb('credit_eligible_service_type_ids').nullable();
      });
    }
  }

  // --- client_contracts ----------------------------------------------------------
  if (await knex.schema.hasTable('client_contracts')) {
    if (!(await knex.schema.hasColumn('client_contracts', 'credit_drawdown_opt_out'))) {
      await knex.schema.alterTable('client_contracts', (table) => {
        table.boolean('credit_drawdown_opt_out').nullable().defaultTo(null);
      });
    }
  }
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  if (await knex.schema.hasTable('default_billing_settings')) {
    if (await knex.schema.hasColumn('default_billing_settings', 'credit_auto_apply_enabled')) {
      await knex.schema.alterTable('default_billing_settings', (table) => {
        table.dropColumn('credit_auto_apply_enabled');
        table.dropColumn('credit_application_order');
        table.dropColumn('credit_eligible_service_type_ids');
      });
    }
  }

  if (await knex.schema.hasTable('client_billing_settings')) {
    if (await knex.schema.hasColumn('client_billing_settings', 'credit_auto_apply_enabled')) {
      await knex.schema.alterTable('client_billing_settings', (table) => {
        table.dropColumn('credit_auto_apply_enabled');
        table.dropColumn('credit_application_order');
        table.dropColumn('credit_eligible_service_type_ids');
      });
    }
  }

  if (await knex.schema.hasTable('client_contracts')) {
    if (await knex.schema.hasColumn('client_contracts', 'credit_drawdown_opt_out')) {
      await knex.schema.alterTable('client_contracts', (table) => {
        table.dropColumn('credit_drawdown_opt_out');
      });
    }
  }
};

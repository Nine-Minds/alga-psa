/**
 * Credit service-type restriction mode (task 29.8.17, mitigation Option B).
 *
 * The original service-type eligibility cascade first-non-nulled
 * `credit_eligible_service_type_ids` (client over tenant over null), which
 * made "unrestricted" inexpressible at the client level whenever the tenant
 * was restricted: a client whose ids column was NULL inherited the tenant's
 * list, and no legal value could mean "this client explicitly allows all
 * service types."
 *
 * This migration adds an explicit `credit_service_type_restriction_mode`
 * beside `credit_eligible_service_type_ids` on both policy tables:
 *
 *   - default_billing_settings (tenant): NOT NULL, 'all' | 'restricted'.
 *     'restricted' pairs with a non-empty ids list; 'all' pairs with NULL.
 *   - client_billing_settings (client): nullable. NULL inherits the tenant;
 *     'all' is an explicit unrestricted override; 'restricted' uses the
 *     client's own non-empty ids list.
 *
 * Backfill: mode is derived from the existing ids column, and the previously
 * legal empty-array "nothing eligible" state is removed (tenant [] -> mode
 * 'all', ids NULL; client [] -> mode NULL, ids NULL) before the CHECK
 * constraints are installed.
 */

const RESTRICTION_MODES = ["'all'", "'restricted'"].join(', ');

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  // --- default_billing_settings (tenant) --------------------------------------
  if (await knex.schema.hasTable('default_billing_settings')) {
    if (!(await knex.schema.hasColumn('default_billing_settings', 'credit_service_type_restriction_mode'))) {
      await knex.schema.alterTable('default_billing_settings', (table) => {
        table.text('credit_service_type_restriction_mode').nullable();
      });

      // Normalize the removed empty-array state before it can violate the CHECK.
      await knex.raw(
        `UPDATE default_billing_settings
           SET credit_eligible_service_type_ids = NULL
         WHERE credit_eligible_service_type_ids = '[]'::jsonb`
      );

      await knex.raw(
        `UPDATE default_billing_settings
            SET credit_service_type_restriction_mode = CASE
              WHEN credit_eligible_service_type_ids IS NOT NULL THEN 'restricted'
              ELSE 'all'
            END`
      );

      await knex.raw(
        `ALTER TABLE default_billing_settings
           ALTER COLUMN credit_service_type_restriction_mode SET NOT NULL,
           ALTER COLUMN credit_service_type_restriction_mode SET DEFAULT 'all'`
      );

      await knex.raw(
        `ALTER TABLE default_billing_settings
           ADD CONSTRAINT default_billing_settings_credit_service_type_restriction_mode_check
           CHECK (
             credit_service_type_restriction_mode IN (${RESTRICTION_MODES})
             AND (
               (credit_service_type_restriction_mode = 'restricted'
                 AND credit_eligible_service_type_ids IS NOT NULL
                 AND jsonb_typeof(credit_eligible_service_type_ids) = 'array'
                 AND jsonb_array_length(credit_eligible_service_type_ids) > 0)
               OR
               (credit_service_type_restriction_mode = 'all'
                 AND credit_eligible_service_type_ids IS NULL)
             )
           )`
      );
    }
  }

  // --- client_billing_settings (client) ----------------------------------------
  if (await knex.schema.hasTable('client_billing_settings')) {
    if (!(await knex.schema.hasColumn('client_billing_settings', 'credit_service_type_restriction_mode'))) {
      await knex.schema.alterTable('client_billing_settings', (table) => {
        table.text('credit_service_type_restriction_mode').nullable();
      });

      // Normalize the removed empty-array state before it can violate the CHECK.
      await knex.raw(
        `UPDATE client_billing_settings
           SET credit_eligible_service_type_ids = NULL
         WHERE credit_eligible_service_type_ids = '[]'::jsonb`
      );

      await knex.raw(
        `UPDATE client_billing_settings
            SET credit_service_type_restriction_mode = CASE
              WHEN credit_eligible_service_type_ids IS NOT NULL THEN 'restricted'
              ELSE NULL
            END`
      );

      await knex.raw(
        `ALTER TABLE client_billing_settings
           ADD CONSTRAINT client_billing_settings_credit_service_type_restriction_mode_check
           CHECK (
             (credit_service_type_restriction_mode IS NULL
               OR credit_service_type_restriction_mode IN (${RESTRICTION_MODES}))
             AND (
               (credit_service_type_restriction_mode = 'restricted'
                 AND credit_eligible_service_type_ids IS NOT NULL
                 AND jsonb_typeof(credit_eligible_service_type_ids) = 'array'
                 AND jsonb_array_length(credit_eligible_service_type_ids) > 0)
               OR
               ((credit_service_type_restriction_mode = 'all'
                 OR credit_service_type_restriction_mode IS NULL)
                 AND credit_eligible_service_type_ids IS NULL)
             )
           )`
      );
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  if (await knex.schema.hasTable('default_billing_settings')) {
    if (await knex.schema.hasColumn('default_billing_settings', 'credit_service_type_restriction_mode')) {
      await knex.raw(
        `ALTER TABLE default_billing_settings
           DROP CONSTRAINT IF EXISTS default_billing_settings_credit_service_type_restriction_mode_check`
      );
      await knex.schema.alterTable('default_billing_settings', (table) => {
        table.dropColumn('credit_service_type_restriction_mode');
      });
    }
  }

  if (await knex.schema.hasTable('client_billing_settings')) {
    if (await knex.schema.hasColumn('client_billing_settings', 'credit_service_type_restriction_mode')) {
      await knex.raw(
        `ALTER TABLE client_billing_settings
           DROP CONSTRAINT IF EXISTS client_billing_settings_credit_service_type_restriction_mode_check`
      );
      await knex.schema.alterTable('client_billing_settings', (table) => {
        table.dropColumn('credit_service_type_restriction_mode');
      });
    }
  }
};

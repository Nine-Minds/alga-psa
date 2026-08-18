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
 *   - default_billing_settings (tenant): 'all' | 'restricted', defaulting to
 *     'all'. 'restricted' pairs with a non-empty ids list; 'all' pairs with NULL.
 *   - client_billing_settings (client): nullable. NULL inherits the tenant;
 *     'all' is an explicit unrestricted override; 'restricted' uses the
 *     client's own non-empty ids list.
 *
 * Backfill: mode is derived from the existing ids column, and the previously
 * legal empty-array "nothing eligible" state is removed (tenant [] -> mode
 * 'all', ids NULL; client [] -> mode NULL, ids NULL).
 *
 * Deliberately NO NOT NULL and NO CHECK constraint. The tenant-side NOT NULL
 * failed on the hosted single-node Citus cluster with "contains null values"
 * immediately after a backfill that a distributed read reported as covering
 * every row, and neither constraint is load-bearing:
 *
 *   - NULL already behaves as 'all'. resolveCreditPolicy() in
 *     shared/billingClients/billingSettings.ts reads the tenant mode through
 *     normalizeServiceTypeRestrictionMode(value, 'all'), so a NULL, absent, or
 *     unrecognized value resolves to 'all' — exactly what the backfill writes.
 *     The DEFAULT below keeps new rows populated anyway.
 *   - The mode/ids pairing is enforced on write. updateClientBillingSettings()
 *     and updateDefaultBillingSettings() treat mode as the source of truth and
 *     null the ids for 'all'/inherit, deriving mode from ids for legacy
 *     callers. The read path only consults ids when mode is 'restricted', and
 *     normalizeEligibleServiceTypeIds() maps null/undefined to null.
 *
 * So the constraints only restated invariants the application already keeps.
 * 20260817130000_drop_credit_restriction_mode_constraints.cjs removes them from
 * databases that installed them before this migration was changed.
 */

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

      // DEFAULT only. Issued as its own single-subcommand ALTER because Citus
      // rejects an ALTER carrying two utility subcommands with "cannot execute
      // multiple utility events".
      await knex.raw(
        `ALTER TABLE default_billing_settings
           ALTER COLUMN credit_service_type_restriction_mode SET DEFAULT 'all'`
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

      // No CHECK here either — see the header note.
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

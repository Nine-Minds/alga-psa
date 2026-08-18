/**
 * Drop the credit service-type restriction-mode constraints.
 *
 * 20260816120000 originally installed a NOT NULL plus a CHECK on
 * default_billing_settings and a CHECK on client_billing_settings. The
 * tenant-side NOT NULL failed on the hosted single-node Citus cluster —
 * "column credit_service_type_restriction_mode of relation
 * default_billing_settings contains null values" — immediately after a backfill
 * that a distributed read reported as covering all 49 rows. That migration no
 * longer declares them, but a database that ran the earlier version still has
 * them, so this converges the two.
 *
 * Neither constraint was load-bearing (the reasoning is recorded in full on
 * 20260816120000): resolveCreditPolicy() already reads the tenant mode through
 * normalizeServiceTypeRestrictionMode(value, 'all'), so NULL behaves as 'all',
 * and the mode/ids pairing is enforced on every write in
 * shared/billingClients/billingSettings.ts. The column, its backfill, and the
 * tenant-side DEFAULT 'all' all stay.
 *
 * Every statement is IF EXISTS / conditional, so this is a no-op on a database
 * that never installed them.
 */

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('default_billing_settings')) {
    await knex.raw(
      `ALTER TABLE default_billing_settings
         DROP CONSTRAINT IF EXISTS default_billing_settings_credit_service_type_restriction_mode_check`
    );

    // DROP NOT NULL is not IF EXISTS-able and errors if the column is missing,
    // so gate it on the column and skip when it is already nullable. One
    // subcommand per ALTER: Citus rejects an ALTER carrying two utility
    // subcommands with "cannot execute multiple utility events".
    if (await knex.schema.hasColumn('default_billing_settings', 'credit_service_type_restriction_mode')) {
      const notNull = await knex.raw(
        `SELECT attnotnull
           FROM pg_attribute
          WHERE attrelid = 'default_billing_settings'::regclass
            AND attname = 'credit_service_type_restriction_mode'
            AND NOT attisdropped`
      );
      if (notNull.rows[0]?.attnotnull) {
        await knex.raw(
          `ALTER TABLE default_billing_settings
             ALTER COLUMN credit_service_type_restriction_mode DROP NOT NULL`
        );
      }
    }
  }

  if (await knex.schema.hasTable('client_billing_settings')) {
    await knex.raw(
      `ALTER TABLE client_billing_settings
         DROP CONSTRAINT IF EXISTS client_billing_settings_credit_service_type_restriction_mode_check`
    );
  }
};

exports.down = async function down() {
  // Deliberately irreversible. Re-adding the constraints is what this migration
  // exists to undo, and re-adding them would reintroduce the failure on Citus.
};

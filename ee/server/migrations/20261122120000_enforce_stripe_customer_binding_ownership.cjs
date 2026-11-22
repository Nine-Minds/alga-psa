// The binding-table migration may already be recorded on deployed databases.
// Re-run its idempotent ownership enforcement so existing installations gain
// the same lock, validated composite FK, and conflict checks as fresh installs.
const bindingsMigration = require('./20261031090000_create_stripe_customer_bindings.cjs');
const OWNER_CONSTRAINT = bindingsMigration.ownerConstraint;
const BINDING_TABLE = bindingsMigration.bindingTable;

exports.up = async function up(knex) {
  // Supports installations that already recorded the original binding-table
  // migration: backfill and add the NOT VALID FK under its original fence,
  // then validate in this separately recorded forward migration.
  await bindingsMigration.enforceOwnership(knex);

  await knex.transaction(async (trx) => {
    await trx.raw("SELECT pg_advisory_xact_lock(hashtext('stripe_customer_bindings_migration'))");

    const citusCatalog = await trx.raw(
      `SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS present`
    );
    if (citusCatalog.rows?.[0]?.present) {
      const isDistributed = await trx.raw(
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_dist_partition WHERE logicalrelid = 'stripe_customers'::regclass) AS present"
      );
      if (isDistributed.rows?.[0]?.present) {
        await trx.raw("SET LOCAL citus.multi_shard_modify_mode = 'sequential'");
      }
    }

    // Current writers claim the reference row before writing stripe_customers.
    // Preserve that lock order while validation fences legacy writers too.
    await trx.raw(`LOCK TABLE ${BINDING_TABLE} IN ACCESS EXCLUSIVE MODE`);
    await trx.raw('LOCK TABLE stripe_customers IN ACCESS EXCLUSIVE MODE');

    const constraint = await trx.raw(
      'SELECT convalidated FROM pg_constraint WHERE conname = ? AND conrelid = \'stripe_customers\'::regclass',
      [OWNER_CONSTRAINT]
    );
    if (constraint.rows.length === 0) {
      throw new Error(`Cannot validate missing Stripe customer ownership constraint ${OWNER_CONSTRAINT}`);
    }
    if (!constraint.rows[0].convalidated) {
      await trx.raw('ALTER TABLE stripe_customers VALIDATE CONSTRAINT stripe_customers_binding_owner_fk');
    }
  });
};
exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE stripe_customers DROP CONSTRAINT IF EXISTS stripe_customers_binding_owner_fk');
};

exports.config = { transaction: false };

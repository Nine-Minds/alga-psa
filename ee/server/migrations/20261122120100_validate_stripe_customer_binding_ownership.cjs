// Validate the composite Stripe customer ownership FK that the locked backfill
// (20261031090000 on fresh installs, 20261122120000 on upgrades) added NOT VALID.
// Kept in its own `transaction: false` migration so validation is recorded
// separately from the backfill and constraint creation.
const bindingsMigration = require('./20261031090000_create_stripe_customer_bindings.cjs');
const OWNER_CONSTRAINT = bindingsMigration.ownerConstraint;
const BINDING_TABLE = bindingsMigration.bindingTable;

exports.up = async function up(knex) {
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

// Validation has nothing to undo; 20261122120000's down drops the constraint.
exports.down = async function down() {};

exports.config = { transaction: false };

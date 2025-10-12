/**
 * Ensure client_plan_bundles has purchase order fields used by the contract wizard.
 */

exports.up = async function up(knex) {
  const hasClientBundles = await knex.schema.hasTable('client_plan_bundles');
  if (!hasClientBundles) return;

  // Add columns if they don't exist yet
  const addColumnIfMissing = async (tableName, columnName, cb) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (!exists) {
      await knex.schema.alterTable(tableName, cb);
    }
  };

  await addColumnIfMissing('client_plan_bundles', 'po_number', (t) => {
    t.string('po_number').nullable();
  });

  await addColumnIfMissing('client_plan_bundles', 'po_amount', (t) => {
    t.bigInteger('po_amount').nullable();
  });

  await addColumnIfMissing('client_plan_bundles', 'po_required', (t) => {
    t.boolean('po_required').notNullable().defaultTo(false);
  });
};

exports.down = async function down(knex) {
  const hasClientBundles = await knex.schema.hasTable('client_plan_bundles');
  if (!hasClientBundles) return;

  // Drop columns only if they exist (safe rollback)
  const dropColumnIfExists = async (tableName, columnName) => {
    const exists = await knex.schema.hasColumn(tableName, columnName);
    if (exists) {
      await knex.schema.alterTable(tableName, (t) => {
        t.dropColumn(columnName);
      });
    }
  };

  await dropColumnIfExists('client_plan_bundles', 'po_number');
  await dropColumnIfExists('client_plan_bundles', 'po_amount');
  await dropColumnIfExists('client_plan_bundles', 'po_required');
};


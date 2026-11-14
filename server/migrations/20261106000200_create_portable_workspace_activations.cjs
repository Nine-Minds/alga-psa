/**
 * Portable-workspace activation receipts (CM L8b).
 *
 * One immutable row per restored workspace that has been activated with a licence or subscription
 * the customer owns. Owned by the restored tenant. The foreign key to `portable_workspace_restores`
 * (CM L7b2) is added ONLY when that table exists, so this migration applies on a main that has not
 * yet landed L7b2 and never creates L7b2's table. The CLI and the activation code refuse a tenant
 * with no restore row regardless of the constraint.
 *
 * CREATE only; idempotent; distributed on `tenant`. Update-immutability trigger is defence in depth
 * on this NEW table only (H section 3 rule 6).
 */
const { ensureTenantDistribution, supportsTriggers } = require('./utils/citusDistribution.cjs');

const TABLE = 'portable_workspace_activations';
const RESTORES = 'portable_workspace_restores';
const FK = 'portable_workspace_activation_restore_fk';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').primary();
      table.uuid('operation_id').notNullable();
      table.uuid('administrator_user_id').notNullable();
      table.text('entitlement_source').notNullable();
      table.text('entitlement_reference').notNullable();
      table.integer('seats');
      table.timestamp('entitlement_valid_until', { useTz: true }).notNullable();
      table.timestamp('activated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.check("entitlement_source IN ('tenant_license', 'hosted_subscription') AND (seats IS NULL OR seats > 0) AND length(entitlement_reference) > 0 AND entitlement_valid_until > activated_at");
    });
  }
  await ensureTenantDistribution(knex, TABLE);
  if ((await knex.schema.hasTable(RESTORES))
    && !(await knex('pg_constraint').where('conname', FK).whereRaw('conrelid = ?::regclass', [TABLE]).first())) {
    await knex.schema.alterTable(TABLE, (table) => table.foreign(['tenant'], FK).references(['tenant']).inTable(RESTORES));
  }
  await knex.raw(`CREATE OR REPLACE FUNCTION portable_workspace_activation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Portable activation receipt is immutable' USING ERRCODE = '23514'; END; $$`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw(`DROP TRIGGER IF EXISTS portable_workspace_activation_immutable ON ${TABLE}`);
    await knex.raw(`CREATE TRIGGER portable_workspace_activation_immutable BEFORE UPDATE ON ${TABLE}
      FOR EACH ROW EXECUTE FUNCTION portable_workspace_activation_immutable()`);
  }
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove retained portable activation receipts');
  }
  await knex.schema.dropTableIfExists(TABLE);
  await knex.raw('DROP FUNCTION IF EXISTS portable_workspace_activation_immutable()');
};

// Citus distribution is performed outside Knex's migration transaction.
exports.config = { transaction: false };

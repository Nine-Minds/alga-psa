/**
 * Co-managed IT L2: collaboration_actor_references (new table only).
 *
 * ticket_audit_logs is deliberately untouched here (deferred to L3). No foreign
 * keys, no triggers. Idempotent.
 */
const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');

const TABLE = 'collaboration_actor_references';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('tenant').notNullable();
      table.uuid('actor_reference_id').notNullable();
      // Qualified historical identities, not foreign tenant FKs or users.
      table.uuid('actor_tenant').notNullable();
      table.uuid('actor_user_id').notNullable();
      table.text('display_name').notNullable();
      table.text('organization_name').notNullable();
      table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.primary(['tenant', 'actor_reference_id']);
      table.unique(['tenant', 'actor_tenant', 'actor_user_id']);
      table.check('tenant <> actor_tenant');
      table.check('char_length(display_name) > 0');
      table.check('char_length(organization_name) > 0');
    });
  }
  await ensureTenantDistribution(knex, TABLE);
};

exports.down = async function down(knex) {
  if ((await knex.schema.hasTable(TABLE)) && (await knex(TABLE).first())) {
    throw new Error('Cannot remove retained collaboration actor attribution');
  }
  await knex.schema.dropTableIfExists(TABLE);
};

exports.config = { transaction: false };

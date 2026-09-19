const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'collaboration_actor_references';

exports.up = async function (knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable();
    table.uuid('actor_reference_id').notNullable();
    // These are qualified historical identities, not foreign tenant FKs or users.
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
  await ensureTenantDistribution(knex, TABLE);
  if (!await knex.schema.hasColumn('ticket_audit_logs', 'actor_reference_id')) await knex.schema.alterTable('ticket_audit_logs', table => {
    table.uuid('actor_reference_id').nullable();
    table.text('actor_organization_name').nullable();
  });
  // User names are text; preserve the complete historical snapshot.
  await knex.raw('ALTER TABLE ticket_audit_logs ALTER COLUMN actor_display_name TYPE text');
  for (const [table, name, columns, parent, parentColumns] of [
    [TABLE, 'collaboration_actor_owner_fk', ['tenant'], 'tenants', ['tenant']],
    ['ticket_audit_logs', 'ticket_audit_actor_reference_fk', ['tenant', 'actor_reference_id'], TABLE, ['tenant', 'actor_reference_id']],
  ]) {
    if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [table]).first()) {
      await knex.schema.alterTable(table, builder => builder.foreign(columns, name).references(parentColumns).inTable(parent));
    }
  }
  if (!await knex('pg_constraint').where('conname', 'ticket_audit_actor_reference_shape').whereRaw("conrelid = 'ticket_audit_logs'::regclass").first()) {
    await knex.raw(`ALTER TABLE ticket_audit_logs ADD CONSTRAINT ticket_audit_actor_reference_shape CHECK
      (actor_reference_id IS NULL OR (actor_user_id IS NULL AND actor_contact_id IS NULL AND actor_type = 'user'
        AND actor_display_name IS NOT NULL AND actor_organization_name IS NOT NULL))`);
  }
};
exports.down = async function (knex) {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).first()) throw new Error('Cannot remove retained collaboration actor attribution');
  if (await knex('ticket_audit_logs').whereRaw('char_length(actor_display_name) > 256').first()) throw new Error('Cannot truncate retained actor display names');
  await knex.raw('ALTER TABLE ticket_audit_logs ALTER COLUMN actor_display_name TYPE varchar(256)');
  await knex.raw('ALTER TABLE ticket_audit_logs DROP CONSTRAINT IF EXISTS ticket_audit_actor_reference_shape');
  await knex.raw('ALTER TABLE ticket_audit_logs DROP CONSTRAINT IF EXISTS ticket_audit_actor_reference_fk');
  if (await knex.schema.hasColumn('ticket_audit_logs', 'actor_reference_id')) await knex.schema.alterTable('ticket_audit_logs', table => {
    table.dropColumn('actor_reference_id'); table.dropColumn('actor_organization_name');
  });
  await knex.schema.dropTableIfExists(TABLE);
};
exports.config = { transaction: false };

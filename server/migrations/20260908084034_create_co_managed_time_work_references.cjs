const { ensureTenantDistribution } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_managed_time_work_references';
exports.up = async function(knex) {
  if (!await knex.schema.hasTable(TABLE)) await knex.schema.createTable(TABLE, table => {
    table.uuid('tenant').notNullable(); table.uuid('reference_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('customer_tenant').notNullable(); table.uuid('relationship_id').notNullable();
    table.string('source_kind', 20).notNullable(); table.uuid('source_id').notNullable();
    table.uuid('client_id').notNullable(); table.uuid('billing_profile_id').nullable();
    table.string('ticket_number', 100).nullable(); table.text('title').nullable(); table.text('description').nullable();
    table.timestamp('captured_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(['tenant', 'reference_id']);
    table.unique(['tenant', 'customer_tenant', 'relationship_id', 'source_kind', 'source_id'], 'co_managed_time_work_source_unique');
    table.check("tenant <> customer_tenant AND source_kind IN ('ticket', 'project_task')");
    // No customer-side FKs: authorized MSP billing evidence survives departure
    // and deletion. This reference is not a mirrored ticket/project lifecycle.
  });
  await ensureTenantDistribution(knex, TABLE);
  for (const [name, columns, parent, parentColumns] of [
    ['co_time_work_client_fk', ['tenant', 'client_id'], 'clients', ['tenant', 'client_id']],
    ['co_time_work_profile_fk', ['tenant', 'billing_profile_id'], 'client_billing_profiles', ['tenant', 'billing_profile_id']],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, builder => builder.foreign(columns, name).references(parentColumns).inTable(parent).onDelete('RESTRICT'));
  }
  if (!await knex.schema.hasColumn('time_entries', 'co_managed_work_reference_id')) await knex.schema.alterTable('time_entries', table => {
    table.uuid('co_managed_work_reference_id').nullable();
  });
  await knex.raw("ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_work_item_type_check");
  await knex.raw("ALTER TABLE time_entries ADD CONSTRAINT time_entries_work_item_type_check CHECK (work_item_type IN ('ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction', 'co_managed'))");
  if (!await knex('pg_constraint').where('conname', 'co_time_entry_reference_check').whereRaw("conrelid = 'time_entries'::regclass").first()) {
    await knex.raw(`ALTER TABLE time_entries ADD CONSTRAINT co_time_entry_reference_check CHECK (
      (work_item_type = 'co_managed' AND co_managed_work_reference_id IS NOT NULL AND work_item_id IS NOT NULL AND co_managed_work_reference_id = work_item_id)
      OR (work_item_type IS DISTINCT FROM 'co_managed' AND co_managed_work_reference_id IS NULL))`);
  }
  if (!await knex('pg_constraint').where('conname', 'co_time_entry_reference_fk').whereRaw("conrelid = 'time_entries'::regclass").first()) {
    await knex.schema.alterTable('time_entries', table => table.foreign(['tenant', 'co_managed_work_reference_id'], 'co_time_entry_reference_fk')
      .references(['tenant', 'reference_id']).inTable(TABLE).onDelete('RESTRICT'));
  }
};
exports.down = async function(knex) {
  if (await knex(TABLE).first()) throw new Error('Cannot discard retained co-managed time work references');
  await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS co_time_entry_reference_fk');
  await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS co_time_entry_reference_check');
  await knex.schema.alterTable('time_entries', table => table.dropColumn('co_managed_work_reference_id'));
  await knex.raw('ALTER TABLE time_entries DROP CONSTRAINT IF EXISTS time_entries_work_item_type_check');
  await knex.raw("ALTER TABLE time_entries ADD CONSTRAINT time_entries_work_item_type_check CHECK (work_item_type IN ('ticket', 'project_task', 'non_billable_category', 'ad_hoc', 'interaction'))");
  await knex.schema.dropTable(TABLE);
};
exports.config = { transaction: false };

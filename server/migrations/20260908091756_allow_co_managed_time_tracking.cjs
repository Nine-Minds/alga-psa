const TABLE = 'native_time_tracking_sessions';
const KIND_CHECK = 'native_time_tracking_sessions_work_item_type_check';
const kinds = "'ticket', 'project_task', 'ad_hoc', 'interaction', 'non_billable_category'";
async function replaceKindCheck(knex, shared) {
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [TABLE, KIND_CHECK]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (work_item_type IN (${kinds}${shared ? ", 'co_managed'" : ''}))`, [TABLE, KIND_CHECK]);
}
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'co_managed_work_reference_id')) await knex.schema.alterTable(TABLE, table => {
    table.uuid('co_managed_work_reference_id').nullable();
  });
  await replaceKindCheck(knex, true);
  if (!await knex('pg_constraint').where('conname', 'co_timer_reference_check').whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_timer_reference_check CHECK (
      (work_item_type = 'co_managed' AND co_managed_work_reference_id IS NOT NULL AND work_item_id IS NOT NULL AND co_managed_work_reference_id = work_item_id)
      OR (work_item_type <> 'co_managed' AND co_managed_work_reference_id IS NULL))`, [TABLE]);
  }
  if (!await knex('pg_constraint').where('conname', 'co_timer_reference_fk').whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.schema.alterTable(TABLE, table => table.foreign(['tenant', 'co_managed_work_reference_id'], 'co_timer_reference_fk')
      .references(['tenant', 'reference_id']).inTable('co_managed_time_work_references').onDelete('RESTRICT'));
  }
};
exports.down = async function(knex) {
  if (await knex(TABLE).where('work_item_type', 'co_managed').first()) throw new Error('Cannot discard retained co-managed timer clocks or completion receipts');
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_timer_reference_fk', [TABLE]);
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_timer_reference_check', [TABLE]);
  await knex.schema.alterTable(TABLE, table => table.dropColumn('co_managed_work_reference_id'));
  await replaceKindCheck(knex, false);
};
exports.config = { transaction: false };

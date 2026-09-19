const TABLE = 'co_managed_upgrade_purchases';
async function configure(knex, failed) {
  if (!await knex.schema.hasTable(TABLE)) return;
  const constraints = await knex('pg_constraint').whereRaw('conrelid = ?::regclass', [TABLE]).where('contype', 'c')
    .whereRaw("pg_get_constraintdef(oid) LIKE '%state%'").select('conname');
  for (const constraint of constraints) await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [TABLE, constraint.conname]);
  await knex.raw(`ALTER TABLE ${TABLE} ADD CONSTRAINT co_upgrade_purchase_state_check CHECK
    (state IN ('preparing', 'checkout', 'paid', 'expired'${failed ? ", 'payment_failed'" : ''}))`);
  await knex.raw('DROP INDEX IF EXISTS co_upgrade_one_pending_purchase');
  await knex.raw(`CREATE UNIQUE INDEX co_upgrade_one_pending_purchase ON ${TABLE} (tenant)
    WHERE state IN ('preparing', 'checkout'${failed ? ", 'payment_failed'" : ''})`);
}
exports.up = knex => configure(knex, true);
exports.down = async knex => {
  if (await knex.schema.hasTable(TABLE) && await knex(TABLE).where('state', 'payment_failed').first())
    throw new Error('Cannot remove pending failed payment recovery');
  await configure(knex, false);
};

const TABLE = 'co_management_ticket_work';
const CHECK = 'co_ticket_work_escalation_state_check';
exports.up = async function(knex) {
  await knex.raw('ALTER TABLE ?? ALTER COLUMN first_escalated_at DROP NOT NULL, ALTER COLUMN last_transition_at DROP NOT NULL', [TABLE]);
  if (!await knex('pg_constraint').where('conname', CHECK).whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (
      (first_escalated_at IS NOT NULL AND last_transition_at IS NOT NULL) OR
      (first_escalated_at IS NULL AND last_transition_at IS NULL AND responsibility = 'customer' AND grant_revoked_at IS NOT NULL AND can_collaborate = false)
    )`, [TABLE, CHECK]);
  }
};
exports.down = async function(knex) {
  if (await knex(TABLE).whereNull('first_escalated_at').first()) throw new Error('Cannot remove retained co-managed work that has not been escalated');
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [TABLE, CHECK]);
  await knex.raw('ALTER TABLE ?? ALTER COLUMN first_escalated_at SET NOT NULL, ALTER COLUMN last_transition_at SET NOT NULL', [TABLE]);
};
exports.config = { transaction: false };

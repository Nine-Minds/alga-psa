/** Restore admission must not share the cancellation reason: a subscription
 * recovery must never activate an imported workspace awaiting review. */
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_suspended_reason_check');
  await knex.raw(`ALTER TABLE tenants ADD CONSTRAINT tenants_suspended_reason_check CHECK (
    (suspended_at IS NULL AND suspended_reason IS NULL) OR
    (suspended_at IS NOT NULL AND suspended_reason IN ('tenant_cancelled', 'portable_restore_pending_activation'))
  )`);
};
exports.down = async function (knex) {
  if (await knex('tenants').where('suspended_reason', 'portable_restore_pending_activation').first('tenant')) {
    throw new Error('Cannot remove suspension support while a restored workspace awaits activation');
  }
  await knex.raw('ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_suspended_reason_check');
  await knex.raw(`ALTER TABLE tenants ADD CONSTRAINT tenants_suspended_reason_check CHECK (
    (suspended_at IS NULL AND suspended_reason IS NULL) OR
    (suspended_at IS NOT NULL AND suspended_reason = 'tenant_cancelled')
  )`);
};

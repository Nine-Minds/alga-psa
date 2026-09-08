const TABLE = 'sla_organization_notification_recipients';
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'attempt_count')) await knex.schema.alterTable(TABLE, table => {
    table.integer('attempt_count').notNullable().defaultTo(0);
    table.timestamp('next_attempt_at', { useTz: true }).defaultTo(knex.fn.now());
    table.text('error_code');
  });
  const constraints = await knex('pg_constraint').whereRaw('conrelid = ?::regclass', [TABLE]).where('contype', 'c')
    .select('conname', knex.raw('pg_get_constraintdef(oid) as definition'));
  for (const constraint of constraints) if (constraint.definition.includes('channel') && constraint.definition.includes("'pending'") &&
      constraint.definition.includes("'created'") && !constraint.definition.includes("'failed'")) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [TABLE, constraint.conname]);
  }
  await knex(TABLE).where('channel', 'email').whereNot('status', 'pending').update({ next_attempt_at: null });
  for (const [name, check] of [
    ['sla_org_recipient_channels_status', "channel IN ('in_app', 'email') AND status IN ('pending', 'created', 'disabled', 'delivered', 'skipped', 'failed')"],
    ['sla_org_email_retry_state', "attempt_count >= 0 AND (channel <> 'email' OR ((status = 'pending' AND next_attempt_at IS NOT NULL) OR (status <> 'pending' AND next_attempt_at IS NULL)))"],
  ]) if (!await knex('pg_constraint').where('conname', name).whereRaw('conrelid = ?::regclass', [TABLE]).first()) {
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT ?? CHECK (' + check + ')', [TABLE, name]);
  }
  await knex.raw("CREATE INDEX IF NOT EXISTS sla_org_email_due_idx ON ?? (tenant, next_attempt_at) WHERE channel = 'email' AND status = 'pending'", [TABLE]);
};
exports.down = async function(knex) {
  if (await knex(TABLE).where('channel', 'email').first()) throw new Error('Cannot remove retained SLA email retry state');
  await knex.raw('DROP INDEX IF EXISTS sla_org_email_due_idx');
  for (const name of ['sla_org_email_retry_state', 'sla_org_recipient_channels_status']) await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS ??', [TABLE, name]);
  await knex.schema.alterTable(TABLE, table => {
    table.dropColumns('attempt_count', 'next_attempt_at', 'error_code');
    table.check("channel IN ('in_app', 'email') AND status IN ('pending', 'created', 'disabled', 'delivered', 'skipped')");
  });
};
exports.config = { transaction: false };

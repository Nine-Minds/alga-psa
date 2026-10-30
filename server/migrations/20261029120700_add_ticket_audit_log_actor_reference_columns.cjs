// CM L4a deploy-fix (1 of 2): ticket_audit_logs actor-reference attribution columns.
// writeTicketActivity writes actor_reference_id / actor_organization_name for a foreign actor;
// L2 deferred the columns. Expand-only: two nullable metadata-only adds, no default, no backfill,
// no trigger. The tenant FK to collaboration_actor_references (mirroring comments_collaboration_actor_fk)
// is added NOT VALID; 20261029120800 validates it in a separate non-transactional file.
// Each ALTER runs under a 2s lock_timeout and is retried so a busy table never queues writers.
const LOCK_ATTEMPTS = 3;

async function withLockRetry(knex, statement) {
  const { rows } = await knex.raw(`SELECT current_setting('lock_timeout') AS value`);
  const prior = rows[0].value;
  const restore = () => knex.raw(`SELECT set_config('lock_timeout', ?, true)`, [prior]);
  for (let attempt = 1; ; attempt += 1) {
    await knex.raw('SAVEPOINT lock_retry');
    try {
      await knex.raw(`SET LOCAL lock_timeout = '2s'`);
      await statement(knex);
      await knex.raw('RELEASE SAVEPOINT lock_retry');
      await restore();
      return;
    } catch (error) {
      try {
        await knex.raw('ROLLBACK TO SAVEPOINT lock_retry');
        await restore();
      } catch {
        throw error;
      }
      if (error.code !== '55P03' || attempt >= LOCK_ATTEMPTS) throw error;
    }
  }
}

async function hasConstraint(knex, table, name) {
  const { rows } = await knex.raw(`SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass`, [name, table]);
  return rows.length > 0;
}

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('ticket_audit_logs'))) return;
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE ticket_audit_logs ADD COLUMN IF NOT EXISTS actor_reference_id uuid'));
  await withLockRetry(knex, (trx) => trx.raw('ALTER TABLE ticket_audit_logs ADD COLUMN IF NOT EXISTS actor_organization_name text'));
  if ((await knex.schema.hasTable('collaboration_actor_references')) && !(await hasConstraint(knex, 'ticket_audit_logs', 'ticket_audit_logs_collaboration_actor_fk'))) {
    await withLockRetry(knex, (trx) => trx.raw(`ALTER TABLE ticket_audit_logs ADD CONSTRAINT ticket_audit_logs_collaboration_actor_fk
      FOREIGN KEY (tenant, actor_reference_id) REFERENCES collaboration_actor_references (tenant, actor_reference_id) NOT VALID`));
  }
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE ticket_audit_logs DROP CONSTRAINT IF EXISTS ticket_audit_logs_collaboration_actor_fk');
  await knex.raw('ALTER TABLE ticket_audit_logs DROP COLUMN IF EXISTS actor_reference_id');
  await knex.raw('ALTER TABLE ticket_audit_logs DROP COLUMN IF EXISTS actor_organization_name');
};

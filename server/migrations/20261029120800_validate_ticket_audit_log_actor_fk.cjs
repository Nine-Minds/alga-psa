// CM L4a deploy-fix (2 of 2): VALIDATE only, non-transactional so the scan runs without blocking writes.
// Idempotent; a no-op when the constraint is absent or already valid.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('ticket_audit_logs'))) return;
  const { rows } = await knex.raw(`SELECT convalidated FROM pg_constraint WHERE conname = 'ticket_audit_logs_collaboration_actor_fk' AND conrelid = 'ticket_audit_logs'::regclass`);
  if (rows.length > 0 && !rows[0].convalidated) {
    await knex.raw('ALTER TABLE ticket_audit_logs VALIDATE CONSTRAINT ticket_audit_logs_collaboration_actor_fk');
  }
};

exports.down = async function down() {
  // Forward-only: the NOT VALID file's down removes the constraint.
};

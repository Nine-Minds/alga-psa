const TABLE = 'co_management_requester_email_deliveries';
async function removeRecipientCheck(knex) {
  const checks = await knex.raw("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'c'", [TABLE]);
  for (const check of checks.rows) if (check.definition.includes('recipient_kind')) await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [TABLE, check.conname]);
}
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'resource_type')) await knex.schema.alterTable(TABLE, table => table.string('resource_type', 32).notNullable().defaultTo('ticket'));
  for (const column of ['resource_id', 'project_id', 'contact_id']) if (!await knex.schema.hasColumn(TABLE, column))
    await knex.schema.alterTable(TABLE, table => table.uuid(column).nullable());
  await knex.raw(`CREATE OR REPLACE FUNCTION co_management_requester_email_qualify_resource() RETURNS trigger AS $$ BEGIN
    IF NEW.resource_type = 'ticket' AND NEW.resource_id IS NULL THEN NEW.resource_id := NEW.ticket_id; END IF;
    RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await knex.raw('DROP TRIGGER IF EXISTS co_management_requester_email_qualify_resource ON ??', [TABLE]);
  await knex.raw('CREATE TRIGGER co_management_requester_email_qualify_resource BEFORE INSERT OR UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION co_management_requester_email_qualify_resource()', [TABLE]);
  await knex(TABLE).whereNull('resource_id').update({ resource_id: knex.ref('ticket_id') });
  await knex.raw('ALTER TABLE ?? ALTER COLUMN resource_id SET NOT NULL, ALTER COLUMN ticket_id DROP NOT NULL', [TABLE]);
  await removeRecipientCheck(knex);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_management_requester_email_resource_check CHECK (attempt_count >= 0 AND (
    (resource_type = 'ticket' AND ticket_id IS NOT NULL AND resource_id = ticket_id AND project_id IS NULL AND contact_id IS NULL AND recipient_kind IN ('requester_contact', 'requester_location')) OR
    (resource_type = 'project_task' AND ticket_id IS NULL AND project_id IS NOT NULL AND contact_id IS NOT NULL AND recipient_kind = 'requester_task_user')))`, [TABLE]);
  await knex.raw(`INSERT INTO co_management_event_consumers (tenant, event_id, consumer, status, completed_at, error_code)
    SELECT tenant, event_id, 'requester-email', CASE WHEN status = 'pending' THEN 'pending' ELSE 'cancelled' END,
      CASE WHEN status = 'pending' THEN NULL ELSE clock_timestamp() END,
      CASE WHEN status = 'pending' THEN NULL ELSE 'legacy_native_delivery' END
    FROM co_management_event_outbox WHERE event_type = 'PROJECT_TASK_COMMENT_CREATED' ON CONFLICT DO NOTHING`);
};
exports.down = async function(knex) {
  if (await knex(TABLE).where('resource_type', 'project_task').first()) throw new Error('Cannot discard retained requester task mail');
  await removeRecipientCheck(knex);
  await knex.raw('DROP TRIGGER IF EXISTS co_management_requester_email_qualify_resource ON ??', [TABLE]);
  await knex.raw('DROP FUNCTION IF EXISTS co_management_requester_email_qualify_resource()');
  await knex.raw("ALTER TABLE ?? ALTER COLUMN ticket_id SET NOT NULL, ADD CHECK (recipient_kind IN ('requester_contact', 'requester_location') AND attempt_count >= 0)", [TABLE]);
  await knex.schema.alterTable(TABLE, table => { for (const column of ['resource_type', 'resource_id', 'project_id', 'contact_id']) table.dropColumn(column); });
};
exports.config = { transaction: false };

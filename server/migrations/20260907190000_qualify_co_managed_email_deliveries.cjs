const TABLE = 'co_management_email_deliveries';
const { removeResourceChecks, installResourceCheck } = require('./utils/coManagedEmailDeliveryResource.cjs');
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'resource_type')) await knex.schema.alterTable(TABLE, table => table.string('resource_type', 32).notNullable().defaultTo('ticket'));
  if (!await knex.schema.hasColumn(TABLE, 'resource_id')) await knex.schema.alterTable(TABLE, table => table.uuid('resource_id').nullable());
  await knex.raw(`CREATE OR REPLACE FUNCTION co_management_email_qualify_resource() RETURNS trigger AS $$ BEGIN
    IF NEW.resource_type = 'ticket' AND NEW.resource_id IS NULL THEN NEW.resource_id := NEW.ticket_id; END IF;
    RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await knex.raw('DROP TRIGGER IF EXISTS co_management_email_qualify_resource ON ??', [TABLE]);
  await knex.raw('CREATE TRIGGER co_management_email_qualify_resource BEFORE INSERT OR UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION co_management_email_qualify_resource()', [TABLE]);
  await knex(TABLE).whereNull('resource_id').update({ resource_id: knex.ref('ticket_id') });
  await knex.raw('ALTER TABLE ?? ALTER COLUMN resource_id SET NOT NULL, ALTER COLUMN ticket_id DROP NOT NULL, ALTER COLUMN audience TYPE varchar(32)', [TABLE]);
  await installResourceCheck(knex);
  await knex.raw(`INSERT INTO co_management_event_consumers (tenant, event_id, consumer, status, completed_at, error_code)
    SELECT tenant, event_id, 'co-managed-email', CASE WHEN status = 'pending' THEN 'pending' ELSE 'cancelled' END,
      CASE WHEN status = 'pending' THEN NULL ELSE clock_timestamp() END,
      CASE WHEN status = 'pending' THEN NULL ELSE 'legacy_native_delivery' END
    FROM co_management_event_outbox WHERE event_type = 'PROJECT_TASK_COMMENT_CREATED' ON CONFLICT DO NOTHING`);
};
exports.down = async function(knex) {
  if (await knex(TABLE).whereIn('resource_type', ['project_task', 'ticket_conversation']).first()) throw new Error('Cannot discard retained task or conversation email deliveries');
  await removeResourceChecks(knex);
  await knex.raw('DROP TRIGGER IF EXISTS co_management_email_qualify_resource ON ??', [TABLE]);
  await knex.raw('DROP FUNCTION IF EXISTS co_management_email_qualify_resource()');
  await knex.raw("ALTER TABLE ?? ALTER COLUMN ticket_id SET NOT NULL, ALTER COLUMN audience TYPE varchar(16), ADD CHECK (audience IN ('requester', 'shared_it') AND tenant <> customer_tenant AND attempt_count >= 0)", [TABLE]);
  await knex.schema.alterTable(TABLE, table => { table.dropColumn('resource_type'); table.dropColumn('resource_id'); });
};

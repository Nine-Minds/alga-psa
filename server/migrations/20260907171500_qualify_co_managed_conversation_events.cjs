const { supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_event_outbox';
const TICKETS = "'TICKET_COMMENT_ADDED', 'TICKET_COMMENT_UPDATED', 'TICKET_COMMENT_DELETED', 'TICKET_RESPONSE_STATE_CHANGED', 'TICKET_MESSAGE_ADDED', 'TICKET_INTERNAL_NOTE_ADDED', 'TICKET_CUSTOMER_REPLIED'";
const TASKS = "'PROJECT_TASK_COMMENT_CREATED', 'PROJECT_TASK_COMMENT_UPDATED', 'PROJECT_TASK_COMMENT_DELETED'";
async function eventConstraint(knex, tasks) {
  const constraints = await knex.raw("SELECT conname FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%event_type%'", [TABLE]);
  for (const row of constraints.rows) await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [TABLE, row.conname]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_management_event_outbox_event_type_check CHECK (event_type IN (${TICKETS}${tasks ? ', ' + TASKS : ''}))`, [TABLE]);
}
exports.up = async function(knex) {
  if (!await knex.schema.hasColumn(TABLE, 'resource_type')) await knex.schema.alterTable(TABLE, table => table.string('resource_type', 32).notNullable().defaultTo('ticket'));
  if (!await knex.schema.hasColumn(TABLE, 'resource_id')) await knex.schema.alterTable(TABLE, table => table.uuid('resource_id').nullable());
  // Old ticket producers can remain running during a rolling deployment.
  await knex.raw(`CREATE OR REPLACE FUNCTION co_management_event_outbox_qualify_resource() RETURNS trigger AS $$ BEGIN
    IF NEW.resource_type = 'ticket' AND NEW.resource_id IS NULL THEN NEW.resource_id := NEW.ticket_id; END IF;
    RETURN NEW; END; $$ LANGUAGE plpgsql`);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw('DROP TRIGGER IF EXISTS co_management_event_outbox_qualify_resource ON ??', [TABLE]);
    await knex.raw('CREATE TRIGGER co_management_event_outbox_qualify_resource BEFORE INSERT OR UPDATE ON ?? FOR EACH ROW EXECUTE FUNCTION co_management_event_outbox_qualify_resource()', [TABLE]);
  }
  await knex(TABLE).whereNull('resource_id').update({ resource_id: knex.ref('ticket_id') });
  await knex.raw('ALTER TABLE ?? ALTER COLUMN resource_id SET NOT NULL, ALTER COLUMN ticket_id DROP NOT NULL', [TABLE]);
  await eventConstraint(knex, true);
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_management_event_outbox_resource_check', [TABLE]);
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_management_event_outbox_resource_check CHECK (
    (resource_type = 'ticket' AND ticket_id IS NOT NULL AND ticket_id = resource_id AND event_type IN (${TICKETS})) OR
    (resource_type = 'project_task' AND ticket_id IS NULL AND event_type IN (${TASKS})))`, [TABLE]);
};
exports.down = async function(knex) {
  if (await knex(TABLE).where('resource_type', 'project_task').first()) throw new Error('Cannot discard retained task conversation event history');
  await eventConstraint(knex, false);
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT IF EXISTS co_management_event_outbox_resource_check', [TABLE]);
  if (await supportsTriggers(knex, TABLE)) {
    await knex.raw('DROP TRIGGER IF EXISTS co_management_event_outbox_qualify_resource ON ??', [TABLE]);
  }
  await knex.raw('DROP FUNCTION IF EXISTS co_management_event_outbox_qualify_resource()');
  await knex.raw('ALTER TABLE ?? ALTER COLUMN ticket_id SET NOT NULL', [TABLE]);
  await knex.schema.alterTable(TABLE, table => { table.dropColumn('resource_type'); table.dropColumn('resource_id'); });
};

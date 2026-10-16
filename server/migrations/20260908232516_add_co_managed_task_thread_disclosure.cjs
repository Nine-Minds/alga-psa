const { supportsTriggers } = require('./utils/citusDistribution.cjs');
const TABLE = 'co_management_thread_transfers';
exports.up = async knex => {
  if (!await knex.schema.hasColumn(TABLE,'project_task_id')) await knex.schema.alterTable(TABLE,t=>t.uuid('project_task_id').nullable());
  await knex.raw('ALTER TABLE ?? ALTER COLUMN ticket_id DROP NOT NULL',[TABLE]);
  if (!await knex('pg_constraint').where('conname','co_thread_transfer_parent_check').whereRaw('conrelid = ?::regclass',[TABLE]).first())
    await knex.raw('ALTER TABLE ?? ADD CONSTRAINT co_thread_transfer_parent_check CHECK (num_nonnulls(ticket_id, project_task_id) = 1)',[TABLE]);
  await knex.raw('ALTER TABLE co_management_conversation_attachments DROP CONSTRAINT IF EXISTS co_task_attachment_publication_check');
  await knex.raw('ALTER TABLE co_management_conversation_attachments ADD CONSTRAINT co_task_attachment_publication_check CHECK (project_task_id IS NULL OR draft_operation_id IS NULL)');
  await knex.raw(`CREATE OR REPLACE FUNCTION co_thread_transfer_parent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF ROW(NEW.tenant,NEW.operation_id,NEW.customer_tenant,NEW.relationship_id,NEW.ticket_id,NEW.project_task_id,NEW.source_thread_id)
      IS DISTINCT FROM ROW(OLD.tenant,OLD.operation_id,OLD.customer_tenant,OLD.relationship_id,OLD.ticket_id,OLD.project_task_id,OLD.source_thread_id) THEN
      RAISE EXCEPTION 'Thread transfer parent identity is immutable' USING ERRCODE = '23514';
    END IF; RETURN NEW; END; $$`);
  if (await supportsTriggers(knex, 'co_management_thread_transfers')) {
    await knex.raw('DROP TRIGGER IF EXISTS co_thread_transfer_parent_immutable ON co_management_thread_transfers');
    await knex.raw('CREATE TRIGGER co_thread_transfer_parent_immutable BEFORE UPDATE ON co_management_thread_transfers FOR EACH ROW EXECUTE FUNCTION co_thread_transfer_parent_immutable()');
  }
};
exports.down = async knex => {
  if (await knex(TABLE).whereNotNull('project_task_id').first() || await knex('co_management_conversation_attachments').whereNotNull('project_task_id').whereNotNull('disclosure_operation_id').first())
    throw new Error('Cannot discard retained task disclosure history');
  if (await supportsTriggers(knex, 'co_management_thread_transfers')) {
    await knex.raw('DROP TRIGGER IF EXISTS co_thread_transfer_parent_immutable ON co_management_thread_transfers');
  }
  await knex.raw('DROP FUNCTION IF EXISTS co_thread_transfer_parent_immutable()');
  await knex.raw('ALTER TABLE co_management_conversation_attachments DROP CONSTRAINT co_task_attachment_publication_check');
  await knex.raw('ALTER TABLE co_management_conversation_attachments ADD CONSTRAINT co_task_attachment_publication_check CHECK (project_task_id IS NULL OR (draft_operation_id IS NULL AND disclosure_operation_id IS NULL))');
  await knex.raw('ALTER TABLE ?? DROP CONSTRAINT co_thread_transfer_parent_check',[TABLE]);
  await knex.raw('ALTER TABLE ?? ALTER COLUMN ticket_id SET NOT NULL',[TABLE]);
  await knex.schema.alterTable(TABLE,t=>t.dropColumn('project_task_id'));
};

const TABLE = 'co_management_email_deliveries';
async function removeResourceChecks(knex) {
  const checks = await knex.raw("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = ?::regclass AND contype = 'c'", [TABLE]);
  for (const check of checks.rows) if (check.definition.includes('tenant <> customer_tenant') || check.conname === 'co_management_email_resource_check')
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [TABLE, check.conname]);
}
/** Earlier migration replay must preserve the qualified conversation variant. */
async function installResourceCheck(knex) {
  const named = await knex.schema.hasColumn(TABLE, 'conversation_id');
  await removeResourceChecks(knex);
  const legacy = named ? 'AND conversation_id IS NULL AND conversation_store_tenant IS NULL AND attention_sequence IS NULL' : '';
  await knex.raw(`ALTER TABLE ?? ADD CONSTRAINT co_management_email_resource_check CHECK (attempt_count >= 0 AND (
    (relationship_id IS NOT NULL ${legacy} AND (
      (resource_type = 'ticket' AND ticket_id IS NOT NULL AND resource_id = ticket_id AND tenant <> customer_tenant AND audience IN ('requester', 'shared_it')) OR
      (resource_type = 'project_task' AND ticket_id IS NULL AND (audience IN ('requester', 'shared_it') OR (audience = 'organization_private' AND tenant = customer_tenant)))))
    ${named ? `OR (resource_type = 'ticket_conversation' AND ticket_id IS NOT NULL AND resource_id = ticket_id
      AND conversation_id IS NOT NULL AND conversation_store_tenant IS NOT NULL AND attention_sequence IS NOT NULL AND attention_sequence > 0
      AND (tenant = customer_tenant OR relationship_id IS NOT NULL)
      AND ((audience = 'shared_it' AND conversation_store_tenant = customer_tenant)
        OR (audience = 'organization_private' AND conversation_store_tenant = tenant)))` : ''}
    ))`, [TABLE]);
}
module.exports = { removeResourceChecks, installResourceCheck };

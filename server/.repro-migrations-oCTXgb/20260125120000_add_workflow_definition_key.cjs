const EMAIL_SYSTEM_WORKFLOW_ID = '00000000-0000-0000-0000-00000000e001';
const EMAIL_SYSTEM_WORKFLOW_KEY = 'system.email-processing';

exports.up = async function (knex) {
  const hasKey = await knex.schema.hasColumn('workflow_definitions', 'key');
  if (!hasKey) {
    await knex.schema.alterTable('workflow_definitions', (table) => {
      table.text('key');
      table.unique(['key'], { indexName: 'workflow_definitions_key_unique' });
      table.index(['key'], 'idx_workflow_definitions_key');
    });
  }

  // Best-effort backfill for the known system workflow seeded by migrations.
  const existing = await knex('workflow_definitions')
    .where({ workflow_id: EMAIL_SYSTEM_WORKFLOW_ID })
    .first();
  if (existing && !existing.key) {
    await knex('workflow_definitions')
      .where({ workflow_id: EMAIL_SYSTEM_WORKFLOW_ID })
      .update({ key: EMAIL_SYSTEM_WORKFLOW_KEY, updated_at: new Date().toISOString() });
  }
};

exports.down = async function (knex) {
  const hasKey = await knex.schema.hasColumn('workflow_definitions', 'key');
  if (!hasKey) return;

  await knex.schema.alterTable('workflow_definitions', (table) => {
    table.dropIndex(['key'], 'idx_workflow_definitions_key');
    table.dropUnique(['key'], 'workflow_definitions_key_unique');
    table.dropColumn('key');
  });
};


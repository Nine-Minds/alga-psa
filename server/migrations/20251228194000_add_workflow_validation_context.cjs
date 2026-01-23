/**
 * Add validation context fields to workflow_definitions so users can understand
 * which schema refs/mode were used when computing validation status.
 */

exports.up = async function up(knex) {
  const hasContext = await knex.schema.hasColumn('workflow_definitions', 'validation_context_json');
  if (!hasContext) {
    await knex.schema.alterTable('workflow_definitions', (table) => {
      table.jsonb('validation_context_json').nullable();
      table.text('validation_payload_schema_hash').nullable();
    });
  }
};

exports.down = async function down(knex) {
  const hasContext = await knex.schema.hasColumn('workflow_definitions', 'validation_context_json');
  if (!hasContext) return;
  await knex.schema.alterTable('workflow_definitions', (table) => {
    table.dropColumn('validation_payload_schema_hash');
    table.dropColumn('validation_context_json');
  });
};


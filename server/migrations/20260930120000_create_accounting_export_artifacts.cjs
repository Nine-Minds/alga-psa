const TABLE = 'accounting_export_artifacts';

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    await knex.schema.createTable(TABLE, (table) => {
      table.uuid('artifact_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('tenant').notNullable();
      table.uuid('batch_id').notNullable();
      table.uuid('file_id').nullable();
      table.text('filename').notNullable();
      table.text('content_type').notNullable();
      table.binary('content').notNullable();
      table.boolean('storage_fallback').notNullable().defaultTo(false);
      table.primary(['tenant', 'artifact_id']);
      table.unique(['tenant', 'batch_id', 'filename'], { indexName: 'accounting_export_artifacts_batch_filename_uk' });
      table.index(['tenant', 'batch_id'], 'accounting_export_artifacts_batch_idx');
    });
  }
  const distributed = await knex.raw("SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS exists");
  const hasCitus = distributed.rows?.[0]?.exists ?? distributed[0]?.exists ?? false;
  if (hasCitus) {
    await knex.raw("SELECT create_distributed_table('accounting_export_artifacts', 'tenant', colocate_with => 'accounting_export_batches')");
  }
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists(TABLE);
};

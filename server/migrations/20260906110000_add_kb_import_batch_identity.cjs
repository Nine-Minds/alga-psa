/** Stable import identity independent of an asynchronous job's record ID. */
exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('kb_import_files', 'batch_id'))) {
    await knex.schema.alterTable('kb_import_files', table => {
      table.uuid('batch_id').nullable();
      table.index(['tenant', 'batch_id'], 'kb_import_files_tenant_batch_idx');
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn('kb_import_files', 'batch_id'))) return;
  if (await knex('kb_import_files').whereNotNull('batch_id').first('import_file_id')) {
    throw new Error('Cannot remove KB import batch identities while tracked imports exist');
  }
  await knex.schema.alterTable('kb_import_files', table => {
    table.dropIndex(['tenant', 'batch_id'], 'kb_import_files_tenant_batch_idx');
    table.dropColumn('batch_id');
  });
};

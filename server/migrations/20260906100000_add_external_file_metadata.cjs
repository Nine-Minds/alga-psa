/** FileStoreModel exposes metadata updates; persist them on the file record. */
exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('external_files', 'metadata'))) {
    await knex.schema.alterTable('external_files', table => {
      table.jsonb('metadata').nullable();
    });
  }
};

exports.down = async function (knex) {
  if (!(await knex.schema.hasColumn('external_files', 'metadata'))) return;
  if (await knex('external_files').whereNotNull('metadata').first('file_id')) {
    throw new Error('Cannot remove external file metadata while stored values exist');
  }
  await knex.schema.alterTable('external_files', table => table.dropColumn('metadata'));
};

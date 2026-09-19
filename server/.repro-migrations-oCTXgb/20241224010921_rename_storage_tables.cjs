/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Drop existing foreign key constraints
  await knex.schema.table('file_stores', table => {
    table.dropForeign(['tenant', 'deleted_by']);
    table.dropForeign(['tenant', 'uploaded_by']);
    table.dropForeign(['tenant']);
  });

  await knex.schema.table('storage_buckets', table => {
    table.dropForeign(['tenant', 'provider_id']);
    table.dropForeign(['tenant']);
  });

  // Rename tables and columns
  await knex.schema.renameTable('file_stores', 'external_files');
  await knex.schema.renameTable('storage_buckets', 'storage_configurations');

  // Rename columns in external_files (previously file_stores)
  await knex.schema.table('external_files', table => {
    table.renameColumn('uploaded_by', 'uploaded_by_id');
    table.renameColumn('deleted_by', 'deleted_by_id');
  });

  // Rename columns in storage_configurations (previously storage_buckets)
  await knex.schema.table('storage_configurations', table => {
    table.renameColumn('bucket_id', 'configuration_id');
    table.renameColumn('bucket_name', 'name');
    table.renameColumn('bucket_path', 'path');
  });

  // Recreate foreign key constraints for external_files
  await knex.schema.table('external_files', table => {
    table.foreign(['tenant', 'deleted_by_id']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'uploaded_by_id']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant']).references('tenant').inTable('tenants');
  });

  // Recreate foreign key constraints for storage_configurations
  await knex.schema.table('storage_configurations', table => {
    table.foreign(['tenant', 'provider_id']).references(['tenant', 'provider_id']).inTable('storage_providers');
    table.foreign(['tenant']).references('tenant').inTable('tenants');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Drop foreign key constraints
  await knex.schema.table('external_files', table => {
    table.dropForeign(['tenant', 'deleted_by_id']);
    table.dropForeign(['tenant', 'uploaded_by_id']);
    table.dropForeign(['tenant']);
  });

  await knex.schema.table('storage_configurations', table => {
    table.dropForeign(['tenant', 'provider_id']);
    table.dropForeign(['tenant']);
  });

  // Rename columns back in external_files
  await knex.schema.table('external_files', table => {
    table.renameColumn('uploaded_by_id', 'uploaded_by');
    table.renameColumn('deleted_by_id', 'deleted_by');
  });

  // Rename columns back in storage_configurations
  await knex.schema.table('storage_configurations', table => {
    table.renameColumn('configuration_id', 'bucket_id');
    table.renameColumn('name', 'bucket_name');
    table.renameColumn('path', 'bucket_path');
  });

  // Rename tables back
  await knex.schema.renameTable('external_files', 'file_stores');
  await knex.schema.renameTable('storage_configurations', 'storage_buckets');

  // Recreate original foreign key constraints for file_stores
  await knex.schema.table('file_stores', table => {
    table.foreign(['tenant', 'deleted_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant', 'uploaded_by']).references(['tenant', 'user_id']).inTable('users');
    table.foreign(['tenant']).references('tenant').inTable('tenants');
  });

  // Recreate original foreign key constraints for storage_buckets
  await knex.schema.table('storage_buckets', table => {
    table.foreign(['tenant', 'provider_id']).references(['tenant', 'provider_id']).inTable('storage_providers');
    table.foreign(['tenant']).references('tenant').inTable('tenants');
  });
};


exports.up = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('bucket_usage', 'service_catalog_id');

  if (!hasColumn) {
    await knex.schema.table('bucket_usage', function(table) {
      // Add the service_catalog_id column if it doesn't exist
      table.uuid('service_catalog_id').nullable();

      // Add the foreign key constraint
      table.foreign(['service_catalog_id', 'tenant'], 'bucket_usage_service_catalog_fk')
        .references(['service_id', 'tenant'])
        .inTable('service_catalog')
        .onDelete('SET NULL');
    });

    // Update existing records
    const defaultService = await knex('service_catalog')
      .where({ service_name: 'Default Bucket Service' })
      .first();

    if (defaultService) {
      await knex('bucket_usage')
        .whereNull('service_catalog_id')
        .update({ service_catalog_id: defaultService.service_id });
    }
  } else {
    console.log('Column service_catalog_id already exists in bucket_usage table. Skipping column addition.');
  }
};

exports.down = async function(knex) {
  const hasColumn = await knex.schema.hasColumn('bucket_usage', 'service_catalog_id');

  if (hasColumn) {
    await knex.schema.table('bucket_usage', function(table) {
      // Drop the foreign key constraint
      table.dropForeign(['service_catalog_id', 'tenant'], 'bucket_usage_service_catalog_fk');

      // Drop the service_catalog_id column
      table.dropColumn('service_catalog_id');
    });
  } else {
    console.log('Column service_catalog_id does not exist in bucket_usage table. Skipping column removal.');
  }
};

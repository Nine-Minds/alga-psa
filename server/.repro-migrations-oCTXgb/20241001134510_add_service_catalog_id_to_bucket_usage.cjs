exports.up = function(knex) {
  return knex.schema.table('bucket_usage', function(table) {
    table.uuid('service_catalog_id');
  });
};

exports.down = function(knex) {
  return knex.schema.table('bucket_usage', function(table) {
    table.dropColumn('service_catalog_id');
  });
};

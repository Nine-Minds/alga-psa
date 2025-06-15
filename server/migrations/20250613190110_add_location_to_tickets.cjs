
exports.up = function(knex) {
  return knex.schema.table('tickets', function(table) {
    table.uuid('location_id').nullable();
    // For CitusDB compatibility, reference both location_id and tenant
    // Note: We use RESTRICT instead of SET NULL because PostgreSQL doesn't support 
    // SET NULL on composite foreign keys where only one column should be nulled
    table.foreign(['location_id', 'tenant']).references(['location_id', 'tenant']).inTable('company_locations').onDelete('RESTRICT');
    table.index(['location_id', 'tenant'], 'idx_tickets_location_tenant');
  });
};

exports.down = function(knex) {
  return knex.schema.table('tickets', function(table) {
    table.dropIndex(['location_id', 'tenant'], 'idx_tickets_location_tenant');
    table.dropForeign(['location_id', 'tenant']);
    table.dropColumn('location_id');
  });
};

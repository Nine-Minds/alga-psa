
exports.up = function(knex) {
  return knex.schema.table('workflow_registration_versions', function(table) {
    table.text('code').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('workflow_registration_versions', function(table) {
    table.dropColumn('code');
  });
};


exports.up = function(knex) {
  return knex.schema.table('workflow_registration_versions', function(table) {
    table.dropColumn('definition');
  });
};

exports.down = function(knex) {
  return knex.schema.table('workflow_registration_versions', function(table) {
    table.jsonb('definition').nullable();
  });
};

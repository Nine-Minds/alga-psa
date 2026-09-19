exports.up = function(knex) {
  return knex.schema.alterTable('job_details', table => {
    table.jsonb('metadata').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('job_details', table => {
    table.dropColumn('metadata');
  });
};

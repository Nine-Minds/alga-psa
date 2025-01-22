exports.up = function(knex) {
  return knex.schema.alterTable('job_details', table => {
    table.timestamp('updated_at')
      .notNullable()
      .defaultTo(knex.fn.now());
  });
};

exports.down = function(knex) {
  return knex.schema.alterTable('job_details', table => {
    table.dropColumn('updated_at');
  });
};

exports.up = function(knex) {
  return knex.raw(`
    CREATE TYPE item_type AS ENUM ('project', 'project_task', 'ticket');
  `);
};

exports.down = function(knex) {
  return knex.raw(`
    DROP TYPE item_type;
  `);
};

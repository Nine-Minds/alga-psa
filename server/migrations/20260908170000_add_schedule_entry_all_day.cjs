exports.up = async function (knex) {
  // Historical midnight intervals may be timed appointments. Preserve them as
  // timed; provider resynchronization supplies explicit date-only semantics.
  await knex.schema.alterTable('schedule_entries', table => {
    table.boolean('is_all_day').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('schedule_entries', table => {
    table.dropColumn('is_all_day');
  });
};

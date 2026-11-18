// Rule 5 (red): unbatched write to an existing table, raw and builder.
exports.up = async function (knex) {
  // lint-expect: 5
  await knex.raw('UPDATE comments SET note = 1');
  // lint-expect: 5
  await knex('time_entries').update({ note: 'x' });
};

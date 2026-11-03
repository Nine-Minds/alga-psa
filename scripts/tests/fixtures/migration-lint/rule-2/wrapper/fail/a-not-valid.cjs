// Rule 2 (red, wrapper 1 of 2): NOT VALID that nothing validates.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_len_check');
  // lint-expect: 2
  await knex.raw('ALTER TABLE comments ADD CONSTRAINT comments_len_check CHECK (length(note) < 10) NOT VALID');
};

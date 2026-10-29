// Rule 2 (red): CHECK added to an existing table without NOT VALID.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_len_check');
  // lint-expect: 2
  await knex.raw('ALTER TABLE comments ADD CONSTRAINT comments_len_check CHECK (length(note) < 10)');
};

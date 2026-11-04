// Rule 2 (green, wrapper 1 of 2): NOT VALID in a transactional file.
exports.up = async function (knex) {
  await knex.raw('ALTER TABLE comments DROP CONSTRAINT IF EXISTS comments_len_check');
  await knex.raw('ALTER TABLE comments ADD CONSTRAINT comments_len_check CHECK (length(note) < 10) NOT VALID');
};

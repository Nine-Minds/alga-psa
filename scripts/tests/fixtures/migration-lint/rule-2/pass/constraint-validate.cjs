// Rule 2 (green, file 2 of 2): VALIDATE in a different, non-transactional file.
exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.raw('ALTER TABLE comments VALIDATE CONSTRAINT comments_len_check');
};

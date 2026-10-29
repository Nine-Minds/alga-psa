// Rule 1 (green): CONCURRENTLY + IF NOT EXISTS in a non-transactional migration.
exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.raw('CREATE INDEX CONCURRENTLY IF NOT EXISTS comments_tenant_idx ON comments (tenant)');
};

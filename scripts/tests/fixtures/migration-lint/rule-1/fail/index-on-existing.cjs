// Rule 1 (red): index on an existing table, transactional, no CONCURRENTLY.
exports.up = async function (knex) {
  // lint-expect: 1
  await knex.raw('CREATE INDEX IF NOT EXISTS comments_tenant_idx ON comments (tenant)');
};

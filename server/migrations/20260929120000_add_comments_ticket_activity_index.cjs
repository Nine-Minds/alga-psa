// Supports the `latest_activity_at` ticket-list sort, whose per-ticket
// MAX(comments.created_at) subquery lives in TICKET_LATEST_ACTIVITY_SQL
// (packages/tickets/src/actions/ticketListSortSql.ts). The partial predicate is
// kept identical to that expression's WHERE clause so the planner can resolve
// each MAX() with a backward index-only scan instead of scanning a ticket's
// comments. Built CONCURRENTLY: `comments` is one of the largest tenant tables
// and the list must stay readable while the index is created.
exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS comments_tenant_ticket_created_idx
    ON comments (tenant, ticket_id, created_at DESC)
    WHERE deleted_at IS NULL AND publish_state = 'published'`);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS comments_tenant_ticket_created_idx');
};

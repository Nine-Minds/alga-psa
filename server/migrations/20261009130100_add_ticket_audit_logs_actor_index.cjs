// Serves the work-trail query (packages/scheduling/src/actions/workTrailActions.ts), which reads one
// user's ticket_audit_logs rows by occurred_at range. The table's only other index is keyed by
// ticket, so there was no way to query by actor.
//
// Non-unique, so there is no stale-local-heap risk. Built CONCURRENTLY like the other index-only
// migrations on large distributed tables (e.g. comments_tenant_ticket_created_idx); on a Citus
// distributed table CREATE INDEX CONCURRENTLY is supported and builds the shard indexes one by one.
// Hence transaction:false.
exports.config = { transaction: false };

exports.up = async function (knex) {
  await knex.raw(`CREATE INDEX CONCURRENTLY IF NOT EXISTS ticket_audit_logs_actor_time_idx
    ON ticket_audit_logs (tenant, actor_user_id, occurred_at)`);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX CONCURRENTLY IF EXISTS ticket_audit_logs_actor_time_idx');
};

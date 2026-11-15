// C1 (alga-2026-0002893): a KB document's is_client_visible is derived from its
// article: visible iff status = 'published' AND audience IN ('client','public').
// Before the application fix, an audience/status change left the flag stale, so
// internal, draft, in-review and archived articles could still be flagged
// client-visible.
//
// Hide-only data repair. It never sets the flag to true: a migration must not
// expose content. Published client/public articles with a stale false are
// repaired by their next write. No DDL, idempotent (a second run updates 0
// rows), N-1 compatible.
//
// Runs outside one big transaction. Each tenant is repaired in batches of
// BATCH_SIZE documents, one short transaction per batch, looping until a batch
// comes back short. Every statement is tenant-pinned on both sides of the
// co-located join (documents.tenant = kb_articles.tenant = ?) so Citus routes it
// to that tenant's single shard. A repaired row leaves the predicate
// (is_client_visible becomes false), so the loop always makes progress and ends.
// Materialize the candidate batch once, including on databases with stale statistics.
const BATCH_SIZE = 1000;

exports.config = { transaction: false };
exports.BATCH_SIZE = BATCH_SIZE;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('kb_articles')) || !(await knex.schema.hasTable('documents'))) {
    return;
  }

  const tenants = await knex('kb_articles').distinct('tenant').pluck('tenant');

  for (const tenant of tenants) {
    for (;;) {
      const result = await knex.transaction(async (trx) => {
        await trx.raw("SET LOCAL lock_timeout = '2s'");
        return trx.raw(
          `
          WITH batch AS MATERIALIZED (
              SELECT dd.document_id
                FROM documents AS dd
                JOIN kb_articles AS ka
                  ON ka.tenant = dd.tenant
                 AND ka.document_id = dd.document_id
               WHERE dd.tenant = ?
                 AND ka.tenant = ?
                 AND dd.is_client_visible
                 AND NOT (ka.status = 'published' AND ka.audience IN ('client', 'public'))
               LIMIT ?
          )
          UPDATE documents AS d
             SET is_client_visible = false,
                 updated_at = now()
            FROM batch
           WHERE d.tenant = ?
             AND d.document_id = batch.document_id
          `,
          [tenant, tenant, BATCH_SIZE, tenant]
        );
      });
      const updated = typeof result.rowCount === 'number' ? result.rowCount : 0;
      if (updated < BATCH_SIZE) break;
    }
  }
};

exports.down = async function down() {
  // Data repair; nothing to restore (it only cleared flags the article state says must be off).
};

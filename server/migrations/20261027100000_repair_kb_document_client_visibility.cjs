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
// Runs outside one big transaction; each tenant is repaired in its own short
// transaction, and the UPDATE is tenant-pinned on both sides of the
// co-located join (documents.tenant = kb_articles.tenant = ?) so Citus routes it
// to that tenant's single shard.
exports.config = { transaction: false };

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('kb_articles')) || !(await knex.schema.hasTable('documents'))) {
    return;
  }

  const tenants = await knex('kb_articles').distinct('tenant').pluck('tenant');

  for (const tenant of tenants) {
    await knex.transaction(async (trx) => {
      await trx.raw(
        `
        UPDATE documents AS d
           SET is_client_visible = false,
               updated_at = now()
          FROM kb_articles AS ka
         WHERE d.tenant = ?
           AND ka.tenant = ?
           AND d.tenant = ka.tenant
           AND d.document_id = ka.document_id
           AND d.is_client_visible
           AND NOT (ka.status = 'published' AND ka.audience IN ('client', 'public'))
        `,
        [tenant, tenant]
      );
    });
  }
};

exports.down = async function down() {
  // Data repair; nothing to restore (it only cleared flags the article state says must be off).
};

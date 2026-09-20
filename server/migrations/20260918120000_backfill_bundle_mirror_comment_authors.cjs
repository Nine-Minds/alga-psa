// Backfill author fields on bundle-mirrored child comments from their source
// comment. Before this, sync_updates mirrors were inserted authorless
// (user_id/contact_id null, author_type 'unknown'), so children rendered as
// "Unknown User". The mapping is authoritative: ticket_bundle_mirrors joins
// each child copy to the comment on the master.
//
// Two tenant-co-located UPDATE ... FROM statements (comments, then
// comment_threads) rather than one three-table write: Citus routes each
// statement per shard and the `IS NULL` guards make reruns no-ops.
exports.up = async function up(knex) {
  await backfillMirroredCommentAuthors(knex);
  await backfillMirroredCommentThreadAuthors(knex);
};

async function backfillMirroredCommentAuthors(knex) {
  await knex.raw(`
    UPDATE comments AS child
    SET
      user_id = source.user_id,
      contact_id = source.contact_id,
      author_type = source.author_type
    FROM ticket_bundle_mirrors AS mirror
    JOIN comments AS source
      ON source.tenant = mirror.tenant
     AND source.comment_id = mirror.source_comment_id
    WHERE child.tenant = mirror.tenant
      AND child.comment_id = mirror.child_comment_id
      AND child.is_system_generated = true
      AND child.user_id IS NULL
      AND child.contact_id IS NULL
      AND (source.user_id IS NOT NULL OR source.contact_id IS NOT NULL)
  `);
}

async function backfillMirroredCommentThreadAuthors(knex) {
  await knex.raw(`
    UPDATE comment_threads AS thread
    SET created_by = source.user_id
    FROM ticket_bundle_mirrors AS mirror
    JOIN comments AS child
      ON child.tenant = mirror.tenant
     AND child.comment_id = mirror.child_comment_id
    JOIN comments AS source
      ON source.tenant = mirror.tenant
     AND source.comment_id = mirror.source_comment_id
    WHERE thread.tenant = mirror.tenant
      AND thread.thread_id = child.thread_id
      AND thread.created_by IS NULL
      AND source.user_id IS NOT NULL
  `);
}

// Revert only rows reachable through ticket_bundle_mirrors, restoring the
// pre-backfill authorless shape (null author fields, 'unknown', null
// created_by). Non-mirrored comments are never touched.
exports.down = async function down(knex) {
  await knex.raw(`
    UPDATE comment_threads AS thread
    SET created_by = NULL
    FROM ticket_bundle_mirrors AS mirror
    JOIN comments AS child
      ON child.tenant = mirror.tenant
     AND child.comment_id = mirror.child_comment_id
    WHERE thread.tenant = mirror.tenant
      AND thread.thread_id = child.thread_id
      AND child.is_system_generated = true
  `);

  await knex.raw(`
    UPDATE comments AS child
    SET
      user_id = NULL,
      contact_id = NULL,
      author_type = 'unknown'
    FROM ticket_bundle_mirrors AS mirror
    WHERE child.tenant = mirror.tenant
      AND child.comment_id = mirror.child_comment_id
      AND child.is_system_generated = true
  `);
};

// Backfill issues single-table-per-statement updates that Citus routes per
// shard; both must commit independently so a partial failure doesn't undo rows
// already populated.
exports.config = { transaction: false };

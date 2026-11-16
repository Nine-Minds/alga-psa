'use strict';

/**
 * Backfill `metadata.opensTicket = true` on the comment that opened each email-originated ticket
 * (alga-2026-0003227). New tickets get the marker when they are created; this marks the ones that
 * already exist so every ticket view renders their opening comment as a compact row.
 *
 * A comment qualifies when its ticket has ticket_origin = 'inbound_email' and the comment is a
 * live root comment (parent_comment_id IS NULL) with inbound-email provenance
 * (metadata.responseSource = 'inbound_email' or metadata.email present). Then:
 *   1. Primary: metadata.email.messageId equals tickets.email_metadata.messageId.
 *   2. Fallback, only for tickets that step 1 left without a marked comment: the ticket's earliest
 *      such comment, if it was created within 120 seconds of the ticket (entered_at). The workflow
 *      path's comment may carry no messageId, which is why the fallback exists.
 *
 * At most one comment per ticket is marked. A ticket that already has a marked comment (written by
 * the new code, or by an earlier run of this migration) is skipped, so a re-run is a no-op.
 * `attachmentCount` is not set: the original attachment list is not recoverable from the comment.
 *
 * Batching: most tickets arrive by email, so this touches a large share of `comments`. It runs
 * outside a transaction in keyset batches of inbound-email tickets over (tenant, ticket_id); each
 * batch applies rule 1 and then rule 2 to its tickets only, and commits on its own. Both rules are
 * per-ticket, so batching does not change which comment is marked, and an interrupted run resumes
 * correctly because already-marked tickets are skipped.
 *
 * Citus: comments and tickets are distributed and co-located by tenant. Every join includes
 * `tenant`; the batch filter is `= ANY(array)` on both distribution-key columns; the per-ticket pick
 * is a ROW_NUMBER() partitioned by (tenant, ticket_id) in a derived table, never a correlated
 * `col = (SELECT ... LIMIT 1)` (which Citus cannot push down). now() is not used. The SQL is written
 * out literally, not assembled from a template, so the migration linter can verify each statement.
 *
 * Comments this misses simply render in full, as they do today.
 */
exports.config = { transaction: false };

const BATCH_SIZE = 1000;

async function backfillEmailOpenerCommentMarker(knex, batchSize = BATCH_SIZE) {
  let marked = 0;
  let afterTenant = null;
  let afterTicket = null;
  for (;;) {
    const batch = await knex.raw(
      `SELECT tenant, ticket_id
         FROM tickets
        WHERE ticket_origin = 'inbound_email'
          AND (?::uuid IS NULL OR (tenant, ticket_id) > (?::uuid, ?::uuid))
        ORDER BY tenant, ticket_id
        LIMIT ?`,
      [afterTenant, afterTenant, afterTicket, batchSize]
    );
    const rows = batch.rows;
    if (rows.length === 0) break;
    const tenants = [...new Set(rows.map((row) => row.tenant))];
    const ticketIds = rows.map((row) => row.ticket_id);

    // 1. Primary rule: Message-ID match. Earliest match wins if several share the id.
    const primary = await knex.raw(
      `UPDATE comments AS c
          SET metadata = COALESCE(c.metadata, '{}'::jsonb) || '{"opensTicket": true}'::jsonb
         FROM (
           SELECT ranked.tenant, ranked.comment_id
             FROM (
               SELECT
                 c2.tenant,
                 c2.comment_id,
                 ROW_NUMBER() OVER (
                   PARTITION BY c2.tenant, c2.ticket_id
                   ORDER BY c2.created_at ASC, c2.comment_id ASC
                 ) AS rn
               FROM comments AS c2
               JOIN tickets AS t
                 ON t.tenant = c2.tenant AND t.ticket_id = c2.ticket_id
               LEFT JOIN comments AS m
                 ON m.tenant = t.tenant
                AND m.ticket_id = t.ticket_id
                AND m.metadata->>'opensTicket' = 'true'
              WHERE m.comment_id IS NULL
                AND t.tenant = ANY(?::uuid[])
                AND t.ticket_id = ANY(?::uuid[])
                AND c2.tenant = ANY(?::uuid[])
                AND c2.ticket_id = ANY(?::uuid[])
                AND t.ticket_origin = 'inbound_email'
                AND c2.parent_comment_id IS NULL
                AND c2.deleted_at IS NULL
                AND (c2.metadata->>'responseSource' = 'inbound_email' OR c2.metadata->'email' IS NOT NULL)
                AND COALESCE(t.email_metadata->>'messageId', '') <> ''
                AND c2.metadata->'email'->>'messageId' = t.email_metadata->>'messageId'
             ) AS ranked
            WHERE ranked.rn = 1
         ) AS pick
        WHERE c.tenant = pick.tenant
          AND c.comment_id = pick.comment_id`,
      [tenants, ticketIds, tenants, ticketIds]
    );

    // 2. Fallback: tickets still without a marked comment get their earliest inbound-email root
    //    comment, if it landed within 120s of the ticket.
    const fallback = await knex.raw(
      `UPDATE comments AS c
          SET metadata = COALESCE(c.metadata, '{}'::jsonb) || '{"opensTicket": true}'::jsonb
         FROM (
           SELECT ranked.tenant, ranked.comment_id
             FROM (
               SELECT
                 c2.tenant,
                 c2.comment_id,
                 c2.created_at,
                 t.entered_at,
                 ROW_NUMBER() OVER (
                   PARTITION BY c2.tenant, c2.ticket_id
                   ORDER BY c2.created_at ASC, c2.comment_id ASC
                 ) AS rn
               FROM comments AS c2
               JOIN tickets AS t
                 ON t.tenant = c2.tenant AND t.ticket_id = c2.ticket_id
               LEFT JOIN comments AS m
                 ON m.tenant = t.tenant
                AND m.ticket_id = t.ticket_id
                AND m.metadata->>'opensTicket' = 'true'
              WHERE m.comment_id IS NULL
                AND t.tenant = ANY(?::uuid[])
                AND t.ticket_id = ANY(?::uuid[])
                AND c2.tenant = ANY(?::uuid[])
                AND c2.ticket_id = ANY(?::uuid[])
                AND t.ticket_origin = 'inbound_email'
                AND c2.parent_comment_id IS NULL
                AND c2.deleted_at IS NULL
                AND (c2.metadata->>'responseSource' = 'inbound_email' OR c2.metadata->'email' IS NOT NULL)
             ) AS ranked
            WHERE ranked.rn = 1
              AND ranked.created_at >= ranked.entered_at - interval '120 seconds'
              AND ranked.created_at <= ranked.entered_at + interval '120 seconds'
         ) AS pick
        WHERE c.tenant = pick.tenant
          AND c.comment_id = pick.comment_id`,
      [tenants, ticketIds, tenants, ticketIds]
    );

    marked += (primary.rowCount ?? 0) + (fallback.rowCount ?? 0);
    if (rows.length < batchSize) break;
    afterTenant = rows[rows.length - 1].tenant;
    afterTicket = rows[rows.length - 1].ticket_id;
  }
  return { marked };
}

exports.backfillEmailOpenerCommentMarker = backfillEmailOpenerCommentMarker;

exports.up = async function up(knex) {
  const { marked } = await backfillEmailOpenerCommentMarker(knex);
  console.log(`[backfill email opener comment marker] marked ${marked} comment(s)`);
};

exports.down = async function down(knex) {
  // Removes the marker from every comment that carries it, including ones written by the new
  // code after this release. Without it the comments render in full, as before.
  await knex.raw(`
    UPDATE comments
    SET metadata = metadata - 'opensTicket'
    WHERE metadata->'opensTicket' IS NOT NULL
  `);
};

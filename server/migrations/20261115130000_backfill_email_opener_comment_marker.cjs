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
 * comments and tickets are distributed and co-located by tenant, so every join includes
 * `tenant` and the per-ticket pick is a ROW_NUMBER() partitioned by (tenant, ticket_id) in a
 * derived table (Citus rejects correlated LIMIT subqueries). now() is not used.
 *
 * Comments this misses simply render in full, as they do today.
 */

const MARK = `COALESCE(c.metadata, '{}'::jsonb) || '{"opensTicket": true}'::jsonb`;

/**
 * One candidate per ticket, picked in a derived table with ROW_NUMBER() partitioned by
 * (tenant, ticket_id) so the work stays shard-local. Citus cannot push down a correlated
 * subquery with LIMIT, so there is deliberately no `col = (SELECT ... LIMIT 1)` here.
 * Tickets that already have a marked comment are removed by an anti-join on (tenant, ticket_id).
 * `extra` filters the candidate set (primary) and `outer` filters the chosen row (fallback).
 */
function markSql({ extra = '', outer = '' }) {
  return `
    UPDATE comments AS c
    SET metadata = ${MARK}
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
          AND t.ticket_origin = 'inbound_email'
          AND c2.parent_comment_id IS NULL
          AND c2.deleted_at IS NULL
          AND (c2.metadata->>'responseSource' = 'inbound_email' OR c2.metadata->'email' IS NOT NULL)
          ${extra}
      ) AS ranked
      WHERE ranked.rn = 1
        ${outer}
    ) AS pick
    WHERE c.tenant = pick.tenant
      AND c.comment_id = pick.comment_id
  `;
}

exports.up = async function up(knex) {
  // 1. Primary rule: Message-ID match. Earliest match wins if several share the id.
  await knex.raw(markSql({
    extra: `AND COALESCE(t.email_metadata->>'messageId', '') <> ''
          AND c2.metadata->'email'->>'messageId' = t.email_metadata->>'messageId'`,
  }));

  // 2. Fallback: tickets still without a marked comment get their earliest inbound-email root
  //    comment, if it landed within 120s of the ticket.
  await knex.raw(markSql({
    outer: `AND ranked.created_at >= ranked.entered_at - interval '120 seconds'
        AND ranked.created_at <= ranked.entered_at + interval '120 seconds'`,
  }));
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

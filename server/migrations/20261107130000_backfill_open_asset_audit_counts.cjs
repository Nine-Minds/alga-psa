'use strict';

/**
 * Bring the result counts of audits that were never completed in step with
 * their items.
 *
 * `asset_audits.present_count / missing_count / unexpected_count` were only
 * ever written when a run was completed, so every run that is still open — and
 * every run that was cancelled, which is terminal — reads as all-zero in the
 * audit lists while its detail page counts the item rows and shows the marks
 * the technician actually made. The service now keeps the columns in step on
 * every write; this repairs the rows written before it did.
 *
 * Completed runs are left alone: their counts were written by `complete`, which
 * is also the only thing that decides what is missing. Nothing here is missing
 * — an open run has not concluded anything and a cancelled one never will.
 *
 * Batched: each page of at most BATCH audits is read keyset-paged on
 * (tenant, audit_id) and repaired with one single-tenant, single-row update, so
 * every write is router-executable on Citus and no statement grows with the
 * tenant's audit history.
 */

const BATCH = 500;

const COUNTED = `
  SELECT a.tenant,
         a.audit_id,
         a.present_count,
         a.missing_count,
         a.unexpected_count,
         COUNT(*) FILTER (WHERE i.result = 'present') AS present_now,
         COUNT(*) FILTER (WHERE i.result = 'missing') AS missing_now,
         COUNT(*) FILTER (WHERE i.result = 'unexpected') AS unexpected_now
  FROM asset_audits a
  JOIN asset_audit_items i ON i.tenant = a.tenant AND i.audit_id = a.audit_id
  WHERE a.status <> 'completed'
`;

const GROUPED = `
  GROUP BY a.tenant, a.audit_id, a.present_count, a.missing_count, a.unexpected_count
  ORDER BY a.tenant, a.audit_id
`;

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('asset_audits'))) return;
  if (!(await knex.schema.hasTable('asset_audit_items'))) return;

  let after = null;
  for (;;) {
    const page = after === null
      ? await knex.raw(`${COUNTED} ${GROUPED} LIMIT ${BATCH}`)
      : await knex.raw(`${COUNTED} AND (a.tenant, a.audit_id) > (?, ?) ${GROUPED} LIMIT ${BATCH}`, after);
    const rows = page.rows ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const stale =
        Number(row.present_count ?? 0) !== Number(row.present_now)
        || Number(row.missing_count ?? 0) !== Number(row.missing_now)
        || Number(row.unexpected_count ?? 0) !== Number(row.unexpected_now);
      if (!stale) continue;
      await knex.raw(
        `UPDATE asset_audits
         SET present_count = ?, missing_count = ?, unexpected_count = ?
         WHERE tenant = ? AND audit_id = ?`,
        [
          Number(row.present_now),
          Number(row.missing_now),
          Number(row.unexpected_now),
          row.tenant,
          row.audit_id,
        ]
      );
    }

    const last = rows[rows.length - 1];
    after = [last.tenant, last.audit_id];
  }
};

exports.down = async function down() {
  // The repaired counts are data, not schema: there is nothing to undo, and
  // putting the zeros back would only restore the disagreement.
};

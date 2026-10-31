/**
 * One time sheet per (tenant, user, period), in every approval status.
 *
 * Existing duplicates are cleaned up conservatively before the unique index is built:
 *
 *  - A member is DISCARDABLE only when it is DRAFT, has no submission/approval metadata and
 *    nothing references it: no time_entries, time_sheet_comments or time_entry_change_requests
 *    rows. time_entry_change_requests has no FK to time_sheets, so it is checked explicitly.
 *  - A group keeps its sole non-discardable sheet. If every member is discardable, the lowest id
 *    is kept (UUID order says nothing about creation order; it is only a deterministic tie-break).
 *  - A group with two or more non-discardable sheets is ambiguous. The PREFLIGHT fails with
 *    diagnostics BEFORE any write. Nothing is merged, moved or deleted for such data; an operator
 *    reconciles it and re-runs the migration.
 *
 * Runs untransacted (see 20260904120000_enforce_availability_scope_uniqueness.cjs): time_sheets is
 * distributed on `tenant` in Citus, which refuses DDL on a distributed table already modified in
 * the same transaction. Cleanup DML therefore completes (autocommit) before the index DDL. Every
 * step is idempotent, so a partial run is safe to retry. Sheet writers should be quiesced for the
 * window; a duplicate that slips in makes CREATE UNIQUE INDEX fail visibly, never silently succeed.
 */

const INDEX_NAME = 'time_sheets_tenant_user_period_unique';
const KEY_COLUMNS = ['tenant', 'user_id', 'period_id'];
const DELETE_BATCH_SIZE = 500;

const DISCARDABLE_SQL = (referenceTables) => `
  s.approval_status = 'DRAFT'
  AND s.submitted_at IS NULL
  AND s.approved_at IS NULL
  AND s.approved_by IS NULL
  AND NOT EXISTS (SELECT 1 FROM time_entries r WHERE r.tenant = s.tenant AND r.time_sheet_id = s.id)
  AND NOT EXISTS (SELECT 1 FROM time_sheet_comments r WHERE r.tenant = s.tenant AND r.time_sheet_id = s.id)
  ${referenceTables.includes('time_entry_change_requests')
    ? 'AND NOT EXISTS (SELECT 1 FROM time_entry_change_requests r WHERE r.tenant = s.tenant AND r.time_sheet_id = s.id)'
    : ''}
`;

async function referenceTablesPresent(knex) {
  const present = [];
  for (const table of ['time_entries', 'time_sheet_comments', 'time_entry_change_requests']) {
    if (await knex.schema.hasTable(table)) present.push(table);
  }
  return present;
}

async function loadDuplicateMembers(knex, referenceTables) {
  const { rows } = await knex.raw(`
    SELECT s.tenant, s.user_id, s.period_id, s.id, s.approval_status,
           (${DISCARDABLE_SQL(referenceTables)}) AS discardable
    FROM time_sheets s
    JOIN (
      SELECT tenant, user_id, period_id
      FROM time_sheets
      GROUP BY tenant, user_id, period_id
      HAVING count(*) > 1
    ) d ON d.tenant = s.tenant AND d.user_id = s.user_id AND d.period_id = s.period_id
    ORDER BY s.tenant, s.user_id, s.period_id, s.id
  `);
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.tenant}|${row.user_id}|${row.period_id}`;
    if (!groups.has(key)) groups.set(key, { tenant: row.tenant, userId: row.user_id, periodId: row.period_id, members: [] });
    groups.get(key).members.push({ id: row.id, status: row.approval_status, discardable: row.discardable });
  }
  return [...groups.values()];
}

function planCleanup(groups) {
  const ambiguous = [];
  const deletions = [];
  for (const group of groups) {
    const keepers = group.members.filter((m) => !m.discardable);
    if (keepers.length >= 2) {
      ambiguous.push(group);
      continue;
    }
    // Members are ordered by id, so members[0] is the lowest id.
    const keep = keepers.length === 1 ? keepers[0] : group.members[0];
    for (const member of group.members) {
      if (member.id !== keep.id) deletions.push({ tenant: group.tenant, id: member.id });
    }
  }
  return { ambiguous, deletions };
}

function ambiguityMessage(ambiguous) {
  const lines = ambiguous.map((g) =>
    `  tenant=${g.tenant} user_id=${g.userId} period_id=${g.periodId}: ` +
    g.members.map((m) => `${m.id} [${m.status}${m.discardable ? ', discardable' : ', has history'}]`).join(', '));
  return (
    `Cannot enforce ${INDEX_NAME}: ${ambiguous.length} (tenant, user_id, period_id) group(s) hold two or more ` +
    `time sheets with history (entries, comments, change requests, or non-DRAFT / submitted / approved state). ` +
    `No data was changed. Reconcile each group manually (move or remove entries/comments and retire the surplus ` +
    `sheets), then re-run the migration:\n${lines.join('\n')}`
  );
}

async function readIndex(knex) {
  const { rows } = await knex.raw(`
    SELECT i.indisunique, i.indisvalid, i.indisready, i.indpred IS NOT NULL AS partial, i.indexprs IS NOT NULL AS expression,
           array(SELECT a.attname::text FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum ORDER BY k.ord) AS columns
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ? AND n.nspname = current_schema()
  `, [INDEX_NAME]);
  return rows[0] || null;
}

function isCorrectDefinition(index) {
  return Boolean(index)
    && index.indisunique && !index.partial && !index.expression
    && index.columns.length === KEY_COLUMNS.length
    && KEY_COLUMNS.every((column, i) => index.columns[i] === column);
}

// batchSize is overridable only so tests can exercise multi-batch cleanup with small data.
exports.up = async function up(knex, { batchSize = DELETE_BATCH_SIZE } = {}) {
  const referenceTables = await referenceTablesPresent(knex);

  // Preflight (read-only): classify everything and refuse before any write.
  const { ambiguous, deletions } = planCleanup(await loadDuplicateMembers(knex, referenceTables));
  if (ambiguous.length > 0) {
    throw new Error(ambiguityMessage(ambiguous));
  }

  // Cleanup: planned ids are deleted per tenant in bounded batches (loop + LIMIT), each batch one
  // autocommit statement. Every DELETE stays tenant-scoped and re-checks discardability at delete
  // time, so a sheet that gained history since the preflight is left alone (and then fails index
  // creation loudly instead of losing data). Re-running after a partial run just re-plans.
  const idsByTenant = new Map();
  for (const { tenant, id } of deletions) {
    if (!idsByTenant.has(tenant)) idsByTenant.set(tenant, []);
    idsByTenant.get(tenant).push(id);
  }
  for (const [tenant, ids] of idsByTenant) {
    for (let start = 0; start < ids.length; start += batchSize) {
      const batch = ids.slice(start, start + batchSize);
      await knex.raw(
        `DELETE FROM time_sheets s
         WHERE s.tenant = ?
           AND s.id IN (SELECT t.id FROM time_sheets t WHERE t.tenant = ? AND t.id = ANY(?::uuid[]) LIMIT ?)
           AND ${DISCARDABLE_SQL(referenceTables)}`,
        [tenant, tenant, batch, batchSize],
      );
    }
  }

  // Index: inspect an existing one by definition, not by name.
  let existing = await readIndex(knex);
  if (existing && !existing.indisvalid) {
    // A failed CREATE INDEX CONCURRENTLY leaves an INVALID index, which IF NOT EXISTS would skip
    // silently; drop it and rebuild.
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
    existing = null;
  }
  if (existing && !isCorrectDefinition(existing)) {
    throw new Error(
      `Index ${INDEX_NAME} already exists with a different definition ` +
      `(unique=${existing.indisunique}, partial=${existing.partial}, columns=${existing.columns.join(',')}). ` +
      `Drop or rename it and re-run the migration.`,
    );
  }
  if (!existing) {
    await knex.raw(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME} ON time_sheets (tenant, user_id, period_id)`);
  }

  const created = await readIndex(knex);
  if (!created || !created.indisvalid || !isCorrectDefinition(created)) {
    throw new Error(`Index ${INDEX_NAME} was not created correctly; time sheet uniqueness is NOT enforced.`);
  }
};

exports.down = async function down(knex) {
  // Removed pristine drafts are not resurrected; only the index goes.
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
};

exports.config = { transaction: false };

'use strict';

/**
 * alga0002072: collapse `recurring_service_periods.obligation_type` into
 * `cadence_owner`.
 *
 * A recurring obligation is identified by (tenant, obligation_id =
 * contract_line_id, charge_family); `cadence_owner` is the only cadence
 * discriminator. This migration
 *
 *   1. rewrites every stored schedule key
 *        schedule:{tenant}:{obligationType}:{obligationId}:{cadenceOwner}:{duePosition}
 *      -> schedule:{tenant}:{obligationId}:{cadenceOwner}:{duePosition}
 *      (keys are computed from the COLUMNS, never parsed from the old key),
 *   2. deterministically merges lineages that collide once the label segment
 *      is gone (e.g. a client-cadence period persisted under both
 *      `contract_line` and `client_contract_line`),
 *   3. rewrites `source_run_key` values that embed an old schedule key,
 *   4. drops the `obligation_type` column and its CHECK.
 *
 * Citus notes
 *  - exports.config.transaction = false: DDL on distributed tables must not
 *    run inside a wrapping transaction. Each tenant is rewritten in its own
 *    short transaction using router-only DML (tenant predicate on every
 *    statement, no functions/casts on column references, values computed in
 *    Node and bound as parameters, `updated_at` bound rather than now()).
 *  - If the table is distributed and the coordinator parent heap still holds
 *    stranded pre-distribution rows, ADD CONSTRAINT UNIQUE would trip over
 *    them. We truncate them with truncate_local_data_after_distributing_table
 *    ONLY after proving the table is distributed, the parent heap is
 *    non-empty and the whole recursive FK closure is distributed (the
 *    cascading TRUNCATE would otherwise wipe a local table's only copy; see
 *    the UNSAFE PATTERN notes in 20260718234058 / 20260818040000).
 *
 * down() restores the column, the four-value CHECK and the legacy 6-segment
 * keys. Merges are NOT reversed: superseded losers stay superseded with their
 * renumbered revisions. Rolling back means reverting the code at the same time.
 *
 * Deploy window: ship code and migration together. Old pods still running
 * during the rollout fail loudly (`column "obligation_type" does not exist`)
 * on recurring writes and label-filtered reads instead of silently writing
 * old-format keys next to rewritten ones. Materialization and invoice
 * generation are idempotent per (schedule_key, period_key), so retries are safe.
 */

const { tenantDb } = require('./utils/tenantDb.cjs');
const { canCreateDistributedTable, isDistributed } = require('./utils/citusDistribution.cjs');

exports.config = { transaction: false };

const TABLE = 'recurring_service_periods';
const UNIQUE_CONSTRAINT = `${TABLE}_tenant_schedule_period_revision_uidx`;
const LABEL_CHECK = `${TABLE}_obligation_type_check`;
const LABEL_COLUMN = 'obligation_type';
const COLLAPSE_REASON_CODE = 'obligation_label_collapse';
const BATCH_SIZE = 500;
const NON_LIVE_STATES = ['superseded', 'archived'];
const LIVE_STATE_RANK = { locked: 4, edited: 3, generated: 2, skipped: 1 };
const CANONICAL_LABEL = { client: 'client_contract_line', contract: 'contract_line' };
const LEGACY_KEY_REGEX = '^schedule:[^:]+:[^:]+:[^:]+:(client|contract):(advance|arrears)$';
const SYSTEM_TENANT = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function computeCanonicalScheduleKey({ tenant, obligationId, cadenceOwner, duePosition }) {
  return `schedule:${tenant}:${obligationId}:${cadenceOwner}:${duePosition}`;
}

function computeLegacyScheduleKey({ tenant, obligationId, cadenceOwner, duePosition }) {
  const label = CANONICAL_LABEL[cadenceOwner];
  return `schedule:${tenant}:${label}:${obligationId}:${cadenceOwner}:${duePosition}`;
}

function isLive(state) {
  return !NON_LIVE_STATES.includes(state);
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Row shape (camelCase): recordId, scheduleKey (old), revision, obligationType,
 * lifecycleState, invoiceId, supersedesRecordId, reasonCode, createdAt, updatedAt.
 */
function describeLineage(scheduleKey, rows, cadenceOwner) {
  const live = rows.filter((row) => isLive(row.lifecycleState));
  return {
    scheduleKey,
    rows,
    hasLinked: rows.some((row) => row.invoiceId != null),
    hasBilled: rows.some((row) => row.lifecycleState === 'billed'),
    liveRank: live.reduce((max, row) => Math.max(max, LIVE_STATE_RANK[row.lifecycleState] ?? 0), 0),
    canonicalLabel: rows.some((row) => row.obligationType === CANONICAL_LABEL[cadenceOwner]),
    latestUpdatedAt: rows.reduce((max, row) => Math.max(max, toMillis(row.updatedAt)), 0),
    minRecordId: rows.map((row) => row.recordId).sort(compareStrings)[0],
  };
}

/**
 * Winner lineage ordering (plan section 4):
 *  1 contains an invoice-linked row
 *  2 contains a billed row
 *  3 live row state rank: locked > edited > generated > skipped
 *  4 label is canonical for the cadence
 *  5 latest updated_at
 *  6 smallest record_id
 */
function compareLineages(a, b) {
  return (
    Number(b.hasLinked) - Number(a.hasLinked)
    || Number(b.hasBilled) - Number(a.hasBilled)
    || b.liveRank - a.liveRank
    || Number(b.canonicalLabel) - Number(a.canonicalLabel)
    || b.latestUpdatedAt - a.latestUpdatedAt
    || compareStrings(a.minRecordId, b.minRecordId)
  );
}

/**
 * Plan the merge of one (newKey, period_key) group that contains more than one
 * old schedule_key. Pure: returns the final per-row values, never touches a DB.
 *
 * @returns {{
 *   winnerScheduleKey: string,
 *   rows: Array<{recordId: string, revision: number, lifecycleState: string, reasonCode: string|null, supersedesRecordId: string|null}>,
 *   retainedLoserRecordIds: string[],
 *   linkedRecordIds: string[],
 * }}
 */
function planCollisionGroup(rows, cadenceOwner) {
  const byLineage = new Map();
  for (const row of rows) {
    const bucket = byLineage.get(row.scheduleKey) ?? [];
    bucket.push(row);
    byLineage.set(row.scheduleKey, bucket);
  }
  const lineages = [...byLineage.entries()].map(([key, lineageRows]) => describeLineage(key, lineageRows, cadenceOwner));
  lineages.sort(compareLineages);
  const winner = lineages[0];

  // The winner's live row: prefer a linked one, then the highest old revision.
  const winnerLive = winner.rows
    .filter((row) => isLive(row.lifecycleState))
    .sort((a, b) => (
      Number(b.invoiceId != null) - Number(a.invoiceId != null)
      || b.revision - a.revision
      || compareStrings(a.recordId, b.recordId)
    ))[0];

  const ordered = [...rows].sort((a, b) => (
    Number(a.recordId === winnerLive?.recordId) - Number(b.recordId === winnerLive?.recordId)
    || a.revision - b.revision
    || toMillis(a.createdAt) - toMillis(b.createdAt)
    || compareStrings(a.recordId, b.recordId)
  ));

  const winnerKey = winner.scheduleKey;
  const planned = ordered.map((row, index) => {
    const isLoser = row.scheduleKey !== winnerKey;
    const linked = row.invoiceId != null;
    const supersede = isLoser && isLive(row.lifecycleState) && !linked && row.lifecycleState !== 'billed';
    return {
      recordId: row.recordId,
      revision: index + 1,
      lifecycleState: supersede ? 'superseded' : row.lifecycleState,
      reasonCode: supersede ? COLLAPSE_REASON_CODE : (row.reasonCode ?? null),
      supersedesRecordId: row.supersedesRecordId ?? null,
      _isLoser: isLoser,
      _retained: isLoser && isLive(row.lifecycleState) && (linked || row.lifecycleState === 'billed'),
    };
  });

  if (winnerLive && winnerLive.supersedesRecordId == null) {
    const newestSupersededLoser = [...planned]
      .filter((row) => row._isLoser && row.lifecycleState === 'superseded')
      .sort((a, b) => b.revision - a.revision)[0];
    if (newestSupersededLoser) {
      const target = planned.find((row) => row.recordId === winnerLive.recordId);
      target.supersedesRecordId = newestSupersededLoser.recordId;
    }
  }

  return {
    winnerScheduleKey: winnerKey,
    rows: planned.map(({ _isLoser, _retained, ...row }) => row),
    retainedLoserRecordIds: planned.filter((row) => row._retained).map((row) => row.recordId),
    linkedRecordIds: rows.filter((row) => row.invoiceId != null).map((row) => row.recordId),
  };
}

// ---------------------------------------------------------------------------
// Introspection helpers
// ---------------------------------------------------------------------------

async function hasConstraint(knex, name) {
  const result = await knex.raw(
    'SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass) AS present',
    [name, TABLE],
  );
  return Boolean(result.rows?.[0]?.present);
}

function unscopedTable(knex, reason) {
  return tenantDb(knex, SYSTEM_TENANT).unscoped(TABLE, reason);
}

/**
 * Citus parent-heap cleanup. Truncate only when ALL hold: Citus installed,
 * table distributed, parent heap non-empty, recursive FK closure fully
 * distributed. Aborts loudly if the closure contains a non-distributed table.
 */
async function cleanCitusParentHeap(knex, log = console.log) {
  if (!(await canCreateDistributedTable(knex))) {
    log('[collapse-obligation-type] Citus not installed; parent-heap cleanup skipped');
    return { truncated: false, reason: 'no-citus' };
  }
  if (!(await isDistributed(knex, TABLE))) {
    log('[collapse-obligation-type] table is not distributed; parent-heap cleanup skipped');
    return { truncated: false, reason: 'not-distributed' };
  }
  const size = await knex.raw('SELECT pg_relation_size(?::regclass) AS bytes', [TABLE]);
  if (Number(size.rows?.[0]?.bytes ?? 0) <= 0) {
    log('[collapse-obligation-type] parent heap is empty; truncate skipped');
    return { truncated: false, reason: 'heap-empty' };
  }

  const closure = await knex.raw(`
    WITH RECURSIVE closure(oid) AS (
      SELECT ?::regclass::oid
      UNION
      SELECT CASE WHEN c.conrelid = k.oid THEN c.confrelid ELSE c.conrelid END
      FROM closure k
      JOIN pg_constraint c ON c.contype = 'f' AND (c.conrelid = k.oid OR c.confrelid = k.oid)
    )
    SELECT closure.oid::regclass::text AS name,
           EXISTS (SELECT 1 FROM pg_dist_partition p WHERE p.logicalrelid = closure.oid) AS distributed
    FROM closure
  `, [TABLE]);
  const undistributed = closure.rows.filter((row) => !row.distributed).map((row) => row.name);
  if (undistributed.length > 0) {
    throw new Error(
      `[collapse-obligation-type] refusing truncate_local_data_after_distributing_table: FK closure of ${TABLE} `
      + `contains non-distributed tables (${undistributed.join(', ')}); the cascading TRUNCATE would destroy their only copy`,
    );
  }

  log(`[collapse-obligation-type] truncating stranded coordinator rows of ${TABLE} (FK closure: ${closure.rows.map((r) => r.name).join(', ')})`);
  await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [TABLE]);
  return { truncated: true, reason: 'truncated' };
}

// ---------------------------------------------------------------------------
// Audit (read-only)
// ---------------------------------------------------------------------------

/**
 * Read-only audit; safe against prod. Returns a JSON-serialisable report.
 * Queries that need the label column are skipped when it no longer exists.
 */
async function auditObligationLabelCollapse(knex) {
  if (!(await knex.schema.hasTable(TABLE))) {
    return { tableExists: false };
  }
  const hasLabel = await knex.schema.hasColumn(TABLE, LABEL_COLUMN);
  const report = { tableExists: true, hasLabelColumn: hasLabel };
  const liveSql = `lifecycle_state NOT IN ('superseded', 'archived')`;

  if (hasLabel) {
    report.labelCadenceStateCounts = (await knex.raw(`
      SELECT obligation_type, cadence_owner, lifecycle_state, count(*)::int AS rows
      FROM ${TABLE}
      GROUP BY obligation_type, cadence_owner, lifecycle_state
      ORDER BY obligation_type, cadence_owner, lifecycle_state
    `)).rows;

    const mismatch = await knex.raw(`
      SELECT tenant,
             count(*)::int AS rows,
             count(*) FILTER (WHERE split_part(schedule_key, ':', 3) <> obligation_type)::int AS label_segment_mismatch
      FROM ${TABLE}
      WHERE schedule_key <> 'schedule:' || tenant || ':' || obligation_type || ':' || obligation_id
                           || ':' || cadence_owner || ':' || due_position
      GROUP BY tenant
      ORDER BY tenant
    `);
    report.keyColumnMismatches = {
      totalRows: mismatch.rows.reduce((sum, row) => sum + row.rows, 0),
      byTenant: mismatch.rows,
    };

    const collisions = await knex.raw(`
      SELECT tenant, obligation_id, cadence_owner, due_position, period_key,
             count(*)::int AS rows,
             count(DISTINCT schedule_key)::int AS distinct_old_keys,
             count(*) FILTER (WHERE ${liveSql})::int AS live_rows,
             count(*) FILTER (WHERE invoice_id IS NOT NULL)::int AS linked_rows
      FROM ${TABLE}
      GROUP BY tenant, obligation_id, cadence_owner, due_position, period_key
      HAVING count(DISTINCT schedule_key) > 1
      ORDER BY tenant, obligation_id, period_key
    `);
    report.collisionGroups = {
      count: collisions.rows.length,
      doubleBilledCount: collisions.rows.filter((row) => row.linked_rows > 1).length,
      groups: collisions.rows.slice(0, 200).map((row) => ({ ...row, double_billed: row.linked_rows > 1 })),
      truncated: collisions.rows.length > 200,
    };
  } else {
    report.labelCadenceStateCounts = 'skipped (obligation_type column already dropped)';
  }

  const uniqueCollisions = await knex.raw(`
    SELECT tenant, obligation_id, cadence_owner, due_position, period_key, revision, count(*)::int AS rows
    FROM ${TABLE}
    GROUP BY tenant, obligation_id, cadence_owner, due_position, period_key, revision
    HAVING count(*) > 1
    ORDER BY tenant, obligation_id, period_key, revision
  `);
  report.uniqueKeyCollisionsAfterRewrite = {
    count: uniqueCollisions.rows.length,
    groups: uniqueCollisions.rows.slice(0, 200),
  };

  const overlaps = await knex.raw(`
    SELECT a.tenant, a.obligation_id, a.cadence_owner, a.due_position,
           a.record_id AS record_a, b.record_id AS record_b,
           a.period_key AS period_key_a, b.period_key AS period_key_b
    FROM ${TABLE} a
    JOIN ${TABLE} b
      ON b.tenant = a.tenant
     AND b.obligation_id = a.obligation_id
     AND b.cadence_owner = a.cadence_owner
     AND b.due_position = a.due_position
     AND b.schedule_key <> a.schedule_key
     AND a.record_id < b.record_id
    WHERE a.lifecycle_state NOT IN ('superseded', 'archived')
      AND b.lifecycle_state NOT IN ('superseded', 'archived')
      AND a.period_key <> b.period_key
      AND a.service_period_start < b.service_period_end
      AND b.service_period_start < a.service_period_end
    ORDER BY a.tenant, a.obligation_id
  `);
  report.overlappingLivePeriodsAcrossLineages = {
    count: overlaps.rows.length,
    pairs: overlaps.rows.slice(0, 200),
  };

  const multiFamily = await knex.raw(`
    SELECT tenant, obligation_id, cadence_owner, due_position,
           array_agg(DISTINCT charge_family ORDER BY charge_family) AS charge_families
    FROM ${TABLE}
    GROUP BY tenant, obligation_id, cadence_owner, due_position
    HAVING count(DISTINCT charge_family) > 1
    ORDER BY tenant, obligation_id
  `);
  report.multiChargeFamilyObligations = {
    count: multiFamily.rows.length,
    obligations: multiFamily.rows.slice(0, 200),
  };

  report.escalate = Boolean(
    (report.collisionGroups && report.collisionGroups.doubleBilledCount > 0)
    || report.overlappingLivePeriodsAcrossLineages.count > 0
    || report.multiChargeFamilyObligations.count > 0,
  );
  return report;
}

// ---------------------------------------------------------------------------
// Per-tenant rewrite
// ---------------------------------------------------------------------------

function normalizeRow(raw) {
  return {
    recordId: raw.record_id,
    scheduleKey: raw.schedule_key,
    periodKey: raw.period_key,
    revision: Number(raw.revision),
    obligationId: raw.obligation_id,
    obligationType: raw.obligation_type ?? null,
    cadenceOwner: raw.cadence_owner,
    duePosition: raw.due_position,
    lifecycleState: raw.lifecycle_state,
    invoiceId: raw.invoice_id ?? null,
    supersedesRecordId: raw.supersedes_record_id ?? null,
    reasonCode: raw.reason_code ?? null,
    sourceRunKey: raw.source_run_key ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

async function loadTenantRows(trx, tenant, hasLabel) {
  const columns = [
    'record_id', 'schedule_key', 'period_key', 'revision', 'obligation_id', 'cadence_owner', 'due_position',
    'lifecycle_state', 'invoice_id', 'invoice_charge_detail_id', 'supersedes_record_id', 'reason_code',
    'source_run_key', 'created_at', 'updated_at',
  ];
  if (hasLabel) columns.push(LABEL_COLUMN);
  const rows = await tenantDb(trx, tenant).table(TABLE).select(columns);
  return rows.map(normalizeRow);
}

async function applyUpdates(trx, tenant, updates) {
  for (let offset = 0; offset < updates.length; offset += BATCH_SIZE) {
    const batch = updates.slice(offset, offset + BATCH_SIZE);
    const placeholders = batch.map(() => '(?::uuid, ?::text, ?::int, ?::text, ?::text, ?::uuid, ?::text, ?::timestamptz)').join(', ');
    const bindings = [];
    for (const u of batch) {
      bindings.push(
        u.recordId, u.scheduleKey, u.revision, u.lifecycleState, u.reasonCode,
        u.supersedesRecordId, u.sourceRunKey, u.updatedAt,
      );
    }
    bindings.push(tenant);
    await trx.raw(`
      UPDATE ${TABLE} AS r
      SET schedule_key = v.schedule_key,
          revision = v.revision,
          lifecycle_state = v.lifecycle_state,
          reason_code = v.reason_code,
          supersedes_record_id = v.supersedes_record_id,
          source_run_key = v.source_run_key,
          updated_at = v.updated_at
      FROM (VALUES ${placeholders}) AS v(record_id, schedule_key, revision, lifecycle_state, reason_code, supersedes_record_id, source_run_key, updated_at)
      WHERE r.tenant = ? AND r.record_id = v.record_id
    `, bindings);
  }
}

function rewriteSourceRunKey(sourceRunKey, oldKey, newKey) {
  if (!sourceRunKey || oldKey === newKey || !sourceRunKey.includes(oldKey)) return sourceRunKey;
  return sourceRunKey.split(oldKey).join(newKey);
}

/**
 * Rewrite and merge one tenant's rows in a single transaction.
 * Idempotent: on a converged tenant no row changes.
 */
async function collapseTenant(knex, tenant, options = {}) {
  const log = options.log ?? ((entry) => console.warn(`[collapse-obligation-type] ${JSON.stringify(entry)}`));
  const hasLabel = await knex.schema.hasColumn(TABLE, LABEL_COLUMN);
  const summary = { tenant, rows: 0, rewritten: 0, collisionGroups: 0, superseded: 0, doubleBilledCollisions: [] };

  await knex.transaction(async (trx) => {
    const rows = await loadTenantRows(trx, tenant, hasLabel);
    summary.rows = rows.length;

    const groups = new Map();
    for (const row of rows) {
      row.newKey = computeCanonicalScheduleKey({
        tenant,
        obligationId: row.obligationId,
        cadenceOwner: row.cadenceOwner,
        duePosition: row.duePosition,
      });
      const groupId = `${row.newKey}\u0000${row.periodKey}`;
      const bucket = groups.get(groupId) ?? [];
      bucket.push(row);
      groups.set(groupId, bucket);
    }

    const now = options.now ?? new Date();
    const updates = [];
    for (const groupRows of groups.values()) {
      const distinctOldKeys = new Set(groupRows.map((row) => row.scheduleKey));
      const newKey = groupRows[0].newKey;
      let finals;
      if (distinctOldKeys.size > 1) {
        summary.collisionGroups += 1;
        const plan = planCollisionGroup(groupRows, groupRows[0].cadenceOwner);
        finals = new Map(plan.rows.map((row) => [row.recordId, row]));
        summary.superseded += plan.rows.filter((row) => row.reasonCode === COLLAPSE_REASON_CODE
          && groupRows.find((r) => r.recordId === row.recordId)?.lifecycleState !== 'superseded').length;
        if (plan.retainedLoserRecordIds.length > 0) {
          const entry = {
            kind: 'double-billed-collision',
            tenant,
            scheduleKey: newKey,
            periodKey: groupRows[0].periodKey,
            winnerOldScheduleKey: plan.winnerScheduleKey,
            linkedRecordIds: plan.linkedRecordIds,
            retainedLoserRecordIds: plan.retainedLoserRecordIds,
          };
          summary.doubleBilledCollisions.push(entry);
          log(entry);
        }
      } else {
        finals = new Map();
      }

      for (const row of groupRows) {
        const planned = finals.get(row.recordId);
        const next = {
          recordId: row.recordId,
          scheduleKey: newKey,
          revision: planned ? planned.revision : row.revision,
          lifecycleState: planned ? planned.lifecycleState : row.lifecycleState,
          reasonCode: planned ? planned.reasonCode : row.reasonCode,
          supersedesRecordId: planned ? planned.supersedesRecordId : row.supersedesRecordId,
          sourceRunKey: rewriteSourceRunKey(row.sourceRunKey, row.scheduleKey, newKey),
          updatedAt: now,
        };
        const changed = next.scheduleKey !== row.scheduleKey
          || next.revision !== row.revision
          || next.lifecycleState !== row.lifecycleState
          || next.reasonCode !== row.reasonCode
          || next.supersedesRecordId !== row.supersedesRecordId
          || next.sourceRunKey !== row.sourceRunKey;
        if (changed) updates.push(next);
      }
    }

    summary.rewritten = updates.length;
    await applyUpdates(trx, tenant, updates);
  });

  return summary;
}

async function listTenants(knex) {
  const rows = await unscopedTable(knex, 'enumerate tenants that own recurring service periods')
    .distinct('tenant')
    .orderBy('tenant');
  return rows.map((row) => row.tenant);
}

async function verifyCollapsed(knex) {
  const duplicates = await unscopedTable(knex, 'post-collapse duplicate check (read-only)')
    .select('tenant', 'schedule_key', 'period_key', 'revision')
    .count('* as rows')
    .groupBy('tenant', 'schedule_key', 'period_key', 'revision')
    .havingRaw('count(*) > 1');
  const legacy = await unscopedTable(knex, 'post-collapse legacy key check (read-only)')
    .select('tenant')
    .count('* as rows')
    .whereRaw('schedule_key ~ ?', [LEGACY_KEY_REGEX])
    .groupBy('tenant');
  if (duplicates.length > 0 || legacy.length > 0) {
    throw new Error(
      '[collapse-obligation-type] verification failed: '
      + JSON.stringify({ duplicateRevisionKeys: duplicates.slice(0, 20), tenantsWithLegacyKeys: legacy.slice(0, 20) }),
    );
  }
}

// ---------------------------------------------------------------------------
// up / down
// ---------------------------------------------------------------------------

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;
  const hasLabel = await knex.schema.hasColumn(TABLE, LABEL_COLUMN);

  const report = await auditObligationLabelCollapse(knex);
  console.log(`[collapse-obligation-type] precheck audit: ${JSON.stringify(report)}`);

  await cleanCitusParentHeap(knex);

  // Dropped before renumbering so revision swaps cannot hit transient violations.
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${UNIQUE_CONSTRAINT}`);

  try {
    for (const tenant of await listTenants(knex)) {
      const summary = await collapseTenant(knex, tenant);
      if (summary.rewritten > 0) {
        console.log(`[collapse-obligation-type] tenant ${tenant}: rewrote ${summary.rewritten}/${summary.rows} rows, ${summary.collisionGroups} collision groups, ${summary.superseded} superseded`);
      }
    }
    await verifyCollapsed(knex);
  } catch (error) {
    // Best effort: leave the table with its uniqueness guarantee where legal.
    // If duplicates exist this fails again and the original error wins.
    await knex.raw(`
      ALTER TABLE ${TABLE} ADD CONSTRAINT ${UNIQUE_CONSTRAINT} UNIQUE (tenant, schedule_key, period_key, revision)
    `).catch(() => undefined);
    throw error;
  }

  if (!(await hasConstraint(knex, UNIQUE_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${TABLE} ADD CONSTRAINT ${UNIQUE_CONSTRAINT} UNIQUE (tenant, schedule_key, period_key, revision)
    `);
  }

  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${LABEL_CHECK}`);
  if (hasLabel || (await knex.schema.hasColumn(TABLE, LABEL_COLUMN))) {
    await knex.raw(`ALTER TABLE ${TABLE} DROP COLUMN IF EXISTS ${LABEL_COLUMN}`);
  }
};

/**
 * Restore the column, the four-value CHECK and the legacy 6-segment keys.
 * Merges are not reversed (see file header).
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable(TABLE))) return;

  await cleanCitusParentHeap(knex);

  if (!(await knex.schema.hasColumn(TABLE, LABEL_COLUMN))) {
    await knex.raw(`ALTER TABLE ${TABLE} ADD COLUMN ${LABEL_COLUMN} varchar(40)`);
  }
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${UNIQUE_CONSTRAINT}`);

  for (const tenant of await listTenants(knex)) {
    await knex.transaction(async (trx) => {
      const rows = await loadTenantRows(trx, tenant, true);
      const now = new Date();
      const updates = [];
      for (const row of rows) {
        const legacyKey = computeLegacyScheduleKey({
          tenant,
          obligationId: row.obligationId,
          cadenceOwner: row.cadenceOwner,
          duePosition: row.duePosition,
        });
        updates.push({
          recordId: row.recordId,
          obligationType: CANONICAL_LABEL[row.cadenceOwner],
          scheduleKey: legacyKey,
          sourceRunKey: rewriteSourceRunKey(row.sourceRunKey, row.scheduleKey, legacyKey),
          updatedAt: now,
        });
      }
      for (let offset = 0; offset < updates.length; offset += BATCH_SIZE) {
        const batch = updates.slice(offset, offset + BATCH_SIZE);
        const placeholders = batch.map(() => '(?::uuid, ?::text, ?::text, ?::text, ?::timestamptz)').join(', ');
        const bindings = [];
        for (const u of batch) {
          bindings.push(u.recordId, u.obligationType, u.scheduleKey, u.sourceRunKey, u.updatedAt);
        }
        bindings.push(tenant);
        await trx.raw(`
          UPDATE ${TABLE} AS r
          SET obligation_type = v.obligation_type,
              schedule_key = v.schedule_key,
              source_run_key = v.source_run_key,
              updated_at = v.updated_at
          FROM (VALUES ${placeholders}) AS v(record_id, obligation_type, schedule_key, source_run_key, updated_at)
          WHERE r.tenant = ? AND r.record_id = v.record_id
        `, bindings);
      }
    });
  }

  await knex.raw(`ALTER TABLE ${TABLE} ALTER COLUMN ${LABEL_COLUMN} SET NOT NULL`);
  await knex.raw(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ${LABEL_CHECK}`);
  await knex.raw(`
    ALTER TABLE ${TABLE}
    ADD CONSTRAINT ${LABEL_CHECK}
    CHECK (obligation_type IN ('contract_line', 'client_contract_line', 'template_line', 'preset_line'))
  `);
  if (!(await hasConstraint(knex, UNIQUE_CONSTRAINT))) {
    await knex.raw(`
      ALTER TABLE ${TABLE} ADD CONSTRAINT ${UNIQUE_CONSTRAINT} UNIQUE (tenant, schedule_key, period_key, revision)
    `);
  }
};

exports.auditObligationLabelCollapse = auditObligationLabelCollapse;
exports.collapseTenant = collapseTenant;
exports.computeCanonicalScheduleKey = computeCanonicalScheduleKey;
exports.computeLegacyScheduleKey = computeLegacyScheduleKey;
exports.planCollisionGroup = planCollisionGroup;
exports.cleanCitusParentHeap = cleanCitusParentHeap;

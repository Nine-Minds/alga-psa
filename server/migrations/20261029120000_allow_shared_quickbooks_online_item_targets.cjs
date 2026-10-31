/**
 * Migration: let several QuickBooks Online services share one item target
 * (alga-2026-0002899).
 *
 * QBO services, products and the automatic discount all export as an ItemRef,
 * so any number of them may route through one QBO item (the way Xero accounts
 * and QuickBooks Desktop services already can). QBO clients, invoices,
 * payments, payment terms, service categories and tax codes stay one-to-one.
 *
 * idx_unique_external_mapping gains a fourth predicate:
 *   (integration_type <> 'quickbooks_online'
 *    OR alga_entity_type NOT IN ('service', 'discount'))
 * and carries the Xero (20261013120000), Desktop (20261017150000) and
 * tombstone (20261027130000) predicates forward verbatim. The runtime twin of
 * this list is isSharedMappingTarget in @alga-psa/types; DB tests assert they
 * agree. idx_unique_alga_mapping is deliberately untouched (upserts infer it).
 *
 * Concurrent, non-transactional, guard-first replacement. A valid unique index
 * on the target must exist at every moment, because customer/invoice/payment
 * targets stay protected while writes continue:
 *   1. build idx_unique_external_mapping_qbo_guard (destination definition)
 *      CONCURRENTLY and verify it is valid;
 *   2. drop the canonical index CONCURRENTLY;
 *   3. rebuild the canonical index CONCURRENTLY and verify it is valid;
 *   4. drop the guard CONCURRENTLY.
 * `IF NOT EXISTS` proves nothing about an interrupted concurrent build (it
 * leaves an INVALID index of that name), so every retry inspects validity, key
 * and predicate of both names via the catalog before trusting or dropping
 * either. A valid index is never dropped unless another valid index with the
 * destination definition already stands guard; an invalid one protects nothing
 * and may always be dropped. An unexpected definition fails loudly.
 *
 * `up` only loosens the invariant: no dedupe, deletes or remapping.
 * `down` restores the three-predicate index, but first counts duplicate groups
 * under the OLD predicates only (shared live QBO targets are exactly what it
 * must find) and refuses, touching nothing, if any exist. No winner is picked.
 *
 * Citus: DDL runs through the coordinator, tenant stays in every key, no
 * triggers or colocation changes. A distributed table whose coordinator-local
 * shell still holds rows is cleaned with truncate_local_data_after_distributing_table
 * before unique indexes are built (never truncating the distributed relation).
 */

const CANONICAL = 'idx_unique_external_mapping';
const GUARD = 'idx_unique_external_mapping_qbo_guard';

const EXPECTED_KEY_PREFIX = ['tenant', 'integration_type', 'alga_entity_type', 'external_entity_id'];

/** @param {string} s */
const squash = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Classify an index by catalog facts. 'new' = destination of `up`
 * (4 predicates), 'old' = destination of `down` (3 predicates).
 * @param {{ valid: boolean, unique: boolean, predicate: string | null, keys: string[] } | null} info
 */
function classify(info) {
  if (!info) return 'absent';
  const keys = (info.keys || []).map(squash);
  const keyOk =
    info.unique &&
    keys.length === 5 &&
    EXPECTED_KEY_PREFIX.every((k, i) => keys[i] === k) &&
    keys[4].startsWith('coalesce(external_realm_id');
  if (!keyOk || !info.predicate) return 'unexpected';
  const p = squash(info.predicate);
  const base = p.includes("'xero'") && p.includes("'quickbooks_desktop'") && p.includes('deleted_at is null');
  if (!base) return 'unexpected';
  return p.includes("'quickbooks_online'") ? 'new' : 'old';
}

/** @param {import('knex').Knex} knex @param {string} name */
async function inspectIndex(knex, name) {
  const res = await knex.raw(
    `SELECT i.indisvalid AS valid,
            i.indisunique AS "unique",
            pg_get_expr(i.indpred, i.indrelid) AS predicate,
            ARRAY(SELECT pg_get_indexdef(i.indexrelid, k, true)
                  FROM generate_series(1, i.indnkeyatts) k ORDER BY k) AS keys
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = ?
        AND i.indrelid = 'public.tenant_external_entity_mappings'::regclass`,
    [name]
  );
  const row = res.rows[0];
  return row ? { valid: row.valid, unique: row.unique, predicate: row.predicate, keys: row.keys } : null;
}

/** Index state for both names: { kind, valid } where kind is absent/new/old/unexpected. */
async function inspectBoth(knex) {
  const canonical = await inspectIndex(knex, CANONICAL);
  const guard = await inspectIndex(knex, GUARD);
  return {
    canonical: { kind: classify(canonical), valid: !!canonical?.valid },
    guard: { kind: classify(guard), valid: !!guard?.valid },
  };
}

/**
 * Distributed tables keep a coordinator-local shell. Stale local rows there
 * make a unique build fail, so move them out. Never truncates the distributed
 * relation itself.
 */
async function cleanCitusLocalData(knex) {
  const citus = await knex.raw(
    "SELECT to_regclass('pg_catalog.pg_dist_partition') IS NOT NULL AS has_citus"
  );
  if (!citus.rows[0].has_citus) return;
  const distributed = await knex.raw(
    "SELECT 1 FROM pg_dist_partition WHERE logicalrelid = 'public.tenant_external_entity_mappings'::regclass"
  );
  if (distributed.rows.length === 0) return;
  const local = await knex.raw('SELECT 1 FROM ONLY public.tenant_external_entity_mappings LIMIT 1');
  if (local.rows.length > 0) {
    await knex.raw(
      "SELECT truncate_local_data_after_distributing_table('public.tenant_external_entity_mappings')"
    );
  }
}

// Each statement is one standalone raw call with literal names (migration-lint R1).
const create = {
  newGuard: (knex) =>
    knex.raw(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique_external_mapping_qbo_guard
      ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
      WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
        AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
        AND deleted_at IS NULL
        AND (integration_type <> 'quickbooks_online' OR alga_entity_type NOT IN ('service', 'discount'))
    `),
  newCanonical: (knex) =>
    knex.raw(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique_external_mapping
      ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
      WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
        AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
        AND deleted_at IS NULL
        AND (integration_type <> 'quickbooks_online' OR alga_entity_type NOT IN ('service', 'discount'))
    `),
  oldGuard: (knex) =>
    knex.raw(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique_external_mapping_qbo_guard
      ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
      WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
        AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
        AND deleted_at IS NULL
    `),
  oldCanonical: (knex) =>
    knex.raw(`
      CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_unique_external_mapping
      ON tenant_external_entity_mappings (tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, ''))
      WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
        AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
        AND deleted_at IS NULL
    `),
};

const dropCanonical = (knex) => knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_unique_external_mapping');
const dropGuard = (knex) => knex.raw('DROP INDEX CONCURRENTLY IF EXISTS idx_unique_external_mapping_qbo_guard');

/**
 * Guard-first replacement of the canonical index with the `target` definition.
 * @param {import('knex').Knex} knex
 * @param {'new' | 'old'} target
 */
async function replaceCanonical(knex, target) {
  const other = target === 'new' ? 'old' : 'new';
  const buildGuard = target === 'new' ? create.newGuard : create.oldGuard;
  const buildCanonical = target === 'new' ? create.newCanonical : create.oldCanonical;
  const label = target === 'new' ? 'shared-QBO-item' : 'pre-shared-QBO-item';

  let s = await inspectBoth(knex);

  // A valid canonical index that is neither definition is not ours to replace.
  if (s.canonical.kind === 'unexpected' && s.canonical.valid) {
    throw new Error(
      `${CANONICAL} is valid but has an unexpected definition; refusing to replace it. ` +
        'Inspect it with pg_get_indexdef and reconcile manually.'
    );
  }

  // Already at destination: only a leftover guard remains to clean up.
  if (s.canonical.kind === target && s.canonical.valid) {
    if (s.guard.kind !== 'absent') await dropGuard(knex);
    return;
  }

  await cleanCitusLocalData(knex);

  // Step 1: a valid guard at the destination definition, built while the
  // current canonical index (or any prior valid guard) keeps protecting.
  if (s.guard.kind !== 'absent' && !(s.guard.valid && s.guard.kind === target)) {
    // An invalid guard protects nothing and may always go. A VALID guard with
    // another definition is dropped only while a valid canonical stands guard.
    if (s.guard.valid && !(s.canonical.valid && s.canonical.kind === other)) {
      throw new Error(
        `${GUARD} exists with an unexpected definition; refusing to drop the last valid protective index.`
      );
    }
    await dropGuard(knex);
  }
  try {
    await buildGuard(knex);
  } catch (error) {
    // A failed concurrent build leaves an invalid index behind. It protects
    // nothing, so drop it; the canonical index is untouched and still valid.
    await dropGuard(knex);
    throw new Error(
      `Could not build the ${label} guard index (${error && error.message}). ` +
        `The existing ${CANONICAL} was left in place. Fix conflicting rows and retry.`
    );
  }
  s = await inspectBoth(knex);
  if (!(s.guard.valid && s.guard.kind === target)) {
    throw new Error(`${GUARD} is not valid after build; leaving ${CANONICAL} in place. Re-run the migration.`);
  }

  // Step 2: the guard now protects the destination invariant, so the old
  // canonical (valid or invalid) can go.
  if (s.canonical.kind !== 'absent') await dropCanonical(knex);

  // Step 3: rebuild the canonical index and verify it.
  await buildCanonical(knex);
  s = await inspectBoth(knex);
  if (!(s.canonical.valid && s.canonical.kind === target)) {
    throw new Error(`${CANONICAL} is not valid after rebuild; ${GUARD} still protects targets. Re-run the migration.`);
  }

  // Step 4: only now is the guard redundant.
  await dropGuard(knex);
}

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await replaceCanonical(knex, 'new');
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // Old predicates ONLY: live shared QBO service/discount targets are what
  // must block the rollback. Tombstones and already-shareable Xero/Desktop
  // targets are outside the old index and do not.
  const dupes = await knex.raw(`
    SELECT COUNT(*)::int AS groups FROM (
      SELECT 1
      FROM tenant_external_entity_mappings
      WHERE (integration_type <> 'xero' OR COALESCE(metadata ->> 'xeroTargetKind', 'item') <> 'account')
        AND (integration_type <> 'quickbooks_desktop' OR alga_entity_type NOT IN ('service', 'discount', 'tax_code'))
        AND deleted_at IS NULL
      GROUP BY tenant, integration_type, alga_entity_type, external_entity_id, COALESCE(external_realm_id, '')
      HAVING COUNT(*) > 1
    ) d
  `);
  const groups = dupes.rows[0].groups;
  if (groups > 0) {
    throw new Error(
      `Cannot restore the one-to-one idx_unique_external_mapping: ${groups} duplicate target ` +
        'group(s) exist (several QuickBooks Online services or discounts mapped to one item). ' +
        'Remap them to distinct QBO items, then re-run the rollback. No mappings were changed ' +
        'and no indexes were touched.'
    );
  }
  await replaceCanonical(knex, 'old');
};

exports.config = { transaction: false };

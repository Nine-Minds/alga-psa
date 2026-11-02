/**
 * Widen credential_associations to the entity-wide roster (scope expansion):
 *
 *  - `entity_type` CHECK expands from `('asset')` to the full document-style
 *    roster: asset, client, contact, contract, document, project_task, quote,
 *    team, tenant, ticket, user.
 *  - `credential_id` becomes nullable and a new nullable `credential_ref`
 *    carries the external Hudu id (`hudu:{company_id}:{password_id}`). A CHECK
 *    requires EXACTLY ONE of the two to be set, so every association points at
 *    exactly one credential row regardless of source.
 *  - Uniqueness becomes per-ref-kind partial unique indexes:
 *    (tenant, credential_id, entity_id, entity_type) where credential_id is
 *    set, and (tenant, credential_ref, entity_id, entity_type) where
 *    credential_ref is set.
 *
 * No RLS is (re)introduced on these tables (see
 * 20260812100000_disable_rls_on_credential_tables.cjs); tenant isolation is
 * enforced at the query layer via the tenantDb facade. No Citus change: the
 * table stays distributed by `tenant`.
 *
 * Mirrors the document_associations CHECK-widening pattern
 * (20251020000001_add_document_folders_preview_and_contract_association.cjs).
 *
 * DOWN STRATEGY — atomic preflight + fail-closed DDL (this migration never runs
 * in a transaction). `exports.config.transaction = false` below is required for
 * Citus DDL compatibility, and it applies to `down` as well as `up`: knex
 * invokes both directions outside any transaction.
 *
 * `down` opens its OWN explicit transaction for the preflight: it takes
 * `LOCK TABLE credential_associations IN ACCESS EXCLUSIVE MODE` and re-counts
 * (`credential_ref IS NOT NULL` OR `entity_type <> 'asset'`) rows UNDER the
 * lock, so the check is atomic with respect to concurrent writers. Dirty rows
 * => the transaction rolls back (releasing the lock) and `down` throws naming
 * the counts and the operator remedy, before ANY DDL.
 *
 * The DDL itself cannot run inside that transaction (Citus), so once the
 * preflight passes the lock is released and the destructive steps run
 * fail-closed: they are ordered so that a row a concurrent writer manages to
 * slip in after the preflight can never be dropped silently — the write is
 * either seen by the re-count under the lock (down refuses) or rejected by a
 * guard DDL step:
 *
 *   1. SET NOT NULL credential_id  — fails if ANY row still has credential_id
 *      NULL (every Hudu-ref row has NULL), and after it succeeds the column is
 *      NOT NULL so no future row can carry a ref-only value at all;
 *   2. narrow entity_type CHECK to ('asset') — fails if any non-asset row
 *      exists (the widening is gone, nothing is deleted);
 *   3. re-add the full (tenant, credential_id, entity_id, entity_type) UNIQUE —
 *      fails on any duplicate pair;
 *   4. only THEN drop oneof_ref_check + credential_ref in ONE atomic ALTER
 *      statement. At that point every row provably has credential_id NOT NULL
 *      and entity_type 'asset' (guards 1-2), so dropping the ref column loses
 *      nothing; a concurrent insert either predates the re-count (down
 *      refused) or blocks on the DDL's ACCESS EXCLUSIVE lock and then fails
 *      against the narrowed schema. The drop never silently discards unseen
 *      rows — it is a no-op over the data the preflight already certified.
 */

// Citus rejects ALTER TABLE ... on distributed tables inside a transaction.
exports.config = { transaction: false };

const ENTITY_TYPES = [
  'asset',
  'client',
  'contact',
  'contract',
  'document',
  'project_task',
  'quote',
  'team',
  'tenant',
  'ticket',
  'user',
];

exports.up = async function up(knex) {
  const tableExists = await knex.schema.hasTable('credential_associations');
  if (!tableExists) {
    throw new Error('credential_associations does not exist; run the credentials tables migration first');
  }

  // 1. Widen the entity_type roster.
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_entity_type_check;');
  await knex.raw(
    `ALTER TABLE credential_associations
      ADD CONSTRAINT credential_associations_entity_type_check
      CHECK (entity_type IN (${ENTITY_TYPES.map((t) => `'${t}'`).join(', ')}));`
  );

  // 2. credential_id nullable + external ref column.
  await knex.raw('ALTER TABLE credential_associations ALTER COLUMN credential_id DROP NOT NULL;');
  const hasRefColumn = await knex.schema.hasColumn('credential_associations', 'credential_ref');
  if (!hasRefColumn) {
    await knex.raw('ALTER TABLE credential_associations ADD COLUMN credential_ref text;');
  }

  // 3. Exactly-one-of CHECK + ref shape guard.
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_oneof_ref_check;');
  await knex.raw(`
    ALTER TABLE credential_associations
      ADD CONSTRAINT credential_associations_oneof_ref_check
      CHECK ((credential_id IS NOT NULL) <> (credential_ref IS NOT NULL));
  `);
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_ref_shape_check;');
  await knex.raw(`
    ALTER TABLE credential_associations
      ADD CONSTRAINT credential_associations_ref_shape_check
      CHECK (credential_ref IS NULL OR credential_ref ~ '^hudu:[^:]+:[^:]+$');
  `);

  // 4. Per-ref-kind partial unique indexes replace the single full unique.
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_credential_entity_unique;');
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS credential_associations_credential_entity_unique
      ON credential_associations (tenant, credential_id, entity_id, entity_type)
      WHERE credential_id IS NOT NULL;
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS credential_associations_ref_entity_unique
      ON credential_associations (tenant, credential_ref, entity_id, entity_type)
      WHERE credential_ref IS NOT NULL;
  `);
};

exports.down = async function down(knex) {
  // ATOMIC PREFLIGHT — own explicit transaction: take an ACCESS EXCLUSIVE lock
  // (raw SQL, held for the duration of the check) so the count is serialized
  // against concurrent writers, then re-verify the counts UNDER the lock.
  // Dirty rows => rollback (releases the lock) + throw, before ANY DDL; no
  // schema or data change happens at all.
  await knex.transaction(async (trx) => {
    await trx.raw('LOCK TABLE credential_associations IN ACCESS EXCLUSIVE MODE');

    const refCountResult = await trx.raw(`
      SELECT count(*) AS ref_count
      FROM credential_associations
      WHERE credential_ref IS NOT NULL;
    `);
    const nonAssetCountResult = await trx.raw(`
      SELECT count(*) AS non_asset_count
      FROM credential_associations
      WHERE entity_type <> 'asset';
    `);
    const refRows = Number(refCountResult.rows?.[0]?.ref_count ?? 0);
    const nonAssetRows = Number(nonAssetCountResult.rows?.[0]?.non_asset_count ?? 0);
    if (refRows > 0 || nonAssetRows > 0) {
      throw new Error(
        `Refusing to roll back 20260812110000_expand_credential_associations_entity_types: ` +
          `credential_associations holds ${refRows} row(s) with credential_ref set and ` +
          `${nonAssetRows} row(s) with entity_type <> 'asset', which the pre-expansion ` +
          `schema (credential_id NOT NULL, entity_type IN ('asset')) cannot represent. ` +
          `Resolve or delete those rows first (e.g. detach the affected Hudu refs and ` +
          `non-asset attachments), then re-run the rollback. No schema or data was changed.`
      );
    }
  });

  // FAIL-CLOSED DDL — outside any transaction (Citus). Guards are ordered so a
  // row slipped in after the preflight lock was released can never be dropped
  // silently: each guard step fails loudly on unrepresentable data, and the
  // credential_ref column is dropped only LAST, in one atomic ALTER with the
  // oneof check, when guards 1-2 have certified the data is representable.
  await knex.raw('DROP INDEX IF EXISTS credential_associations_ref_entity_unique;');
  await knex.raw('DROP INDEX IF EXISTS credential_associations_credential_entity_unique;');

  // Guard 1: ref-only rows carry credential_id NULL; SET NOT NULL refuses them,
  // and afterwards no concurrent insert can create a ref-only row at all.
  await knex.raw('ALTER TABLE credential_associations ALTER COLUMN credential_id SET NOT NULL;');

  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_ref_shape_check;');

  // Guard 2: narrow the roster; a non-asset row makes this ADD fail (never
  // deleted, never silently tolerated).
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_entity_type_check;');
  await knex.raw(`
    ALTER TABLE credential_associations
      ADD CONSTRAINT credential_associations_entity_type_check
      CHECK (entity_type IN ('asset'));
  `);

  // Guard 3: duplicate (tenant, credential_id, entity_id, entity_type) pairs
  // are unrepresentable under the restored full UNIQUE; re-adding it refuses.
  await knex.raw(`
    ALTER TABLE credential_associations
      ADD CONSTRAINT credential_associations_credential_entity_unique
      UNIQUE (tenant, credential_id, entity_id, entity_type);
  `);

  // Only now drop the ref plumbing — one atomic ALTER, so there is no window
  // where the oneof guard is gone but the column still exists. By this point
  // every row has credential_id NOT NULL and entity_type 'asset' (guards 1-2),
  // so credential_ref is NULL on all of them: the drop loses nothing.
  await knex.raw(`
    ALTER TABLE credential_associations
      DROP CONSTRAINT IF EXISTS credential_associations_oneof_ref_check,
      DROP COLUMN IF EXISTS credential_ref;
  `);
};

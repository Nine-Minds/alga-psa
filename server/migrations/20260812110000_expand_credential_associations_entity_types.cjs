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
  await knex.raw('DROP INDEX IF EXISTS credential_associations_ref_entity_unique;');
  await knex.raw('DROP INDEX IF EXISTS credential_associations_credential_entity_unique;');
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_ref_shape_check;');
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_oneof_ref_check;');
  await knex.raw('ALTER TABLE credential_associations DROP COLUMN IF EXISTS credential_ref;');
  await knex.raw('ALTER TABLE credential_associations ALTER COLUMN credential_id SET NOT NULL;');
  await knex.raw('ALTER TABLE credential_associations DROP CONSTRAINT IF EXISTS credential_associations_entity_type_check;');
  await knex.raw(`
    ALTER TABLE credential_associations
      ADD CONSTRAINT credential_associations_entity_type_check
      CHECK (entity_type IN ('asset'));
  `);
  await knex.raw(`
    ALTER TABLE credential_associations
      ADD CONSTRAINT credential_associations_credential_entity_unique
      UNIQUE (tenant, credential_id, entity_id, entity_type);
  `);
};

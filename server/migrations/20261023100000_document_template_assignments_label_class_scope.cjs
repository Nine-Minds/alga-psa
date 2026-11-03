/**
 * Per-label-class tenant defaults for the `work-tag` document type (alga-2026-0002683 C2).
 *
 * One generic `work-tag` type serves ticket, asset and stock-unit labels, but the assignments table
 * allowed ONE tenant default per document type. A third scope, `label_class`, keyed by `scope_key`
 * (the label class), lets each class have its own default without touching the existing scopes:
 *
 *   tenant      scope_id NULL      scope_key NULL      (unchanged)
 *   client      scope_id NOT NULL  scope_key NULL      (unchanged)
 *   label_class scope_id NULL      scope_key NOT NULL  (new)
 *
 * Citus: the table is tenant-distributed. This only adds a nullable column, replaces CHECK
 * constraints and replaces a partial unique index that still leads with `tenant` (the distribution
 * column). No cross-shard statement, no data rewrite; existing rows already satisfy the new checks.
 */
const TABLE_NAME = 'document_template_assignments';
const SCOPE_TYPE_CHECK = 'document_template_assignments_scope_type_check';
const SCOPE_ID_CHECK = 'document_template_assignments_scope_id_check';
const TENANT_SCOPE_INDEX = 'document_template_assignments_unique_tenant_scope';

exports.config = { transaction: true };

exports.up = async function up(knex) {
  // LEVERAGE: friction document-template-scope — scopes beyond tenant/client are bolted on via scope_key
  await knex.raw(`ALTER TABLE ${TABLE_NAME} ADD COLUMN IF NOT EXISTS scope_key varchar(64)`);

  await knex.raw(`ALTER TABLE ${TABLE_NAME} DROP CONSTRAINT IF EXISTS ${SCOPE_TYPE_CHECK}`);
  // migration-lint: allow 2 - retroactive: CHECK re-created after DROP IF EXISTS on document_template_assignments, a small settings table; merged before the lint existed
  await knex.raw(`
    ALTER TABLE ${TABLE_NAME} ADD CONSTRAINT ${SCOPE_TYPE_CHECK}
    CHECK (scope_type IN ('tenant','client','label_class'))
  `);

  await knex.raw(`ALTER TABLE ${TABLE_NAME} DROP CONSTRAINT IF EXISTS ${SCOPE_ID_CHECK}`);
  // migration-lint: allow 2 - retroactive: CHECK re-created after DROP IF EXISTS on document_template_assignments, a small settings table; merged before the lint existed
  await knex.raw(`
    ALTER TABLE ${TABLE_NAME} ADD CONSTRAINT ${SCOPE_ID_CHECK}
    CHECK (
      (scope_type = 'tenant' AND scope_id IS NULL AND scope_key IS NULL)
      OR (scope_type = 'client' AND scope_id IS NOT NULL AND scope_key IS NULL)
      OR (scope_type = 'label_class' AND scope_id IS NULL AND scope_key IS NOT NULL)
    )
  `);

  // One default per (tenant, document_type, scope_type[, scope_key]) among rows without a scope_id.
  await knex.raw(`DROP INDEX IF EXISTS ${TENANT_SCOPE_INDEX}`);
  // migration-lint: allow 1 - retroactive: unique index re-created inside the transaction on document_template_assignments, a small settings table; merged before the lint existed
  await knex.raw(`
    CREATE UNIQUE INDEX ${TENANT_SCOPE_INDEX}
    ON ${TABLE_NAME} (tenant, document_type, scope_type, (COALESCE(scope_key, '')))
    WHERE scope_id IS NULL
  `);
};

exports.down = async function down(knex) {
  // label_class rows cannot be represented by the old shape; they are the only data this drops.
  await knex.raw(`DELETE FROM ${TABLE_NAME} WHERE scope_type = 'label_class'`);

  await knex.raw(`DROP INDEX IF EXISTS ${TENANT_SCOPE_INDEX}`);
  await knex.raw(`
    CREATE UNIQUE INDEX ${TENANT_SCOPE_INDEX}
    ON ${TABLE_NAME} (tenant, document_type, scope_type)
    WHERE scope_id IS NULL
  `);

  await knex.raw(`ALTER TABLE ${TABLE_NAME} DROP CONSTRAINT IF EXISTS ${SCOPE_ID_CHECK}`);
  await knex.raw(`
    ALTER TABLE ${TABLE_NAME} ADD CONSTRAINT ${SCOPE_ID_CHECK}
    CHECK (
      (scope_type = 'tenant' AND scope_id IS NULL)
      OR
      (scope_type <> 'tenant' AND scope_id IS NOT NULL)
    )
  `);

  await knex.raw(`ALTER TABLE ${TABLE_NAME} DROP CONSTRAINT IF EXISTS ${SCOPE_TYPE_CHECK}`);
  await knex.raw(`
    ALTER TABLE ${TABLE_NAME} ADD CONSTRAINT ${SCOPE_TYPE_CHECK}
    CHECK (scope_type IN ('tenant','client'))
  `);

  await knex.raw(`ALTER TABLE ${TABLE_NAME} DROP COLUMN IF EXISTS scope_key`);
};

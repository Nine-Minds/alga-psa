/**
 * Co-managed IT L2: per-relationship field redaction list. Stored on the
 * relationship row (a co-managed table; no hot table is touched). Idempotent.
 */
exports.up = async function up(knex) {
  if (
    (await knex.schema.hasTable('co_management_relationships')) &&
    !(await knex.schema.hasColumn('co_management_relationships', 'redacted_fields'))
  ) {
    await knex.raw(
      `ALTER TABLE co_management_relationships ADD COLUMN IF NOT EXISTS redacted_fields text[] NOT NULL DEFAULT '{}'`
    );
  }
};

exports.down = async function down(knex) {
  if (
    (await knex.schema.hasTable('co_management_relationships')) &&
    (await knex.schema.hasColumn('co_management_relationships', 'redacted_fields'))
  ) {
    const row = await knex('co_management_relationships').whereRaw('cardinality(redacted_fields) > 0').first();
    if (row) throw new Error('Cannot discard configured co-management field redaction');
    await knex.raw('ALTER TABLE co_management_relationships DROP COLUMN IF EXISTS redacted_fields');
  }
};

exports.config = { transaction: false };

/**
 * Add payload schema contract mode/provenance fields to workflow_definitions.
 *
 * - payload_schema_mode: 'inferred' | 'pinned' (default pinned for existing rows)
 * - pinned_payload_schema_ref: stores the last user-pinned ref (used when toggling modes)
 * - payload_schema_provenance: optional freeform string for future diagnostics
 */

exports.up = async function up(knex) {
  const hasMode = await knex.schema.hasColumn('workflow_definitions', 'payload_schema_mode');
  if (!hasMode) {
    await knex.schema.alterTable('workflow_definitions', (table) => {
      table.text('payload_schema_mode').notNullable().defaultTo('pinned');
      table.text('pinned_payload_schema_ref').nullable();
      table.text('payload_schema_provenance').nullable();
    });
  }

  // Backfill pinned ref for existing rows (safe / idempotent).
  try {
    await knex('workflow_definitions')
      .whereNull('pinned_payload_schema_ref')
      .update({
        pinned_payload_schema_ref: knex.ref('payload_schema_ref')
      });
  } catch {
    // best-effort backfill
  }
};

exports.down = async function down(knex) {
  const hasMode = await knex.schema.hasColumn('workflow_definitions', 'payload_schema_mode');
  if (!hasMode) return;
  await knex.schema.alterTable('workflow_definitions', (table) => {
    table.dropColumn('payload_schema_mode');
    table.dropColumn('pinned_payload_schema_ref');
    table.dropColumn('payload_schema_provenance');
  });
};


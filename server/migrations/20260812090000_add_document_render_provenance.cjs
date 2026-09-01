/**
 * Records how a generated document was rendered: which template produced it and
 * which locale was resolved at render time. Nullable across the board — only
 * documents filed by the PDF generation pipeline carry provenance, and existing
 * rows are deliberately left alone (forward-only).
 *
 * source_template_id is text rather than uuid: standard templates are addressed
 * by code (e.g. 'standard-invoice-by-location'), tenant templates by uuid, and
 * both must be recordable.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('documents'))) return;

  const columns = ['source_template_id', 'source_template_version', 'rendered_locale'];
  const existing = await Promise.all(columns.map((c) => knex.schema.hasColumn('documents', c)));
  if (existing.every(Boolean)) return;

  await knex.schema.alterTable('documents', (table) => {
    if (!existing[0]) table.text('source_template_id').nullable();
    if (!existing[1]) table.integer('source_template_version').nullable();
    if (!existing[2]) table.text('rendered_locale').nullable();
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('documents'))) return;

  const columns = ['source_template_id', 'source_template_version', 'rendered_locale'];
  const existing = await Promise.all(columns.map((c) => knex.schema.hasColumn('documents', c)));
  if (!existing.some(Boolean)) return;

  await knex.schema.alterTable('documents', (table) => {
    columns.forEach((column, index) => {
      if (existing[index]) table.dropColumn(column);
    });
  });
};

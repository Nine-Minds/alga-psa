/**
 * Invoice bundle component presentation (plan 2026-10-14-invoice-bundle-component-presentation).
 *
 * - contract_lines.invoice_line_subtitle: optional muted second line under a Fixed bundle title.
 * - contract_template_lines.invoice_line_description / invoice_line_subtitle: bundle text
 *   authored on templates and copied onto client lines on clone.
 * - invoice_charges.bundle_presentation: versioned JSONB snapshot (names, raw quantities,
 *   pricing basis, order, previous-period quantities). Never holds amounts.
 *
 * All additions are nullable columns on existing (Citus-distributed) tables.
 */
async function addColumn(knex, table, column, add) {
  if (!(await knex.schema.hasTable(table))) return;
  if (await knex.schema.hasColumn(table, column)) return;
  await knex.schema.alterTable(table, add);
}

async function dropColumn(knex, table, column) {
  if (!(await knex.schema.hasTable(table))) return;
  if (!(await knex.schema.hasColumn(table, column))) return;
  await knex.schema.alterTable(table, (t) => t.dropColumn(column));
}

exports.up = async function up(knex) {
  await addColumn(knex, 'contract_lines', 'invoice_line_subtitle', (t) => t.text('invoice_line_subtitle').nullable());
  await addColumn(knex, 'contract_template_lines', 'invoice_line_description', (t) => t.text('invoice_line_description').nullable());
  await addColumn(knex, 'contract_template_lines', 'invoice_line_subtitle', (t) => t.text('invoice_line_subtitle').nullable());
  await addColumn(knex, 'invoice_charges', 'bundle_presentation', (t) => t.jsonb('bundle_presentation').nullable());
};

exports.down = async function down(knex) {
  await dropColumn(knex, 'invoice_charges', 'bundle_presentation');
  await dropColumn(knex, 'contract_template_lines', 'invoice_line_subtitle');
  await dropColumn(knex, 'contract_template_lines', 'invoice_line_description');
  await dropColumn(knex, 'contract_lines', 'invoice_line_subtitle');
};

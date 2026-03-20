/**
 * Ensure canonical print settings exist on shipped standard invoice template ASTs.
 *
 * This migration is idempotent and only targets records in standard_invoice_templates.
 */

const STANDARD_TABLE = 'standard_invoice_templates';
const STANDARD_CODES = ['standard-default', 'standard-detailed'];
const STANDARD_NAMES = ['standard template', 'detailed template'];
const PRINT_SETTINGS = JSON.stringify({
  paperPreset: 'Letter',
  marginMm: 10.58,
});

exports.up = async function up(knex) {
  const hasTable = await knex.schema.hasTable(STANDARD_TABLE);
  if (!hasTable) {
    return;
  }

  const hasTemplateAst = await knex.schema.hasColumn(STANDARD_TABLE, 'templateAst');
  if (!hasTemplateAst) {
    return;
  }

  await knex(STANDARD_TABLE)
    .where(function whereStandardTemplates() {
      this.whereIn('standard_invoice_template_code', STANDARD_CODES).orWhereRaw('lower(name) in (?, ?)', STANDARD_NAMES);
    })
    .update({
      templateAst: knex.raw(
        `jsonb_set(
          COALESCE("templateAst", '{}'::jsonb),
          '{metadata,printSettings}',
          ?::jsonb,
          true
        )`,
        [PRINT_SETTINGS]
      ),
      updated_at: knex.fn.now(),
    });
};

exports.down = async function down() {
  // No-op: this mutates canonical template content and should not be auto-reverted.
};


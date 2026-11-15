/**
 * Standard invoice templates: per-line Service Period column + invoice currency code.
 *
 * Rendering reads `standard_invoice_templates.templateAst`, so the code change in
 * packages/billing/.../standardTemplates.ts has no effect until the rows are refreshed.
 *
 * - standard_invoice_templates: every row gets the structural additions (idempotent).
 * - invoice_templates (tenant-owned): a custom template is refreshed ONLY when its
 *   templateAst is identical (key-order independent, since jsonb reorders keys) to the
 *   frozen previous AST of a standard template, i.e. it was never edited. Edited
 *   templates are left exactly as the tenant authored them; they can opt in by adding
 *   the "Service Period" column (field `servicePeriodLabel`) and the `currencyCode`
 *   binding in the designer, where both are now available.
 *
 * Untouched templates keep rendering either way: an unknown path or binding resolves to
 * an empty cell/field, it does not fail the render.
 */
const {
  applyServicePeriodAndCurrency,
  matchPreviousStandardCode,
  canonicalJson,
} = require('./utils/invoiceTemplateServicePeriodCurrency.cjs');

const STANDARD_TABLE = 'standard_invoice_templates';
const CUSTOM_TABLE = 'invoice_templates';
const REASON = 'refresh untouched clones of the standard invoice templates (service period + currency)';
const MIGRATION_TENANT = 'migration:20261020000000_invoice_templates_service_period_and_currency';

const parseAst = (value) => (typeof value === 'string' ? JSON.parse(value) : value);

exports.up = async function up(knex) {
  if (await knex.schema.hasTable(STANDARD_TABLE)) {
    const rows = await knex(STANDARD_TABLE).select('template_id', 'templateAst');
    for (const row of rows) {
      const ast = parseAst(row.templateAst);
      if (!ast) continue;
      const next = applyServicePeriodAndCurrency(ast);
      if (canonicalJson(next) === canonicalJson(ast)) continue;
      // migration-lint: allow 5 - retroactive: rewrites only changed rows of standard_invoice_templates, a small system table keyed by template_id; merged before the lint existed
      await knex(STANDARD_TABLE)
        .where({ template_id: row.template_id })
        .update({ templateAst: knex.raw('?::jsonb', [JSON.stringify(next)]), updated_at: knex.fn.now() });
    }
  }

  if (await knex.schema.hasTable(CUSTOM_TABLE)) {
    const { tenantDb } = require('./utils/tenantDb.cjs');
    const migrationDb = tenantDb(knex, MIGRATION_TENANT);
    const rows = await migrationDb
      .unscoped(CUSTOM_TABLE, REASON)
      .select('tenant', 'template_id', 'templateAst')
      .whereNotNull('templateAst');
    let refreshed = 0;
    for (const row of rows) {
      const ast = parseAst(row.templateAst);
      if (!matchPreviousStandardCode(ast)) continue;
      const next = applyServicePeriodAndCurrency(ast);
      await tenantDb(knex, row.tenant)
        .table(CUSTOM_TABLE)
        .where('template_id', row.template_id)
        .update({ templateAst: knex.raw('?::jsonb', [JSON.stringify(next)]), updated_at: knex.fn.now() });
      refreshed += 1;
    }
    console.log(`[${MIGRATION_TENANT}] refreshed ${refreshed} untouched custom invoice template(s); ${rows.length - refreshed} left as authored`);
  }
};

// Removing a column tenants may already rely on is not a safe rollback.
exports.down = async function down() {};

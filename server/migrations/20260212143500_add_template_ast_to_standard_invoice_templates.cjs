/**
 * No-op.
 *
 * This migration originally introduced standard_invoice_templates.templateAst.
 * The final cutover migrations now ensure this column exists when needed:
 * - 20260217133000_upsert_standard_invoice_template_asts.cjs
 */

exports.up = async function up() {
  // Intentionally no-op.
};

exports.down = async function down() {
  // Intentionally no-op.
};

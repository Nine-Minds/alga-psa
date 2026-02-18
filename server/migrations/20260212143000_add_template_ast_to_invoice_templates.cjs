/**
 * No-op.
 *
 * This migration originally introduced invoice_templates.templateAst.
 * The final cutover migrations now ensure this column exists when needed:
 * - 20260217134000_normalize_custom_invoice_templates_to_ast.cjs
 */

exports.up = async function up() {
  // Intentionally no-op.
};

exports.down = async function down() {
  // Intentionally no-op.
};

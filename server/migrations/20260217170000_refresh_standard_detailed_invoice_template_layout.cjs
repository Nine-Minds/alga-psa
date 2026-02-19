/**
 * No-op.
 *
 * Originally introduced to refresh the detailed template AST after earlier cutover drafts.
 * The final canonical AST payloads are now authored directly in:
 * - 20260217133000_upsert_standard_invoice_template_asts.cjs
 * - 20260217134000_normalize_custom_invoice_templates_to_ast.cjs
 *
 * Keeping this migration as a no-op preserves migration history/order without performing
 * redundant data rewrites.
 */

exports.up = async function up() {
  // Intentionally no-op.
};

exports.down = async function down() {
  // Intentionally no-op.
};

// alga0002161 — the issuer-logo node lacked object-fit, so non-wide logos were
// stretched. Standard quote/invoice templates render from these global DB rows
// (seeded once, never resynced from TS), so patch the seeded rows in place.
// Additive + idempotent: only sets objectFit/objectPosition when absent.

const TABLES = ['standard_quote_document_templates', 'standard_invoice_templates'];

// Recursively add object-fit to any issuer-logo node missing it. Mutates node in
// place; returns true if changed.
function patchIssuerLogo(node) {
  if (!node || typeof node !== 'object') {
    return false;
  }

  let changed = false;

  if (Array.isArray(node)) {
    for (const item of node) {
      if (patchIssuerLogo(item)) {
        changed = true;
      }
    }
    return changed;
  }

  if (
    node.id === 'issuer-logo' &&
    node.style &&
    typeof node.style === 'object' &&
    node.style.inline &&
    typeof node.style.inline === 'object' &&
    node.style.inline.objectFit === undefined
  ) {
    node.style.inline.objectFit = 'contain';
    node.style.inline.objectPosition = 'left';
    changed = true;
  }

  for (const key of Object.keys(node)) {
    if (patchIssuerLogo(node[key])) {
      changed = true;
    }
  }

  return changed;
}

exports.up = async function up(knex) {
  for (const table of TABLES) {
    const hasTable = await knex.schema.hasTable(table);
    if (!hasTable) continue;

    const hasColumn = await knex.schema.hasColumn(table, 'templateAst');
    if (!hasColumn) continue;

    const rows = await knex(table).select('template_id', 'templateAst');

    for (const row of rows) {
      if (!row.templateAst) continue;

      // JSONB is already parsed; only parse the defensive string case.
      const ast =
        typeof row.templateAst === 'string' ? JSON.parse(row.templateAst) : row.templateAst;

      if (patchIssuerLogo(ast)) {
        await knex(table)
          .where({ template_id: row.template_id })
          .update({ templateAst: JSON.stringify(ast), updated_at: knex.fn.now() });
      }
    }
  }
};

exports.down = async function down() {
  // No-op: additive data patch, nothing safe to revert.
};

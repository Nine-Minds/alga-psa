/**
 * Rewrite the stock quote-template `terms-copy` node from a plain `text` node to
 * a `richText` node so the shipped layouts render authored rich Terms &
 * Conditions (links, bold, paragraphs) instead of escaping them as text.
 *
 * Three sources carry the stock AST: the global
 * `standard_quote_document_templates` rows, tenant-owned `quote_document_templates`
 * rows cloned from a stock layout, and the in-code fallback in
 * `standardTemplates.ts` (changed alongside this migration).
 *
 * Tenant rows are only rewritten while the node still matches the stock shape:
 * `id: 'terms-copy'`, `type: 'text'`, bound to `termsAndConditions`. Anything a
 * tenant has authored differently is left byte-for-byte unchanged and keeps
 * rendering through the `text` node. The rewrite is idempotent — a node already
 * carrying the rich binding fails the stock-shape guard — and the `down`
 * migration restores the text binding.
 */

const STANDARD_CODES = [
  'standard-quote-default',
  'standard-quote-detailed',
  'standard-quote-grouped',
  'standard-quote-by-location',
];

const LEGACY_BINDING_ID = 'termsAndConditions';
const RICH_BINDING_ID = 'termsAndConditionsRich';

// The new binding must be declared in `ast.bindings.values` for the evaluator
// to resolve it; a node carrying an undeclared binding renders empty. This
// mirrors QUOTE_TEMPLATE_VALUE_BINDINGS.termsAndConditionsRich.
const RICH_TERMS_BINDING = {
  id: RICH_BINDING_ID,
  kind: 'value',
  path: 'terms_and_conditions_rich',
  fallback: '',
};

function isStockTermsCopyNode(node) {
  return (
    node &&
    typeof node === 'object' &&
    node.id === 'terms-copy' &&
    node.type === 'text' &&
    node.content &&
    typeof node.content === 'object' &&
    node.content.type === 'binding' &&
    node.content.bindingId === LEGACY_BINDING_ID
  );
}

function isRichTermsCopyNode(node) {
  return (
    node &&
    typeof node === 'object' &&
    node.id === 'terms-copy' &&
    node.type === 'richText' &&
    node.content &&
    typeof node.content === 'object' &&
    node.content.type === 'binding' &&
    node.content.bindingId === RICH_BINDING_ID
  );
}

/**
 * Walk the AST in place, flipping any stock terms-copy node. Returns true when at
 * least one node changed so callers can skip the write.
 */
function rewriteTermsCopy(value, direction) {
  let changed = false;

  const visit = (entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }

    if (direction === 'up' && isStockTermsCopyNode(entry)) {
      entry.type = 'richText';
      entry.content = { ...entry.content, bindingId: RICH_BINDING_ID };
      changed = true;
    } else if (direction === 'down' && isRichTermsCopyNode(entry)) {
      entry.type = 'text';
      entry.content = { ...entry.content, bindingId: LEGACY_BINDING_ID };
      changed = true;
    }

    for (const child of Object.values(entry)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };

  visit(value);
  return changed;
}

/**
 * True when the AST already carries a rich terms-copy node. Used to decide
 * whether the `termsAndConditionsRich` binding declaration needs to exist, so
 * unrelated layouts are never touched.
 */
function containsRichTermsCopy(value) {
  let found = false;

  const visit = (entry) => {
    if (found || !entry || typeof entry !== 'object') {
      return;
    }
    if (isRichTermsCopyNode(entry)) {
      found = true;
      return;
    }
    for (const child of Object.values(entry)) {
      if (Array.isArray(child)) {
        child.forEach(visit);
      } else if (child && typeof child === 'object') {
        visit(child);
      }
    }
  };

  visit(value);
  return found;
}

/**
 * Ensure the AST declares (up) or drops (down) the rich terms value binding.
 * Returns true when the bindings changed.
 */
function syncRichTermsBinding(ast, direction) {
  if (!ast || typeof ast !== 'object') {
    return false;
  }
  if (!ast.bindings || typeof ast.bindings !== 'object') {
    if (direction !== 'up') {
      return false;
    }
    ast.bindings = { values: {}, collections: {} };
  }
  if (!ast.bindings.values || typeof ast.bindings.values !== 'object') {
    if (direction !== 'up') {
      return false;
    }
    ast.bindings.values = {};
  }

  if (direction === 'up') {
    if (ast.bindings.values[RICH_BINDING_ID]) {
      return false;
    }
    ast.bindings.values[RICH_BINDING_ID] = { ...RICH_TERMS_BINDING };
    return true;
  }

  if (ast.bindings.values[RICH_BINDING_ID]) {
    delete ast.bindings.values[RICH_BINDING_ID];
    return true;
  }
  return false;
}

async function applyToStandardRows(knex, direction) {
  const rows = await knex('standard_quote_document_templates')
    .whereIn('standard_quote_document_template_code', STANDARD_CODES)
    .select('template_id', 'templateAst');

  for (const row of rows) {
    const ast = row.templateAst;
    if (!ast || typeof ast !== 'object') {
      continue;
    }
    const nodeChanged = rewriteTermsCopy(ast, direction);
    const bindingWanted = direction === 'up' ? containsRichTermsCopy(ast) : true;
    const bindingChanged = bindingWanted ? syncRichTermsBinding(ast, direction) : false;
    if (nodeChanged || bindingChanged) {
      await knex('standard_quote_document_templates')
        .where({ template_id: row.template_id })
        .update({ templateAst: ast, updated_at: knex.fn.now() });
    }
  }
}

async function applyToTenantRows(knex, direction) {
  const rows = await knex('quote_document_templates').select('tenant', 'template_id', 'templateAst');

  for (const row of rows) {
    const ast = row.templateAst;
    if (!ast || typeof ast !== 'object') {
      continue;
    }
    const nodeChanged = rewriteTermsCopy(ast, direction);
    const bindingWanted = direction === 'up' ? containsRichTermsCopy(ast) : true;
    const bindingChanged = bindingWanted ? syncRichTermsBinding(ast, direction) : false;
    if (nodeChanged || bindingChanged) {
      await knex('quote_document_templates')
        .where({ tenant: row.tenant, template_id: row.template_id })
        .update({ templateAst: ast, updated_at: knex.fn.now() });
    }
  }
}

exports.up = async function up(knex) {
  await applyToStandardRows(knex, 'up');
  await applyToTenantRows(knex, 'up');
};

exports.down = async function down(knex) {
  await applyToStandardRows(knex, 'down');
  await applyToTenantRows(knex, 'down');
};

// Pure AST rewrite exposed for the contract test; the migration itself only
// needs up/down.
exports.__test = {
  rewriteTermsCopy,
  containsRichTermsCopy,
  syncRichTermsBinding,
  isStockTermsCopyNode,
  isRichTermsCopyNode,
};

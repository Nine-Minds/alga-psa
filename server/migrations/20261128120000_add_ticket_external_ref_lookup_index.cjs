/** Supports the co-managed workflow's authorized external_ref selector lookup. */
const TABLE = 'tickets';
const INDEX_NAME = 'tickets_tenant_external_ref_lookup_idx';

async function readIndex(knex) {
  const { rows } = await knex.raw(`
    SELECT i.indisvalid, i.indisready, i.indisunique,
           i.indpred IS NULL AS unfiltered,
           array(SELECT a.attname::text
                 FROM unnest(i.indkey::int2[]) WITH ORDINALITY k(attnum, ord)
                 LEFT JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
                 ORDER BY k.ord) AS columns,
           pg_get_expr(i.indexprs, i.indrelid) AS expression
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ? AND n.nspname = current_schema() AND i.indrelid = ?::regclass
  `, [INDEX_NAME, TABLE]);
  return rows[0] || null;
}

function normalizedExpression(expression) {
  const source = String(expression || '');
  let normalized = '';
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      normalized += char;
      if (char === quote) {
        // SQL escapes a quote inside a quoted identifier or string by doubling it.
        if (source[i + 1] === quote) normalized += source[++i];
        else quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      normalized += char;
    } else if (!/[()\s]/.test(char)) {
      normalized += char.toLowerCase();
    }
  }
  return normalized;
}

function isExpectedIndex(index) {
  return Boolean(index)
    && index.indisvalid
    && index.indisready
    && !index.indisunique
    && index.unfiltered
    && index.columns.length === 2
    && index.columns[0] === 'tenant'
    && index.columns[1] === null
    && normalizedExpression(index.expression) === "attributes->>'external_ref'::text";
}

exports.up = async function up(knex) {
  let existing = await readIndex(knex);
  if (existing && !existing.indisvalid) {
    // CREATE INDEX CONCURRENTLY can leave an INVALID index after cancellation;
    // IF NOT EXISTS would silently accept it and never repair selector lookups.
    await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
    existing = null;
  }
  if (existing && !isExpectedIndex(existing)) {
    throw new Error(`Index ${INDEX_NAME} exists with a different definition; refusing to preserve or replace it.`);
  }
  if (!existing) {
    await knex.raw(`
      CREATE INDEX CONCURRENTLY IF NOT EXISTS ${INDEX_NAME}
        ON ${TABLE} (tenant, (attributes->>'external_ref'))
    `);
  }

  const created = await readIndex(knex);
  if (!isExpectedIndex(created)) {
    throw new Error(`Index ${INDEX_NAME} is missing, invalid, or has an unexpected definition.`);
  }
};

exports.down = async function down(knex) {
  await knex.raw(`DROP INDEX CONCURRENTLY IF EXISTS ${INDEX_NAME}`);
};

// CREATE/DROP INDEX CONCURRENTLY cannot run inside a transaction block.
exports.config = { transaction: false };

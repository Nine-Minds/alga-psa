// CM L6a2: widen an `IN (...)` / `= ANY (ARRAY[...])` text CHECK additively, in the order that
// keeps old readers and writers working: (1) add the replacement NOT VALID, (2) validate it,
// (3) drop the old constraint and give the replacement the original name.
// The replacement list is built from the LIVE constraint definition, never hard-coded, so any
// value a later migration added survives. DDL cannot bind parameters; every literal is escaped.
const REPLACEMENT_SUFFIX = '_v2';

const quoteLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;
const quoteIdent = (value) => `"${String(value).replace(/"/g, '""')}"`;

function literalsOf(definition) {
  const out = [];
  for (const match of definition.matchAll(/'((?:[^']|'')*)'::(?:text|character varying)/g)) out.push(match[1].replace(/''/g, "'"));
  return out;
}

async function liveDefinition(knex, table, name) {
  const { rows } = await knex.raw(
    `SELECT pg_get_constraintdef(oid) AS definition, convalidated FROM pg_constraint WHERE conrelid = ?::regclass AND conname = ?`,
    [table, name],
  );
  return rows[0] || null;
}

/** Step 1. Idempotent: no-op when the live constraint already allows every wanted value or the replacement exists. */
async function addWidenedCheckNotValid(knex, { table, name, column, add }) {
  if (!(await knex.schema.hasTable(table))) return;
  const replacement = `${name}${REPLACEMENT_SUFFIX}`;
  if (await liveDefinition(knex, table, replacement)) return;
  const live = await liveDefinition(knex, table, name);
  if (!live) return; // nothing to widen: the column was never constrained here
  const values = literalsOf(live.definition);
  if (!values.length) throw new Error(`Cannot derive the allowed list of ${table}.${name} from: ${live.definition}`);
  if (add.every((value) => values.includes(value))) return;
  const next = [...new Set([...values, ...add])];
  await knex.raw(
    `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(replacement)} CHECK (${quoteIdent(column)} IN (${next.map(quoteLiteral).join(', ')})) NOT VALID`,
  );
}

/** Step 2: VALIDATE only (SHARE UPDATE EXCLUSIVE; reads and writes continue). Needs a transaction:false file. */
async function validateWidenedCheck(knex, { table, name }) {
  if (!(await knex.schema.hasTable(table))) return;
  const replacement = await liveDefinition(knex, table, `${name}${REPLACEMENT_SUFFIX}`);
  if (!replacement || replacement.convalidated) return;
  await knex.raw(`ALTER TABLE ${quoteIdent(table)} VALIDATE CONSTRAINT ${quoteIdent(`${name}${REPLACEMENT_SUFFIX}`)}`);
}

/** Step 3: only after the replacement is validated, drop the old one and rename the replacement into its place. */
async function promoteWidenedCheck(knex, { table, name }) {
  if (!(await knex.schema.hasTable(table))) return;
  const replacementName = `${name}${REPLACEMENT_SUFFIX}`;
  const replacement = await liveDefinition(knex, table, replacementName);
  if (!replacement) return; // already promoted, or never needed
  if (!replacement.convalidated) throw new Error(`${table}.${replacementName} is not validated; refusing to drop ${name}`);
  await knex.raw(`ALTER TABLE ${quoteIdent(table)} DROP CONSTRAINT IF EXISTS ${quoteIdent(name)}`);
  await knex.raw(`ALTER TABLE ${quoteIdent(table)} RENAME CONSTRAINT ${quoteIdent(replacementName)} TO ${quoteIdent(name)}`);
}

module.exports = { addWidenedCheckNotValid, validateWidenedCheck, promoteWidenedCheck, literalsOf };

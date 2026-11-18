// Structural N-1 compatibility (CM L0g, alga-2026-0002848).
//
// The release currently in production (the PR's merge base) keeps running against
// the PR's schema during a blue/green window. These functions snapshot a database
// and decide, from two snapshots alone, whether the old release can still use it.
// No database is needed to *compare*, so every assertion is unit-testable.

/** Capture everything the assertions need. `db` is a knex instance. */
export async function snapshotSchema(db) {
  const rows = async (sql) => (await db.raw(sql)).rows;
  const tables = (await rows(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`)).map((r) => r.table_name);
  const columns = await rows(`
    SELECT table_name AS "table", column_name AS "column", data_type AS "dataType", udt_name AS "udt",
           character_maximum_length AS "charLength", numeric_precision AS "precision",
           numeric_scale AS "scale", datetime_precision AS "datetimePrecision"
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN (SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE')
     ORDER BY 1, ordinal_position`);
  // Primary-key/unique constraints are identified by (table, columns): a rename is harmless,
  // losing the uniqueness old ON CONFLICT clauses rely on is not.
  const uniques = await rows(`
    SELECT c.conrelid::regclass::text AS "table", c.conname AS name, c.contype AS kind,
           (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE n.nspname = 'public' AND c.contype IN ('p', 'u') ORDER BY 1, 2`);
  const enums = await rows(`
    SELECT t.typname AS name, array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' GROUP BY 1 ORDER BY 1`);
  const ledger = await rows(`SELECT id, name, batch FROM knex_migrations ORDER BY id`);
  return { tables, columns, uniques, enums, ledger };
}

const INT_RANK = { int2: 1, int4: 2, int8: 3 };
const FLOAT_RANK = { float4: 1, float8: 2 };

/**
 * Is `after` a type the old release can still read and write wherever it could with `before`?
 * Returns null when compatible, else a short reason.
 */
export function narrowing(before, after) {
  const label = (c) => {
    const len = c.charLength != null ? `(${c.charLength})` : '';
    const num = c.udt === 'numeric' && c.precision != null ? `(${c.precision},${c.scale ?? 0})` : '';
    return `${c.udt}${len}${num}`;
  };
  if (before.udt === after.udt) {
    if (before.charLength != null && after.charLength != null && after.charLength < before.charLength) return `${label(before)} -> ${label(after)} shrinks the length`;
    if (before.charLength != null && after.charLength == null && ['bpchar'].includes(before.udt)) return null;
    if (before.udt === 'numeric') {
      if (before.precision != null && after.precision == null) return null; // bounded -> unbounded widens
      if (before.precision == null && after.precision != null) return `${label(before)} -> ${label(after)} bounds a previously unbounded numeric`;
      if (after.precision < before.precision || (after.scale ?? 0) < (before.scale ?? 0)) return `${label(before)} -> ${label(after)} shrinks precision or scale`;
      if (after.precision - (after.scale ?? 0) < before.precision - (before.scale ?? 0)) return `${label(before)} -> ${label(after)} loses integer digits`;
    }
    if (before.datetimePrecision != null && after.datetimePrecision != null && after.datetimePrecision < before.datetimePrecision) return `${label(before)} fractional-second precision ${before.datetimePrecision} -> ${after.datetimePrecision}`;
    return null;
  }
  if (INT_RANK[before.udt] && INT_RANK[after.udt]) return INT_RANK[after.udt] >= INT_RANK[before.udt] ? null : `${label(before)} -> ${label(after)} narrows the integer`;
  if (FLOAT_RANK[before.udt] && FLOAT_RANK[after.udt]) return FLOAT_RANK[after.udt] >= FLOAT_RANK[before.udt] ? null : `${label(before)} -> ${label(after)} narrows the float`;
  if (INT_RANK[before.udt] && after.udt === 'numeric') return after.precision == null ? null : `${label(before)} -> ${label(after)} may not hold every integer`;
  // varchar(n)/bpchar -> text widens; text -> varchar(n) is the canonical narrowing.
  if (['varchar', 'bpchar'].includes(before.udt) && after.udt === 'text') return null;
  if (before.udt === 'bpchar' && after.udt === 'varchar') return after.charLength == null || after.charLength >= before.charLength ? null : `${label(before)} -> ${label(after)} shrinks the length`;
  if (before.udt === 'text' && ['varchar', 'bpchar'].includes(after.udt)) return `${label(before)} -> ${label(after)} narrows text to a bounded string`;
  return `${label(before)} -> ${label(after)} is a different type`;
}

/**
 * The N-1 assertions. Returns [{ assertion, subject, message }]; empty means compatible.
 * `before` is the baseline-release schema, `after` the same database after the PR's migrations.
 */
export function assertN1(before, after) {
  const out = [];
  const fail = (assertion, subject, message) => out.push({ assertion, subject, message });

  // 1. The ledger is append-only.
  const afterByName = new Map(after.ledger.map((r) => [r.name, r]));
  for (const row of before.ledger) {
    const now = afterByName.get(row.name);
    if (!now) fail('ledger-append-only', row.name, `baseline migration ${row.name} is no longer in knex_migrations`);
    else if (Number(now.batch) !== Number(row.batch)) fail('ledger-append-only', row.name, `baseline migration ${row.name} moved from batch ${row.batch} to ${now.batch}`);
  }
  // Ordering of *new* rows is deliberately not asserted: knex applies every pending file in name
  // order even when it sorts before the head, and rule 6 of the migration lint owns timestamps.
  const baseIds = new Map(before.ledger.map((r) => [r.name, Number(r.id)]));
  for (const row of after.ledger) {
    if (baseIds.has(row.name) && baseIds.get(row.name) !== Number(row.id)) fail('ledger-append-only', row.name, `baseline migration ${row.name} changed ledger id ${baseIds.get(row.name)} -> ${row.id}`);
  }

  // 2. No table dropped.
  const afterTables = new Set(after.tables);
  for (const t of before.tables) if (!afterTables.has(t)) fail('table-dropped', t, `table ${t} was dropped`);

  // 3. No column dropped, no type narrowed.
  const afterCols = new Map(after.columns.map((c) => [`${c.table}.${c.column}`, c]));
  for (const c of before.columns) {
    if (!afterTables.has(c.table)) continue; // already reported as table-dropped
    const now = afterCols.get(`${c.table}.${c.column}`);
    if (!now) {
      fail('column-dropped', `${c.table}.${c.column}`, `column ${c.table}.${c.column} was dropped or renamed`);
      continue;
    }
    const reason = narrowing(c, now);
    if (reason) fail('type-narrowed', `${c.table}.${c.column}`, `column ${c.table}.${c.column}: ${reason}`);
  }

  // 3b. Enum labels are part of the type: removing one narrows it.
  const afterEnums = new Map(after.enums.map((e) => [e.name, e.labels]));
  for (const e of before.enums) {
    const now = afterEnums.get(e.name);
    if (!now) fail('type-narrowed', e.name, `enum type ${e.name} was dropped`);
    else for (const l of e.labels) if (!now.includes(l)) fail('type-narrowed', `${e.name}.${l}`, `enum ${e.name} lost label '${l}'`);
  }

  // 4. Primary-key / unique constraints survive (matched by columns, so a rename is fine).
  const sig = (u) => `${u.table}(${(u.columns ?? []).join(',')})`;
  const afterSigs = new Set(after.uniques.map(sig));
  for (const u of before.uniques) {
    if (!afterTables.has(u.table)) continue;
    if (!afterSigs.has(sig(u))) fail('unique-dropped', sig(u), `${u.kind === 'p' ? 'primary key' : 'unique constraint'} ${u.name} on ${sig(u)} no longer exists; old ON CONFLICT targets and lookups depend on it`);
  }
  return out;
}

/**
 * Schema-wide repair of tenant-nulling foreign keys.
 *
 * 19 composite FKs of the shape FOREIGN KEY (tenant, X) ... ON DELETE SET
 * NULL exist across the schema (users->contacts, projects->users,
 * documents->document_types, invoices->invoice_templates, ...). On a delete
 * of the referenced row, Postgres nulls EVERY referencing column — including
 * the tenant column — silently stripping tenancy from the referencing row.
 * App-level deletion guards have kept this dormant, but each one is a latent
 * data-corruption hazard on every deployment.
 *
 * Recreate each safely:
 * - PG 15+ on plain Postgres: ON DELETE SET NULL (<non-tenant columns>) —
 *   nulls only the link columns, preserving the unlink-on-delete intent.
 * - Citus (or PG < 15): plain NO ACTION — Citus refuses SET NULL/SET DEFAULT
 *   when the distribution key is part of the FK, and the column-targeted
 *   form does not exist before PG 15.
 */

const isCitusEnabled = async (knex) => {
  const { rows } = await knex.raw("SELECT 1 FROM pg_extension WHERE extname = 'citus' LIMIT 1");
  return rows.length > 0;
};

const findDangerousFks = (knex) => knex.raw(`
  SELECT
    c.conrelid::regclass::text AS tbl,
    c.conname,
    pg_get_constraintdef(c.oid) AS def,
    (
      SELECT string_agg(quote_ident(a.attname), ', ')
      FROM unnest(c.conkey) k
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      WHERE a.attname <> 'tenant'
    ) AS settable_cols
  FROM pg_constraint c
  WHERE c.contype = 'f'
    AND c.confdeltype IN ('n', 'd')
    AND coalesce(cardinality(c.confdelsetcols), 0) = 0
    AND EXISTS (
      SELECT 1 FROM unnest(c.conkey) k
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k
      WHERE a.attname = 'tenant'
    )
`);

exports.up = async function up(knex) {
  const { rows } = await findDangerousFks(knex);
  if (rows.length === 0) {
    return;
  }

  const versionRow = await knex.raw("SELECT current_setting('server_version_num')::int AS v");
  const columnTargeted = versionRow.rows[0].v >= 150000 && !(await isCitusEnabled(knex));

  for (const row of rows) {
    const replacement = columnTargeted && row.settable_cols
      ? ` ON DELETE SET NULL (${row.settable_cols})`
      : '';
    const def = row.def.replace(/ ON DELETE SET (NULL|DEFAULT)/, replacement);
    console.log(`[fix-tenant-nulling-fks] ${row.tbl}.${row.conname}: ${columnTargeted ? 'column-targeted SET NULL' : 'NO ACTION'}`);
    await knex.raw(`ALTER TABLE ${row.tbl} DROP CONSTRAINT "${row.conname}"`);
    await knex.raw(`ALTER TABLE ${row.tbl} ADD CONSTRAINT "${row.conname}" ${def}`);
  }
};

exports.down = async function down() {
  // Intentionally a no-op: restoring bare SET NULL would reintroduce the
  // tenant-nulling hazard.
};

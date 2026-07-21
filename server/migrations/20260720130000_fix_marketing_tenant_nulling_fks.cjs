/**
 * Re-run of the 20260611150000 tenant-nulling FK repair for databases that
 * migrated through the original marketing-table migrations, which created
 * nine bare composite ON DELETE SET NULL FKs (marketing_content /
 * marketing_capture_forms / social_posts / marketing_sequences ->
 * marketing_campaigns, marketing_suppressions -> contacts, and four on
 * marketing_engagements). Those migrations now create the FKs safely, so on
 * a fresh chain this scan finds nothing; on an already-migrated database it
 * rewrites any survivors:
 * - PG 15+ on plain Postgres: ON DELETE SET NULL (<non-tenant columns>)
 * - Citus (or PG < 15): plain NO ACTION
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
    console.log(`[fix-marketing-tenant-nulling-fks] ${row.tbl}.${row.conname}: ${columnTargeted ? 'column-targeted SET NULL' : 'NO ACTION'}`);
    await knex.raw(`ALTER TABLE ${row.tbl} DROP CONSTRAINT "${row.conname}"`);
    await knex.raw(`ALTER TABLE ${row.tbl} ADD CONSTRAINT "${row.conname}" ${def}`);
  }
};

exports.down = async function down() {
  // Intentionally a no-op: restoring bare SET NULL would reintroduce the
  // tenant-nulling hazard.
};

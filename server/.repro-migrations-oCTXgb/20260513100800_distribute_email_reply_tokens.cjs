// `comments` was distributed earlier without the required
// truncate_local_data_after_distributing_table() follow-up, stranding
// pre-distribution NULL-thread_id rows in the coordinator parent heap. They are
// invisible to Citus-routed DML but break ALTER ... SET NOT NULL (core PG DDL
// scans the parent heap). That cleanup is refused while ANY non-distributed
// table has an FK to comments. Several do (email_reply_tokens, vectors,
// ticket_bundle_mirrors, ...). This migration distributes every such local
// referrer co-located with comments, then runs the official cleanup.
//
// ⚠️ UNSAFE PATTERN — do not copy into new migrations, and do NOT treat the
// following as a general rule: "distributing a possibly-non-empty table must be
// followed by truncate_local_data_after_distributing_table()". That function
// issues a TRUNCATE that CASCADEs across the whole FK graph. Distributed tables
// in the cascade only lose stranded coordinator-local rows, but any
// NON-distributed table in the recursive FK closure loses ALL of its data (a
// local table's coordinator heap is its only copy). This migration only got
// away with it because it first distributed every local referrer. Before ever
// calling the function again, walk the FK closure (pg_constraint) and abort
// unless every member is distributed (pg_dist_partition). Retained as history,
// not as an example.

exports.up = async function up(knex) {
  const citus = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled"
  );
  if (!citus.rows?.[0]?.enabled) {
    return;
  }

  // Colocation anchor must be distributed; nothing to do otherwise.
  if (!(await isDistributed(knex, 'comments'))) {
    return;
  }

  const referrers = await knex.raw(
    `SELECT DISTINCT con.conrelid::regclass::text AS tbl
       FROM pg_constraint con
      WHERE con.contype = 'f'
        AND con.confrelid IN ('comments'::regclass, 'project_task_comments'::regclass)
        AND con.conrelid <> con.confrelid
        AND NOT EXISTS (
          SELECT 1 FROM citus_tables ct WHERE ct.table_name = con.conrelid
        )
      ORDER BY 1`
  );

  const distributedNow = [];
  for (const { tbl } of referrers.rows ?? []) {
    await makeDistributable(knex, tbl);
    // Joining the colocation group pulls the table into an FK graph that may
    // reach a reference table; Citus then forbids the default parallel DDL of
    // create_distributed_table. Run it in its own transaction in sequential
    // mode (SET LOCAL auto-resets on commit) with no prior reference access.
    await knex.transaction(async (trx) => {
      await trx.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
      await trx.raw(
        "SELECT create_distributed_table(?, 'tenant', colocate_with => 'comments')",
        [tbl]
      );
    });
    distributedNow.push(tbl);
  }

  for (const tbl of [...distributedNow, 'email_reply_tokens', 'comments', 'project_task_comments']) {
    await truncateLocalDataIfNeeded(knex, tbl);
  }
};

// Prepare a local table for create_distributed_table: it must have the
// distribution column, no unique/exclude constraint or unique index that omits
// it, and no rows whose composite FKs point at now-deleted distributed parents
// (those abort the shard copy; the referenced entity is gone so the row is
// dead).
async function makeDistributable(knex, table) {
  const hasTenant = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_name = ? AND column_name = 'tenant'
     ) AS ok`,
    [table]
  );
  if (!hasTenant.rows?.[0]?.ok) {
    throw new Error(
      `Cannot distribute ${table}: it FKs comments/project_task_comments but ` +
      `has no tenant column. Handle it explicitly before this migration.`
    );
  }

  const blockingUniques = await knex.raw(
    `SELECT con.conname AS conname
       FROM pg_constraint con
      WHERE con.conrelid = ?::regclass
        AND con.contype IN ('u', 'x')
        AND NOT EXISTS (
          SELECT 1
            FROM unnest(con.conkey) AS k(attnum)
            JOIN pg_attribute a
              ON a.attrelid = con.conrelid AND a.attnum = k.attnum
           WHERE a.attname = 'tenant'
        )`,
    [table]
  );
  for (const row of blockingUniques.rows ?? []) {
    await knex.raw('ALTER TABLE ?? DROP CONSTRAINT ??', [table, row.conname]);
  }

  const blockingIndexes = await knex.raw(
    `SELECT i.relname AS indexname
       FROM pg_index x
       JOIN pg_class i ON i.oid = x.indexrelid
       JOIN pg_class t ON t.oid = x.indrelid
      WHERE t.relname = ?
        AND x.indisunique
        AND NOT x.indisprimary
        AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid)
        AND NOT EXISTS (
          SELECT 1
            FROM unnest(x.indkey) AS k(attnum)
            JOIN pg_attribute a
              ON a.attrelid = x.indrelid AND a.attnum = k.attnum
           WHERE a.attname = 'tenant'
        )`,
    [table]
  );
  for (const row of blockingIndexes.rows ?? []) {
    await knex.raw('DROP INDEX IF EXISTS ??', [row.indexname]);
  }

  await purgeOrphanRows(knex, table);
}

// Delete rows whose FK columns reference a parent row that no longer exists.
// Citus forbids local<->distributed joins, so every step touches one table
// kind only: read local, check existence on the (distributed) parent, delete
// local by primary key.
async function purgeOrphanRows(knex, table) {
  const pkRes = await knex.raw(
    `SELECT a.attname
       FROM pg_constraint c
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = ?::regclass AND c.contype = 'p'
      ORDER BY k.ord`,
    [table]
  );
  const pkCols = (pkRes.rows ?? []).map((r) => r.attname);
  if (pkCols.length === 0) {
    return;
  }

  const fkRes = await knex.raw(
    `SELECT c.conname,
            c.confrelid::regclass::text AS parent,
            (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
               FROM unnest(c.conkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            ) AS local_cols,
            (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
               FROM unnest(c.confkey) WITH ORDINALITY k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
            ) AS parent_cols
       FROM pg_constraint c
      WHERE c.conrelid = ?::regclass AND c.contype = 'f'`,
    [table]
  );
  // string_agg keeps these as scalar text regardless of driver array parsing.
  const fks = (fkRes.rows ?? []).map((r) => ({
    conname: r.conname,
    parent: r.parent,
    local_cols: r.local_cols.split(','),
    parent_cols: r.parent_cols.split(','),
  }));
  if (fks.length === 0) {
    return;
  }

  const fkCols = [...new Set(fks.flatMap((f) => f.local_cols))];
  const selectCols = [...new Set([...pkCols, ...fkCols])];
  const { rows } = await knex.raw(
    `SELECT ${selectCols.map((_, i) => `??::text AS c${i}`).join(', ')} FROM ??`,
    [...selectCols, table]
  );
  if (rows.length === 0) {
    return;
  }
  const colIndex = new Map(selectCols.map((c, i) => [c, `c${i}`]));
  const val = (row, col) => row[colIndex.get(col)];

  // Existence set per FK, built from the parent (single-table, Citus-routable).
  // Keep `tenant` as uuid so shard pruning still applies; compare other cols
  // as text so we don't need each parent column's exact type.
  const okSets = [];
  for (const fk of fks) {
    const pairs = [];
    for (const row of rows) {
      if (fk.local_cols.some((lc) => val(row, lc) == null)) continue;
      pairs.push(fk.local_cols.map((lc) => val(row, lc)));
    }
    const uniq = [...new Map(pairs.map((p) => [p.join('|'), p])).values()];
    if (uniq.length === 0) {
      okSets.push(new Set());
      continue;
    }
    const tuple = fk.parent_cols
      .map((pc) => (pc === 'tenant' ? 'tenant' : `??::text`))
      .join(', ');
    const ph = '(' + fk.parent_cols
      .map((pc) => (pc === 'tenant' ? '?::uuid' : '?::text'))
      .join(', ') + ')';
    const idents = fk.parent_cols.filter((pc) => pc !== 'tenant');
    const sql =
      `SELECT ${fk.parent_cols.map((_, i) => `??::text AS k${i}`).join(', ')} ` +
      `FROM ?? WHERE (${tuple}) IN (${uniq.map(() => ph).join(', ')})`;
    const binds = [
      ...fk.parent_cols, // SELECT ??::text AS k{i}
      fk.parent,         // FROM ??
      ...idents,         // tuple ??::text (non-tenant parent cols)
      ...uniq.flat(),    // IN (...) values
    ];
    const res = await knex.raw(sql, binds);
    okSets.push(
      new Set((res.rows ?? []).map((r) => fk.parent_cols.map((_, i) => r[`k${i}`]).join('|')))
    );
  }

  const orphans = rows.filter((row) =>
    fks.some((fk, i) => {
      if (fk.local_cols.some((lc) => val(row, lc) == null)) return false;
      const key = fk.local_cols.map((lc) => val(row, lc)).join('|');
      return !okSets[i].has(key);
    })
  );
  if (orphans.length === 0) {
    return;
  }

  // Local-only delete by primary key (no distributed table referenced).
  const pkTuple = pkCols.map(() => '??::text').join(', ');
  const rowPh = '(' + pkCols.map(() => '?').join(', ') + ')';
  await knex.raw(
    `DELETE FROM ?? WHERE (${pkTuple}) IN (${orphans.map(() => rowPh).join(', ')})`,
    [table, ...pkCols, ...orphans.flatMap((o) => pkCols.map((c) => val(o, c)))]
  );
}

async function isDistributed(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
     ) AS is_distributed`,
    [table]
  );
  return Boolean(res.rows?.[0]?.is_distributed);
}

// ⚠️ See the header warning: the TRUNCATE below cascades over the FK graph and
// destroys ALL data of any non-distributed table in the closure. Do not reuse.
async function truncateLocalDataIfNeeded(knex, table) {
  if (!(await isDistributed(knex, table))) {
    return;
  }
  // 0-byte parent heap = cleanly distributed; nothing to do (also the no-op
  // guard for re-runs and fresh installs).
  const heap = await knex.raw('SELECT pg_relation_size(?::regclass) AS bytes', [table]);
  if (Number(heap.rows?.[0]?.bytes ?? 0) === 0) {
    return;
  }
  await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [table]);
}

// Forward-only schema hygiene; undistribute_table() is too heavy/risky to
// auto-reverse and dropped non-tenant uniques are superseded by tenant-scoped
// keys.
exports.down = async function down(_knex) {};

// create_distributed_table() / truncate_local_data_after_distributing_table()
// must run outside a transaction block.
exports.config = { transaction: false };

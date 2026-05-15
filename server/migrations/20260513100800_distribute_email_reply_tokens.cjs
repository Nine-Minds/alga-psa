// `comments` was distributed earlier without the required
// truncate_local_data_after_distributing_table() follow-up, stranding
// pre-distribution rows in the coordinator parent heap. Those NULL-thread_id
// shadow rows are invisible to Citus-routed DML but break ALTER ... SET NOT
// NULL (core PG DDL scans the parent heap). The official cleanup is blocked
// while a non-distributed table FKs `comments`; the only one is
// email_reply_tokens. Distributing it unblocks the cleanup and removes the
// local->distributed FK smell. Rule: distributing a non-empty table MUST be
// followed by truncate_local_data_after_distributing_table().

exports.up = async function up(knex) {
  const citus = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled"
  );
  if (!citus.rows?.[0]?.enabled) {
    return;
  }

  if (!(await isDistributed(knex, 'comments'))) {
    return;
  }

  if (!(await isDistributed(knex, 'email_reply_tokens'))) {
    // Citus rejects create_distributed_table() if a unique/exclude constraint
    // or unique index omits the distribution column. email_reply_tokens has a
    // global UNIQUE(token); the PK (tenant, token) already covers tenant-scoped
    // lookups and tokens are random secrets, so dropping it is safe.
    const blockingUniques = await knex.raw(
      `SELECT con.conname AS conname
         FROM pg_constraint con
        WHERE con.conrelid = 'email_reply_tokens'::regclass
          AND con.contype IN ('u', 'x')
          AND NOT EXISTS (
            SELECT 1
              FROM unnest(con.conkey) AS k(attnum)
              JOIN pg_attribute a
                ON a.attrelid = con.conrelid
               AND a.attnum = k.attnum
             WHERE a.attname = 'tenant'
          )`
    );
    for (const row of blockingUniques.rows ?? []) {
      await knex.raw('ALTER TABLE email_reply_tokens DROP CONSTRAINT ??', [row.conname]);
    }

    const blockingIndexes = await knex.raw(
      `SELECT i.relname AS indexname
         FROM pg_index x
         JOIN pg_class i ON i.oid = x.indexrelid
         JOIN pg_class t ON t.oid = x.indrelid
        WHERE t.relname = 'email_reply_tokens'
          AND x.indisunique
          AND NOT x.indisprimary
          AND NOT EXISTS (
            SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid
          )
          AND NOT EXISTS (
            SELECT 1
              FROM unnest(x.indkey) AS k(attnum)
              JOIN pg_attribute a
                ON a.attrelid = x.indrelid
               AND a.attnum = k.attnum
             WHERE a.attname = 'tenant'
          )`
    );
    for (const row of blockingIndexes.rows ?? []) {
      await knex.raw('DROP INDEX IF EXISTS ??', [row.indexname]);
    }

    // email_reply_tokens has an FK to the reference table standard_service_types.
    // Citus forbids the default parallel DDL of create_distributed_table when a
    // reference-table FK is involved ("cannot execute parallel DDL ... because
    // there is a foreign key"). Run it in its own transaction with sequential
    // mode (SET LOCAL auto-resets on commit) and no prior reference-table access.
    await knex.transaction(async (trx) => {
      await trx.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
      await trx.raw(
        "SELECT create_distributed_table('email_reply_tokens', 'tenant', colocate_with => 'comments')"
      );
    });
  }

  await truncateLocalDataIfNeeded(knex, 'email_reply_tokens');
  await truncateLocalDataIfNeeded(knex, 'comments');
  await truncateLocalDataIfNeeded(knex, 'project_task_comments');
};

async function isDistributed(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass
     ) AS is_distributed`,
    [table]
  );
  return Boolean(res.rows?.[0]?.is_distributed);
}

async function truncateLocalDataIfNeeded(knex, table) {
  if (!(await isDistributed(knex, table))) {
    return;
  }
  // A cleanly-distributed table has a 0-byte parent heap; non-zero means
  // create_distributed_table() left pre-distribution rows behind. The guard
  // also makes this a no-op on fresh installs and re-runs.
  const heap = await knex.raw('SELECT pg_relation_size(?::regclass) AS bytes', [table]);
  if (Number(heap.rows?.[0]?.bytes ?? 0) === 0) {
    return;
  }
  await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [table]);
}

// Forward-only schema hygiene; undistribute_table() is too heavy/risky to
// auto-reverse and the dropped global UNIQUE(token) is superseded by the PK.
exports.down = async function down(_knex) {};

// create_distributed_table() / truncate_local_data_after_distributing_table()
// must run outside a transaction block.
exports.config = { transaction: false };

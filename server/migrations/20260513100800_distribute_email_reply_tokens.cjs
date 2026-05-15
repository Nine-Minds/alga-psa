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
    // Drop orphaned tokens before distribution: create_distributed_table copies
    // rows into shards where the composite FKs are enforced per-shard. A token
    // whose ticket/project/comment/tenant was deleted (tokens are ephemeral and
    // these FKs don't cascade) can't be placed and aborts the copy. It's dead
    // anyway. Citus forbids local<->distributed joins, so each step queries one
    // table kind only: read local, check existence on distributed, delete local.
    await deleteOrphanedEmailReplyTokens(knex);

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

    // Joining colocation group 16 pulls email_reply_tokens into an FK graph that
    // reaches a reference table; Citus then forbids the default parallel DDL of
    // create_distributed_table ("cannot execute parallel DDL ... foreign key").
    // Run it in its own transaction in sequential mode (SET LOCAL auto-resets
    // on commit) with no prior reference-table access in that transaction.
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

async function deleteOrphanedEmailReplyTokens(knex) {
  const { rows: tokens } = await knex.raw(
    `SELECT tenant::text AS tenant, token,
            ticket_id::text AS ticket_id,
            project_id::text AS project_id,
            comment_id::text AS comment_id
       FROM email_reply_tokens`
  );
  if (tokens.length === 0) {
    return;
  }

  const uniqPairs = (rows, idKey) => {
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (!r[idKey]) continue;
      const k = `${r.tenant}|${r[idKey]}`;
      if (!seen.has(k)) {
        seen.add(k);
        out.push([r.tenant, r[idKey]]);
      }
    }
    return out;
  };

  // Existence lookups hit ONLY the distributed table (no local table joined),
  // so Citus can route them. Keep tenant uncast so shard pruning still applies.
  const existing = async (table, idCol, pairs) => {
    if (pairs.length === 0) return new Set();
    const placeholders = pairs.map(() => '(?::uuid,?::uuid)').join(',');
    const { rows } = await knex.raw(
      `SELECT tenant::text AS tenant, ${idCol}::text AS id
         FROM ${table}
        WHERE (tenant, ${idCol}) IN (${placeholders})`,
      pairs.flat()
    );
    return new Set(rows.map((r) => `${r.tenant}|${r.id}`));
  };

  const ticketsOk = await existing('tickets', 'ticket_id', uniqPairs(tokens, 'ticket_id'));
  const projectsOk = await existing('projects', 'project_id', uniqPairs(tokens, 'project_id'));
  const commentsOk = await existing('comments', 'comment_id', uniqPairs(tokens, 'comment_id'));

  const tenantList = [...new Set(tokens.map((t) => t.tenant))];
  const { rows: tnRows } = await knex.raw(
    `SELECT tenant::text AS tenant FROM tenants
      WHERE tenant IN (${tenantList.map(() => '?::uuid').join(',')})`,
    tenantList
  );
  const tenantsOk = new Set(tnRows.map((r) => r.tenant));

  const orphans = tokens.filter((t) =>
    !tenantsOk.has(t.tenant) ||
    (t.ticket_id && !ticketsOk.has(`${t.tenant}|${t.ticket_id}`)) ||
    (t.project_id && !projectsOk.has(`${t.tenant}|${t.project_id}`)) ||
    (t.comment_id && !commentsOk.has(`${t.tenant}|${t.comment_id}`))
  );
  if (orphans.length === 0) {
    return;
  }

  // Local-only delete (no distributed table referenced).
  const ph = orphans.map(() => '(?::uuid,?)').join(',');
  await knex.raw(
    `DELETE FROM email_reply_tokens WHERE (tenant, token) IN (${ph})`,
    orphans.flatMap((o) => [o.tenant, o.token])
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

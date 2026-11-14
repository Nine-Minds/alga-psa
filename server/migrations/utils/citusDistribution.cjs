'use strict';
// Distribute a tenant-scoped table on Citus, colocated with `tenants`.
// No-op on plain Postgres (CI CE path) and if already distributed.
async function canCreateDistributedTable(knex) {
  const r = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'create_distributed_table') AS exists;`);
  return Boolean(r.rows?.[0]?.exists);
}
async function isDistributed(knex, tableName) {
  const r = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_dist_partition WHERE logicalrelid = ?::regclass) AS is_distributed;`, [tableName]);
  return Boolean(r.rows?.[0]?.is_distributed);
}
async function ensureTenantDistribution(knex, tableName) {
  if (!(await canCreateDistributedTable(knex))) return;
  if (await isDistributed(knex, tableName)) return;
  await knex.raw(`SELECT create_distributed_table('${tableName}', 'tenant', colocate_with => 'tenants')`);
}

async function hasCitus(knex) {
  const r = await knex.raw(`SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS has_citus;`);
  return Boolean(r.rows?.[0]?.has_citus);
}

async function hasConstraint(knex, tableName, constraintName) {
  const r = await knex.raw(
    `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ? AND conrelid = ?::regclass) AS present;`,
    [constraintName, tableName]
  );
  return Boolean(r.rows?.[0]?.present);
}

// Citus enforces a foreign key only when both rows can live on the same node:
// both tables tenant-distributed (hence colocated), or neither. Several
// tenant-scoped tables are still coordinator-local — `client_locations` above
// all — so a distributed referrer has to go without the constraint rather than
// fail the migration. This is the probe that 20250613190110,
// 20260415120[0-3]00, 20260518120000 and 20260816010000 each copied by hand;
// it lives here now (see the LEVERAGE note in 20260816010000).
async function isFkCompatible(knex, referencingTable, referencedTable) {
  try {
    if (!(await hasCitus(knex))) return true;
    const referencing = await isDistributed(knex, referencingTable);
    const referenced = await isDistributed(knex, referencedTable);
    return referencing === referenced;
  } catch {
    return true;
  }
}

// Adds a composite FK when the two tables' distribution states allow it, drops
// a leftover one when they do not, and is a no-op when it is already in place.
// Call it *after* distributing the referencing table: whether the FK is legal
// is only knowable once both sides have their final distribution state.
async function ensureCompositeFk(knex, spec) {
  const { table, constraint, columns, referencedTable, referencedColumns, onDelete } = spec;
  const present = await hasConstraint(knex, table, constraint);

  if (!(await isFkCompatible(knex, table, referencedTable))) {
    if (present) {
      await knex.raw(`ALTER TABLE ${table} DROP CONSTRAINT ${constraint}`);
    }
    console.log(
      `${table} and ${referencedTable} have incompatible distribution - skipping foreign key ${constraint}`
    );
    return false;
  }

  if (!present) {
    await knex.raw(
      `ALTER TABLE ${table} ADD CONSTRAINT ${constraint} FOREIGN KEY (${columns.join(', ')}) ` +
        `REFERENCES ${referencedTable} (${referencedColumns.join(', ')})` +
        (onDelete ? ` ON DELETE ${onDelete}` : '')
    );
  }
  return true;
}

// Citus rejects CREATE/DROP TRIGGER on a distributed table unless
// citus.enable_unsafe_triggers is set, which this codebase does not set. A
// trigger on a tenant-distributed table is therefore defense-in-depth for plain
// Postgres and for tables Citus leaves local; where the table is distributed the
// invariant rests on the application path that writes it. Probe the extension
// first: pg_dist_partition does not exist on plain Postgres.
async function supportsTriggers(knex, tableName) {
  if (!(await canCreateDistributedTable(knex))) return true;
  return !(await isDistributed(knex, tableName));
}

const LOCK_ATTEMPTS = 3;

// Run DDL that takes ACCESS EXCLUSIVE on a hot table in its own transaction,
// giving up after 2s rather than queueing every reader behind a long
// transaction, and retrying a few times before failing the migration. Needs
// `exports.config = { transaction: false }` in the calling migration.
// LEVERAGE: pattern migration-lock-retry — 20261029140400 and 20261106090000 carry a savepoint variant of this retry that could move here.
async function inLockBoundedTransaction(knex, work) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await knex.transaction(async (trx) => {
        await trx.raw("SET LOCAL lock_timeout = '2s'");
        return work(trx);
      });
    } catch (error) {
      if (error.code !== '55P03' || attempt >= LOCK_ATTEMPTS) throw error;
    }
  }
}

// Local tables that FK to `tableName` would lose all their rows to the
// cascading TRUNCATE in distributeLocalTenantTables (see 20260513100800's header).
async function localReferrers(knex, tableName) {
  const r = await knex.raw(
    `SELECT DISTINCT con.conrelid::regclass::text AS tbl
       FROM pg_constraint con
      WHERE con.contype = 'f'
        AND con.confrelid = ?::regclass
        AND con.conrelid <> con.confrelid
        AND NOT EXISTS (SELECT 1 FROM pg_dist_partition p WHERE p.logicalrelid = con.conrelid)`,
    [tableName],
  );
  return (r.rows ?? []).map((row) => row.tbl);
}

const ORPHAN_BATCH = 1000;

// A local table's foreign key to a distributed parent is not enforced, so its
// rows outlive the parent they point at. On the shards the key is real and one
// such row fails create_distributed_table(). Each orphan gets what its key
// would have done at the parent's delete: a cascading key removes the row, any
// other key on a nullable column clears the reference. A required column under
// a non-cascading key has no such answer — the migration names it in
// `removeOrphans` or fails here, before anything is distributed.
//
// Covers (tenant, <uuid column>) keys. Local and distributed tables cannot be
// joined, so the referenced ids are read per tenant and looked up in the parent.
async function repairOrphanedReferences(knex, table, removable = []) {
  const fks = await knex.raw(
    `SELECT child.attname AS col, con.confrelid::regclass::text AS parent, parent.attname AS parent_col,
            con.confdeltype = 'c' AS cascades, NOT child.attnotnull AS nullable
       FROM pg_constraint con
       JOIN pg_attribute child ON child.attrelid = con.conrelid
        AND child.attnum = ANY (con.conkey) AND child.attname <> 'tenant'
       JOIN pg_attribute parent ON parent.attrelid = con.confrelid
        AND parent.attnum = con.confkey[array_position(con.conkey, child.attnum)]
      WHERE con.contype = 'f'
        AND con.conrelid = ?::regclass
        AND cardinality(con.conkey) = 2
        AND child.atttypid = 'uuid'::regtype
        AND EXISTS (SELECT 1 FROM pg_attribute t WHERE t.attrelid = con.conrelid
                     AND t.attnum = ANY (con.conkey) AND t.attname = 'tenant')
        AND EXISTS (SELECT 1 FROM pg_dist_partition p WHERE p.logicalrelid = con.confrelid)
      ORDER BY con.conname`,
    [table],
  );

  for (const { col, parent, parent_col: parentCol, cascades, nullable } of fks.rows) {
    const nullify = !cascades && nullable;
    const referenced = await knex.raw(
      'SELECT tenant, array_agg(DISTINCT ??) AS ids FROM ?? WHERE ?? IS NOT NULL GROUP BY tenant',
      [col, table, col],
    );
    let repaired = 0;
    for (const { tenant, ids } of referenced.rows) {
      const found = await knex.raw('SELECT ?? AS id FROM ?? WHERE tenant = ? AND ?? = ANY(?::uuid[])', [
        parentCol, parent, tenant, parentCol, ids,
      ]);
      const live = new Set(found.rows.map((row) => row.id));
      const missing = ids.filter((id) => !live.has(id));
      if (missing.length === 0) continue;
      if (!nullify && !cascades && !removable.includes(col)) {
        throw new Error(
          `${table}.${col} references ${missing.length} missing ${parent} row(s) for tenant ${tenant}, and its key has no delete action`,
        );
      }

      // Each batch commits on its own: the caller runs outside a transaction.
      const orphans = 'SELECT ctid FROM ?? WHERE tenant = ? AND ?? = ANY(?::uuid[]) LIMIT ?';
      const statement = nullify
        ? `UPDATE ?? SET ?? = NULL WHERE ctid = ANY (ARRAY(${orphans}))`
        : `DELETE FROM ?? WHERE ctid = ANY (ARRAY(${orphans}))`;
      const bindings = [...(nullify ? [table, col] : [table]), table, tenant, col, missing, ORPHAN_BATCH];
      for (;;) {
        const { rowCount } = await knex.raw(statement, bindings);
        repaired += rowCount;
        if (rowCount < ORPHAN_BATCH) break;
      }
    }
    if (repaired > 0) {
      console.log(`${table}.${col}: ${repaired} row(s) referenced a missing ${parent} row; ${nullify ? 'reference cleared' : 'removed'}`);
    }
  }
}

// Move tenant tables that were left coordinator-local onto the shards, next to
// an already-distributed table they join. A local table joined to distributed
// ones is recursively planned into a subplan shipped over a loopback
// connection, which fails whenever the coordinator is near max_connections.
//
// - `tables`: referenced tables before the tables that FK to them. Every
//   unique key must already lead with `tenant`.
// - `dropTriggers`: { table: [trigger, ...] }. Citus refuses to distribute a
//   table that has triggers; whatever a trigger did becomes the application's
//   job once the table is distributed, so audit the writers first.
// - `removeOrphans`: { table: [column, ...] }, see repairOrphanedReferences.
//
// All pending tables move in one transaction, so a failed attempt leaves every
// table local with its triggers in place. No-op on plain Postgres, when
// `colocateWith` is not distributed, and for tables already distributed.
async function distributeLocalTenantTables(knex, { tables, colocateWith, dropTriggers = {}, removeOrphans = {} }) {
  if (!(await hasCitus(knex))) return;
  if (!(await isDistributed(knex, colocateWith))) return;

  const present = [];
  for (const table of tables) {
    if (await knex.schema.hasTable(table)) present.push(table);
  }
  const pending = [];
  for (const table of present) {
    if (!(await isDistributed(knex, table))) pending.push(table);
  }

  for (const table of pending) await repairOrphanedReferences(knex, table, removeOrphans[table]);

  if (pending.length > 0) {
    await inLockBoundedTransaction(knex, async (trx) => {
      // The tenant colocation group reaches reference tables through FKs, so
      // Citus refuses the default parallel DDL (SET LOCAL resets on commit).
      await trx.raw("SET LOCAL citus.multi_shard_modify_mode TO 'sequential'");
      for (const table of pending) {
        for (const trigger of dropTriggers[table] ?? []) {
          await trx.raw('DROP TRIGGER IF EXISTS ?? ON ??', [trigger, table]);
        }
        await trx.raw("SELECT create_distributed_table(?, 'tenant', colocate_with => ?)", [table, colocateWith]);
      }
    });
  }

  // Rows that existed before distribution stay in the coordinator parent heap,
  // invisible to routed queries but in the way of later DDL. Referrers first;
  // a table something local still references keeps its heap rather than
  // cascade into that table.
  for (const table of [...present].reverse()) {
    const heap = await knex.raw('SELECT pg_relation_size(?::regclass) AS bytes', [table]);
    if (Number(heap.rows?.[0]?.bytes ?? 0) === 0) continue;
    const blockers = await localReferrers(knex, table);
    if (blockers.length > 0) {
      console.log(`${table}: skipping local-heap truncate; local referrers: ${blockers.join(', ')}`);
      continue;
    }
    await knex.raw('SELECT truncate_local_data_after_distributing_table(?::regclass)', [table]);
  }
}

module.exports = {
  canCreateDistributedTable,
  isDistributed,
  ensureTenantDistribution,
  inLockBoundedTransaction,
  distributeLocalTenantTables,
  hasCitus,
  hasConstraint,
  isFkCompatible,
  ensureCompositeFk,
  supportsTriggers,
};

/**
 * Convert standard_statuses from a per-tenant table into a global reference
 * catalog, matching every other standard_* table.
 *
 * Per-tenant copies are collapsed to one canonical row per (name, item_type);
 * rows referencing the removed duplicates are remapped before deletion.
 * In Citus deployments the table is already a reference table, so all DDL
 * here propagates without distribution changes.
 */

const STANDARD_STATUS_CATALOG = [
  { name: 'Planned', item_type: 'project', display_order: 1, is_closed: false, is_default: false },
  { name: 'In Progress', item_type: 'project', display_order: 2, is_closed: false, is_default: false },
  { name: 'On Hold', item_type: 'project', display_order: 3, is_closed: false, is_default: false },
  { name: 'Completed', item_type: 'project', display_order: 4, is_closed: true, is_default: false },
  { name: 'Cancelled', item_type: 'project', display_order: 5, is_closed: true, is_default: false },

  { name: 'To Do', item_type: 'project_task', display_order: 1, is_closed: false, is_default: false },
  { name: 'In Progress', item_type: 'project_task', display_order: 2, is_closed: false, is_default: false },
  { name: 'In Review', item_type: 'project_task', display_order: 3, is_closed: false, is_default: false },
  { name: 'Done', item_type: 'project_task', display_order: 4, is_closed: true, is_default: false },
  { name: 'Blocked', item_type: 'project_task', display_order: 5, is_closed: false, is_default: false },

  { name: 'Open', item_type: 'ticket', display_order: 1, is_closed: false, is_default: true },
  { name: 'In Progress', item_type: 'ticket', display_order: 2, is_closed: false, is_default: false },
  { name: 'Waiting for Customer', item_type: 'ticket', display_order: 3, is_closed: false, is_default: false },
  { name: 'Resolved', item_type: 'ticket', display_order: 4, is_closed: true, is_default: false },
  { name: 'Closed', item_type: 'ticket', display_order: 5, is_closed: true, is_default: false },

  { name: 'Planned', item_type: 'interaction', display_order: 1, is_closed: false, is_default: false },
  { name: 'In Progress', item_type: 'interaction', display_order: 2, is_closed: false, is_default: false },
  { name: 'Completed', item_type: 'interaction', display_order: 3, is_closed: true, is_default: true },
  { name: 'Cancelled', item_type: 'interaction', display_order: 4, is_closed: true, is_default: false },
];

const CANONICAL_MAP_SQL = `
  SELECT ss.standard_status_id AS old_id, m.canonical_id
  FROM standard_statuses ss
  JOIN (
    SELECT name, item_type, min(standard_status_id::text)::uuid AS canonical_id
    FROM standard_statuses
    GROUP BY name, item_type
  ) m ON m.name = ss.name AND m.item_type = ss.item_type
  WHERE ss.standard_status_id <> m.canonical_id
`;

async function recoverOrphanedProjectTaskMappings(knex) {
  const allStandardStatuses = await knex('standard_statuses').select('standard_status_id');
  const projectTaskStatuses = await knex('standard_statuses')
    .select('name', 'standard_status_id')
    .where({ item_type: 'project_task' });

  if (allStandardStatuses.length === 0 || projectTaskStatuses.length === 0) {
    return;
  }

  const caseClauses = [];
  const bindings = [];

  for (const status of projectTaskStatuses) {
    caseClauses.push('WHEN ? THEN ?::uuid');
    bindings.push(status.name, status.standard_status_id);
  }

  bindings.push(
    allStandardStatuses.map((status) => status.standard_status_id),
    projectTaskStatuses.map((status) => status.name),
  );

  // Keep the distributed UPDATE independent of standard_statuses. Citus rejects
  // this recovery step when the target table is distributed and the UPDATE also
  // reads the reference/local catalog in FROM or a correlated subquery.
  await knex.raw(`
    UPDATE project_status_mappings
    SET standard_status_id = CASE custom_name
      ${caseClauses.join('\n      ')}
      ELSE standard_status_id
    END
    WHERE is_standard = true
      AND standard_status_id IS NOT NULL
      AND NOT (standard_status_id = ANY(?::uuid[]))
      AND custom_name = ANY(?::text[])
  `, bindings);
}

// Inbound foreign keys into standard_statuses. After the distributed->reference
// conversion these become distributed->reference FKs (which Citus permits);
// rebuilt from this declarative list so a partially-applied run can self-heal.
const STANDARD_STATUS_INBOUND_FKS = [
  { table: 'statuses', constraint: 'statuses_standard_status_id_foreign' },
  { table: 'project_status_mappings', constraint: 'project_status_mappings_standard_status_id_foreign' },
];

async function isCitusEnabled(knex) {
  const res = await knex.raw(
    "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled"
  );
  return Boolean(res.rows?.[0]?.enabled);
}

async function isDistributed(knex, table) {
  const res = await knex.raw(
    `SELECT EXISTS (
       SELECT 1 FROM pg_dist_partition
       WHERE logicalrelid = ?::regclass AND partmethod <> 'n'
     ) AS distributed`,
    [table]
  );
  return Boolean(res.rows?.[0]?.distributed);
}

// Re-create standard_statuses' inbound foreign keys on standard_status_id when
// missing. Idempotent and unconditional: skips any child whose FK already exists
// (the common case on plain Postgres), and restores them where an earlier run
// dropped them during the distributed->reference conversion.
async function ensureStandardStatusForeignKeys(knex) {
  for (const fk of STANDARD_STATUS_INBOUND_FKS) {
    if (!(await knex.schema.hasTable(fk.table))) continue;
    if (!(await knex.schema.hasColumn(fk.table, 'standard_status_id'))) continue;

    const existing = await knex.raw(
      `SELECT 1 FROM pg_constraint
       WHERE conrelid = ?::regclass
         AND confrelid = 'standard_statuses'::regclass
         AND contype = 'f'
       LIMIT 1`,
      [fk.table]
    );
    if (existing.rows?.length) continue;

    await knex.raw(
      `ALTER TABLE ${fk.table} ADD CONSTRAINT "${fk.constraint}" ` +
      `FOREIGN KEY (standard_status_id) REFERENCES standard_statuses (standard_status_id)`
    );
  }
}

exports.config = { transaction: false };

exports.up = async function up(knex) {
  const onCitus = await isCitusEnabled(knex);
  if (onCitus) {
    // Undistribute and FK changes that touch reference tables must propagate one
    // shard at a time rather than in the default parallel mode.
    await knex.raw("SET citus.multi_shard_modify_mode TO 'sequential'");
  }

  const hasTenant = await knex.schema.hasColumn('standard_statuses', 'tenant');

  if (hasTenant) {
    await knex.raw('DROP POLICY IF EXISTS tenant_isolation_policy ON standard_statuses');
    await knex.raw('ALTER TABLE standard_statuses DISABLE ROW LEVEL SECURITY');

    await knex.raw(`
      UPDATE project_status_mappings psm
      SET standard_status_id = canon.canonical_id
      FROM (${CANONICAL_MAP_SQL}) canon
      WHERE psm.standard_status_id = canon.old_id
    `);

    if (await knex.schema.hasTable('project_template_status_mappings')) {
      await knex.raw(`
        UPDATE project_template_status_mappings ptsm
        SET status_id = canon.canonical_id
        FROM (${CANONICAL_MAP_SQL}) canon
        WHERE ptsm.status_id = canon.old_id
      `);
    }

    if (await knex.schema.hasColumn('statuses', 'standard_status_id')) {
      await knex.raw(`
        UPDATE statuses s
        SET standard_status_id = canon.canonical_id
        FROM (${CANONICAL_MAP_SQL}) canon
        WHERE s.standard_status_id = canon.old_id
      `);
    }

    await knex.raw(`
      DELETE FROM standard_statuses ss
      USING (
        SELECT name, item_type, min(standard_status_id::text)::uuid AS canonical_id
        FROM standard_statuses
        GROUP BY name, item_type
      ) m
      WHERE m.name = ss.name AND m.item_type = ss.item_type
        AND ss.standard_status_id <> m.canonical_id
    `);

    // Mappings left pointing at rows that no longer exist (e.g. removed by
    // tenant deletion before this migration) are recovered via custom_name.
    await recoverOrphanedProjectTaskMappings(knex);

    // standard_statuses is the last per-tenant standard_* catalog. In Citus it is
    // distributed on `tenant` while its sibling standard_* tables are reference
    // tables, and the distribution column cannot be dropped while the table is
    // distributed (Citus: "cannot execute ALTER TABLE command involving partition
    // column"). Undistribute it first, drop the column, then turn it into a
    // reference table so it matches every other standard_* catalog. On plain
    // Postgres these Citus steps are skipped and the table is altered in place.
    const wasDistributed = onCitus && (await isDistributed(knex, 'standard_statuses'));

    if (wasDistributed) {
      // Both inbound FKs (child -> standard_statuses) and standard_statuses' own
      // FKs (e.g. tenant -> tenants) block undistribute_table(); drop them first.
      // Inbound FKs are restored against the reference table below; the outbound
      // FKs referenced the tenant column and disappear together with it.
      const blockingFks = await knex.raw(`
        SELECT conrelid::regclass::text AS owner_table, conname
        FROM pg_constraint
        WHERE contype = 'f'
          AND (confrelid = 'standard_statuses'::regclass
               OR conrelid = 'standard_statuses'::regclass)
      `);
      for (const fk of blockingFks.rows ?? []) {
        await knex.raw(`ALTER TABLE ${fk.owner_table} DROP CONSTRAINT IF EXISTS "${fk.conname}"`);
      }

      await knex.raw("SELECT undistribute_table('standard_statuses')");
    }

    await knex.raw('ALTER TABLE standard_statuses DROP CONSTRAINT IF EXISTS standard_statuses_name_item_type_tenant_key');
    await knex.raw('ALTER TABLE standard_statuses DROP COLUMN tenant');
    await knex.raw(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'standard_statuses_name_item_type_key'
            AND conrelid = 'standard_statuses'::regclass
        ) THEN
          ALTER TABLE standard_statuses
            ADD CONSTRAINT standard_statuses_name_item_type_key UNIQUE (name, item_type);
        END IF;
      END
      $$
    `);

    if (wasDistributed) {
      // Reference tables are replicated to every node, so distributed children can
      // keep foreign keys into standard_statuses (matching the other standard_*).
      await knex.raw("SELECT create_reference_table('standard_statuses')");
    }
  }

  // Restore the catalog's inbound foreign keys. Runs unconditionally so an
  // environment where an earlier (partially-applied) run dropped them during the
  // distributed->reference conversion is self-healed; no-ops when they exist.
  await ensureStandardStatusForeignKeys(knex);

  await knex('standard_statuses')
    .insert(STANDARD_STATUS_CATALOG)
    .onConflict(['name', 'item_type'])
    .merge(['display_order', 'is_closed', 'is_default']);
};

exports.down = async function down(knex) {
  const hasTenant = await knex.schema.hasColumn('standard_statuses', 'tenant');
  if (!hasTenant) {
    // Per-tenant copies cannot be reconstructed; restore the old shape with
    // the global rows left as tenant-less seeds.
    await knex.raw('ALTER TABLE standard_statuses DROP CONSTRAINT IF EXISTS standard_statuses_name_item_type_key');
    await knex.raw('ALTER TABLE standard_statuses ADD COLUMN tenant uuid REFERENCES tenants (tenant)');
  }
};

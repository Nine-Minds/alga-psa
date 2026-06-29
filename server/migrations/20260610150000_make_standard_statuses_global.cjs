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

exports.config = { transaction: false };

exports.up = async function up(knex) {
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
    // tables; the distribution column cannot be dropped while the table is
    // distributed (Citus: "cannot execute ALTER TABLE command involving partition
    // column"). Undistribute first, drop the column, then redistribute it as a
    // reference table so it matches every other standard_* catalog. On plain
    // Postgres every Citus step below is skipped and the table is altered in place.
    const citusEnabled = await knex.raw(
      "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'citus') AS enabled"
    );
    const onCitus = Boolean(citusEnabled.rows?.[0]?.enabled);

    let wasDistributed = false;
    let inboundForeignKeys = [];

    if (onCitus) {
      const distRes = await knex.raw(`
        SELECT EXISTS (
          SELECT 1 FROM pg_dist_partition
          WHERE logicalrelid = 'standard_statuses'::regclass
            AND partmethod <> 'n'
        ) AS distributed
      `);
      wasDistributed = Boolean(distRes.rows?.[0]?.distributed);
    }

    if (wasDistributed) {
      // Inbound FKs from distributed tables (statuses, project_status_mappings, ...)
      // block undistribute_table(). Capture each one's column pairs so it can be
      // rebuilt against the reference table afterwards, dropping any `tenant` leg
      // (that column no longer exists once it is removed below).
      const inboundRes = await knex.raw(`
        SELECT
          con.conrelid::regclass::text AS child_table,
          con.conname AS conname,
          (SELECT array_agg(att.attname ORDER BY u.ord)
             FROM unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord)
             JOIN pg_attribute att
               ON att.attrelid = con.conrelid AND att.attnum = u.attnum) AS child_columns,
          (SELECT array_agg(att.attname ORDER BY u.ord)
             FROM unnest(con.confkey) WITH ORDINALITY AS u(attnum, ord)
             JOIN pg_attribute att
               ON att.attrelid = con.confrelid AND att.attnum = u.attnum) AS ref_columns
        FROM pg_constraint con
        WHERE con.confrelid = 'standard_statuses'::regclass
          AND con.contype = 'f'
      `);
      inboundForeignKeys = inboundRes.rows ?? [];

      for (const fk of inboundForeignKeys) {
        await knex.raw(`ALTER TABLE ${fk.child_table} DROP CONSTRAINT IF EXISTS "${fk.conname}"`);
      }

      // standard_statuses' own FKs (e.g. tenant -> tenants) reference the
      // distribution column and likewise obstruct undistribute_table(); they
      // disappear together with the column, so just drop them up front.
      const outboundRes = await knex.raw(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'standard_statuses'::regclass AND contype = 'f'
      `);
      for (const fk of outboundRes.rows ?? []) {
        await knex.raw(`ALTER TABLE standard_statuses DROP CONSTRAINT IF EXISTS "${fk.conname}"`);
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

      for (const fk of inboundForeignKeys) {
        const pairs = (fk.child_columns || [])
          .map((childCol, i) => ({ childCol, refCol: (fk.ref_columns || [])[i] }))
          .filter((pair) => pair.refCol && pair.refCol !== 'tenant');

        if (pairs.length === 0) {
          continue;
        }

        const childCols = pairs.map((p) => `"${p.childCol}"`).join(', ');
        const refCols = pairs.map((p) => `"${p.refCol}"`).join(', ');
        await knex.raw(
          `ALTER TABLE ${fk.child_table} ADD CONSTRAINT "${fk.conname}" ` +
          `FOREIGN KEY (${childCols}) REFERENCES standard_statuses (${refCols})`
        );
      }
    }
  }

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

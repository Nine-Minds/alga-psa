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

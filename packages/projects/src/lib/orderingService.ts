'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { generateKeyForPosition } from './orderingUtils';

function tenantScopedTable(
  conn: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  table: string,
  tenant: string,
) {
  return tenantDb(conn, tenant).table(table);
}

/**
 * Reorder a project task to a new position
 */
export const reorderProjectTask = withAuth(async (
  _user,
  { tenant },
  taskId: string,
  targetStatusId: string,
  beforeKey: string | null,
  afterKey: string | null
): Promise<string> => {
  const newKey = generateKeyForPosition(beforeKey, afterKey);

  const { knex: db } = await createTenantKnex();

  await tenantScopedTable(db, 'project_tasks', tenant)
    .where({ task_id: taskId })
    .update({
      project_status_mapping_id: targetStatusId,
      order_key: newKey,
      updated_at: db.fn.now(),
    });

  return newKey;
});

/**
 * Reorder a project phase to a new position
 */
export const reorderProjectPhase = withAuth(async (
  _user,
  { tenant },
  phaseId: string,
  beforeKey: string | null,
  afterKey: string | null
): Promise<string> => {
  const newKey = generateKeyForPosition(beforeKey, afterKey);

  const { knex: db } = await createTenantKnex();

  await tenantScopedTable(db, 'project_phases', tenant)
    .where({ phase_id: phaseId })
    .update({
      order_key: newKey,
      updated_at: db.fn.now(),
    });

  return newKey;
});

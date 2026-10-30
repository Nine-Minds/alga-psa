'use server'

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { assertMspPermission } from '../lib/authHelpers';

export interface ClientChecklistTemplateSummary {
  template_id: string;
  name: string;
  is_active: boolean;
  item_count: number;
}

/**
 * Read-only list of the checklist templates scoped to one client, for the client record's
 * "Checklists" tab. Editing happens in Settings > Ticketing > Checklist Templates.
 */
export const getClientChecklistTemplates = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientChecklistTemplateSummary[]> => {
  await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read clients');

  const { knex: db } = await createTenantKnex();
  const scopedDb = tenantDb(db, tenant);
  const templates = await scopedDb.table('checklist_templates')
    .where({ client_id: clientId })
    .orderBy('name', 'asc')
    .select('template_id', 'name', 'is_active') as Array<{ template_id: string; name: string; is_active: boolean }>;
  if (!templates.length) return [];

  const counts = await scopedDb.table('checklist_template_items')
    .whereIn('template_id', templates.map((t) => t.template_id))
    .groupBy('template_id')
    .select('template_id')
    .count('* as count') as Array<{ template_id: string; count: string | number }>;
  const countById = new Map(counts.map((c) => [c.template_id, Number(c.count)]));

  return templates.map((t) => ({ ...t, item_count: countById.get(t.template_id) ?? 0 }));
});

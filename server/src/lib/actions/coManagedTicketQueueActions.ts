'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedTicketQueue, exportCoManagedTicketQueue, type CoManagedTicketQueueRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { unparseCSV } from '../utils/csvParser';

export const getCoManagedTicketQueueAction = withAuth(async (user, { tenant }, request: CoManagedTicketQueueRequest) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketQueue(knex, actor, request);
});

export const exportCoManagedTicketQueueAction = withAuth(async (user, { tenant }, request: Omit<CoManagedTicketQueueRequest, 'page' | 'pageSize'>) => {
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const items = await exportCoManagedTicketQueue(knex, actor, request);
  // Stable machine-readable columns preserve ownership even when ticket numbers
  // collide. Unavailable fields stay blank; no enrichment bypasses queue scope.
  const fields = ['workspace_tenant', 'relationship_id', 'ticket_id', 'workspace_name', 'ticket_number', 'title', 'status_name', 'priority_name', 'is_closed', 'responsibility', 'entered_at', 'updated_at'];
  const rows = items.map(item => ({ workspace_tenant: item.tenant, relationship_id: item.relationshipId, ticket_id: item.ticketId, workspace_name: item.workspaceName, ...item.fields }));
  return { filename: `co-managed-${request.view}-tickets.csv`, csv: '\uFEFF' + unparseCSV(rows, fields), rowCount: rows.length };
});

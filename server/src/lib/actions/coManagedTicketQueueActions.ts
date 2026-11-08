'use server';

import { withAuth } from '@alga-psa/auth';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { createTenantKnex } from '@alga-psa/db';
import { getCoManagedTicketQueue, exportCoManagedTicketQueue, bulkHandBackCoManagedTickets, type CoManagedBulkHandbackRequest, type CoManagedTicketQueueRequest, type CoManagedWorkSignals } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { unparseCSV } from '../utils/csvParser';

export const getCoManagedTicketQueueAction = withAuth(async (user, { tenant }, request: CoManagedTicketQueueRequest) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return getCoManagedTicketQueue(knex, actor, request);
});

/**
 * The callout/badge read. It is the ordinary authorized queue read narrowed to
 * a one-row page, so counts carry the same authorization and redaction as the
 * list; only counts and the relationship tally leave the server, never rows.
 * Release-flag gating is presentation and lives in the callers, not here.
 */
export const getCoManagedWorkSignalsAction = withAuth(async (user, { tenant }, request: { clientId?: string } = {}): Promise<CoManagedWorkSignals> => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const page = await getCoManagedTicketQueue(knex, actor, { view: 'working', state: 'open', page: 1, pageSize: 1, ...(request?.clientId ? { clientId: request.clientId } : {}) });
  return { assignedRelationshipCount: page.assignedRelationshipCount, signals: page.signals };
});

export const bulkHandBackCoManagedTicketsAction = withAuth(async (user, { tenant }, request: CoManagedBulkHandbackRequest) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  return bulkHandBackCoManagedTickets(knex, actor, request);
});

export const exportCoManagedTicketQueueAction = withAuth(async (user, { tenant }, request: Omit<CoManagedTicketQueueRequest, 'page' | 'pageSize'>) => {
  await requireCapabilityForAction('co-managed', tenant, 'serves');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const items = await exportCoManagedTicketQueue(knex, actor, request);
  // Stable machine-readable columns preserve ownership even when ticket numbers
  // collide. Unavailable fields stay blank; no enrichment bypasses queue scope.
  const fields = ['workspace_tenant', 'relationship_id', 'ticket_id', 'workspace_name', 'ticket_number', 'title', 'status_name', 'priority_name', 'is_closed', 'responsibility', 'entered_at', 'updated_at'];
  const rows = items.map(item => ({ workspace_tenant: item.tenant, relationship_id: item.relationshipId, ticket_id: item.ticketId, workspace_name: item.workspaceName, ...item.fields }));
  return { filename: `co-managed-${request.view}-tickets.csv`, csv: '\uFEFF' + unparseCSV(rows, fields), rowCount: rows.length };
});

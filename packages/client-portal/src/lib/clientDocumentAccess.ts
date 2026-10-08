import { applyPublicCommentAttachmentFilter } from '@alga-psa/shared/lib/ticketCommentAttachments';
import type { IDocument, IUser } from '@alga-psa/types';
import type { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth';
import { tenantDb, type TenantDb } from '@alga-psa/db';
import { applyProjectVisibilityFilter, type ContactVisibilityContext } from '@alga-psa/authorization/portal/visibility';
import { getAuthenticatedPortalVisibility } from './clientAuth';

export type ClientDocumentVisibilitySource = 'direct' | 'ticket' | 'project' | 'contract';

const CLIENT_DOCUMENT_VISIBILITY_SOURCES: ClientDocumentVisibilitySource[] = ['direct', 'ticket', 'project', 'contract'];

export function getClientDocumentVisibilitySources(sourceType: 'all' | ClientDocumentVisibilitySource = 'all'): ClientDocumentVisibilitySource[] {
  return sourceType === 'all' ? CLIENT_DOCUMENT_VISIBILITY_SOURCES : CLIENT_DOCUMENT_VISIBILITY_SOURCES.includes(sourceType) ? [sourceType] : [];
}

function buildDirectAssociationQuery(scopedDb: TenantDb, clientId: string, documentAlias: string): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da').select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'client').andWhere('da.entity_id', clientId);
  return scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
}

function buildTicketAssociationQuery(scopedDb: TenantDb, clientId: string, documentAlias: string): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da').select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'ticket').andWhere('t.client_id', clientId);
  scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
  scopedDb.tenantJoin(query, 'tickets as t', 't.ticket_id', 'da.entity_id');
  return query;
}

function buildProjectAssociationQuery(scopedDb: TenantDb, visibility: ContactVisibilityContext, documentAlias: string): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da').select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'project_task');
  // Project-task documents follow project scope: under contact scope only
  // tasks of projects assigned to the user (or their reports) are readable.
  applyProjectVisibilityFilter(query, visibility, { clientColumn: 'p.client_id', contactColumn: 'p.contact_name_id' });
  scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
  scopedDb.tenantJoin(query, 'project_tasks as pt', 'pt.task_id', 'da.entity_id');
  scopedDb.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');
  scopedDb.tenantJoin(query, 'projects as p', 'p.project_id', 'pp.project_id');
  return query;
}

function buildContractAssociationQuery(scopedDb: TenantDb, clientId: string, documentAlias: string): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da').select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'contract')
    .andWhere(function (this: Knex.QueryBuilder) { this.whereNull('c.is_template').orWhere('c.is_template', false); })
    .andWhere('c.owner_client_id', clientId);
  scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
  scopedDb.tenantJoin(query, 'contracts as c', 'c.contract_id', 'da.entity_id');
  return query;
}

export function applyClientDocumentVisibilityFilter(
  query: Knex.QueryBuilder,
  scopedDb: TenantDb,
  visibility: ContactVisibilityContext,
  documentAlias: string,
  sources: ClientDocumentVisibilitySource[] = CLIENT_DOCUMENT_VISIBILITY_SOURCES
): Knex.QueryBuilder {
  const clientId = visibility.clientId;
  if (!sources.length) return query.whereRaw('FALSE');
  return query.where(function (this: Knex.QueryBuilder) {
    sources.forEach((source, index) => {
      const associationQuery = source === 'direct'
        ? buildDirectAssociationQuery(scopedDb, clientId, documentAlias)
        : source === 'ticket'
          ? buildTicketAssociationQuery(scopedDb, clientId, documentAlias)
          : source === 'project'
            ? buildProjectAssociationQuery(scopedDb, visibility, documentAlias)
            : buildContractAssociationQuery(scopedDb, clientId, documentAlias);
      if (index === 0) this.whereExists(associationQuery);
      else this.orWhereExists(associationQuery);
    });
  });
}

/** Resolve a document only when the authenticated client can see it in this tenant. */
export async function resolveClientPortalDocument(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documentId: string
): Promise<IDocument | null> {
  if (user.user_type !== 'client') throw new Error('Access denied: Client portal actions are restricted to client users');
  if (!documentId) throw new Error('documentId is required');

  const scopedDb = tenantDb(trx, tenant);
  const userRecord = await scopedDb.table('users')
    .select('user_id', 'email', 'user_type', 'is_inactive')
    .where({ user_id: user.user_id })
    .first();
  if (!userRecord || userRecord.user_type !== 'client' || userRecord.is_inactive) {
    throw new Error('Access denied: Client portal user is unavailable');
  }
  const permissionUser = { ...userRecord, tenant } as IUser;
  if (!await hasPermission(permissionUser, 'document', 'read', trx)) {
    throw new Error('Insufficient permissions to view documents');
  }

  const visibility = await getAuthenticatedPortalVisibility(trx, user.user_id, tenant);
  const query = scopedDb.table('documents as d').select('d.*')
    .where('d.document_id', documentId).andWhere('d.is_client_visible', true);
  applyClientDocumentVisibilityFilter(query, scopedDb, visibility, 'd');
  applyPublicCommentAttachmentFilter(query, trx, tenant, user.user_id);
  const document = await query.first();
  return document ? { ...document, file_size: document.file_size == null ? undefined : Number(document.file_size) } as IDocument : null;
}

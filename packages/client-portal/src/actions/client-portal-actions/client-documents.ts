'use server';

import { IDocument, IFolderNode } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { Knex } from 'knex';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { getConnection, withTransaction, tenantDb, type TenantDb } from '@alga-psa/db';
import { getAuthenticatedClientId } from '../../lib/clientAuth';

export interface ClientDocumentFilters {
  search?: string;
  sourceType?: 'all' | 'ticket' | 'project' | 'contract' | 'direct';
  startDate?: string;
  endDate?: string;
  folderPath?: string | null;
}

export interface PaginatedClientDocuments {
  documents: IDocument[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

type ClientDocumentVisibilitySource = Exclude<NonNullable<ClientDocumentFilters['sourceType']>, 'all'>;

const CLIENT_DOCUMENT_VISIBILITY_SOURCES: ClientDocumentVisibilitySource[] = [
  'direct',
  'ticket',
  'project',
  'contract',
];

function getClientDocumentVisibilitySources(
  sourceType: ClientDocumentFilters['sourceType'] = 'all'
): ClientDocumentVisibilitySource[] {
  if (sourceType === 'all') {
    return CLIENT_DOCUMENT_VISIBILITY_SOURCES;
  }

  return CLIENT_DOCUMENT_VISIBILITY_SOURCES.includes(sourceType as ClientDocumentVisibilitySource)
    ? [sourceType as ClientDocumentVisibilitySource]
    : [];
}

function buildDirectAssociationQuery(
  scopedDb: TenantDb,
  clientId: string,
  documentAlias: string
): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da')
    .select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'client')
    .andWhere('da.entity_id', clientId);

  return scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
}

function buildTicketAssociationQuery(
  scopedDb: TenantDb,
  clientId: string,
  documentAlias: string
): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da')
    .select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'ticket')
    .andWhere('t.client_id', clientId);

  scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
  scopedDb.tenantJoin(query, 'tickets as t', 't.ticket_id', 'da.entity_id');

  return query;
}

function buildProjectAssociationQuery(
  scopedDb: TenantDb,
  clientId: string,
  documentAlias: string
): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da')
    .select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'project_task')
    .andWhere('p.client_id', clientId);

  scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
  scopedDb.tenantJoin(query, 'project_tasks as pt', 'pt.task_id', 'da.entity_id');
  scopedDb.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id');
  scopedDb.tenantJoin(query, 'projects as p', 'p.project_id', 'pp.project_id');

  return query;
}

function buildContractAssociationQuery(
  scopedDb: TenantDb,
  clientId: string,
  documentAlias: string
): Knex.QueryBuilder {
  const query = scopedDb.table('document_associations as da')
    .select('da.document_id')
    .whereRaw('?? = ??', ['da.document_id', `${documentAlias}.document_id`])
    .andWhere('da.entity_type', 'contract')
    .andWhere(function (this: Knex.QueryBuilder) {
      this.whereNull('c.is_template').orWhere('c.is_template', false);
    })
    .andWhere('c.owner_client_id', clientId);

  scopedDb.tenantWhereColumn(query, 'da.tenant', `${documentAlias}.tenant`);
  scopedDb.tenantJoin(query, 'contracts as c', 'c.contract_id', 'da.entity_id');

  return query;
}

function buildClientDocumentAssociationQuery(
  scopedDb: TenantDb,
  clientId: string,
  documentAlias: string,
  source: ClientDocumentVisibilitySource
): Knex.QueryBuilder {
  switch (source) {
    case 'direct':
      return buildDirectAssociationQuery(scopedDb, clientId, documentAlias);
    case 'ticket':
      return buildTicketAssociationQuery(scopedDb, clientId, documentAlias);
    case 'project':
      return buildProjectAssociationQuery(scopedDb, clientId, documentAlias);
    case 'contract':
      return buildContractAssociationQuery(scopedDb, clientId, documentAlias);
  }
}

function applyClientDocumentVisibilityFilter(
  query: Knex.QueryBuilder,
  scopedDb: TenantDb,
  clientId: string,
  documentAlias: string,
  sources: ClientDocumentVisibilitySource[] = CLIENT_DOCUMENT_VISIBILITY_SOURCES
): Knex.QueryBuilder {
  if (sources.length === 0) {
    return query.whereRaw('FALSE');
  }

  return query.where(function (this: Knex.QueryBuilder) {
    sources.forEach((source, index) => {
      const associationQuery = buildClientDocumentAssociationQuery(scopedDb, clientId, documentAlias, source);

      if (index === 0) {
        this.whereExists(associationQuery);
      } else {
        this.orWhereExists(associationQuery);
      }
    });
  });
}

function buildClientOwnedContractFolderQuery(
  scopedDb: TenantDb,
  clientId: string
): Knex.QueryBuilder {
  const query = scopedDb.table('contracts as c')
    .select('c.contract_id')
    .whereRaw('?? = ??', ['c.contract_id', 'document_folders.entity_id'])
    .andWhere('document_folders.entity_type', 'contract')
    .andWhere(function (this: Knex.QueryBuilder) {
      this.whereNull('c.is_template').orWhere('c.is_template', false);
    })
    .andWhere('c.owner_client_id', clientId);

  return scopedDb.tenantWhereColumn(query, 'c.tenant', 'document_folders.tenant');
}

/**
 * Returns paginated client-visible documents for the authenticated client.
 * Aggregates across: direct client associations, client's tickets,
 * client's project tasks, and client's contracts.
 */
export const getClientDocuments = withAuth(
  async (
    user,
    { tenant },
    page: number = 1,
    pageSize: number = 20,
    filters: ClientDocumentFilters = {}
  ): Promise<PaginatedClientDocuments> => {
    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    // Cap pageSize to prevent excessive queries
    const effectivePageSize = Math.min(Math.max(pageSize, 1), 100);

    // Validate date formats if provided
    if (filters.startDate && isNaN(Date.parse(filters.startDate))) {
      throw new Error('Invalid startDate format. Use ISO 8601 (e.g. 2026-01-15)');
    }
    if (filters.endDate && isNaN(Date.parse(filters.endDate))) {
      throw new Error('Invalid endDate format. Use ISO 8601 (e.g. 2026-01-15)');
    }

    const db = await getConnection(tenant);

    // Fetch real user record for permission check instead of hardcoding is_inactive
    const userRecord = await tenantDb(db, tenant).table('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id })
      .first();
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: userRecord?.is_inactive ?? false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view documents');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const clientId = await getAuthenticatedClientId(trx, user.user_id, tenant);
      const scopedDb = tenantDb(trx, tenant);

      const baseQuery = scopedDb.table('documents as d')
        .distinct('d.*')
        .where('d.is_client_visible', true);

      applyClientDocumentVisibilityFilter(
        baseQuery,
        scopedDb,
        clientId,
        'd',
        getClientDocumentVisibilitySources(filters.sourceType)
      );

      // Wrap in subquery for filtering and pagination
      let query = trx
        .select('*')
        .from(trx.raw('(?) as base', [baseQuery]));

      // Apply filters
      if (filters.search) {
        query = query.whereRaw('LOWER(document_name) LIKE ?', [`%${filters.search.toLowerCase()}%`]);
      }

      if (filters.folderPath) {
        query = query.where('folder_path', filters.folderPath);
      }

      if (filters.startDate) {
        query = query.where('created_at', '>=', filters.startDate);
      }

      if (filters.endDate) {
        query = query.where('created_at', '<=', filters.endDate);
      }

      // Get total count
      const countQuery = query.clone().clearSelect().count('* as count').first();
      const countResult = (await countQuery) as { count: string } | undefined;
      const total = parseInt(countResult?.count ?? '0', 10);

      // Apply pagination
      const offset = (page - 1) * effectivePageSize;
      const documents = await query
        .orderBy('entered_at', 'desc')
        .limit(effectivePageSize)
        .offset(offset);

      return {
        documents: documents as IDocument[],
        total,
        page,
        pageSize: effectivePageSize,
        totalPages: Math.ceil(total / effectivePageSize),
      };
    });
  }
);

/**
 * Returns the folder tree of client-visible folders for the authenticated client.
 * Only includes folders that contain client-visible documents.
 */
export const getClientDocumentFolders = withAuth(
  async (user, { tenant }): Promise<IFolderNode[]> => {
    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    const db = await getConnection(tenant);

    const userRecord = await tenantDb(db, tenant).table('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id })
      .first();
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: userRecord?.is_inactive ?? false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view document folders');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const clientId = await getAuthenticatedClientId(trx, user.user_id, tenant);
      const scopedDb = tenantDb(trx, tenant);

      // Get folder paths from client-visible documents belonging to this client
      const docFolderPaths: Array<{ folder_path: string }> = await scopedDb.table<{ folder_path: string }>('documents as d')
        .distinct('folder_path')
        .where('d.is_client_visible', true)
        .whereNotNull('d.folder_path')
        .modify((query) => applyClientDocumentVisibilityFilter(query, scopedDb, clientId, 'd'));

      // Also get explicitly client-visible folders scoped to this client or one of the
      // client's owned contracts so portal navigation matches document visibility rules.
      const explicitFolders = await scopedDb.table<{ folder_path: string }>('document_folders')
        .distinct('folder_path')
        .where('is_client_visible', true)
        .where(function (this: Knex.QueryBuilder) {
          this.where(function (this: Knex.QueryBuilder) {
            this.where('entity_id', clientId).andWhere('entity_type', 'client');
          }).orWhereExists(buildClientOwnedContractFolderQuery(scopedDb, clientId));
        });

      const docPaths = docFolderPaths.map((r) => r.folder_path);
      const explicitPaths = explicitFolders.map((r) => r.folder_path);
      const allPaths = Array.from(new Set([...docPaths, ...explicitPaths])).filter(Boolean).sort();

      return buildFolderTreeFromPaths(allPaths);
    });
  }
);

/**
 * Verifies visibility and client ownership before allowing document download.
 * Returns the document if access is allowed, throws otherwise.
 */
export const downloadClientDocument = withAuth(
  async (user, { tenant }, documentId: string): Promise<IDocument> => {
    // Enforce client portal access only
    if (user.user_type !== 'client') {
      throw new Error('Access denied: Client portal actions are restricted to client users');
    }

    if (!documentId) {
      throw new Error('documentId is required');
    }

    const db = await getConnection(tenant);

    const userRecord = await tenantDb(db, tenant).table('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id })
      .first();
    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: userRecord?.is_inactive ?? false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to download documents');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const clientId = await getAuthenticatedClientId(trx, user.user_id, tenant);
      const scopedDb = tenantDb(trx, tenant);

      const documentQuery = scopedDb.table('documents as d')
        .select('d.*')
        .where('d.document_id', documentId)
        .andWhere('d.is_client_visible', true);

      applyClientDocumentVisibilityFilter(documentQuery, scopedDb, clientId, 'd');

      const document = await documentQuery.first();

      if (!document) {
        throw new Error('Document not found or access denied');
      }

      return document as unknown as IDocument;
    });
  }
);

/**
 * Build a folder tree from a list of folder paths.
 * Used internally for constructing the client-visible folder hierarchy.
 */
function buildFolderTreeFromPaths(paths: string[]): IFolderNode[] {
  const root: IFolderNode[] = [];
  const nodeMap = new Map<string, IFolderNode>();

  for (const path of paths) {
    if (!path) continue;

    const segments = path.split('/').filter(Boolean);
    let currentPath = '';

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${segment}` : `/${segment}`;

      if (nodeMap.has(currentPath)) {
        continue;
      }

      const node: IFolderNode = {
        name: segment,
        path: currentPath,
        children: [],
        documentCount: 0,
      };

      nodeMap.set(currentPath, node);

      if (parentPath) {
        const parent = nodeMap.get(parentPath);
        if (parent) {
          parent.children.push(node);
        }
      } else {
        // Top-level folder
        root.push(node);
      }
    }
  }

  return root;
}

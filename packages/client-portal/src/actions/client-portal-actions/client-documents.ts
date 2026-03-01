'use server';

import { IDocument, IFolderNode } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { Knex } from 'knex';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { getConnection, withTransaction } from '@alga-psa/db';

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

/**
 * Get the authenticated client user's client_id.
 * Reusable helper for all client document actions.
 */
async function getAuthenticatedClientId(
  trx: Knex.Transaction,
  userId: string,
  tenant: string
): Promise<string> {
  const userRecord = await trx('users')
    .where({
      user_id: userId,
      tenant: tenant,
    })
    .first();

  if (!userRecord?.contact_id) {
    throw new Error('User not associated with a contact');
  }

  const contact = await trx('contacts')
    .where({
      contact_name_id: userRecord.contact_id,
      tenant: tenant,
    })
    .first();

  if (!contact?.client_id) {
    throw new Error('Contact not associated with a client');
  }

  return contact.client_id;
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

    const db = await getConnection(tenant);

    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view documents');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const clientId = await getAuthenticatedClientId(trx, user.user_id, tenant);

      // Build base query for client-visible documents associated with this client
      // UNION of four sources: direct client association, tickets, project_tasks, contracts
      const baseQuery = trx.raw(
        `
        SELECT DISTINCT d.*
        FROM documents d
        WHERE d.tenant = ?
          AND d.is_client_visible = true
          AND (
            -- Direct client association
            EXISTS (
              SELECT 1 FROM document_associations da
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'client'
                AND da.entity_id = ?
            )
            -- Client's tickets
            OR EXISTS (
              SELECT 1 FROM document_associations da
              JOIN tickets t ON t.ticket_id = da.entity_id AND t.tenant = da.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'ticket'
                AND t.client_id = ?
            )
            -- Client's project tasks
            OR EXISTS (
              SELECT 1 FROM document_associations da
              JOIN project_tasks pt ON pt.project_task_id = da.entity_id AND pt.tenant = da.tenant
              JOIN projects p ON p.project_id = pt.project_id AND p.tenant = pt.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'project_task'
                AND p.client_id = ?
            )
            -- Client's contracts
            OR EXISTS (
              SELECT 1 FROM document_associations da
              JOIN billing_plans bp ON bp.plan_id = da.entity_id AND bp.tenant = da.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'contract'
                AND bp.company_id = ?
            )
          )
        `,
        [tenant, clientId, clientId, clientId, clientId]
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
      const offset = (page - 1) * pageSize;
      const documents = await query
        .orderBy('created_at', 'desc')
        .limit(pageSize)
        .offset(offset);

      return {
        documents: documents as IDocument[],
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
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

    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to view document folders');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const clientId = await getAuthenticatedClientId(trx, user.user_id, tenant);

      // Get all distinct folder paths from client-visible documents
      const folderPaths = await trx.raw(
        `
        SELECT DISTINCT d.folder_path
        FROM documents d
        WHERE d.tenant = ?
          AND d.is_client_visible = true
          AND d.folder_path IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM document_associations da
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'client'
                AND da.entity_id = ?
            )
            OR EXISTS (
              SELECT 1 FROM document_associations da
              JOIN tickets t ON t.ticket_id = da.entity_id AND t.tenant = da.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'ticket'
                AND t.client_id = ?
            )
            OR EXISTS (
              SELECT 1 FROM document_associations da
              JOIN project_tasks pt ON pt.project_task_id = da.entity_id AND pt.tenant = da.tenant
              JOIN projects p ON p.project_id = pt.project_id AND p.tenant = pt.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'project_task'
                AND p.client_id = ?
            )
            OR EXISTS (
              SELECT 1 FROM document_associations da
              JOIN billing_plans bp ON bp.plan_id = da.entity_id AND bp.tenant = da.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'contract'
                AND bp.company_id = ?
            )
          )
        ORDER BY folder_path
        `,
        [tenant, clientId, clientId, clientId, clientId]
      );

      const paths = (folderPaths.rows || []).map((r: { folder_path: string }) => r.folder_path);

      // Build folder tree from paths
      return buildFolderTreeFromPaths(paths);
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

    const userForPermission = {
      user_id: user.user_id,
      email: user.email,
      user_type: user.user_type,
      is_inactive: false,
      tenant,
    } as IUser;
    const canRead = await hasPermission(userForPermission, 'document', 'read', db);
    if (!canRead) {
      throw new Error('Insufficient permissions to download documents');
    }

    return withTransaction(db, async (trx: Knex.Transaction) => {
      const clientId = await getAuthenticatedClientId(trx, user.user_id, tenant);

      // Check document exists, is client-visible, and belongs to this client
      const document = await trx('documents as d')
        .select('d.*')
        .where('d.document_id', documentId)
        .andWhere('d.tenant', tenant)
        .andWhere('d.is_client_visible', true)
        .andWhere(function (this: Knex.QueryBuilder) {
          this.whereExists(
            trx('document_associations as da')
              .whereRaw('da.document_id = d.document_id')
              .andWhereRaw('da.tenant = d.tenant')
              .andWhere('da.entity_type', 'client')
              .andWhere('da.entity_id', clientId)
          )
            .orWhereExists(
              trx('document_associations as da')
                .join('tickets as t', function () {
                  this.on('t.ticket_id', '=', 'da.entity_id').andOn('t.tenant', '=', 'da.tenant');
                })
                .whereRaw('da.document_id = d.document_id')
                .andWhereRaw('da.tenant = d.tenant')
                .andWhere('da.entity_type', 'ticket')
                .andWhere('t.client_id', clientId)
            )
            .orWhereExists(
              trx('document_associations as da')
                .join('project_tasks as pt', function () {
                  this.on('pt.project_task_id', '=', 'da.entity_id').andOn('pt.tenant', '=', 'da.tenant');
                })
                .join('projects as p', function () {
                  this.on('p.project_id', '=', 'pt.project_id').andOn('p.tenant', '=', 'pt.tenant');
                })
                .whereRaw('da.document_id = d.document_id')
                .andWhereRaw('da.tenant = d.tenant')
                .andWhere('da.entity_type', 'project_task')
                .andWhere('p.client_id', clientId)
            )
            .orWhereExists(
              trx('document_associations as da')
                .join('billing_plans as bp', function () {
                  this.on('bp.plan_id', '=', 'da.entity_id').andOn('bp.tenant', '=', 'da.tenant');
                })
                .whereRaw('da.document_id = d.document_id')
                .andWhereRaw('da.tenant = d.tenant')
                .andWhere('da.entity_type', 'contract')
                .andWhere('bp.company_id', clientId)
            );
        })
        .first();

      if (!document) {
        throw new Error('Document not found or access denied');
      }

      return document as IDocument;
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

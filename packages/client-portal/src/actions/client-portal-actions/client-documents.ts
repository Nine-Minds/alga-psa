'use server';

import { IDocument, IFolderNode } from '@alga-psa/types';
import { IUser } from '@alga-psa/types';
import { Knex } from 'knex';
import { hasPermission, withAuth } from '@alga-psa/auth';
import { getConnection, withTransaction } from '@alga-psa/db';
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
    const userRecord = await db('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id, tenant })
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

      // Build source-type-specific EXISTS clauses based on filter
      const sourceType = filters.sourceType || 'all';
      const sourceClauses: string[] = [];
      const sourceParams: string[] = [];

      if (sourceType === 'all' || sourceType === 'direct') {
        sourceClauses.push(`
          EXISTS (
            SELECT 1 FROM document_associations da
            WHERE da.document_id = d.document_id
              AND da.tenant = d.tenant
              AND da.entity_type = 'client'
              AND da.entity_id = ?
          )
        `);
        sourceParams.push(clientId);
      }

      if (sourceType === 'all' || sourceType === 'ticket') {
        sourceClauses.push(`
          EXISTS (
            SELECT 1 FROM document_associations da
            JOIN tickets t ON t.ticket_id = da.entity_id AND t.tenant = da.tenant
            WHERE da.document_id = d.document_id
              AND da.tenant = d.tenant
              AND da.entity_type = 'ticket'
              AND t.client_id = ?
          )
        `);
        sourceParams.push(clientId);
      }

      if (sourceType === 'all' || sourceType === 'project') {
        sourceClauses.push(`
          EXISTS (
            SELECT 1 FROM document_associations da
            JOIN project_tasks pt ON pt.task_id = da.entity_id AND pt.tenant = da.tenant
            JOIN project_phases pp ON pp.phase_id = pt.phase_id AND pp.tenant = pt.tenant
            JOIN projects p ON p.project_id = pp.project_id AND p.tenant = pp.tenant
            WHERE da.document_id = d.document_id
              AND da.tenant = d.tenant
              AND da.entity_type = 'project_task'
              AND p.client_id = ?
          )
        `);
        sourceParams.push(clientId);
      }

      if (sourceType === 'all' || sourceType === 'contract') {
        sourceClauses.push(`
          EXISTS (
            SELECT 1 FROM document_associations da
            JOIN contracts c ON c.contract_id = da.entity_id AND c.tenant = da.tenant
            WHERE da.document_id = d.document_id
              AND da.tenant = d.tenant
              AND da.entity_type = 'contract'
              AND (c.is_template IS NULL OR c.is_template = false)
              AND c.owner_client_id = ?
          )
        `);
        sourceParams.push(clientId);
      }

      const sourceFilter = sourceClauses.length > 0
        ? `(${sourceClauses.join(' OR ')})`
        : 'FALSE';

      const baseQuery = trx.raw(
        `
        SELECT DISTINCT d.*
        FROM documents d
        WHERE d.tenant = ?
          AND d.is_client_visible = true
          AND ${sourceFilter}
        `,
        [tenant, ...sourceParams]
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

    const userRecord = await db('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id, tenant })
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

      // Get folder paths from client-visible documents belonging to this client
      const docFolderPaths = await trx.raw(
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
              JOIN project_tasks pt ON pt.task_id = da.entity_id AND pt.tenant = da.tenant
              JOIN project_phases pp ON pp.phase_id = pt.phase_id AND pp.tenant = pt.tenant
              JOIN projects p ON p.project_id = pp.project_id AND p.tenant = pp.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'project_task'
                AND p.client_id = ?
            )
            OR EXISTS (
              SELECT 1 FROM document_associations da
              JOIN contracts c ON c.contract_id = da.entity_id AND c.tenant = da.tenant
              WHERE da.document_id = d.document_id
                AND da.tenant = d.tenant
                AND da.entity_type = 'contract'
                AND (c.is_template IS NULL OR c.is_template = false)
                AND c.owner_client_id = ?
            )
          )
        `,
        [tenant, clientId, clientId, clientId, clientId]
      );

      // Also get explicitly client-visible folders scoped to this client
      const explicitFolders = await trx.raw(
        `
        SELECT DISTINCT folder_path
        FROM document_folders
        WHERE tenant = ?
          AND is_client_visible = true
          AND entity_id = ?
          AND entity_type = 'client'
        `,
        [tenant, clientId]
      );

      const docPaths = (docFolderPaths.rows || []).map((r: { folder_path: string }) => r.folder_path);
      const explicitPaths = (explicitFolders.rows || []).map((r: { folder_path: string }) => r.folder_path);
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

    const userRecord = await db('users')
      .select('user_id', 'email', 'user_type', 'is_inactive')
      .where({ user_id: user.user_id, tenant })
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
                  this.on('pt.task_id', '=', 'da.entity_id').andOn('pt.tenant', '=', 'da.tenant');
                })
                .join('project_phases as pp', function () {
                  this.on('pp.phase_id', '=', 'pt.phase_id').andOn('pp.tenant', '=', 'pt.tenant');
                })
                .join('projects as p', function () {
                  this.on('p.project_id', '=', 'pp.project_id').andOn('p.tenant', '=', 'pp.tenant');
                })
                .whereRaw('da.document_id = d.document_id')
                .andWhereRaw('da.tenant = d.tenant')
                .andWhere('da.entity_type', 'project_task')
                .andWhere('p.client_id', clientId)
            )
            .orWhereExists(
              trx('document_associations as da')
                .join('contracts as c', function () {
                  this.on('c.contract_id', '=', 'da.entity_id').andOn('c.tenant', '=', 'da.tenant');
                })
                .whereRaw('da.document_id = d.document_id')
                .andWhereRaw('da.tenant = d.tenant')
                .andWhere('da.entity_type', 'contract')
                .andWhere(function (this: Knex.QueryBuilder) {
                  this.whereNull('c.is_template').orWhere('c.is_template', false);
                })
                .andWhere('c.owner_client_id', clientId)
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

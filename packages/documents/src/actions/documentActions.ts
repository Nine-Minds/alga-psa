'use server'

import { StorageService } from '@alga-psa/storage/StorageService';
import { createTenantKnex } from '@alga-psa/db';
import { withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { Knex } from 'knex';
import { marked } from 'marked';
import { PDFDocument } from 'pdf-lib';
import { fromPath } from 'pdf2pic';
import puppeteer from 'puppeteer';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { CacheFactory } from '../cache/CacheFactory';

import DocumentAssociation from '@alga-psa/documents/models/documentAssociation';
import {
    IDocument,
    IDocumentType,
    ISharedDocumentType,
    IUser,
    DocumentFilters,
    PreviewResponse,
    DocumentInput,
    PaginatedDocumentsResponse,
    IFolderNode,
    IFolderStats,
    DeletionValidationResult
} from '@alga-psa/types';
import type { IDocumentAssociation, IDocumentAssociationInput, DocumentAssociationEntityType } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';
import { deleteFile } from './file-actions/fileActions';
import { NextResponse } from 'next/server';
import { deleteDocumentContent } from './documentContentActions';
import { deleteBlockContent } from './documentBlockContentActions';
import { deleteEntityWithValidation } from '@alga-psa/core';
import { deleteEntityTags } from '@alga-psa/tags/lib/tagCleanup';
import { DocumentHandlerRegistry } from '@alga-psa/documents/handlers/DocumentHandlerRegistry';
import { getEntityTypesForUser } from '../lib/documentPermissionUtils';
import { generateDocumentPreviews } from '../lib/documentPreviewGenerator';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildDocumentAssociatedPayload,
  buildDocumentDetachedPayload,
} from '@alga-psa/workflow-streams';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  BuiltinAuthorizationKernelProvider,
  BundleAuthorizationKernelProvider,
  RequestLocalAuthorizationCache,
  createAuthorizationKernel,
  type AuthorizationRecord,
  type AuthorizationSubject,
  type RelationshipRule,
} from 'server/src/lib/authorization/kernel';
import { resolveBundleNarrowingRulesForEvaluation } from 'server/src/lib/authorization/bundles/service';

async function loadSharp() {
  try {
    const mod = await import('sharp');
    return (mod as any).default ?? (mod as any);
  } catch (error) {
    throw new Error(
      `Failed to load optional dependency "sharp" (required for document previews). ` +
        `Ensure platform-specific sharp binaries are installed. Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function ensureEntityFoldersInitializedInternal(
  knex: Knex,
  tenant: string,
  entityId: string,
  entityType: string,
  createdBy: string | null | undefined
) {
  const existingFolders = await knex('document_folders')
    .where('tenant', tenant)
    .andWhere('entity_id', entityId)
    .andWhere('entity_type', entityType)
    .select('folder_path', 'folder_id');

  const existingPaths = new Set(existingFolders.map((folder: { folder_path: string }) => folder.folder_path));

  const defaults = await knex('document_default_folders')
    .where('tenant', tenant)
    .andWhere('entity_type', entityType)
    .select('folder_name', 'folder_path', 'is_client_visible', 'sort_order')
    .orderBy('sort_order', 'asc')
    .orderBy('folder_path', 'asc');

  if (defaults.length === 0) {
    return;
  }

  const pathToFolderId = new Map<string, string>();
  for (const folder of existingFolders as Array<{ folder_path: string; folder_id: string }>) {
    pathToFolderId.set(folder.folder_path, folder.folder_id);
  }

  const foldersToInsert = defaults
    .filter((item: { folder_path: string }) => !existingPaths.has(item.folder_path))
    .map((item: { folder_name: string; folder_path: string; is_client_visible: boolean }) => {
      const folderId = uuidv4();
      pathToFolderId.set(item.folder_path, folderId);

      const segments = item.folder_path.split('/').filter(Boolean);
      const parentPath = segments.length > 1 ? '/' + segments.slice(0, -1).join('/') : null;

      return {
        tenant,
        folder_id: folderId,
        folder_path: item.folder_path,
        folder_name: item.folder_name,
        parent_folder_id: parentPath ? pathToFolderId.get(parentPath) ?? null : null,
        entity_id: entityId,
        entity_type: entityType,
        is_client_visible: item.is_client_visible,
        created_by: createdBy ?? null,
      };
    });

  if (foldersToInsert.length > 0) {
    await knex('document_folders').insert(foldersToInsert);
  }
}

type UserWithOptionalRoles = IUser & { roles?: Array<{ role_id?: string } | string> };

interface DocumentAssociationRow {
  document_id: string;
  entity_id: string;
  entity_type: string;
}

interface DocumentAuthorizationInput {
  document_id: string;
  created_by?: string | null;
  is_client_visible?: boolean | null;
}

function extractRoleIdsFromUser(user: UserWithOptionalRoles): string[] {
  if (!Array.isArray(user.roles)) {
    return [];
  }

  return user.roles
    .map((role: { role_id?: string } | string) => {
      if (typeof role === 'string') {
        return role;
      }
      return typeof role?.role_id === 'string' ? role.role_id : null;
    })
    .filter((value: string | null): value is string => Boolean(value));
}

async function resolveAuthorizationSubjectForUser(
  trx: Knex.Transaction,
  tenant: string,
  user: UserWithOptionalRoles
): Promise<AuthorizationSubject> {
  let roleIds = extractRoleIdsFromUser(user);
  if (roleIds.length === 0) {
    try {
      const roleRows = await trx('user_roles')
        .where({ tenant, user_id: user.user_id })
        .select<{ role_id: string }[]>('role_id');
      roleIds = roleRows.map((row) => row.role_id);
    } catch {
      roleIds = [];
    }
  }

  let teamRows: Array<{ team_id: string }> = [];
  let managedRows: Array<{ user_id: string }> = [];
  try {
    teamRows = await trx('team_members')
      .where({ tenant, user_id: user.user_id })
      .select<{ team_id: string }[]>('team_id');
  } catch {
    teamRows = [];
  }
  try {
    managedRows = await trx('users')
      .where({ tenant, reports_to: user.user_id })
      .select<{ user_id: string }[]>('user_id');
  } catch {
    managedRows = [];
  }

  return {
    tenant,
    userId: user.user_id,
    userType: user.user_type,
    roleIds,
    teamIds: teamRows.map((row) => row.team_id),
    managedUserIds: managedRows.map((row) => row.user_id),
    clientId: user.clientId ?? null,
    portfolioClientIds: user.clientId ? [user.clientId] : [],
  };
}

function applyDocumentRedactions<T extends object>(document: T, redactedFields: string[]): T {
  if (redactedFields.length === 0) {
    return document;
  }

  const redacted = { ...document } as Record<string, unknown>;
  for (const field of redactedFields) {
    delete redacted[field];
  }
  return redacted as T;
}

function getDocumentBuiltinRelationshipRules(user: IUser): RelationshipRule[] {
  if (user.user_type !== 'client') {
    return [];
  }

  return [{ template: 'own' }, { template: 'same_client' }];
}

async function resolveDocumentAuthorizationRecords(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: DocumentAuthorizationInput[]
): Promise<Map<string, AuthorizationRecord>> {
  const documentIds = documents.map((doc) => doc.document_id);
  const records = new Map<string, AuthorizationRecord>();
  if (documentIds.length === 0) {
    return records;
  }

  const associations = await trx('document_associations')
    .where({ tenant })
    .whereIn('document_id', documentIds)
    .select<DocumentAssociationRow[]>('document_id', 'entity_id', 'entity_type');

  const associationByDocument = new Map<string, DocumentAssociationRow[]>();
  for (const association of associations) {
    const existing = associationByDocument.get(association.document_id) ?? [];
    existing.push(association);
    associationByDocument.set(association.document_id, existing);
  }

  const contactIds = new Set<string>();
  const ticketIds = new Set<string>();
  const projectTaskIds = new Set<string>();
  const contractIds = new Set<string>();

  for (const association of associations) {
    if (association.entity_type === 'contact') {
      contactIds.add(association.entity_id);
    }
    if (association.entity_type === 'ticket') {
      ticketIds.add(association.entity_id);
    }
    if (association.entity_type === 'project_task') {
      projectTaskIds.add(association.entity_id);
    }
    if (association.entity_type === 'contract') {
      contractIds.add(association.entity_id);
    }
  }

  const [contactClientRows, ticketClientRows, projectTaskClientRows, contractClientRows] = await Promise.all([
    contactIds.size > 0
      ? trx('contacts')
          .where({ tenant })
          .whereIn('contact_name_id', Array.from(contactIds))
          .select<{ contact_name_id: string; client_id: string | null }[]>('contact_name_id', 'client_id')
      : Promise.resolve([]),
    ticketIds.size > 0
      ? trx('tickets')
          .where({ tenant })
          .whereIn('ticket_id', Array.from(ticketIds))
          .select<{ ticket_id: string; client_id: string | null }[]>('ticket_id', 'client_id')
      : Promise.resolve([]),
    projectTaskIds.size > 0
      ? trx('project_tasks as pt')
          .join('project_phases as pp', function joinPhases() {
            this.on('pt.phase_id', '=', 'pp.phase_id').andOn('pt.tenant', '=', 'pp.tenant');
          })
          .join('projects as p', function joinProjects() {
            this.on('pp.project_id', '=', 'p.project_id').andOn('pp.tenant', '=', 'p.tenant');
          })
          .where('pt.tenant', tenant)
          .whereIn('pt.task_id', Array.from(projectTaskIds))
          .select<{ task_id: string; client_id: string | null }[]>('pt.task_id', 'p.client_id')
      : Promise.resolve([]),
    contractIds.size > 0
      ? trx('billing_plans')
          .where({ tenant })
          .whereIn('plan_id', Array.from(contractIds))
          .select<{ plan_id: string; company_id: string | null }[]>('plan_id', 'company_id')
      : Promise.resolve([]),
  ]);

  const contactClientById = new Map<string, string | null>();
  for (const row of contactClientRows) {
    contactClientById.set(row.contact_name_id, row.client_id ?? null);
  }
  const ticketClientById = new Map<string, string | null>();
  for (const row of ticketClientRows) {
    ticketClientById.set(row.ticket_id, row.client_id ?? null);
  }
  const projectTaskClientById = new Map<string, string | null>();
  for (const row of projectTaskClientRows) {
    projectTaskClientById.set(row.task_id, row.client_id ?? null);
  }
  const contractClientById = new Map<string, string | null>();
  for (const row of contractClientRows) {
    contractClientById.set(row.plan_id, row.company_id ?? null);
  }

  for (const document of documents) {
    const documentAssociations = associationByDocument.get(document.document_id) ?? [];
    const directClientAssociation = documentAssociations.find((association) => association.entity_type === 'client');
    const userAssociations = documentAssociations.filter((association) => association.entity_type === 'user');
    const teamAssociations = documentAssociations.filter((association) => association.entity_type === 'team');
    const contactAssociations = documentAssociations.filter((association) => association.entity_type === 'contact');
    const ticketAssociations = documentAssociations.filter((association) => association.entity_type === 'ticket');
    const projectTaskAssociations = documentAssociations.filter((association) => association.entity_type === 'project_task');
    const contractAssociations = documentAssociations.filter((association) => association.entity_type === 'contract');

    const ownerFromUserAssociation = userAssociations[0]?.entity_id ?? null;
    const ownerViaContactMatch =
      user.contact_id && contactAssociations.some((association) => association.entity_id === user.contact_id)
        ? user.user_id
        : null;

    const clientFromContact =
      contactAssociations
        .map((association) => contactClientById.get(association.entity_id))
        .find((clientId): clientId is string => typeof clientId === 'string') ?? null;
    const clientFromTicket =
      ticketAssociations
        .map((association) => ticketClientById.get(association.entity_id))
        .find((clientId): clientId is string => typeof clientId === 'string') ?? null;
    const clientFromTask =
      projectTaskAssociations
        .map((association) => projectTaskClientById.get(association.entity_id))
        .find((clientId): clientId is string => typeof clientId === 'string') ?? null;
    const clientFromContract =
      contractAssociations
        .map((association) => contractClientById.get(association.entity_id))
        .find((clientId): clientId is string => typeof clientId === 'string') ?? null;

    const clientId =
      directClientAssociation?.entity_id ??
      clientFromContact ??
      clientFromTicket ??
      clientFromTask ??
      clientFromContract ??
      null;

    records.set(document.document_id, {
      id: document.document_id,
      ownerUserId: ownerFromUserAssociation ?? ownerViaContactMatch ?? document.created_by ?? null,
      assignedUserIds: Array.from(new Set(userAssociations.map((association) => association.entity_id))),
      clientId,
      teamIds: Array.from(new Set(teamAssociations.map((association) => association.entity_id))),
      is_client_visible: document.is_client_visible === true,
    });
  }

  return records;
}

export async function authorizeAndRedactDocuments<T extends IDocument>(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  documents: T[]
): Promise<T[]> {
  if (documents.length === 0) {
    return [];
  }

  const authorizationSubject = await resolveAuthorizationSubjectForUser(trx, tenant, user as UserWithOptionalRoles);
  const relationshipRules = getDocumentBuiltinRelationshipRules(user);
  const selectedClientIds = user.clientId ? [user.clientId] : undefined;
  const authorizationKernel = createAuthorizationKernel({
    builtinProvider: new BuiltinAuthorizationKernelProvider({
      relationshipRules,
    }),
    bundleProvider: new BundleAuthorizationKernelProvider({
      resolveRules: async (input) => {
        try {
          return await resolveBundleNarrowingRulesForEvaluation(trx, input);
        } catch {
          return [];
        }
      },
    }),
    rbacEvaluator: async () => true,
  });
  const requestCache = new RequestLocalAuthorizationCache();
  const authorizationRecords = await resolveDocumentAuthorizationRecords(
    trx,
    tenant,
    user,
    documents.map((document) => ({
      document_id: document.document_id,
      created_by: document.created_by,
      is_client_visible: document.is_client_visible,
    }))
  );

  const decisions = await Promise.all(
    documents.map(async (document) => {
      const record = authorizationRecords.get(document.document_id) ?? {
        id: document.document_id,
        ownerUserId: document.created_by ?? null,
        is_client_visible: document.is_client_visible === true,
      };

      const decision = await authorizationKernel.authorizeResource({
        subject: authorizationSubject,
        resource: {
          type: 'document',
          action: 'read',
          id: document.document_id,
        },
        record,
        selectedClientIds,
        requestCache,
        knex: trx,
      });

      const isClientVisible = record.is_client_visible === true;
      const isOwnedBySubject = record.ownerUserId === authorizationSubject.userId;
      const deniedByClientVisibility =
        user.user_type === 'client' && !isOwnedBySubject && !isClientVisible;
      const allowed = decision.allowed && !deniedByClientVisibility;

      return {
        allowed,
        redactedFields: decision.redactedFields,
      };
    })
  );

  const authorizedDocuments: T[] = [];
  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const decision = decisions[index];
    if (!document || !decision?.allowed) {
      continue;
    }
    authorizedDocuments.push(applyDocumentRedactions(document, decision.redactedFields));
  }

  return authorizedDocuments;
}

export async function getAuthorizedDocumentByFileId(
  trx: Knex.Transaction,
  tenant: string,
  user: IUser,
  fileId: string
): Promise<IDocument | null> {
  const document = await trx('documents')
    .where({ tenant, file_id: fileId })
    .first();

  if (!document) {
    return null;
  }

  const [authorizedDocument] = await authorizeAndRedactDocuments(trx, tenant, user, [document as IDocument]);
  return authorizedDocument ?? null;
}

function mapDocumentRowToDocument(doc: any): IDocument {
  return {
    document_id: doc.document_id,
    document_name: doc.document_name,
    type_id: doc.type_id,
    shared_type_id: doc.shared_type_id,
    user_id: doc.user_id ?? doc.created_by,
    order_number: doc.order_number || 0,
    created_by: doc.created_by,
    tenant: doc.tenant,
    file_id: doc.file_id,
    storage_path: doc.storage_path,
    mime_type: doc.mime_type,
    file_size: doc.file_size,
    is_client_visible: doc.is_client_visible,
    created_by_full_name: doc.created_by_full_name,
    type_name: doc.type_name,
    type_icon: doc.type_icon,
    entered_at: doc.entered_at,
    updated_at: doc.updated_at,
    edited_by: doc.edited_by,
    thumbnail_file_id: doc.thumbnail_file_id,
    preview_file_id: doc.preview_file_id,
    preview_generated_at: doc.preview_generated_at,
    folder_path: doc.folder_path,
  };
}

async function paginateAuthorizedDocuments(input: {
  trx: Knex.Transaction;
  tenant: string;
  user: IUser;
  page: number;
  limit: number;
  scanLimit?: number;
  fetchPage: (page: number, limit: number) => Promise<any[]>;
}): Promise<PaginatedDocumentsResponse> {
  const requestedPage = Number.isFinite(input.page) && input.page > 0 ? Math.floor(input.page) : 1;
  const requestedLimit = Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : 15;
  const scanLimit = Math.max(1, input.scanLimit ?? requestedLimit);
  const pageOffset = (requestedPage - 1) * requestedLimit;
  const pageUpperBoundExclusive = pageOffset + requestedLimit;

  const authorizedDocumentsForPage: IDocument[] = [];
  let authorizedTotalCount = 0;
  let sourcePage = 1;

  for (;;) {
    const rows = await input.fetchPage(sourcePage, scanLimit);
    if (!Array.isArray(rows) || rows.length === 0) {
      break;
    }

    const authorizedBatch = await authorizeAndRedactDocuments(
      input.trx,
      input.tenant,
      input.user,
      rows.map(mapDocumentRowToDocument)
    );

    for (const document of authorizedBatch) {
      if (
        authorizedTotalCount >= pageOffset &&
        authorizedTotalCount < pageUpperBoundExclusive
      ) {
        authorizedDocumentsForPage.push(document);
      }
      authorizedTotalCount += 1;
    }

    if (rows.length < scanLimit) {
      break;
    }

    sourcePage += 1;
  }

  return {
    documents: authorizedDocumentsForPage,
    totalCount: authorizedTotalCount,
    currentPage: requestedPage,
    totalPages: Math.ceil(authorizedTotalCount / requestedLimit),
  };
}

// Add new document
export const addDocument = withAuth(async (user, { tenant }, data: DocumentInput) => {
  try {
    const { knex } = await createTenantKnex();

    // Check permission for document creation
    if (!await hasPermission(user, 'document', 'create')) {
      return permissionError('Permission denied: Cannot create documents');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documentId = uuidv4();

      // Clean up the data - replace empty strings with proper values
      const cleanedData = {
        ...data,
        user_id: data.user_id || user.user_id,
        created_by: data.created_by || user.user_id,
        tenant: tenant
      };

      // Remove empty string values that should be null
      if (cleanedData.user_id === '') {
        cleanedData.user_id = user.user_id;
      }
      if (cleanedData.created_by === '') {
        cleanedData.created_by = user.user_id;
      }

      const new_document: IDocument = {
        ...cleanedData,
        document_id: documentId
      };

      console.log('Adding document:', new_document);
      await trx('documents').insert(new_document);

      return { _id: new_document.document_id };
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
});

// Update document
export const updateDocument = withAuth(async (user, { tenant }, documentId: string, data: Partial<IDocument>) => {
  try {
    // Check permission for document updates
    if (!await hasPermission(user, 'document', 'update')) {
      return permissionError('Permission denied: Cannot update documents');
    }

    const { knex } = await createTenantKnex();

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      await trx('documents')
        .where({ document_id: documentId, tenant })
        .update({
          ...data,
          updated_at: new Date()
        });
    });

    // Invalidate the preview cache for this document if it exists
    const cache = CacheFactory.getPreviewCache(tenant);
    await cache.delete(documentId);
    console.log(`[updateDocument] Invalidated preview cache for document ${documentId}`);
  } catch (error) {
    console.error(error);
    throw new Error("Failed to update the document");
  }
});

// Delete document
export const deleteDocument = withAuth(async (
  user,
  { tenant },
  documentId: string,
  userId: string
): Promise<DeletionValidationResult & { success: boolean; deleted?: boolean }> => {
  let detachedAssociations: Array<{
    associationId: string;
    documentId: string;
    entityId: string;
    entityType: string;
  }> = [];
  let deletedDocument: any | null = null;

  try {
    const { knex } = await createTenantKnex();
    const result = await deleteEntityWithValidation('document', documentId, knex, tenant, async (trx, tenantId) => {
      const document = await trx('documents')
        .where({ document_id: documentId, tenant: tenantId })
        .first();
      if (!document) {
        throw new Error('Document not found');
      }

      await deleteEntityTags(trx, documentId, 'document');

      await trx('clients')
        .where({
          notes_document_id: documentId,
          tenant: tenantId
        })
        .update({
          notes_document_id: null
        });

      await trx('assets')
        .where({
          notes_document_id: documentId,
          tenant: tenantId
        })
        .update({
          notes_document_id: null
        });

      await trx('contacts')
        .where({
          notes_document_id: documentId,
          tenant: tenantId
        })
        .update({
          notes_document_id: null
        });

      const existingAssociations = await trx('document_associations')
        .where({ document_id: document.document_id, tenant: tenantId })
        .select('association_id', 'document_id', 'entity_id', 'entity_type');

      detachedAssociations = existingAssociations.map((row: any) => ({
        associationId: row.association_id,
        documentId: row.document_id,
        entityId: row.entity_id,
        entityType: row.entity_type,
      }));

      await DocumentAssociation.deleteByDocument(trx, document.document_id);
      await trx('documents').where({ document_id: documentId, tenant: tenantId }).delete();
      deletedDocument = document;
    });

    if (!result.deleted || !deletedDocument) {
      return {
        ...result,
        success: result.deleted === true,
        deleted: result.deleted
      };
    }

    if (detachedAssociations.length > 0) {
      const occurredAt = new Date().toISOString();
      await Promise.all(
        detachedAssociations.map(async (association) => {
          try {
            await publishWorkflowEvent({
              eventType: 'DOCUMENT_DETACHED',
              payload: buildDocumentDetachedPayload({
                documentId: association.documentId,
                entityType: association.entityType,
                entityId: association.entityId,
                detachedByUserId: user.user_id,
                detachedAt: occurredAt,
                reason: 'document_deleted',
              }),
              ctx: {
                tenantId: tenant,
                occurredAt,
                actor: { actorType: 'USER', actorUserId: user.user_id },
              },
              idempotencyKey: `document_detached:${association.associationId}`,
            });
          } catch (eventError) {
            console.error('[deleteDocument] Failed to publish DOCUMENT_DETACHED workflow event:', eventError);
          }
        })
      );
    }

    const filesToDelete: string[] = [];

    if (deletedDocument.file_id) {
      filesToDelete.push(deletedDocument.file_id);
    }

    if (deletedDocument.thumbnail_file_id) {
      filesToDelete.push(deletedDocument.thumbnail_file_id);
    }

    if (deletedDocument.preview_file_id) {
      filesToDelete.push(deletedDocument.preview_file_id);
    }

    if (filesToDelete.length > 0) {
      console.log(`[deleteDocument] Deleting ${filesToDelete.length} files for document ${documentId}`);

      const deletePromises = filesToDelete.map(async (fileId) => {
        try {
          const deleteResult = await deleteFile(fileId, userId);
          if (!deleteResult.success) {
            console.error(`[deleteDocument] Failed to delete file ${fileId}:`, deleteResult.error);
          }
        } catch (error) {
          console.error(`[deleteDocument] Error deleting file ${fileId}:`, error);
        }
      });

      await Promise.all(deletePromises);

      const cache = CacheFactory.getPreviewCache(tenant);
      await cache.delete(deletedDocument.file_id);
    }

    await Promise.all([
      deleteDocumentContent(documentId),
      deleteBlockContent(documentId)
    ]);

    return {
      ...result,
      success: true,
      deleted: true
    };
  } catch (error) {
    console.error('Error deleting document:', error);
    return {
      success: false,
      canDelete: false,
      code: 'VALIDATION_FAILED',
      message: error instanceof Error ? error.message : 'Failed to delete the document',
      dependencies: [],
      alternatives: []
    };
  }
});

// Get single document
export const getDocument = withAuth(async (user, { tenant }, documentId: string) => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    // Use direct query to join with users table
    const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('documents')
        .select(
          'documents.*',
          'users.first_name',
          'users.last_name',
          trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
          trx.raw(`
            COALESCE(dt.type_name, sdt.type_name) as type_name,
            COALESCE(dt.icon, sdt.icon) as type_icon
          `)
        )
        .leftJoin('users', function() {
          this.on('documents.created_by', '=', 'users.user_id')
              .andOn('users.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('document_types as dt', function() {
          this.on('documents.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
        .where({
          'documents.document_id': documentId,
          'documents.tenant': tenant
        })
        .first();
    });

    if (!document) {
      return null;
    }

    // Process the document to match IDocument interface
    const processedDoc: IDocument = {
      document_id: document.document_id,
      document_name: document.document_name,
      type_id: document.type_id,
      shared_type_id: document.shared_type_id,
      user_id: document.user_id,
      order_number: document.order_number || 0,
      created_by: document.created_by,
      tenant: document.tenant,
      file_id: document.file_id,
      storage_path: document.storage_path,
      mime_type: document.mime_type,
      file_size: document.file_size,
      is_client_visible: document.is_client_visible,
      created_by_full_name: document.created_by_full_name,
      type_name: document.type_name,
      type_icon: document.type_icon,
      entered_at: document.entered_at,
      updated_at: document.updated_at,
      edited_by: document.edited_by
    };

    const [authorizedDocument] = await withTransaction(knex, async (trx: Knex.Transaction) =>
      authorizeAndRedactDocuments(trx, tenant, user, [processedDoc])
    );

    if (!authorizedDocument) {
      return permissionError('Permission denied: Cannot read documents');
    }

    return authorizedDocument;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the document");
  }
});

// Get documents by ticket
export const getDocumentByTicketId = withAuth(async (user, { tenant }, ticketId: string) => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documents = await trx('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('documents.tenant', '=', 'document_associations.tenant');
        })
        .leftJoin('users', function() {
          this.on('documents.created_by', '=', 'users.user_id')
              .andOn('users.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('document_types as dt', function() {
          this.on('documents.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
        .where({
          'document_associations.entity_id': ticketId,
          'document_associations.entity_type': 'ticket',
          'documents.tenant': tenant,
          'document_associations.tenant': tenant
        })
        .select(
          'documents.*',
          'users.first_name',
          'users.last_name',
          trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
          trx.raw(`
            COALESCE(dt.type_name, sdt.type_name) as type_name,
            COALESCE(dt.icon, sdt.icon) as type_icon
          `)
        )
        .orderBy('documents.updated_at', 'desc');
      return authorizeAndRedactDocuments(trx, tenant, user, documents as IDocument[]);
    });
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
});

// Get documents by client
export const getDocumentByClientId = withAuth(async (user, { tenant }, clientId: string) => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documents = await trx('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('documents.tenant', '=', 'document_associations.tenant');
        })
        .leftJoin('users', function() {
          this.on('documents.created_by', '=', 'users.user_id')
              .andOn('users.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('document_types as dt', function() {
          this.on('documents.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
        .where({
          'document_associations.entity_id': clientId,
          'document_associations.entity_type': 'client',
          'documents.tenant': tenant,
          'document_associations.tenant': tenant
        })
        .select(
          'documents.*',
          'users.first_name',
          'users.last_name',
          trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
          trx.raw(`
            COALESCE(dt.type_name, sdt.type_name) as type_name,
            COALESCE(dt.icon, sdt.icon) as type_icon
          `)
        )
        .orderBy('documents.updated_at', 'desc');
      return authorizeAndRedactDocuments(trx, tenant, user, documents as IDocument[]);
    });
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
});

export const associateDocumentWithClient = withAuth(async (user, { tenant }, input: IDocumentAssociationInput) => {
  try {
    if (!await hasPermission(user, 'document', 'create')) {
      return permissionError('Permission denied: Cannot associate documents');
    }

    if (!await hasPermission(user, 'client', 'update')) {
      return permissionError('Permission denied: Cannot modify client documents');
    }

    const { knex } = await createTenantKnex();

    const created = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const association = await DocumentAssociation.create(trx, {
        ...input,
        entity_type: 'client',
        tenant
      });

      return association;
    });

    try {
      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'DOCUMENT_ASSOCIATED',
        payload: buildDocumentAssociatedPayload({
          documentId: input.document_id,
          entityType: 'client',
          entityId: input.entity_id,
          associatedByUserId: user.user_id,
          associatedAt: occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: user.user_id },
        },
        idempotencyKey: `document_associated:${created.association_id}`,
      });
    } catch (eventError) {
      console.error('[associateDocumentWithClient] Failed to publish DOCUMENT_ASSOCIATED workflow event:', eventError);
    }

    return created;
  } catch (error) {
    console.error('Error associating document with client:', error);
    throw new Error('Failed to associate document with client');
  }
});

// Get documents by contact
export const getDocumentByContactNameId = withAuth(async (user, { tenant }, contactNameId: string) => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documents = await trx('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('documents.tenant', '=', 'document_associations.tenant');
        })
        .leftJoin('users', function() {
          this.on('documents.created_by', '=', 'users.user_id')
              .andOn('users.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('document_types as dt', function() {
          this.on('documents.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
        .where({
          'document_associations.entity_id': contactNameId,
          'document_associations.entity_type': 'contact',
          'documents.tenant': tenant,
          'document_associations.tenant': tenant
        })
        .select(
          'documents.*',
          'users.first_name',
          'users.last_name',
          trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
          trx.raw(`
            COALESCE(dt.type_name, sdt.type_name) as type_name,
            COALESCE(dt.icon, sdt.icon) as type_icon
          `)
        )
        .orderBy('documents.updated_at', 'desc');
      return authorizeAndRedactDocuments(trx, tenant, user, documents as IDocument[]);
    });
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
});

// Get documents by contract ID
export const getDocumentsByContractId = withAuth(async (user, { tenant }, contractId: string) => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    // Check billing permission (required for contract documents)
    if (!await hasPermission(user, 'billing', 'read')) {
      return permissionError('Permission denied: Cannot access contract documents');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documents = await trx('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('documents.tenant', '=', 'document_associations.tenant');
        })
        .where({
          'document_associations.entity_id': contractId,
          'document_associations.entity_type': 'contract',
          'documents.tenant': tenant,
          'document_associations.tenant': tenant
        })
        .select('documents.*', 'document_associations.association_id');
      return authorizeAndRedactDocuments(trx, tenant, user, documents as IDocument[]);
    });
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get contract documents");
  }
});

// Associate document with contract
export const associateDocumentWithContract = withAuth(async (user, { tenant }, input: IDocumentAssociationInput) => {
  try {
    // Check permission for document association
    if (!await hasPermission(user, 'document', 'create')) {
      return permissionError('Permission denied: Cannot associate documents');
    }

    // Check billing permission (required for contract documents)
    if (!await hasPermission(user, 'billing', 'update')) {
      return permissionError('Permission denied: Cannot modify contract documents');
    }

    const { knex } = await createTenantKnex();

    const created = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const association = await DocumentAssociation.create(trx, {
        ...input,
        entity_type: 'contract',
        tenant
      });

      return association;
    });

    try {
      const occurredAt = new Date().toISOString();
      await publishWorkflowEvent({
        eventType: 'DOCUMENT_ASSOCIATED',
        payload: buildDocumentAssociatedPayload({
          documentId: input.document_id,
          entityType: 'contract',
          entityId: input.entity_id,
          associatedByUserId: user.user_id,
          associatedAt: occurredAt,
        }),
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: { actorType: 'USER', actorUserId: user.user_id },
        },
        idempotencyKey: `document_associated:${created.association_id}`,
      });
    } catch (eventError) {
      console.error('[associateDocumentWithContract] Failed to publish DOCUMENT_ASSOCIATED workflow event:', eventError);
    }

    return created;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to associate document with contract");
  }
});

// Remove document from contract
export const removeDocumentFromContract = withAuth(async (user, { tenant }, associationId: string) => {
  try {
    // Check permission for document deletion
    if (!await hasPermission(user, 'document', 'delete')) {
      return permissionError('Permission denied: Cannot remove document associations');
    }

    // Check billing permission (required for contract documents)
    if (!await hasPermission(user, 'billing', 'update')) {
      return permissionError('Permission denied: Cannot modify contract documents');
    }

    const { knex } = await createTenantKnex();

    const removed = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const existing = await trx('document_associations')
        .where({
          association_id: associationId,
          tenant,
          entity_type: 'contract'
        })
        .first();

      if (!existing) return null;

      await trx('document_associations')
        .where({
          association_id: associationId,
          tenant,
          entity_type: 'contract'
        })
        .delete();

      return existing;
    });

    if (removed) {
      try {
        const occurredAt = new Date().toISOString();
        await publishWorkflowEvent({
          eventType: 'DOCUMENT_DETACHED',
          payload: buildDocumentDetachedPayload({
            documentId: removed.document_id,
            entityType: removed.entity_type,
            entityId: removed.entity_id,
            detachedByUserId: user.user_id,
            detachedAt: occurredAt,
            reason: 'manual_remove',
          }),
          ctx: {
            tenantId: tenant,
            occurredAt,
            actor: { actorType: 'USER', actorUserId: user.user_id },
          },
          idempotencyKey: `document_detached:${associationId}`,
        });
      } catch (eventError) {
        console.error('[removeDocumentFromContract] Failed to publish DOCUMENT_DETACHED workflow event:', eventError);
      }
    }

    return;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to remove document from contract");
  }
});

// Get document preview
async function renderHtmlToPng(htmlContent: string, width: number = 400, height: number = 300): Promise<Buffer> {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    const styledHtml = `
      <style>
        body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"; font-size: 14px; line-height: 1.4; padding: 15px; border: 1px solid #e0e0e0; box-sizing: border-box; overflow: hidden; height: ${height}px; background-color: #ffffff; }
        pre { white-space: pre-wrap; word-wrap: break-word; font-family: monospace; }
        h1, h2, h3, h4, h5, h6 { margin-top: 0; margin-bottom: 0.5em; }
        p { margin-top: 0; margin-bottom: 1em; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
        th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
        ul, ol { padding-left: 20px; margin-top: 0; margin-bottom: 1em; }
        img { max-width: 100%; height: auto; }
        /* Basic styling for BlockNote generated HTML */
        .bn-editor table { width: 100%; border-collapse: collapse; }
        .bn-editor th, .bn-editor td { border: 1px solid #ddd; padding: 8px; }
      </style>
      <div>${htmlContent}</div>
    `;
    await page.setContent(styledHtml, { waitUntil: 'domcontentloaded' });
    const imageBuffer = await page.screenshot({ type: 'png' });

    
    return Buffer.from(imageBuffer);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

const IN_APP_TEXT_TYPE_NAMES = ['text', 'text document', 'plain text'];
const IN_APP_MARKDOWN_TYPE_NAMES = ['markdown', 'markdown document'];
const IN_APP_BLOCKNOTE_TYPE_NAMES = ['blocknote', 'block note', 'blocknote document', 'application/vnd.blocknote+json'];


/**
 * Generates a preview for a document
 * Uses the Strategy pattern with document type handlers to handle different document types
 * Now with cached preview support - tries cached preview first, then falls back to legacy handler
 *
 * @param identifier The document ID or file ID to generate a preview for
 * @returns A promise that resolves to a PreviewResponse
 */
export const getDocumentPreview = withAuth(async (
  user,
  { tenant },
  identifier: string
): Promise<PreviewResponse | ActionPermissionError> => {
  console.log(`[getDocumentPreview] Received identifier: ${identifier}`);
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    // Check if the identifier is a document ID
    let document = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('documents')
        .select(
          'documents.*',
          trx.raw(`
            COALESCE(dt.type_name, sdt.type_name) as type_name,
            COALESCE(dt.icon, sdt.icon) as type_icon
          `)
        )
        .leftJoin('document_types as dt', function() {
          this.on('documents.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
        .where({ 'documents.document_id': identifier, 'documents.tenant': tenant })
        .first();
    });
    console.log(`[getDocumentPreview] Document.get(${identifier}) result: ${document ? 'found' : 'not found'}`);

    // If document not found, try to treat identifier as a file ID
    if (!document) {
      console.log(`[getDocumentPreview] Document not found, treating identifier as file ID: ${identifier}`);

      document = await withTransaction(knex, async (trx: Knex.Transaction) =>
        getAuthorizedDocumentByFileId(trx, tenant, user, identifier)
      );

      if (!document) {
        return {
          success: false,
          error: 'File not found or inaccessible'
        };
      }

      // Check cache for file ID only after authorization succeeds
      const cache = CacheFactory.getPreviewCache(tenant);
      const cachedPreview = await cache.get(identifier);
      if (cachedPreview) {
        console.log(`[getDocumentPreview] Cache hit for file ID: ${identifier}`);
        const sharp = await loadSharp();
        const imageBuffer = await sharp(cachedPreview).toBuffer();
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        return {
          success: true,
          previewImage: base64Image,
          content: 'Cached Preview'
        };
      }
    }

    const [authorizedDocument] = await withTransaction(knex, async (trx: Knex.Transaction) =>
      authorizeAndRedactDocuments(trx, tenant, user, [document as IDocument])
    );

    if (!authorizedDocument) {
      return {
        success: false,
        error: 'Permission denied: Cannot read documents'
      };
    }

    document = authorizedDocument;

    // NEW: Try cached preview first if available
    if (document.preview_file_id) {
      console.log(`[getDocumentPreview] Using cached preview: ${document.preview_file_id}`);
      try {
        const downloadResult = await StorageService.downloadFile(document.preview_file_id);
        if (downloadResult) {
          const base64Image = `data:image/jpeg;base64,${downloadResult.buffer.toString('base64')}`;
          return {
            success: true,
            previewImage: base64Image,
            content: `Cached Preview (${document.document_name || 'document'})`
          };
        }
      } catch (cacheError) {
        console.error(`[getDocumentPreview] Failed to load cached preview, falling back to handler:`, cacheError);
        // Continue to legacy handler fallback
      }
    }

    // Fallback to legacy handler if no cached preview or if loading cached preview failed
    console.log(`[getDocumentPreview] Using legacy handler for document ${identifier}`);
    const handlerRegistry = DocumentHandlerRegistry.getInstance();
    return await handlerRegistry.generatePreview(document, tenant, knex);
  } catch (error) {
    console.error(`[getDocumentPreview] General error for identifier ${identifier}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to preview file'
    };
  }
});

// Get document download URL
export const getDocumentDownloadUrl = withAuth(async (user, { tenant }, file_id: string): Promise<string | ActionPermissionError> => {
    // Check permission for document reading/download
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    return `/api/documents/download/${file_id}`;
});

/**
 * Get thumbnail URL for a document
 * Returns the cached thumbnail if available, falls back to original file for images
 *
 * @param documentId - The document ID
 * @returns URL to thumbnail or null if not available
 */
export const getDocumentThumbnailUrl = withAuth(async (user, { tenant }, documentId: string): Promise<string | null | ActionPermissionError> => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    // Get document
    const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('documents')
        .where({ document_id: documentId, tenant })
        .first();
    });

    if (!document) {
      console.warn(`[getDocumentThumbnailUrl] Document not found: ${documentId}`);
      return null;
    }

    // Check if thumbnail exists
    if (document.thumbnail_file_id) {
      return `/api/documents/thumbnail/${documentId}`;
    }

    // Fallback: For images without thumbnails, return original file
    if (document.file_id && document.mime_type?.startsWith('image/')) {
      return `/api/documents/view/${document.file_id}`;
    }

    // No thumbnail available
    return null;
  } catch (error) {
    console.error(`[getDocumentThumbnailUrl] Error for document ${documentId}:`, error);
    return null;
  }
});

/**
 * Get preview URL for a document
 * Returns the cached preview if available, falls back to original file
 *
 * @param documentId - The document ID
 * @returns URL to preview or null if not available
 */
export const getDocumentPreviewUrl = withAuth(async (user, { tenant }, documentId: string): Promise<string | null | ActionPermissionError> => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    // Get document
    const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('documents')
        .where({ document_id: documentId, tenant })
        .first();
    });

    if (!document) {
      console.warn(`[getDocumentPreviewUrl] Document not found: ${documentId}`);
      return null;
    }

    // Check if preview exists
    if (document.preview_file_id) {
      return `/api/documents/preview/${documentId}`;
    }

    // Fallback: Return original file if available
    if (document.file_id) {
      return `/api/documents/view/${document.file_id}`;
    }

    // No preview available
    return null;
  } catch (error) {
    console.error(`[getDocumentPreviewUrl] Error for document ${documentId}:`, error);
    return null;
  }
});

// Download document
export const downloadDocument = withAuth(async (user, { tenant }, documentIdOrFileId: string) => {
    try {
        // Check permission for document reading/download
        if (!await hasPermission(user, 'document', 'read')) {
          return permissionError('Permission denied: Cannot read documents');
        }

        const { knex } = await createTenantKnex();

        // Get document by file_id or document_id
        const document = await withTransaction(knex, async (trx: Knex.Transaction) => {
            return await trx('documents')
                .where({ tenant })
                .andWhere(function() {
                    this.where({ file_id: documentIdOrFileId })
                        .orWhere({ document_id: documentIdOrFileId });
                })
                .first();
        });

        if (!document || !document.file_id) {
            throw new Error('Document not found or has no associated file');
        }

        const [authorizedDocument] = await withTransaction(knex, async (trx: Knex.Transaction) =>
          authorizeAndRedactDocuments(trx, tenant, user, [document as IDocument])
        );
        if (!authorizedDocument) {
          return permissionError('Permission denied: Cannot read documents');
        }

        // Download file from storage
        const result = await StorageService.downloadFile(authorizedDocument.file_id!);
        if (!result) {
            throw new Error('File not found in storage');
        }

        const { buffer, metadata } = result;

        // Set appropriate headers for file download
        const headers = new Headers();
        headers.set('Content-Type', metadata.mime_type || 'application/octet-stream');

        // Properly encode filename to handle special characters
        const encodedFilename = encodeURIComponent(authorizedDocument.document_name || 'download');
        const asciiFilename = authorizedDocument.document_name?.replace(/[^\x00-\x7F]/g, '_') || 'download';
        headers.set('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
        headers.set('Content-Length', buffer.length.toString());

        // Add cache control headers for images to enable browser caching
        const isImage = metadata.mime_type?.startsWith('image/');
        if (isImage) {
            // Cache images for 7 days, but revalidate after 1 day
            headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
            // Add ETag for conditional requests
            headers.set('ETag', `"${authorizedDocument.file_id}"`);
        } else {
            // For non-images, use no-cache to ensure fresh content
            headers.set('Cache-Control', 'no-cache');
        }

        return new Response(buffer as any, {
            status: 200,
            headers
        });
    } catch (error) {
        console.error('Error downloading document:', error);
        throw error;
    }
});

// Get documents by entity using the new association table
export const getDocumentCountsForEntities = withAuth(async (
  user,
  { tenant },
  entityIds: string[],
  entityType: string
): Promise<Map<string, number>> => {
  const { knex } = await createTenantKnex();
  
  try {
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const counts = await trx('document_associations')
        .select('entity_id')
        .count('document_id as count')
        .where('tenant', tenant)
        .whereIn('entity_id', entityIds)
        .where('entity_type', entityType)
        .groupBy('entity_id');

      const countMap = new Map<string, number>();
      for (const row of counts) {
        countMap.set(String(row.entity_id), Number(row.count));
      }

      // Ensure all requested entities have a count (0 if no documents)
      for (const entityId of entityIds) {
        if (!countMap.has(entityId)) {
          countMap.set(entityId, 0);
        }
      }

      return countMap;
    });
  } catch (error) {
    console.error('Error fetching document counts:', error);
    throw error;
  }
});

export const getDocumentsByEntity = withAuth(async (
  user,
  { tenant },
  entity_id: string,
  entity_type: string,
  filters?: DocumentFilters,
  page: number = 1,
  limit: number = 15
): Promise<PaginatedDocumentsResponse | ActionPermissionError> => {
  try {
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const fetchPage = async (sourcePage: number, sourceLimit: number) => {
        let query = trx('documents')
          .join('document_associations', function() {
            this.on('documents.document_id', '=', 'document_associations.document_id')
                .andOn('document_associations.tenant', '=', trx.raw('?', [tenant]));
          })
          .leftJoin('users', function() {
            this.on('documents.created_by', '=', 'users.user_id')
                .andOn('users.tenant', '=', trx.raw('?', [tenant]));
          })
          .leftJoin('document_types as dt', function() {
            this.on('documents.type_id', '=', 'dt.type_id')
                .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
          })
          .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
          .where('documents.tenant', tenant)
          .where('document_associations.entity_id', entity_id)
          .andWhere('document_associations.entity_type', entity_type)
          .select(
            'documents.*',
            'users.first_name',
            'users.last_name',
            trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
            trx.raw(`
              COALESCE(dt.type_name, sdt.type_name) as type_name,
              COALESCE(dt.icon, sdt.icon) as type_icon
            `),
            trx.raw(`
              CASE
                WHEN documents.document_name ~ '^[0-9]'
                THEN CAST(COALESCE(NULLIF(LEFT(regexp_replace(documents.document_name, '[^0-9].*$', ''), 18), ''), '0') AS BIGINT)
                ELSE 0
              END as document_name_sort_key
            `)
          )
          .distinct('documents.document_id');

        if (filters?.searchTerm) {
          query = query.whereRaw('LOWER(documents.document_name) LIKE ?', [`%${filters.searchTerm.toLowerCase()}%`]);
        }
        if (filters?.uploadedBy) {
          query = query.where('documents.created_by', filters.uploadedBy);
        }
        if (filters?.updated_at_start) {
          query = query.where('documents.updated_at', '>=', filters.updated_at_start);
        }
        if (filters?.updated_at_end) {
          const endDate = new Date(filters.updated_at_end);
          endDate.setDate(endDate.getDate() + 1);
          query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
        }

        if (filters?.sortBy === 'created_by_full_name') {
          query = query.orderByRaw(`CONCAT(users.first_name, ' ', users.last_name) ${filters.sortOrder || 'desc'}`);
        } else if (filters?.sortBy === 'document_name') {
          query = query.orderBy('document_name_sort_key', filters.sortOrder || 'desc').orderBy('documents.document_name', filters.sortOrder || 'desc');
        } else if (filters?.sortBy) {
          query = query.orderBy(`documents.${filters.sortBy}`, filters.sortOrder || 'desc');
        } else {
          query = query.orderBy('documents.updated_at', 'desc');
        }

        return query.limit(sourceLimit).offset((sourcePage - 1) * sourceLimit);
      };

      return paginateAuthorizedDocuments({
        trx,
        tenant,
        user,
        page,
        limit,
        fetchPage,
      });
    });
  } catch (error) {
    console.error('Error fetching documents by entity:', error);
    throw new Error('Failed to fetch documents');
  }
});

// Get all documents with optional filtering
export const getAllDocuments = withAuth(async (
  user,
  { tenant },
  filters?: DocumentFilters,
  page: number = 1,
  limit: number = 10
): Promise<PaginatedDocumentsResponse | ActionPermissionError> => {
  try {
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    const { knex } = await createTenantKnex();

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const fetchPage = async (sourcePage: number, sourceLimit: number) => {
        let query = trx('documents')
          .where('documents.tenant', tenant)
          .leftJoin('document_types as dt', function() {
            this.on('documents.type_id', '=', 'dt.type_id')
                .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
          })
          .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
          .leftJoin('users', function() {
            this.on('documents.created_by', '=', 'users.user_id')
                .andOn('users.tenant', '=', trx.raw('?', [tenant]));
          })
          .select(
            'documents.*',
            'users.first_name',
            'users.last_name',
            trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
            trx.raw(`
              COALESCE(dt.type_name, sdt.type_name) as type_name,
              COALESCE(dt.icon, sdt.icon) as type_icon
            `),
            trx.raw(`
              CASE
                WHEN documents.document_name ~ '^[0-9]'
                THEN CAST(COALESCE(NULLIF(LEFT(regexp_replace(documents.document_name, '[^0-9].*$', ''), 18), ''), '0') AS BIGINT)
                ELSE 0
              END as document_name_sort_key
            `)
          )
          .distinct('documents.document_id');

        if (filters?.searchTerm) {
          query = query.whereRaw('LOWER(documents.document_name) LIKE ?', [`%${filters.searchTerm.toLowerCase()}%`]);
        }
        if (filters?.type) {
          if (filters.type === 'application/pdf') {
            query = query.where(function() {
              this.where(function() {
                this.where('dt.type_name', '=', 'application/pdf')
                    .orWhere('sdt.type_name', '=', 'application/pdf');
              }).whereNotNull('documents.file_id');
            });
          } else if (filters.type === 'image') {
            query = query.where(function() {
              this.where(function() {
                this.where('dt.type_name', 'like', 'image/%')
                    .orWhere('sdt.type_name', 'like', 'image/%');
              }).whereNotNull('documents.file_id');
            });
          } else if (filters.type === 'text') {
            query = query.where(function() {
              this.where('dt.type_name', 'like', 'text/%')
                  .orWhere('sdt.type_name', 'like', 'text/%')
                  .orWhere('dt.type_name', '=', 'application/msword')
                  .orWhere('sdt.type_name', '=', 'application/msword')
                  .orWhere('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                  .orWhere('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                  .orWhere('dt.type_name', 'like', 'application/vnd.ms-excel%')
                  .orWhere('sdt.type_name', 'like', 'application/vnd.ms-excel%')
                  .orWhere('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%')
                  .orWhere('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%')
                  .orWhereNull('documents.file_id');
            });
          } else if (filters.type === 'application') {
            query = query.where(function() {
              this.where(function() {
                this.where(function() {
                  this.where('dt.type_name', 'like', 'application/%')
                      .whereNot('dt.type_name', '=', 'application/pdf')
                      .whereNot('dt.type_name', '=', 'application/msword')
                      .whereNot('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                      .whereNot('dt.type_name', 'like', 'application/vnd.ms-excel%')
                      .whereNot('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%');
                }).orWhere(function() {
                  this.where('sdt.type_name', 'like', 'application/%')
                      .whereNot('sdt.type_name', '=', 'application/pdf')
                      .whereNot('sdt.type_name', '=', 'application/msword')
                      .whereNot('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                      .whereNot('sdt.type_name', 'like', 'application/vnd.ms-excel%')
                      .whereNot('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%');
                });
              }).whereNotNull('documents.file_id');
            });
          } else {
            query = query.where(function() {
              this.where('dt.type_name', 'like', `${filters.type}%`)
                  .orWhere('sdt.type_name', 'like', `${filters.type}%`);
            });
          }
        }
        if (filters?.uploadedBy) {
          query = query.where('documents.created_by', filters.uploadedBy);
        }
        if (filters?.updated_at_start) {
          query = query.where('documents.updated_at', '>=', filters.updated_at_start);
        }
        if (filters?.updated_at_end) {
          const endDate = new Date(filters.updated_at_end);
          endDate.setDate(endDate.getDate() + 1);
          query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
        }
        if (filters?.excludeEntityId && filters?.excludeEntityType) {
          query = query.whereNotExists(function() {
            this.select('*')
                .from('document_associations')
                .whereRaw('document_associations.document_id = documents.document_id')
                .andWhere('document_associations.entity_id', filters.excludeEntityId)
                .andWhere('document_associations.entity_type', filters.excludeEntityType)
                .andWhere('document_associations.tenant', tenant);
          });
        }
        if (filters?.entityType) {
          query = query
            .leftJoin('document_associations', function() {
              this.on('documents.document_id', '=', 'document_associations.document_id')
                  .andOn('document_associations.tenant', '=', trx.raw('?', [tenant]));
            })
            .where('document_associations.entity_type', filters.entityType);
        }
        if (filters?.folder_path !== undefined && !filters.showAllDocuments) {
          if (filters.folder_path === null || filters.folder_path === '') {
            query = query.whereNull('documents.folder_path');
          } else {
            query = query.where(function() {
              this.where('documents.folder_path', filters.folder_path)
                .orWhere('documents.folder_path', 'like', `${filters.folder_path}/%`);
            });
          }
        }

        if (filters?.sortBy === 'created_by_full_name') {
          query = query.orderByRaw(`CONCAT(users.first_name, ' ', users.last_name) ${filters.sortOrder || 'desc'}`);
        } else if (filters?.sortBy === 'document_name') {
          query = query.orderBy('document_name_sort_key', filters.sortOrder || 'desc').orderBy('documents.document_name', filters.sortOrder || 'desc');
        } else if (filters?.sortBy) {
          query = query.orderBy(`documents.${filters.sortBy}`, filters.sortOrder || 'desc');
        } else {
          query = query.orderBy('documents.updated_at', 'desc');
        }

        return query.limit(sourceLimit).offset((sourcePage - 1) * sourceLimit);
      };

      return paginateAuthorizedDocuments({
        trx,
        tenant,
        user,
        page,
        limit,
        fetchPage,
      });
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    throw error;
  }
});

// Create document associations
export const createDocumentAssociations = withAuth(async (
  user,
  { tenant },
  entity_id: string,
  entity_type: DocumentAssociationEntityType,
  document_ids: string[]
): Promise<{ success: boolean } | ActionPermissionError> => {
  try {
    // Check permission for document updates (associating documents is an update operation)
    if (!await hasPermission(user, 'document', 'update')) {
      return permissionError('Permission denied: Cannot update document associations');
    }

    const { knex: db } = await createTenantKnex();

    // Create associations for all selected documents
    const associations = document_ids.map((document_id): IDocumentAssociationInput => ({
      document_id,
      entity_id,
      entity_type,
      tenant
    }));

    const created = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await Promise.all(
        associations.map((association): Promise<Pick<IDocumentAssociation, "association_id">> =>
          DocumentAssociation.create(trx, association)
        )
      );
    });

    const occurredAt = new Date().toISOString();
    await Promise.all(
      created.map(async (row, index) => {
        const association = associations[index];
        if (!association) return;
        try {
          await publishWorkflowEvent({
            eventType: 'DOCUMENT_ASSOCIATED',
            payload: buildDocumentAssociatedPayload({
              documentId: association.document_id,
              entityType: association.entity_type,
              entityId: association.entity_id,
              associatedByUserId: user.user_id,
              associatedAt: occurredAt,
            }),
            ctx: {
              tenantId: tenant,
              occurredAt,
              actor: { actorType: 'USER', actorUserId: user.user_id },
            },
            idempotencyKey: `document_associated:${row.association_id}`,
          });
        } catch (eventError) {
          console.error('[createDocumentAssociations] Failed to publish DOCUMENT_ASSOCIATED workflow event:', eventError);
        }
      })
    );

    return { success: true };
  } catch (error) {
    console.error('Error creating document associations:', error);
    throw new Error('Failed to create document associations');
  }
});

// Remove document associations
export const removeDocumentAssociations = withAuth(async (
  user,
  { tenant },
  entity_id: string,
  entity_type: DocumentAssociationEntityType,
  document_ids?: string[]
) => {
  try {
    // Check permission for document updates (removing associations is an update operation)
    if (!await hasPermission(user, 'document', 'update')) {
      return permissionError('Permission denied: Cannot update document associations');
    }

    const { knex } = await createTenantKnex();

    const removed = await withTransaction(knex, async (trx: Knex.Transaction) => {
      let query = trx('document_associations')
        .where('entity_id', entity_id)
        .andWhere('entity_type', entity_type)
        .andWhere('tenant', tenant);

      if (document_ids && document_ids.length > 0) {
        query = query.whereIn('document_id', document_ids);
      }

      const rows = await query.clone().select('association_id', 'document_id');
      await query.delete();
      return rows;
    });

    if (removed.length > 0) {
      const occurredAt = new Date().toISOString();
      await Promise.all(
        removed.map(async (row: any) => {
          try {
            await publishWorkflowEvent({
              eventType: 'DOCUMENT_DETACHED',
              payload: buildDocumentDetachedPayload({
                documentId: row.document_id,
                entityType: entity_type,
                entityId: entity_id,
                detachedByUserId: user.user_id,
                detachedAt: occurredAt,
                reason: 'manual_remove',
              }),
              ctx: {
                tenantId: tenant,
                occurredAt,
                actor: { actorType: 'USER', actorUserId: user.user_id },
              },
              idempotencyKey: `document_detached:${row.association_id}`,
            });
          } catch (eventError) {
            console.error('[removeDocumentAssociations] Failed to publish DOCUMENT_DETACHED workflow event:', eventError);
          }
        })
      );
    }

    return { success: true };
  } catch (error) {
    console.error('Error removing document associations:', error);
    throw new Error('Failed to remove document associations');
  }
});

// Upload new document
export const uploadDocument = withAuth(async (
  user,
  { tenant },
  file: FormData,
  options: {
    userId: string;
    clientId?: string;
    ticketId?: string;
    contactNameId?: string;
    assetId?: string;
    projectTaskId?: string;
    contractId?: string;
    folder_path?: string | null;
  }
): Promise<
  | { success: true; document: IDocument }
  | { success: false; error: string }
  | ActionPermissionError
> => {
  try {
    // Check permission for document creation/upload
    if (!await hasPermission(user, 'document', 'create')) {
      return permissionError('Permission denied: Cannot create documents');
    }

    const { knex } = await createTenantKnex();

      let createdAssociations: Array<{
        associationId: string;
        documentId: string;
        entityId: string;
        entityType: string;
      }> = [];

      const authenticatedUserId = user.user_id;
      if (!authenticatedUserId) {
        throw new Error('User session is required to upload documents');
      }
      if (options.userId && options.userId !== authenticatedUserId) {
        console.warn('[uploadDocument] Ignoring client-provided userId that differs from authenticated user', {
          authenticatedUserId,
          providedUserId: options.userId,
        });
      }

      // Extract file from FormData
      const fileData = file.get('file') as File;
      if (!fileData) {
        throw new Error('No file provided');
      }

      // Validate first
      await validateDocumentUpload(fileData);

      const buffer = Buffer.from(await fileData.arrayBuffer());

      // Upload file to storage
      const uploadResult = await StorageService.uploadFile(tenant, buffer, fileData.name, {
        mime_type: fileData.type,
        uploaded_by_id: authenticatedUserId
      });

      // Get document type based on mime type
      const typeResult = await getDocumentTypeId(fileData.type);
      if ('permissionError' in typeResult) return typeResult;
      const { typeId, isShared } = typeResult;

      // Auto-file into entity folder if folder_path not set and entity context exists
      // Best-effort: never fails the upload, wraps in try/catch
      let resolvedFolderPath: string | undefined = options.folder_path || undefined;
      if (!resolvedFolderPath) {
        try {
          const primaryEntity = options.ticketId ? { id: options.ticketId, type: 'ticket' }
            : options.projectTaskId ? { id: options.projectTaskId, type: 'project_task' }
            : options.contractId ? { id: options.contractId, type: 'contract' }
            : options.clientId ? { id: options.clientId, type: 'client' }
            : options.assetId ? { id: options.assetId, type: 'asset' }
            : null;

          if (primaryEntity) {
            await ensureEntityFoldersInitializedInternal(
              knex,
              tenant,
              primaryEntity.id,
              primaryEntity.type,
              authenticatedUserId
            );

            const entityFolderQuery = () =>
              knex('document_folders')
                .where('tenant', tenant)
                .andWhere('entity_id', primaryEntity.id)
                .andWhere('entity_type', primaryEntity.type);

            if (primaryEntity.type === 'ticket') {
              const attachmentsFolder = await entityFolderQuery()
                .andWhere('folder_path', '/Tickets/Attachments')
                .select('folder_path')
                .first();

              if (attachmentsFolder) {
                resolvedFolderPath = attachmentsFolder.folder_path;
              }
            }

            if (!resolvedFolderPath) {
              // Fall back to the first entity-scoped folder for older setups.
              const entityFolder = await entityFolderQuery()
                .orderBy('folder_path', 'asc')
                .select('folder_path')
                .first();

              if (entityFolder) {
                resolvedFolderPath = entityFolder.folder_path;
              }
            }
          }
        } catch {
          // Silent failure — best-effort, never fails the upload
        }
      }

      // Create document record
      // Documents uploaded by client users are automatically client-visible.
      // For internal users, inherit visibility from the target folder.
      let isClientVisible = user.user_type === 'client';
      if (!isClientVisible && resolvedFolderPath) {
        try {
          const folderVisibilityQuery = knex('document_folders')
            .select('is_client_visible')
            .where('tenant', tenant)
            .andWhere('folder_path', resolvedFolderPath);

          const entityId = options.ticketId || options.projectTaskId || options.contractId
            || options.clientId || options.assetId;
          const entityType = options.ticketId ? 'ticket'
            : options.projectTaskId ? 'project_task'
            : options.contractId ? 'contract'
            : options.clientId ? 'client'
            : options.assetId ? 'asset'
            : null;

          if (entityId && entityType) {
            folderVisibilityQuery.andWhere('entity_id', entityId).andWhere('entity_type', entityType);
          }

          const targetFolder = await folderVisibilityQuery.first();
          if (targetFolder?.is_client_visible) {
            isClientVisible = true;
          }
        } catch {
          // Silent failure — best-effort, never fails the upload
        }
      }
      const document: IDocument = {
        document_id: uuidv4(),
        document_name: fileData.name,
        type_id: isShared ? null : typeId,
        shared_type_id: isShared ? typeId : undefined,
        user_id: authenticatedUserId,
        order_number: 0,
        created_by: authenticatedUserId,
        tenant,
        file_id: uploadResult.file_id,
        storage_path: uploadResult.storage_path,
        mime_type: fileData.type,
        file_size: fileData.size,
        folder_path: resolvedFolderPath,
        is_client_visible: isClientVisible,
      };

      // Use transaction for document creation and associations
      const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
        await trx('documents').insert(document);
        const documentWithId = document;

        // Create associations if any entity IDs are provided
        const associations: IDocumentAssociationInput[] = [];

    if (options.ticketId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.ticketId,
        entity_type: 'ticket',
        tenant
      });
    }

    if (options.clientId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.clientId,
        entity_type: 'client',
        tenant
      });
    }

    if (options.contactNameId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.contactNameId,
        entity_type: 'contact',
        tenant
      });
    }

    if (options.assetId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.assetId,
        entity_type: 'asset',
        tenant
      });
    }

    if (options.projectTaskId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.projectTaskId,
        entity_type: 'project_task',
        tenant
      });
    }

    if (options.contractId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.contractId,
        entity_type: 'contract',
        tenant
      });
    }

        // Create all associations
        if (associations.length > 0) {
          const created = await Promise.all(
            associations.map((association): Promise<Pick<IDocumentAssociation, "association_id">> =>
              DocumentAssociation.create(trx, association)
            )
          );
          createdAssociations = created.map((row, index) => ({
            associationId: row.association_id,
            documentId: associations[index]!.document_id,
            entityId: associations[index]!.entity_id,
            entityType: associations[index]!.entity_type,
          }));
        }

        return {
          success: true as const,
          document: documentWithId
        };
      });

      if (createdAssociations.length > 0) {
        const occurredAt = new Date().toISOString();
        await Promise.all(
          createdAssociations.map(async (association) => {
            try {
              await publishWorkflowEvent({
                eventType: 'DOCUMENT_ASSOCIATED',
                payload: buildDocumentAssociatedPayload({
                  documentId: association.documentId,
                  entityType: association.entityType,
                  entityId: association.entityId,
                  associatedByUserId: user.user_id,
                  associatedAt: occurredAt,
                }),
                ctx: {
                  tenantId: tenant,
                  occurredAt,
                  actor: { actorType: 'USER', actorUserId: user.user_id },
                },
                idempotencyKey: `document_associated:${association.associationId}`,
              });
            } catch (eventError) {
              console.error('[uploadDocument] Failed to publish DOCUMENT_ASSOCIATED workflow event:', eventError);
            }
          })
        );
      }

      // Generate previews after the transaction completes.
      // Awaited so the preview is ready before the response reaches the client.
      // Failures are caught internally and won't affect the upload success.
      try {
        const previewResult = await generateDocumentPreviews(document, buffer);
        if (previewResult.thumbnail_file_id || previewResult.preview_file_id) {
          await knex('documents')
            .where({ document_id: document.document_id, tenant })
            .update({
              thumbnail_file_id: previewResult.thumbnail_file_id,
              preview_file_id: previewResult.preview_file_id,
              preview_generated_at: previewResult.preview_generated_at,
              updated_at: new Date(),
            });
          // Update the returned document object so the caller has preview IDs
          document.thumbnail_file_id = previewResult.thumbnail_file_id ?? undefined;
          document.preview_file_id = previewResult.preview_file_id ?? undefined;
          console.log(`[uploadDocument] Preview generation completed for document ${document.document_id}`);
        }
      } catch (error) {
        console.error(`[uploadDocument] Preview generation failed for document ${document.document_id}:`, error);
      }

      return result;
  } catch (error) {
    console.error('Error uploading document:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload document'
    };
  }
});

// Centralized validation logic - internal helper, uses tenant from context
async function validateDocumentUpload(file: File): Promise<void> {
  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('No tenant found');
  }

  await StorageService.validateFileUpload(
    tenant,
    file.type,
    file.size
  );
}

// Get document type ID
export const getDocumentTypeId = withAuth(async (user, { tenant }, mimeType: string): Promise<{ typeId: string, isShared: boolean } | ActionPermissionError> => {
  // Check permission for document reading
  if (!await hasPermission(user, 'document', 'read')) {
    return permissionError('Permission denied: Cannot read document types');
  }

  const { knex } = await createTenantKnex();

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    // First try to find a tenant-specific type
    const tenantType = await trx('document_types')
      .where({ tenant, type_name: mimeType })
      .first();

    if (tenantType) {
      return { typeId: tenantType.type_id, isShared: false };
    }

    // Then try to find a shared type
    const sharedType = await trx('shared_document_types')
      .where({ type_name: mimeType })
      .first();

    if (sharedType) {
      return { typeId: sharedType.type_id, isShared: true };
    }

    // If no exact match, try to find a match for the general type (e.g., "image/*" for "image/png")
    const generalType = mimeType.split('/')[0] + '/*';

    // Check tenant-specific general type first
    const generalTenantType = await trx('document_types')
      .where({ tenant, type_name: generalType })
      .first();

    if (generalTenantType) {
      return { typeId: generalTenantType.type_id, isShared: false };
    }

    // Then check shared general type
    const generalSharedType = await trx('shared_document_types')
      .where({ type_name: generalType })
      .first();

    if (generalSharedType) {
      return { typeId: generalSharedType.type_id, isShared: true };
    }

    // If no match found, return the unknown type (application/octet-stream) from shared types
    const unknownType = await trx('shared_document_types')
      .where({ type_name: 'application/octet-stream' })
      .first();

    if (!unknownType) {
      throw new Error('Unknown document type not found in shared document types');
    }

    return { typeId: unknownType.type_id, isShared: true };
  });
});

/**
 * Generates a publicly accessible URL for an image file.
 * Handles different storage providers (local vs. S3).
 *
 * @param file_id The ID of the file in external_files.
 * @returns A promise resolving to the image URL string, or null if an error occurs or the file is not found/an image.
 */
/**
 * Core implementation for generating image URLs from file IDs.
 * Handles different storage providers (local vs. S3).
 * This is an internal helper that uses the tenant from AsyncLocalStorage context.
 *
 * @param file_id The ID of the file in external_files
 * @param useTransaction Whether to use database transaction (default: true)
 * @returns A promise resolving to the image URL string, or null if an error occurs or the file is not found/an image
 */
async function getImageUrlCore(file_id: string, useTransaction: boolean = true): Promise<string | null> {
  try {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      console.error('getImageUrlCore: No tenant found');
      return null;
    }

    // Fetch minimal file details to check MIME type and existence
    const fileDetails = useTransaction
      ? await withTransaction(knex, async (trx: Knex.Transaction) => {
          return await trx('external_files')
            .select('mime_type', 'storage_path')
            .where({ file_id, tenant })
            .first();
        })
      : await knex('external_files')
          .select('mime_type', 'storage_path')
          .where({ file_id, tenant })
          .first();

    if (!fileDetails) {
      console.warn(`getImageUrlCore: File not found for file_id: ${file_id}`);
      return null;
    }

    // Check if the file is an image
    if (!fileDetails.mime_type?.startsWith('image/')) {
      console.warn(`getImageUrlCore: File ${file_id} is not an image (mime_type: ${fileDetails.mime_type})`);
      return null;
    }

    // Always use the API endpoint approach for consistency
    // This works for both local and S3/MinIO storage providers
    // The /api/documents/view endpoint handles fetching from the actual storage
    return `/api/documents/view/${file_id}`;
  } catch (error) {
    console.error(`getImageUrlCore: Error generating URL for file_id ${file_id}:`, error);
    return null;
  }
}

/**
 * Generates a URL for accessing an image file by its ID.
 * This is the PUBLIC API that includes user authentication and permission checks.
 *
 * Use this function when:
 * - Handling user requests that need authentication
 * - API endpoints that require permission validation
 * - Any user-facing functionality
 *
 * @param file_id The ID of the file in external_files
 * @returns A promise resolving to the image URL string, or null if an error occurs or the file is not found/an image
 */
export const getImageUrl = withAuth(async (user, { tenant }, file_id: string): Promise<string | null | ActionPermissionError> => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read documents');
    }

    return await getImageUrlCore(file_id, true);
  } catch (error) {
    console.error(`getImageUrl: Error generating URL for file_id ${file_id}:`, error);
    return null;
  }
});

export const getDistinctEntityTypes = withAuth(async (user, { tenant }): Promise<string[] | ActionPermissionError> => {
  try {
    // Check permission for document reading
    if (!await hasPermission(user, 'document', 'read')) {
      return permissionError('Permission denied: Cannot read document associations');
    }

    const { knex } = await createTenantKnex();

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx('document_associations')
        .distinct('entity_type')
        .where('tenant', tenant)
        .orderBy('entity_type', 'asc');
    });

    return result.map((row: { entity_type: string }) => row.entity_type);
  } catch (error) {
    console.error('Error fetching distinct entity types:', error);
    throw new Error('Failed to fetch distinct entity types');
  }
});

// ============================================================================
// FOLDER OPERATIONS
// ============================================================================

/**
 * Build a hierarchical folder tree from document folder_paths
 *
 * @returns Promise<IFolderNode[]> - Root level folders with nested children
 */
/**
 * Internal helper for building a folder tree. Not wrapped in withAuth —
 * intended to be called from already-authenticated contexts.
 */
async function _getFolderTreeInternal(
  knex: Knex,
  tenant: string,
  entityId?: string | null,
  entityType?: string | null
): Promise<IFolderNode[]> {
  const hasEntityScope = Boolean(entityId && entityType);

  // Get explicit folders from document_folders table
  const explicitFolderQuery = knex('document_folders')
    .select('folder_path', 'entity_id', 'entity_type', 'is_client_visible')
    .where('tenant', tenant);

  if (hasEntityScope) {
    explicitFolderQuery
      .andWhere('entity_id', entityId)
      .andWhere('entity_type', entityType);
  }
  // When no entity scope, show ALL folders (unscoped + entity-scoped) so the
  // global Documents page remains a complete view of every document.

  const explicitFolders = await explicitFolderQuery.orderBy('folder_path', 'asc');

  const explicitPaths = explicitFolders.map((row: any) => row.folder_path);
  const explicitFolderMetadata = new Map<string, Pick<IFolderNode, 'entity_id' | 'entity_type' | 'is_client_visible'>>();

  for (const folder of explicitFolders as Array<{
    folder_path: string;
    entity_id?: string | null;
    entity_type?: string | null;
    is_client_visible?: boolean;
  }>) {
    explicitFolderMetadata.set(folder.folder_path, {
      entity_id: folder.entity_id ?? null,
      entity_type: folder.entity_type ?? null,
      is_client_visible: Boolean(folder.is_client_visible),
    });
  }

  // Get implicit folder paths from documents
  const implicitFoldersQuery = knex('documents')
    .select('folder_path')
    .where('tenant', tenant)
    .whereNotNull('folder_path')
    .andWhere('folder_path', '!=', '');

  if (hasEntityScope) {
    implicitFoldersQuery.whereExists(function() {
      this.select('*')
        .from('document_associations as da')
        .whereRaw('da.document_id = documents.document_id')
        .andWhere('da.tenant', tenant)
        .andWhere('da.entity_id', entityId)
        .andWhere('da.entity_type', entityType);
    });
  }
  // When no entity scope, don't filter — include all documents' folder paths
  // so the global Documents page shows everything.

  const implicitFolders = await implicitFoldersQuery.groupBy('folder_path');

  const implicitPaths = implicitFolders.map((row: any) => row.folder_path);

  // Merge both lists (remove duplicates)
  const allPaths = Array.from(new Set([...explicitPaths, ...implicitPaths]));

  // Build tree structure
  const tree = buildFolderTreeFromPaths(allPaths, explicitFolderMetadata);

  // Get document counts for each folder (single query)
  await enrichFolderTreeWithCounts(tree, knex, tenant, entityId, entityType);

  return tree;
}

export const getFolderTree = withAuth(async (
  user,
  { tenant },
  entityId?: string | null,
  entityType?: string | null
): Promise<IFolderNode[] | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'read'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  return _getFolderTreeInternal(knex, tenant, entityId, entityType);
});

/**
 * Get list of all folder paths (for folder selector)
 * @returns Promise<string[]> - Array of folder paths
 */
export const getFolders = withAuth(async (
  user,
  { tenant },
  entityId?: string | null,
  entityType?: string | null
): Promise<string[] | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'read'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();
  const hasEntityScope = Boolean(entityId && entityType);

  // Get explicit folders from document_folders table
  const explicitFolderQuery = knex('document_folders')
    .select('folder_path')
    .where('tenant', tenant);

  if (hasEntityScope) {
    // Entity context: show ONLY this entity's folders
    explicitFolderQuery
      .where('entity_id', entityId)
      .andWhere('entity_type', entityType);
  }
  // No entity scope: show all folders

  const explicitFolders = await explicitFolderQuery.orderBy('folder_path', 'asc');
  const explicitPaths = explicitFolders.map((row: any) => row.folder_path);

  // Get implicit folder paths from documents
  const implicitFoldersQuery = knex('documents')
    .select('folder_path')
    .where('tenant', tenant)
    .whereNotNull('folder_path')
    .andWhere('folder_path', '!=', '');

  if (hasEntityScope) {
    // Entity context: show folders only from this entity's docs
    implicitFoldersQuery.whereExists(function() {
      this.select('*')
        .from('document_associations as da')
        .whereRaw('da.document_id = documents.document_id')
        .andWhere('da.tenant', tenant)
        .andWhere('da.entity_id', entityId)
        .andWhere('da.entity_type', entityType);
    });
  }
  // No entity scope: show all documents' folder paths

  const implicitFolders = await implicitFoldersQuery.groupBy('folder_path');
  const implicitPaths = implicitFolders.map((row: any) => row.folder_path);

  // Merge both lists (remove duplicates) and sort
  const allPaths = Array.from(new Set([...explicitPaths, ...implicitPaths]));
  return allPaths.sort();
});

/**
 * Get documents in a specific folder (OPTIMIZED - filters at DB level)
 *
 * @param folderPath - Path to folder (e.g., '/Legal/Contracts')
 * @param includeSubfolders - Whether to include documents from subfolders
 * @param page - Page number
 * @param limit - Items per page
 * @param filters - Optional filters including sorting
 * @returns Promise with documents and pagination info
 */
export const getDocumentsByFolder = withAuth(async (
  user,
  { tenant },
  folderPath: string | null,
  includeSubfolders: boolean = false,
  page: number = 1,
  limit: number = 15,
  filters?: DocumentFilters,
  entityId?: string | null,
  entityType?: string | null
): Promise<{ documents: IDocument[]; total: number } | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'read'))) {
    return permissionError('Permission denied');
  }

  const allowedEntityTypes = await getEntityTypesForUser(user);
  const { knex } = await createTenantKnex();
  const hasEntityScope = Boolean(entityId && entityType);

  return await withTransaction(knex, async (trx: Knex.Transaction) => {
    const fetchPage = async (sourcePage: number, sourceLimit: number) => {
      let query = trx('documents as d')
        .where('d.tenant', tenant);

      if (hasEntityScope) {
        query = query.whereExists(function() {
          this.select('*')
            .from('document_associations as da')
            .whereRaw('da.document_id = d.document_id')
            .andWhere('da.tenant', tenant)
            .andWhere('da.entity_id', entityId)
            .andWhere('da.entity_type', entityType)
            .whereIn('da.entity_type', allowedEntityTypes);
        });
      } else {
        query = query.where(function() {
          this.whereNotExists(function() {
            this.select('*')
              .from('document_associations as da')
              .whereRaw('da.document_id = d.document_id')
              .andWhere('da.tenant', tenant);
          })
          .orWhereExists(function() {
            this.select('*')
              .from('document_associations as da')
              .whereRaw('da.document_id = d.document_id')
              .andWhere('da.tenant', tenant)
              .whereIn('da.entity_type', allowedEntityTypes);
          });
        });
      }

      if (folderPath) {
        if (includeSubfolders) {
          query = query.where(function() {
            this.where('d.folder_path', folderPath)
              .orWhere('d.folder_path', 'like', `${folderPath}/%`);
          });
        } else {
          query = query.where('d.folder_path', folderPath);
        }
      } else if (!includeSubfolders) {
        query = query.whereNull('d.folder_path');
      }

      query = query
        .leftJoin('document_types as dt', function() {
          this.on('d.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'd.shared_type_id', 'sdt.type_id');

      if (filters?.searchTerm) {
        query = query.whereRaw('LOWER(d.document_name) LIKE ?', [`%${filters.searchTerm.toLowerCase()}%`]);
      }
      if (filters?.type) {
        if (filters.type === 'application/pdf') {
          query = query.where(function() {
            this.where(function() {
              this.where('dt.type_name', '=', 'application/pdf')
                  .orWhere('sdt.type_name', '=', 'application/pdf');
            }).whereNotNull('d.file_id');
          });
        } else if (filters.type === 'image') {
          query = query.where(function() {
            this.where(function() {
              this.where('dt.type_name', 'like', 'image/%')
                  .orWhere('sdt.type_name', 'like', 'image/%');
            }).whereNotNull('d.file_id');
          });
        } else if (filters.type === 'text') {
          query = query.where(function() {
            this.where('dt.type_name', 'like', 'text/%')
                .orWhere('sdt.type_name', 'like', 'text/%')
                .orWhere('dt.type_name', '=', 'application/msword')
                .orWhere('sdt.type_name', '=', 'application/msword')
                .orWhere('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                .orWhere('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                .orWhere('dt.type_name', 'like', 'application/vnd.ms-excel%')
                .orWhere('sdt.type_name', 'like', 'application/vnd.ms-excel%')
                .orWhere('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%')
                .orWhere('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%')
                .orWhereNull('d.file_id');
          });
        } else if (filters.type === 'application') {
          query = query.where(function() {
            this.where(function() {
              this.where(function() {
                this.where('dt.type_name', 'like', 'application/%')
                    .whereNot('dt.type_name', '=', 'application/pdf')
                    .whereNot('dt.type_name', '=', 'application/msword')
                    .whereNot('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                    .whereNot('dt.type_name', 'like', 'application/vnd.ms-excel%')
                    .whereNot('dt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%');
              }).orWhere(function() {
                this.where('sdt.type_name', 'like', 'application/%')
                    .whereNot('sdt.type_name', '=', 'application/pdf')
                    .whereNot('sdt.type_name', '=', 'application/msword')
                    .whereNot('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.wordprocessing%')
                    .whereNot('sdt.type_name', 'like', 'application/vnd.ms-excel%')
                    .whereNot('sdt.type_name', 'like', 'application/vnd.openxmlformats-officedocument.spreadsheet%');
              });
            }).whereNotNull('d.file_id');
          });
        } else {
          query = query.where(function() {
            this.where('dt.type_name', 'like', `${filters.type}%`)
                .orWhere('sdt.type_name', 'like', `${filters.type}%`);
          });
        }
      }
      if (filters?.uploadedBy) {
        query = query.where('d.created_by', filters.uploadedBy);
      }
      if (filters?.updated_at_start) {
        query = query.where('d.updated_at', '>=', filters.updated_at_start);
      }
      if (filters?.updated_at_end) {
        const endDate = new Date(filters.updated_at_end);
        endDate.setDate(endDate.getDate() + 1);
        query = query.where('d.updated_at', '<', endDate.toISOString().split('T')[0]);
      }
      if (filters?.entityType) {
        query = query
          .leftJoin('document_associations as da', function() {
            this.on('d.document_id', '=', 'da.document_id')
                .andOn('da.tenant', '=', trx.raw('?', [tenant]));
          })
          .where('da.entity_type', filters.entityType);
      }
      if (filters?.clientVisibility === 'visible') {
        query = query.where('d.is_client_visible', true);
      } else if (filters?.clientVisibility === 'hidden') {
        query = query.where(function() {
          this.where('d.is_client_visible', false).orWhereNull('d.is_client_visible');
        });
      }

      query = query
        .leftJoin('users', function() {
          this.on('d.created_by', '=', 'users.user_id')
              .andOn('users.tenant', '=', trx.raw('?', [tenant]));
        })
        .select(
          'd.*',
          trx.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
          trx.raw(`
            COALESCE(dt.type_name, sdt.type_name) as type_name,
            COALESCE(dt.icon, sdt.icon) as type_icon
          `),
          trx.raw(`
            CASE
              WHEN d.document_name ~ '^[0-9]'
              THEN CAST(COALESCE(NULLIF(regexp_replace(d.document_name, '[^0-9].*$', ''), ''), '0') AS INTEGER)
              ELSE 0
            END as numeric_prefix
          `)
        )
        .distinct('d.document_id');

      if (filters?.sortBy === 'created_by_full_name') {
        query = query.orderByRaw(`CONCAT(users.first_name, ' ', users.last_name) ${filters.sortOrder || 'desc'}`);
      } else if (filters?.sortBy === 'document_name') {
        query = query.orderByRaw(`numeric_prefix ${filters.sortOrder || 'desc'}, d.document_name ${filters.sortOrder || 'desc'}`);
      } else if (filters?.sortBy) {
        query = query.orderBy(`d.${filters.sortBy}`, filters.sortOrder || 'desc');
      } else {
        query = query.orderByRaw('numeric_prefix ASC, d.document_name ASC');
      }

      return query.limit(sourceLimit).offset((sourcePage - 1) * sourceLimit);
    };

    const pagination = await paginateAuthorizedDocuments({
      trx,
      tenant,
      user,
      page,
      limit,
      fetchPage,
    });

    return {
      documents: pagination.documents,
      total: pagination.totalCount,
    };
  });
});

/**
 * Move documents to a different folder
 *
 * @param documentIds - Array of document IDs to move
 * @param newFolderPath - Destination folder path
 */
export const moveDocumentsToFolder = withAuth(async (
  user,
  { tenant },
  documentIds: string[],
  newFolderPath: string | null
): Promise<void | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'update'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  await knex('documents')
    .whereIn('document_id', documentIds)
    .andWhere('tenant', tenant)
    .update({
      folder_path: newFolderPath,
      updated_at: new Date(),
    });
});

/**
 * Bulk toggle client visibility for documents
 *
 * @param documentIds - Array of document IDs to update
 * @param isClientVisible - Target client visibility state
 * @returns Promise<number> - Number of affected rows
 */
export const toggleDocumentVisibility = withAuth(async (
  user,
  { tenant },
  documentIds: string[],
  isClientVisible: boolean
): Promise<number | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'update'))) {
    return permissionError('Permission denied');
  }

  if (!Array.isArray(documentIds) || documentIds.length === 0) {
    return 0;
  }

  const { knex } = await createTenantKnex();

  const updatedCount = await knex('documents')
    .where('tenant', tenant)
    .whereIn('document_id', documentIds)
    .update({
      is_client_visible: isClientVisible,
      updated_at: new Date(),
    });

  return Number(updatedCount || 0);
});

/**
 * Toggle client visibility for a folder and optionally cascade to contained documents
 *
 * @param folderId - Folder ID to update
 * @param isClientVisible - Target client visibility state
 * @param cascade - Whether to cascade visibility to documents in folder/subfolders
 * @returns Promise with folder/document update counts
 */
export const toggleFolderVisibility = withAuth(async (
  user,
  { tenant },
  folderId: string,
  isClientVisible: boolean,
  cascade: boolean = false
): Promise<{ folderUpdated: boolean; updatedDocuments: number } | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'update'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  const folder = await knex('document_folders')
    .select('folder_id', 'folder_path', 'entity_id', 'entity_type')
    .where('tenant', tenant)
    .andWhere('folder_id', folderId)
    .first();

  if (!folder) {
    throw new Error('Folder not found');
  }

  const folderUpdatedCount = await knex('document_folders')
    .where('tenant', tenant)
    .andWhere('folder_id', folderId)
    .update({
      is_client_visible: isClientVisible,
    });

  let updatedDocuments = 0;

  if (cascade) {
    // Escape SQL LIKE wildcards in folder path before using in pattern
    const escapedPath = folder.folder_path.replace(/%/g, '\\%').replace(/_/g, '\\_');
    let documentsQuery = knex('documents as d')
      .where('d.tenant', tenant)
      .where(function() {
        this.where('d.folder_path', folder.folder_path)
          .orWhere('d.folder_path', 'like', `${escapedPath}/%`);
      });

    if (folder.entity_id && folder.entity_type) {
      documentsQuery = documentsQuery.whereExists(function() {
        this.select('*')
          .from('document_associations as da')
          .whereRaw('da.document_id = d.document_id')
          .andWhere('da.tenant', tenant)
          .andWhere('da.entity_id', folder.entity_id)
          .andWhere('da.entity_type', folder.entity_type);
      });
    } else {
      documentsQuery = documentsQuery.whereNotExists(function() {
        this.select('*')
          .from('document_associations as da')
          .whereRaw('da.document_id = d.document_id')
          .andWhere('da.tenant', tenant);
      });
    }

    const documentUpdatedCount = await documentsQuery.update({
      is_client_visible: isClientVisible,
      updated_at: new Date(),
    });

    updatedDocuments = Number(documentUpdatedCount || 0);
  }

  return {
    folderUpdated: Number(folderUpdatedCount || 0) > 0,
    updatedDocuments,
  };
});

/**
 * Toggle client visibility for a folder by path (used by FolderTreeView which has paths, not IDs).
 */
export const toggleFolderVisibilityByPath = withAuth(async (
  user,
  { tenant },
  folderPath: string,
  isClientVisible: boolean,
  entityId?: string | null,
  entityType?: string | null,
  cascade?: boolean
): Promise<{ folderUpdated: boolean; updatedDocuments: number } | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'update'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  const query = knex('document_folders')
    .select('folder_id', 'folder_path', 'entity_id', 'entity_type')
    .where('tenant', tenant)
    .andWhere('folder_path', folderPath);

  if (entityId && entityType) {
    query.andWhere('entity_id', entityId).andWhere('entity_type', entityType);
  }

  const folder = await query.first();

  if (!folder) {
    throw new Error('Folder not found');
  }

  const folderUpdatedCount = await knex('document_folders')
    .where('tenant', tenant)
    .andWhere('folder_id', folder.folder_id)
    .update({
      is_client_visible: isClientVisible,
    });

  let updatedDocuments = 0;

  if (cascade) {
    const escapedPath = folder.folder_path.replace(/%/g, '\\%').replace(/_/g, '\\_');
    let documentsQuery = knex('documents as d')
      .where('d.tenant', tenant)
      .where(function() {
        this.where('d.folder_path', folder.folder_path)
          .orWhere('d.folder_path', 'like', `${escapedPath}/%`);
      });

    if (folder.entity_id && folder.entity_type) {
      documentsQuery = documentsQuery.whereExists(function() {
        this.select('*')
          .from('document_associations as da')
          .whereRaw('da.document_id = d.document_id')
          .andWhere('da.tenant', tenant)
          .andWhere('da.entity_id', folder.entity_id)
          .andWhere('da.entity_type', folder.entity_type);
      });
    } else {
      documentsQuery = documentsQuery.whereNotExists(function() {
        this.select('*')
          .from('document_associations as da')
          .whereRaw('da.document_id = d.document_id')
          .andWhere('da.tenant', tenant);
      });
    }

    const documentUpdatedCount = await documentsQuery.update({
      is_client_visible: isClientVisible,
      updated_at: new Date(),
    });

    updatedDocuments = Number(documentUpdatedCount || 0);
  }

  return {
    folderUpdated: Number(folderUpdatedCount || 0) > 0,
    updatedDocuments,
  };
});

/**
 * Ensure entity-scoped folders are initialized.
 *
 * On first access, applies the default folder template for the given entity type
 * (if one exists), then records initialization so subsequent calls are no-ops.
 * Idempotent: skips folders that already exist.
 *
 * @param entityId - Target entity ID
 * @param entityType - Target entity type
 * @returns Promise<IFolderNode[]> - The folder tree for this entity
 */
export const ensureEntityFolders = withAuth(async (
  user,
  { tenant },
  entityId: string,
  entityType: string
): Promise<IFolderNode[] | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'read'))) {
    return permissionError('Permission denied');
  }

  if (!entityId || !entityType) {
    throw new Error('Both entityId and entityType are required');
  }

  const { knex } = await createTenantKnex();
  await ensureEntityFoldersInitializedInternal(knex, tenant, entityId, entityType, user.user_id);

  // Return current folder tree
  return _getFolderTreeInternal(knex, tenant, entityId, entityType);
});

/**
 * Get folder statistics (document count, total size)
 *
 * @param folderPath - Path to folder
 * @returns Promise<IFolderStats> - Folder statistics
 */
export const getFolderStats = withAuth(async (
  user,
  { tenant },
  folderPath: string
): Promise<IFolderStats> => {
  const { knex } = await createTenantKnex();

  const result = await knex('documents')
    .where('tenant', tenant)
    .where(function() {
      this.where('folder_path', folderPath)
        .orWhere('folder_path', 'like', `${folderPath}/%`);
    })
    .count('* as count')
    .sum('file_size as size')
    .first();

  return {
    path: folderPath,
    documentCount: parseInt(result?.count as string) || 0,
    totalSize: parseInt(result?.size as string) || 0,
  };
});

/**
 * Create a new folder explicitly
 *
 * @param folderPath - Full path to the folder (e.g., '/Legal/Contracts')
 * @param entityId - Optional entity scope ID for entity-specific folders
 * @param entityType - Optional entity scope type for entity-specific folders
 * @param isClientVisible - Optional visibility flag for client portal
 * @returns Promise<void>
 */
export const createFolder = withAuth(async (
  user,
  { tenant },
  folderPath: string,
  entityId?: string | null,
  entityType?: string | null,
  isClientVisible: boolean = false
): Promise<void | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'create'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  // Validate folder path
  if (!folderPath || !folderPath.startsWith('/')) {
    throw new Error('Folder path must start with /');
  }

  if ((entityId && !entityType) || (!entityId && entityType)) {
    throw new Error('Both entityId and entityType are required when scoping a folder to an entity');
  }

  const hasEntityScope = Boolean(entityId && entityType);

  // Extract folder name from path
  const parts = folderPath.split('/').filter(p => p.length > 0);
  if (parts.length === 0) {
    throw new Error('Invalid folder path');
  }
  const folderName = parts[parts.length - 1];

  // Get parent folder path
  const parentPath = parts.length > 1
    ? '/' + parts.slice(0, -1).join('/')
    : null;

  // Get parent folder ID if exists
  let parentFolderId = null;
  if (parentPath) {
    const parentFolderQuery = knex('document_folders')
      .where('tenant', tenant)
      .where('folder_path', parentPath);

    if (hasEntityScope) {
      parentFolderQuery
        .andWhere('entity_id', entityId)
        .andWhere('entity_type', entityType);
    } else {
      parentFolderQuery
        .whereNull('entity_id')
        .whereNull('entity_type');
    }

    const parentFolder = await parentFolderQuery.first();

    if (parentFolder) {
      parentFolderId = parentFolder.folder_id;
    }
  }

  // Check if folder already exists
  const existingFolderQuery = knex('document_folders')
    .where('tenant', tenant)
    .where('folder_path', folderPath);

  if (hasEntityScope) {
    existingFolderQuery
      .andWhere('entity_id', entityId)
      .andWhere('entity_type', entityType);
  } else {
    existingFolderQuery
      .whereNull('entity_id')
      .whereNull('entity_type');
  }

  const existingFolder = await existingFolderQuery.first();

  if (existingFolder) {
    // Folder already exists, that's fine
    return;
  }

  // Create folder
  await knex('document_folders').insert({
    tenant,
    folder_path: folderPath,
    folder_name: folderName,
    parent_folder_id: parentFolderId,
    entity_id: hasEntityScope ? entityId : null,
    entity_type: hasEntityScope ? entityType : null,
    is_client_visible: isClientVisible,
    created_by: user.user_id,
  });
});

/**
 * Delete a folder (only if it's empty - no documents and no subfolders)
 *
 * @param folderPath - Path to the folder to delete
 * @returns Promise<void>
 */
export const deleteFolder = withAuth(async (user, { tenant }, folderPath: string): Promise<void | ActionPermissionError> => {
  if (!(await hasPermission(user, 'document', 'delete'))) {
    return permissionError('Permission denied');
  }

  const { knex } = await createTenantKnex();

  // Check if folder has documents
  const docCount = await knex('documents')
    .where('tenant', tenant)
    .where('folder_path', folderPath)
    .count('* as count')
    .first();

  if (parseInt(docCount?.count as string) > 0) {
    throw new Error('Cannot delete folder: contains documents');
  }

  // Check if folder has subfolders
  const subfolderCount = await knex('document_folders')
    .where('tenant', tenant)
    .where('folder_path', 'like', `${folderPath}/%`)
    .count('* as count')
    .first();

  if (parseInt(subfolderCount?.count as string) > 0) {
    throw new Error('Cannot delete folder: contains subfolders');
  }

  // Delete folder
  await knex('document_folders')
    .where('tenant', tenant)
    .where('folder_path', folderPath)
    .delete();
});

// Helper functions
function buildFolderTreeFromPaths(
  paths: string[],
  explicitFolderMetadata: Map<string, Pick<IFolderNode, 'entity_id' | 'entity_type' | 'is_client_visible'>> = new Map()
): IFolderNode[] {
  const root: IFolderNode[] = [];

  for (const path of paths) {
    const parts = path.split('/').filter(p => p.length > 0);
    let currentLevel = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;

      let node = currentLevel.find(n => n.name === part);
      if (!node) {
        const folderMetadata = explicitFolderMetadata.get(currentPath);
        node = {
          path: currentPath,
          name: part,
          children: [],
          documentCount: 0,
          ...(folderMetadata ?? {}),
        };
        currentLevel.push(node);
      }

      const folderMetadata = explicitFolderMetadata.get(currentPath);
      if (folderMetadata) {
        node.entity_id = folderMetadata.entity_id ?? null;
        node.entity_type = folderMetadata.entity_type ?? null;
        node.is_client_visible = folderMetadata.is_client_visible;
      }

      currentLevel = node.children;
    }
  }

  return root;
}

async function enrichFolderTreeWithCounts(
  nodes: IFolderNode[],
  knex: Knex,
  tenant: string,
  entityId?: string | null,
  entityType?: string | null
): Promise<void> {
  // Collect all folder paths in the tree (including nested)
  const allPaths: string[] = [];
  function collectPaths(nodeList: IFolderNode[]) {
    for (const node of nodeList) {
      allPaths.push(node.path);
      if (node.children.length > 0) {
        collectPaths(node.children);
      }
    }
  }
  collectPaths(nodes);

  if (allPaths.length === 0) {
    return;
  }

  // Note: This is an internal helper called from within withAuth-wrapped functions
  // so the tenant context is already established. We use a fixed set of entity types.
  const allowedEntityTypes = ['ticket', 'client', 'contact', 'asset', 'project_task', 'contract'];

  // Single query to get counts for ALL folders at once - with same permission filtering as getDocumentsByFolder
  const countsQuery = knex('documents as d')
    .where('d.tenant', tenant)
    .whereIn('d.folder_path', allPaths);

  if (entityId && entityType) {
    // Entity-scoped: only count documents associated with this specific entity
    countsQuery.whereExists(function() {
      this.select('*')
        .from('document_associations as da')
        .whereRaw('da.document_id = d.document_id')
        .andWhere('da.tenant', tenant)
        .andWhere('da.entity_id', entityId)
        .andWhere('da.entity_type', entityType);
    });
  } else {
    // Tenant-level: count unassociated docs + docs with allowed entity types
    countsQuery.where(function() {
      // Option 1: Document has no associations (tenant-level doc)
      this.whereNotExists(function() {
        this.select('*')
          .from('document_associations as da')
          .whereRaw('da.document_id = d.document_id')
          .andWhere('da.tenant', tenant);
      })
      // Option 2: Document has associations user has permission for
      .orWhereExists(function() {
        this.select('*')
          .from('document_associations as da')
          .whereRaw('da.document_id = d.document_id')
          .andWhere('da.tenant', tenant)
          .whereIn('da.entity_type', allowedEntityTypes);
      });
    });
  }

  const counts = await countsQuery
    .groupBy('d.folder_path')
    .select('d.folder_path')
    .count('* as count');

  // Build map of path -> count
  const countMap = new Map<string, number>();
  for (const row of counts) {
    const count = typeof row.count === 'string' ? parseInt(row.count) : Number(row.count);
    countMap.set(String(row.folder_path), count);
  }

  // Apply counts to nodes recursively
  function applyCounts(nodeList: IFolderNode[]) {
    for (const node of nodeList) {
      node.documentCount = countMap.get(node.path) || 0;
      if (node.children.length > 0) {
        applyCounts(node.children);
      }
    }
  }
  applyCounts(nodes);
}

// ---------------------------------------------------------------------------
// Look up a document by its external file_id (used by the invoice designer
// image picker to check client-portal visibility).
// ---------------------------------------------------------------------------
export const getDocumentByFileId = withAuth(async (
  user,
  { tenant },
  fileId: string
): Promise<{ document_id: string; document_name: string; is_client_visible: boolean } | null> => {
  if (!await hasPermission(user, 'document', 'read')) {
    return null;
  }

  const { knex } = await createTenantKnex();

  const row = await withTransaction(knex, async (trx: Knex.Transaction) =>
    getAuthorizedDocumentByFileId(trx, tenant, user, fileId)
  );

  if (!row) return null;

  return {
    document_id: row.document_id,
    document_name: row.document_name,
    is_client_visible: !!row.is_client_visible,
  };
});

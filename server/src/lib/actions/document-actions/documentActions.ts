'use server'

import { StorageService } from 'server/src/lib/storage/StorageService';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@shared/db';
import { Knex } from 'knex';
import { marked } from 'marked';
import { PDFDocument } from 'pdf-lib';
import { fromPath } from 'pdf2pic';
import sharp from 'sharp';
import puppeteer from 'puppeteer';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { CacheFactory } from 'server/src/lib/cache/CacheFactory';
import { convertBlockNoteToHTML } from 'server/src/lib/utils/blocknoteUtils';
import DocumentAssociation from 'server/src/models/document-association';
import {
    IDocument,
    IDocumentType,
    ISharedDocumentType,
    DocumentFilters,
    PreviewResponse,
    DocumentInput,
    PaginatedDocumentsResponse,
    IFolderNode,
    IFolderStats
} from 'server/src/interfaces/document.interface';
import { IDocumentAssociation, IDocumentAssociationInput, DocumentAssociationEntityType } from 'server/src/interfaces/document-association.interface';
import { v4 as uuidv4 } from 'uuid';
import { deleteFile } from 'server/src/lib/actions/file-actions/fileActions';
import { NextResponse } from 'next/server';
import { deleteDocumentContent } from './documentContentActions';
import { deleteBlockContent } from './documentBlockContentActions';
import { DocumentHandlerRegistry } from 'server/src/lib/document-handlers/DocumentHandlerRegistry';
import { getCurrentUser } from '../user-actions/userActions';
import { hasPermission } from 'server/src/lib/auth/rbac';
import { getEntityTypesForUser } from 'server/src/lib/utils/documentPermissionUtils';

// Add new document
export async function addDocument(data: DocumentInput) {
  try {
    const { tenant, knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Get current user if not provided
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document creation
    if (!await hasPermission(currentUser, 'document', 'create')) {
      throw new Error('Permission denied: Cannot create documents');
    }

    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documentId = uuidv4();
      
      // Clean up the data - replace empty strings with proper values
      const cleanedData = {
        ...data,
        user_id: data.user_id || currentUser.user_id,
        created_by: data.created_by || currentUser.user_id,
        tenant: tenant
      };

      // Remove empty string values that should be null
      if (cleanedData.user_id === '') {
        cleanedData.user_id = currentUser.user_id;
      }
      if (cleanedData.created_by === '') {
        cleanedData.created_by = currentUser.user_id;
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
}

// Update document
export async function updateDocument(documentId: string, data: Partial<IDocument>) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document updates
    if (!await hasPermission(currentUser, 'document', 'update')) {
      throw new Error('Permission denied: Cannot update documents');
    }

    const { tenant, knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

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
}

// Delete document
export async function deleteDocument(documentId: string, userId: string) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document deletion
    if (!await hasPermission(currentUser, 'document', 'delete')) {
      throw new Error('Permission denied: Cannot delete documents');
    }

    const { tenant, knex } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Use a single transaction for all database operations
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Get the document first to get the file_id
      const document = await trx('documents')
        .where({ document_id: documentId, tenant })
        .first();
      if (!document) {
        throw new Error('Document not found');
      }

      // First, update any clients that reference this document as notes_document_id
      // We need to do this manually because of the composite foreign key constraint
      await trx('clients')
        .where({
          notes_document_id: documentId,
          tenant
        })
        .update({
          notes_document_id: null
        });

      // Delete all associations
      await DocumentAssociation.deleteByDocument(trx, document.document_id);

      // Delete the document record
      await trx('documents').where({ document_id: documentId, tenant }).delete();

      return document;
    });

    // If there's an associated file, delete it from storage (outside transaction)
    if (result.file_id) {
      // Delete file from storage and soft delete file record
      const deleteResult = await deleteFile(result.file_id, userId);
      if (!deleteResult.success) {
        throw new Error(deleteResult.error || 'Failed to delete file from storage');
      }

      // Clear preview cache if it exists
      const cache = CacheFactory.getPreviewCache(tenant);
      await cache.delete(result.file_id);
    }

    // Delete document content and block content (outside transaction)
    await Promise.all([
      deleteDocumentContent(documentId),
      deleteBlockContent(documentId)
    ]);

    return { success: true };
  } catch (error) {
    console.error('Error deleting document:', error);
    throw new Error(error instanceof Error ? error.message : "Failed to delete the document");
  }
}

// Get single document
export async function getDocument(documentId: string) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

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
      created_by_full_name: document.created_by_full_name,
      type_name: document.type_name,
      type_icon: document.type_icon,
      entered_at: document.entered_at,
      updated_at: document.updated_at,
      edited_by: document.edited_by
    };

    return processedDoc;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the document");
  }
}

// Get documents by ticket
export async function getDocumentByTicketId(ticketId: string) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documents = await trx('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('documents.tenant', '=', 'document_associations.tenant');
        })
        .where({
          'document_associations.entity_id': ticketId,
          'document_associations.entity_type': 'ticket',
          'documents.tenant': tenant,
          'document_associations.tenant': tenant
        })
        .select('documents.*');
      return documents;
    });
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
}

// Get documents by client
export async function getDocumentByClientId(clientId: string) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documents = await trx('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('documents.tenant', '=', 'document_associations.tenant');
        })
        .where({
          'document_associations.entity_id': clientId,
          'document_associations.entity_type': 'client',
          'documents.tenant': tenant,
          'document_associations.tenant': tenant
        })
        .select('documents.*');
      return documents;
    });
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
}

// Get documents by contact
export async function getDocumentByContactNameId(contactNameId: string) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }
    return await withTransaction(knex, async (trx: Knex.Transaction) => {
      const documents = await trx('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('documents.tenant', '=', 'document_associations.tenant');
        })
        .where({
          'document_associations.entity_id': contactNameId,
          'document_associations.entity_type': 'contact',
          'documents.tenant': tenant,
          'document_associations.tenant': tenant
        })
        .select('documents.*');
      return documents;
    });
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
}

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
 *
 * @param identifier The document ID or file ID to generate a preview for
 * @returns A promise that resolves to a PreviewResponse
 */
export async function getDocumentPreview(
  identifier: string
): Promise<PreviewResponse> {
  console.log(`[getDocumentPreview] Received identifier: ${identifier}`);
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      console.error("[getDocumentPreview] No tenant found");
      throw new Error('No tenant found');
    }

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
      
      // Check cache for file ID
      const cache = CacheFactory.getPreviewCache(tenant);
      const cachedPreview = await cache.get(identifier);
      if (cachedPreview) {
        console.log(`[getDocumentPreview] Cache hit for file ID: ${identifier}`);
        const imageBuffer = await sharp(cachedPreview).toBuffer();
        const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;
        return {
          success: true,
          previewImage: base64Image,
          content: 'Cached Preview'
        };
      }
      
      // Try to download the file to get metadata
      try {
        const downloadResult = await StorageService.downloadFile(identifier);
        if (!downloadResult) {
          console.error(`[getDocumentPreview] File not found in storage for ID: ${identifier}`);
          return {
            success: false,
            error: 'File not found in storage'
          };
        }

        // Create a temporary document object with file metadata
        document = {
          document_id: identifier,
          document_name: downloadResult.metadata.original_name || 'Unknown',
          type_id: null,
          user_id: '',
          order_number: 0,
          created_by: '',
          tenant,
          file_id: identifier,
          mime_type: downloadResult.metadata.mime_type,
          type_name: downloadResult.metadata.mime_type
        };
      } catch (storageError) {
        console.error(`[getDocumentPreview] Storage error for ID ${identifier}:`, storageError);
        return {
          success: false,
          error: 'File not found or inaccessible'
        };
      }
    }

    // Use the document handler registry to get the appropriate handler
    const handlerRegistry = DocumentHandlerRegistry.getInstance();
    return await handlerRegistry.generatePreview(document, tenant, knex);
  } catch (error) {
    console.error(`[getDocumentPreview] General error for identifier ${identifier}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to preview file'
    };
  }
}

// Get document download URL
export async function getDocumentDownloadUrl(file_id: string): Promise<string> {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading/download
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    return `/api/documents/download/${file_id}`;
}

// Download document
export async function downloadDocument(documentIdOrFileId: string) {
    try {
        const currentUser = await getCurrentUser();
        if (!currentUser) {
          throw new Error('No authenticated user found');
        }

        // Check permission for document reading/download
        if (!await hasPermission(currentUser, 'document', 'read')) {
          throw new Error('Permission denied: Cannot read documents');
        }

        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

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

        // Download file from storage
        const result = await StorageService.downloadFile(document.file_id);
        if (!result) {
            throw new Error('File not found in storage');
        }

        const { buffer, metadata } = result;

        // Set appropriate headers for file download
        const headers = new Headers();
        headers.set('Content-Type', metadata.mime_type || 'application/octet-stream');

        // Properly encode filename to handle special characters
        const encodedFilename = encodeURIComponent(document.document_name || 'download');
        const asciiFilename = document.document_name?.replace(/[^\x00-\x7F]/g, '_') || 'download';
        headers.set('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
        headers.set('Content-Length', buffer.length.toString());
        
        // Add cache control headers for images to enable browser caching
        const isImage = metadata.mime_type?.startsWith('image/');
        if (isImage) {
            // Cache images for 7 days, but revalidate after 1 day
            headers.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
            // Add ETag for conditional requests
            headers.set('ETag', `"${document.file_id}"`);
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
}

// Get documents by entity using the new association table
export async function getDocumentCountsForEntities(
  entityIds: string[],
  entityType: string
): Promise<Map<string, number>> {
  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.tenant) {
    throw new Error('User not authenticated');
  }

  const { knex } = await createTenantKnex();
  
  try {
    const counts = await knex('document_associations')
      .select('entity_id')
      .count('document_id as count')
      .where('tenant', currentUser.tenant)
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
  } catch (error) {
    console.error('Error fetching document counts:', error);
    throw error;
  }
}

export async function getDocumentsByEntity(
  entity_id: string,
  entity_type: string,
  filters?: DocumentFilters,
  page: number = 1,
  limit: number = 15
): Promise<PaginatedDocumentsResponse> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    console.log('Getting documents for entity:', { entity_id, entity_type, filters, page, limit });

    const offset = (page - 1) * limit;

    // Base query structure, executed sequentially
    const buildBaseQuery = () => {
      let query = knex('documents')
        .join('document_associations', function() {
          this.on('documents.document_id', '=', 'document_associations.document_id')
              .andOn('document_associations.tenant', '=', knex.raw('?', [tenant]));
        })
        .leftJoin('users', function() {
          this.on('documents.created_by', '=', 'users.user_id')
              .andOn('users.tenant', '=', knex.raw('?', [tenant]));
        })
        .leftJoin('document_types as dt', function() {
          this.on('documents.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', knex.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
        .where('documents.tenant', tenant)
        .where('document_associations.entity_id', entity_id)
        .andWhere('document_associations.entity_type', entity_type);

      if (filters) {
        if (filters.searchTerm) {
          query = query.whereRaw('LOWER(documents.document_name) LIKE ?',
            [`%${filters.searchTerm.toLowerCase()}%`]);
        }
        if (filters.uploadedBy) {
          query = query.where('documents.created_by', filters.uploadedBy);
        }
        if (filters.updated_at_start) {
          query = query.where('documents.updated_at', '>=', filters.updated_at_start);
        }
        if (filters.updated_at_end) {
          const endDate = new Date(filters.updated_at_end);
          endDate.setDate(endDate.getDate() + 1);
          query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
        }
      }
      return query;
    };

    // Execute count query first
    const totalResult = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const buildBaseTrxQuery = () => {
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
          .andWhere('document_associations.entity_type', entity_type);

        if (filters) {
          if (filters.searchTerm) {
            query = query.whereRaw('LOWER(documents.document_name) LIKE ?',
              [`%${filters.searchTerm.toLowerCase()}%`]);
          }
          if (filters.uploadedBy) {
            query = query.where('documents.created_by', filters.uploadedBy);
          }
          if (filters.updated_at_start) {
            query = query.where('documents.updated_at', '>=', filters.updated_at_start);
          }
          if (filters.updated_at_end) {
            const endDate = new Date(filters.updated_at_end);
            endDate.setDate(endDate.getDate() + 1);
            query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
          }
        }
        return query;
      };
      return await buildBaseTrxQuery()
        .countDistinct('documents.document_id as total')
        .first();
    });
    const totalCount = totalResult ? Number(totalResult.total) : 0;

    // Execute data query second
    const documents = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const buildBaseTrxQuery = () => {
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
          .andWhere('document_associations.entity_type', entity_type);

        if (filters) {
          if (filters.searchTerm) {
            query = query.whereRaw('LOWER(documents.document_name) LIKE ?',
              [`%${filters.searchTerm.toLowerCase()}%`]);
          }
          if (filters.uploadedBy) {
            query = query.where('documents.created_by', filters.uploadedBy);
          }
          if (filters.updated_at_start) {
            query = query.where('documents.updated_at', '>=', filters.updated_at_start);
          }
          if (filters.updated_at_end) {
            const endDate = new Date(filters.updated_at_end);
            endDate.setDate(endDate.getDate() + 1);
            query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
          }
        }
        return query;
      };
      return await buildBaseTrxQuery()
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
        .orderBy('documents.updated_at', 'desc')
        .limit(limit)
        .offset(offset)
        .distinct('documents.document_id');
    });

    console.log('Raw documents from database:', documents);
    console.log('Total count:', totalCount);

    // Process the documents
    const processedDocuments = documents.map((doc: any): IDocument => {
      const processedDoc = {
        document_id: doc.document_id,
        document_name: doc.document_name,
        type_id: doc.type_id,
        shared_type_id: doc.shared_type_id,
        user_id: doc.created_by,
        order_number: doc.order_number || 0,
        created_by: doc.created_by,
        tenant: doc.tenant,
        file_id: doc.file_id,
        storage_path: doc.storage_path,
        mime_type: doc.mime_type,
        file_size: doc.file_size,
        created_by_full_name: doc.created_by_full_name,
        type_name: doc.type_name,
        type_icon: doc.type_icon,
        entered_at: doc.entered_at,
        updated_at: doc.updated_at
      };
      console.log('Processed document:', processedDoc);
      return processedDoc;
    });

    return {
      documents: processedDocuments,
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
    };
  } catch (error) {
    console.error('Error fetching documents by entity:', error);
    throw new Error('Failed to fetch documents');
  }
}

// Get all documents with optional filtering
export async function getAllDocuments(
  filters?: DocumentFilters,
  page: number = 1,
  limit: number = 10
): Promise<PaginatedDocumentsResponse> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    console.log('Getting documents with filters:', { filters, page, limit });
    const offset = (page - 1) * limit;

    // Base query structure, executed sequentially
    const buildBaseQuery = () => {
      let query = knex('documents')
        .where('documents.tenant', tenant);

      query = query
        .leftJoin('document_types as dt', function() {
          this.on('documents.type_id', '=', 'dt.type_id')
              .andOn('dt.tenant', '=', knex.raw('?', [tenant]));
        })
        .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
        .leftJoin('users', function() {
          this.on('documents.created_by', '=', 'users.user_id')
              .andOn('users.tenant', '=', knex.raw('?', [tenant]));
        });

      if (filters) {
        if (filters.searchTerm) {
          query = query.whereRaw('LOWER(documents.document_name) LIKE ?',
            [`%${filters.searchTerm.toLowerCase()}%`]);
        }

        if (filters.type) {
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

        if (filters.uploadedBy) {
          query = query.where('documents.created_by', filters.uploadedBy);
        }

        if (filters.updated_at_start) {
          query = query.where('documents.updated_at', '>=', filters.updated_at_start);
        }
        if (filters.updated_at_end) {
          const endDate = new Date(filters.updated_at_end);
          endDate.setDate(endDate.getDate() + 1);
          query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
        }

        if (filters.excludeEntityId && filters.excludeEntityType) {
          query = query.whereNotExists(function() {
            this.select('*')
                .from('document_associations')
                .whereRaw('document_associations.document_id = documents.document_id')
                .andWhere('document_associations.entity_id', filters.excludeEntityId)
                .andWhere('document_associations.entity_type', filters.excludeEntityType)
                .andWhere('document_associations.tenant', tenant);
          });
        }

        if (filters.entityType) {
          query = query
            .leftJoin('document_associations', function() {
              this.on('documents.document_id', '=', 'document_associations.document_id')
                  .andOn('document_associations.tenant', '=', knex.raw('?', [tenant]));
            })
            .where('document_associations.entity_type', filters.entityType);
        }
      }
      return query;
    };

    // Execute count query first
    const totalResult = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const buildBaseTrxQuery = () => {
        let query = trx('documents')
          .where('documents.tenant', tenant);

        query = query
          .leftJoin('document_types as dt', function() {
            this.on('documents.type_id', '=', 'dt.type_id')
                .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
          })
          .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
          .leftJoin('users', function() {
            this.on('documents.created_by', '=', 'users.user_id')
                .andOn('users.tenant', '=', trx.raw('?', [tenant]));
          });

        if (filters) {
          if (filters.searchTerm) {
            query = query.whereRaw('LOWER(documents.document_name) LIKE ?',
              [`%${filters.searchTerm.toLowerCase()}%`]);
          }

          if (filters.type) {
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

          if (filters.uploadedBy) {
            query = query.where('documents.created_by', filters.uploadedBy);
          }

          if (filters.updated_at_start) {
            query = query.where('documents.updated_at', '>=', filters.updated_at_start);
          }
          if (filters.updated_at_end) {
            const endDate = new Date(filters.updated_at_end);
            endDate.setDate(endDate.getDate() + 1);
            query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
          }

          if (filters.excludeEntityId && filters.excludeEntityType) {
            query = query.whereNotExists(function() {
              this.select('*')
                  .from('document_associations')
                  .whereRaw('document_associations.document_id = documents.document_id')
                  .andWhere('document_associations.entity_id', filters.excludeEntityId)
                  .andWhere('document_associations.entity_type', filters.excludeEntityType)
                  .andWhere('document_associations.tenant', tenant);
            });
          }

          if (filters.entityType) {
            query = query
              .leftJoin('document_associations', function() {
                this.on('documents.document_id', '=', 'document_associations.document_id')
                    .andOn('document_associations.tenant', '=', trx.raw('?', [tenant]));
              })
              .where('document_associations.entity_type', filters.entityType);
          }
        }
        return query;
      };
      return await buildBaseTrxQuery()
        .countDistinct('documents.document_id as total')
        .first();
    });
    const totalCount = totalResult ? Number(totalResult.total) : 0;

    // Execute data query second
    const documents = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const buildBaseTrxQuery = () => {
        let query = trx('documents')
          .where('documents.tenant', tenant);

        query = query
          .leftJoin('document_types as dt', function() {
            this.on('documents.type_id', '=', 'dt.type_id')
                .andOn('dt.tenant', '=', trx.raw('?', [tenant]));
          })
          .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
          .leftJoin('users', function() {
            this.on('documents.created_by', '=', 'users.user_id')
                .andOn('users.tenant', '=', trx.raw('?', [tenant]));
          });

        if (filters) {
          if (filters.searchTerm) {
            query = query.whereRaw('LOWER(documents.document_name) LIKE ?',
              [`%${filters.searchTerm.toLowerCase()}%`]);
          }

          if (filters.type) {
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

          if (filters.uploadedBy) {
            query = query.where('documents.created_by', filters.uploadedBy);
          }

          if (filters.updated_at_start) {
            query = query.where('documents.updated_at', '>=', filters.updated_at_start);
          }
          if (filters.updated_at_end) {
            const endDate = new Date(filters.updated_at_end);
            endDate.setDate(endDate.getDate() + 1);
            query = query.where('documents.updated_at', '<', endDate.toISOString().split('T')[0]);
          }

          if (filters.excludeEntityId && filters.excludeEntityType) {
            query = query.whereNotExists(function() {
              this.select('*')
                  .from('document_associations')
                  .whereRaw('document_associations.document_id = documents.document_id')
                  .andWhere('document_associations.entity_id', filters.excludeEntityId)
                  .andWhere('document_associations.entity_type', filters.excludeEntityType)
                  .andWhere('document_associations.tenant', tenant);
            });
          }

          if (filters.entityType) {
            query = query
              .leftJoin('document_associations', function() {
                this.on('documents.document_id', '=', 'document_associations.document_id')
                    .andOn('document_associations.tenant', '=', trx.raw('?', [tenant]));
              })
              .where('document_associations.entity_type', filters.entityType);
          }
        }
        return query;
      };
      
      let query = buildBaseTrxQuery()
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
        .limit(limit)
        .offset(offset)
        .distinct('documents.document_id');
      
      // Apply sorting based on filters
      if (filters?.sortBy) {
        const sortField = filters.sortBy;
        const sortOrder = filters.sortOrder || 'desc';
        
        // Handle special case for created_by_full_name which is a computed field
        if (sortField === 'created_by_full_name') {
          query = query.orderByRaw(`CONCAT(users.first_name, ' ', users.last_name) ${sortOrder}`);
        } else {
          // For other fields, prefix with table name for clarity
          query = query.orderBy(`documents.${sortField}`, sortOrder);
        }
      } else {
        // Default sort by updated_at desc if no sort specified
        query = query.orderBy('documents.updated_at', 'desc');
      }

      return await query;
    });

    console.log('Raw documents from database:', documents);
    console.log('Total count:', totalCount);

    // Process the documents
    const processedDocuments = documents.map((doc: any): IDocument => {
      const processedDoc = {
        document_id: doc.document_id,
        document_name: doc.document_name,
        type_id: doc.type_id,
        shared_type_id: doc.shared_type_id,
        user_id: doc.created_by,
        order_number: doc.order_number || 0,
        created_by: doc.created_by,
        tenant: doc.tenant,
        file_id: doc.file_id,
        storage_path: doc.storage_path,
        mime_type: doc.mime_type,
        file_size: doc.file_size,
        created_by_full_name: doc.created_by_full_name,
        type_name: doc.type_name,
        type_icon: doc.type_icon,
        entered_at: doc.entered_at,
        updated_at: doc.updated_at
      };
      console.log('Processed document:', processedDoc);
      return processedDoc;
    });

    return {
      documents: processedDocuments,
      totalCount,
      currentPage: page,
      totalPages: Math.ceil(totalCount / limit),
    };
  } catch (error) {
    console.error('Error fetching documents:', error);
    throw error;
  }
}

// Create document associations
export async function createDocumentAssociations(
  entity_id: string,
  entity_type: DocumentAssociationEntityType,
  document_ids: string[]
): Promise<{ success: boolean }> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document updates (associating documents is an update operation)
    if (!await hasPermission(currentUser, 'document', 'update')) {
      throw new Error('Permission denied: Cannot update document associations');
    }

    const { knex: db, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Create associations for all selected documents
    const associations = document_ids.map((document_id): IDocumentAssociationInput => ({
      document_id,
      entity_id,
      entity_type,
      tenant
    }));

    await withTransaction(db, async (trx: Knex.Transaction) => {
      await Promise.all(
        associations.map((association): Promise<Pick<IDocumentAssociation, "association_id">> =>
          DocumentAssociation.create(trx, association)
        )
      );
    });

    return { success: true };
  } catch (error) {
    console.error('Error creating document associations:', error);
    throw new Error('Failed to create document associations');
  }
}

// Remove document associations
export async function removeDocumentAssociations(
  entity_id: string,
  entity_type: DocumentAssociationEntityType,
  document_ids?: string[]
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document updates (removing associations is an update operation)
    if (!await hasPermission(currentUser, 'document', 'update')) {
      throw new Error('Permission denied: Cannot update document associations');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    await withTransaction(knex, async (trx: Knex.Transaction) => {
      let query = trx('document_associations')
        .where('entity_id', entity_id)
        .andWhere('entity_type', entity_type)
        .andWhere('tenant', tenant);

      if (document_ids && document_ids.length > 0) {
        query = query.whereIn('document_id', document_ids);
      }

      return await query.delete();
    });

    return { success: true };
  } catch (error) {
    console.error('Error removing document associations:', error);
    throw new Error('Failed to remove document associations');
  }
}

// Upload new document
export async function uploadDocument(
  file: FormData,
  options: {
    userId: string;
    clientId?: string;
    ticketId?: string;
    contactNameId?: string;
    assetId?: string;
    projectTaskId?: string;
    folder_path?: string | null;
  }
): Promise<
  | { success: true; document: IDocument }
  | { success: false; error: string }
> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document creation/upload
    if (!await hasPermission(currentUser, 'document', 'create')) {
      throw new Error('Permission denied: Cannot create documents');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
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
        uploaded_by_id: options.userId
      });

      // Get document type based on mime type
      const { typeId, isShared } = await getDocumentTypeId(fileData.type);

      // Create document record
      const document: IDocument = {
        document_id: uuidv4(),
        document_name: fileData.name,
        type_id: isShared ? null : typeId,
        shared_type_id: isShared ? typeId : undefined,
        user_id: options.userId,
        order_number: 0,
        created_by: options.userId,
        tenant,
        file_id: uploadResult.file_id,
        storage_path: uploadResult.storage_path,
        mime_type: fileData.type,
        file_size: fileData.size,
        folder_path: options.folder_path || null
      };

      // Use transaction for document creation and associations
      return await withTransaction(knex, async (trx: Knex.Transaction) => {
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

        // Create all associations
        if (associations.length > 0) {
          await Promise.all(
            associations.map((association): Promise<Pick<IDocumentAssociation, "association_id">> =>
              DocumentAssociation.create(trx, association)
            )
          );
        }

        return {
          success: true,
          document: documentWithId
        };
      });
  } catch (error) {
    console.error('Error uploading document:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upload document'
    };
  }
}

// Centralized validation logic
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
export async function getDocumentTypeId(mimeType: string): Promise<{ typeId: string, isShared: boolean }> { // Export this function
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  // Check permission for document reading
  if (!await hasPermission(currentUser, 'document', 'read')) {
    throw new Error('Permission denied: Cannot read document types');
  }

  const { knex, tenant } = await createTenantKnex();

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
}

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
export async function getImageUrl(file_id: string): Promise<string | null> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read documents');
    }

    return await getImageUrlCore(file_id, true);
  } catch (error) {
    console.error(`getImageUrl: Error generating URL for file_id ${file_id}:`, error);
    return null;
  }
}

/**
 * Generates a URL for accessing an image file by its ID without authentication checks.
 * This is the INTERNAL API that bypasses user authentication and permission validation.
 * 
 * Use this function when:
 * - System-level operations that don't require user context
 * - Internal service calls where authentication is handled elsewhere
 * - Background processes and workflows
 * - Avatar utilities and other trusted internal operations
 * 
 * SECURITY WARNING: This function bypasses all user authentication and permission checks.
 * Only use in trusted contexts where access control is handled at a higher level.
 * 
 * @param file_id The ID of the file in external_files
 * @returns A promise resolving to the image URL string, or null if an error occurs or the file is not found/an image
 */
export async function getImageUrlInternal(file_id: string): Promise<string | null> {
  return await getImageUrlCore(file_id, false);
}
export async function getDistinctEntityTypes(): Promise<string[]> {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      throw new Error('No authenticated user found');
    }

    // Check permission for document reading
    if (!await hasPermission(currentUser, 'document', 'read')) {
      throw new Error('Permission denied: Cannot read document associations');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

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
}

// ============================================================================
// FOLDER OPERATIONS
// ============================================================================

/**
 * Build a hierarchical folder tree from document folder_paths
 *
 * @returns Promise<IFolderNode[]> - Root level folders with nested children
 */
export async function getFolderTree(): Promise<IFolderNode[]> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  if (!(await hasPermission(currentUser, 'document', 'read'))) {
    throw new Error('Permission denied');
  }

  const { knex, tenant } = await createTenantKnex();

  // Get explicit folders from document_folders table
  const explicitFolders = await knex('document_folders')
    .select('folder_path')
    .where('tenant', tenant)
    .orderBy('folder_path', 'asc');

  const explicitPaths = explicitFolders.map((row: any) => row.folder_path);

  // Get implicit folder paths from documents
  const implicitFolders = await knex('documents')
    .select('folder_path')
    .where('tenant', tenant)
    .whereNotNull('folder_path')
    .andWhere('folder_path', '!=', '')
    .groupBy('folder_path');

  const implicitPaths = implicitFolders.map((row: any) => row.folder_path);

  // Merge both lists (remove duplicates)
  const allPaths = Array.from(new Set([...explicitPaths, ...implicitPaths]));

  // Build tree structure
  const tree = buildFolderTreeFromPaths(allPaths);

  // Get document counts for each folder (single query)
  await enrichFolderTreeWithCounts(tree, knex, tenant);

  return tree;
}

/**
 * Get documents in a specific folder (OPTIMIZED - filters at DB level)
 *
 * @param folderPath - Path to folder (e.g., '/Legal/Contracts')
 * @param includeSubfolders - Whether to include documents from subfolders
 * @param page - Page number
 * @param limit - Items per page
 * @returns Promise with documents and pagination info
 */
export async function getDocumentsByFolder(
  folderPath: string | null,
  includeSubfolders: boolean = false,
  page: number = 1,
  limit: number = 15
): Promise<{ documents: IDocument[]; total: number }> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  if (!(await hasPermission(currentUser, 'document', 'read'))) {
    throw new Error('Permission denied');
  }

  // Build list of entity types user has permission for
  const allowedEntityTypes = await getEntityTypesForUser(currentUser);

  const { knex, tenant } = await createTenantKnex();

  // Build base query with permission filtering at DB level
  let query = knex('documents as d')
    .where('d.tenant', tenant)
    .where(function() {
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

  // Add folder filtering
  if (folderPath) {
    if (includeSubfolders) {
      query = query.where(function() {
        this.where('d.folder_path', folderPath)
          .orWhere('d.folder_path', 'like', `${folderPath}/%`);
      });
    } else {
      query = query.where('d.folder_path', folderPath);
    }
  } else {
    // Root folder - documents with no folder_path
    query = query.whereNull('d.folder_path');
  }

  // Get total count
  const countResult = await query.clone().count('* as count');
  const total = parseInt(countResult[0].count as string);

  // Get paginated results
  const offset = (page - 1) * limit;
  const documents = await query
    .select('d.*')
    .limit(limit)
    .offset(offset)
    .orderBy('d.document_name', 'asc');

  return {
    documents,
    total,
  };
}

/**
 * Move documents to a different folder
 *
 * @param documentIds - Array of document IDs to move
 * @param newFolderPath - Destination folder path
 */
export async function moveDocumentsToFolder(
  documentIds: string[],
  newFolderPath: string | null
): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  if (!(await hasPermission(currentUser, 'document', 'update'))) {
    throw new Error('Permission denied');
  }

  const { knex, tenant } = await createTenantKnex();

  await knex('documents')
    .whereIn('document_id', documentIds)
    .andWhere('tenant', tenant)
    .update({
      folder_path: newFolderPath,
      updated_at: new Date(),
    });
}

/**
 * Get folder statistics (document count, total size)
 *
 * @param folderPath - Path to folder
 * @returns Promise<IFolderStats> - Folder statistics
 */
export async function getFolderStats(
  folderPath: string
): Promise<IFolderStats> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  const { knex, tenant } = await createTenantKnex();

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
}

/**
 * Create a new folder explicitly
 *
 * @param folderPath - Full path to the folder (e.g., '/Legal/Contracts')
 * @returns Promise<void>
 */
export async function createFolder(folderPath: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  if (!(await hasPermission(currentUser, 'document', 'create'))) {
    throw new Error('Permission denied');
  }

  const { knex, tenant } = await createTenantKnex();

  // Validate folder path
  if (!folderPath || !folderPath.startsWith('/')) {
    throw new Error('Folder path must start with /');
  }

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
    const parentFolder = await knex('document_folders')
      .where('tenant', tenant)
      .where('folder_path', parentPath)
      .first();

    if (parentFolder) {
      parentFolderId = parentFolder.folder_id;
    }
  }

  // Check if folder already exists
  const existingFolder = await knex('document_folders')
    .where('tenant', tenant)
    .where('folder_path', folderPath)
    .first();

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
    created_by: currentUser.user_id,
  });
}

/**
 * Delete a folder (only if it's empty - no documents and no subfolders)
 *
 * @param folderPath - Path to the folder to delete
 * @returns Promise<void>
 */
export async function deleteFolder(folderPath: string): Promise<void> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }

  if (!(await hasPermission(currentUser, 'document', 'delete'))) {
    throw new Error('Permission denied');
  }

  const { knex, tenant } = await createTenantKnex();

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
}

// Helper functions
function buildFolderTreeFromPaths(paths: string[]): IFolderNode[] {
  const root: IFolderNode[] = [];

  for (const path of paths) {
    const parts = path.split('/').filter(p => p.length > 0);
    let currentLevel = root;
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;

      let node = currentLevel.find(n => n.name === part);
      if (!node) {
        node = {
          path: currentPath,
          name: part,
          children: [],
          documentCount: 0,
        };
        currentLevel.push(node);
      }

      currentLevel = node.children;
    }
  }

  return root;
}

async function enrichFolderTreeWithCounts(
  nodes: IFolderNode[],
  knex: Knex,
  tenant: string
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

  // Single query to get counts for ALL folders at once
  const counts = await knex('documents')
    .where('tenant', tenant)
    .whereIn('folder_path', allPaths)
    .groupBy('folder_path')
    .select('folder_path')
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

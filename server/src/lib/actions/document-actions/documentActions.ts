'use server'

import { StorageService } from '../../storage/StorageService';
import { createTenantKnex } from '../../db';
import { marked } from 'marked';
import { PDFDocument } from 'pdf-lib';
import { fromPath } from 'pdf2pic';
import sharp from 'sharp';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { CacheFactory } from '../../cache/CacheFactory';
import Document from '../../models/document';
import DocumentAssociation from '../../models/document-association';
import {
    IDocument,
    IDocumentType,
    ISharedDocumentType,
    DocumentFilters,
    PreviewResponse,
    DocumentInput
} from '../../../interfaces/document.interface';
import { IDocumentAssociation, IDocumentAssociationInput } from '../../../interfaces/document-association.interface';
import { v4 as uuidv4 } from 'uuid';
import { getStorageConfig } from '../../../config/storage';
import { deleteFile } from '../file-actions/fileActions';
import { NextResponse } from 'next/server';
import { deleteDocumentContent } from './documentContentActions';
import { deleteBlockContent } from './documentBlockContentActions';

// Add new document
export async function addDocument(data: DocumentInput) {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    const documentId = uuidv4();
    const new_document: IDocument = {
      ...data,
      document_id: documentId
    };

    console.log('Adding document:', new_document);
    const document = await Document.insert(new_document);

    return { _id: document.document_id };
  } catch (error) {
    console.error(error);
    throw error;
  }
}

// Update document
export async function updateDocument(documentId: string, data: Partial<IDocument>) {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    await Document.update(documentId, data);
  } catch (error) {
    console.error(error);
    throw new Error("Failed to update the document");
  }
}

// Delete document
export async function deleteDocument(documentId: string, userId: string) {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Get the document first to get the file_id
    const document = await Document.get(documentId);
    if (!document) {
      throw new Error('Document not found');
    }

    // If there's an associated file, delete it from storage
    if (document.file_id) {
      // Delete file from storage and soft delete file record
      const deleteResult = await deleteFile(document.file_id, userId);
      if (!deleteResult.success) {
        throw new Error(deleteResult.error || 'Failed to delete file from storage');
      }

      // Clear preview cache if it exists
      const cache = CacheFactory.getPreviewCache(tenant);
      await cache.delete(document.file_id);
    }

    // Delete document content and block content
    await Promise.all([
      deleteDocumentContent(documentId),
      deleteBlockContent(documentId)
    ]);

    // Delete all associations
    await DocumentAssociation.deleteByDocument(document.document_id);

    // Delete the document record
    await Document.delete(documentId);

    return { success: true };
  } catch (error) {
    console.error('Error deleting document:', error);
    throw new Error(error instanceof Error ? error.message : "Failed to delete the document");
  }
}

// Get single document
export async function getDocument(documentId: string) {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    const document = await Document.get(documentId);
    if (!document) {
      return null;
    }

    return document;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the document");
  }
}

// Get documents by ticket
export async function getDocumentByTicketId(ticketId: string) {
  try {
    const documents = await Document.getByTicketId(ticketId);
    return documents;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
}

// Get documents by company
export async function getDocumentByCompanyId(companyId: string) {
  try {
    const documents = await Document.getByCompanyId(companyId);
    return documents;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
}

// Get documents by contact
export async function getDocumentByContactNameId(contactNameId: string) {
  try {
    const documents = await Document.getByContactNameId(contactNameId);
    return documents;
  } catch (error) {
    console.error(error);
    throw new Error("Failed to get the documents");
  }
}

// Get document preview
export async function getDocumentPreview(
  file_id: string
): Promise<PreviewResponse> {
  try {
    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    // Get cache instance for this tenant
    const cache = CacheFactory.getPreviewCache(tenant);

    // Check if preview exists in cache
    const cachedPreview = await cache.get(file_id);
    if (cachedPreview) {
      // Read the cached preview image
      const imageBuffer = await sharp(cachedPreview).toBuffer();
      const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

      return {
        success: true,
        previewImage: base64Image,
        content: 'PDF Document'
      };
    }

    const result = await StorageService.downloadFile(file_id);
    if (!result) {
      throw new Error('File not found');
    }

    const { buffer, metadata } = result;
    const mime = metadata.mime_type.toLowerCase();

    // Handle different file types
    if (mime === 'application/pdf') {
      try {
        // First get basic PDF info
        const pdfDoc = await PDFDocument.load(buffer);
        const pageCount = pdfDoc.getPages().length;

        const config = getStorageConfig();

        // Create temp directory for processing
        const tempDir = join(config.providers[config.defaultProvider!].basePath!, 'pdf-previews');

        // Ensure temp directory exists
        try {
          await mkdir(tempDir, { recursive: true });
        } catch (error) {
          // Check if error is a NodeJS.ErrnoException and has a code property
          if (error instanceof Error && 'code' in error && error.code !== 'EEXIST') {
            throw error;
          }
          // Ignore EEXIST error (directory already exists)
        }

        const tempPdfPath = join(tempDir, `${file_id}.pdf`);

        try {
          // Write the PDF file
          await writeFile(tempPdfPath, buffer);

          // Set up pdf2pic options
          const options = {
            density: 100,
            saveFilename: `${file_id}_thumb`,
            savePath: tempDir,
            format: "png",
            width: 600,
            height: 600,
            quality: 75,
            compression: "jpeg",
            useIMagick: true // Use ImageMagick instead of GraphicsMagick
          };

          // Convert PDF to image
          const convert = fromPath(tempPdfPath, options);
          const pageToConvertAsImage = 1;
          const result = await convert(pageToConvertAsImage);

          // Read the generated image and optimize it
          const imageBuffer = await sharp(result.path)
            .resize(400, 400, {
              fit: 'inside',
              withoutEnlargement: true
            })
            .png({ quality: 80 })
            .toBuffer();

          // Store in cache
          await cache.set(file_id, imageBuffer);

          // Convert to base64
          const base64Image = `data:image/png;base64,${imageBuffer.toString('base64')}`;

          // Clean up temp files
          await Promise.all([
            unlink(tempPdfPath),
            unlink(result.path!)
          ]);

          return {
            success: true,
            previewImage: base64Image,
            pageCount,
            content: `PDF Document\nPages: ${pageCount}`
          };
        } catch (conversionError) {
          console.error('PDF conversion error:', conversionError);
          // Clean up temp file if it exists
          try {
            await unlink(tempPdfPath);
          } catch (cleanupError) {
            console.error('Cleanup error:', cleanupError);
          }
          // Fallback to basic info if image conversion fails
          return {
            success: true,
            pageCount,
            content: `PDF Document\nPages: ${pageCount}\n\nPreview image generation failed.`
          };
        }
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
        return {
          success: false,
          error: 'Failed to parse PDF document'
        };
      }
    }

    // Handle markdown files
    if (mime === 'text/markdown' || metadata.original_name.endsWith('.md')) {
      try {
        const markdown = buffer.toString('utf-8');
        const html = await marked(markdown, { async: true });
        return { success: true, content: html };
      } catch (markdownError) {
        console.error('Markdown parsing error:', markdownError);
        return {
          success: false,
          error: 'Failed to parse markdown document'
        };
      }
    }

    // Handle text files
    if (mime.startsWith('text/') || mime === 'application/json') {
      try {
        const text = buffer.toString('utf-8');
        // For JSON, try to format it
        if (mime === 'application/json') {
          const obj = JSON.parse(text);
          return { success: true, content: JSON.stringify(obj, null, 2) };
        }
        return { success: true, content: text };
      } catch (textError) {
        console.error('Text parsing error:', textError);
        return {
          success: false,
          error: 'Failed to parse text document'
        };
      }
    }

    // For unsupported types
    return {
      success: false,
      error: 'Preview not available for this file type'
    };
  } catch (error) {
    console.error('Preview file error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to preview file'
    };
  }
}

// Get document download URL
export async function getDocumentDownloadUrl(file_id: string): Promise<string> {
    return `/api/documents/download/${file_id}`;
}

// Download document
export async function downloadDocument(file_id: string) {
    try {
        const { knex, tenant } = await createTenantKnex();
        if (!tenant) {
            throw new Error('No tenant found');
        }

        // Get document by file_id
        const document = await knex('documents')
            .where({ file_id, tenant })
            .first();

        if (!document) {
            throw new Error('Document not found');
        }

        // Download file from storage
        const result = await StorageService.downloadFile(file_id);
        if (!result) {
            throw new Error('File not found in storage');
        }

        const { buffer, metadata } = result;

        // Set appropriate headers for file download
        const headers = new Headers();
        headers.set('Content-Type', metadata.mime_type || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${document.document_name}"`);
        headers.set('Content-Length', buffer.length.toString());

        return new NextResponse(buffer, {
            status: 200,
            headers
        });
    } catch (error) {
        console.error('Error downloading document:', error);
        throw error;
    }
}

// Get documents by entity using the new association table
export async function getDocumentsByEntity(entity_id: string, entity_type: string) {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    console.log('Getting documents for entity:', { entity_id, entity_type }); // Debug log

    let query = knex('documents')
      .select(
        'documents.*',
        'users.first_name',
        'users.last_name',
        knex.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
        knex.raw(`
          COALESCE(dt.type_name, sdt.type_name) as type_name,
          COALESCE(dt.icon, sdt.icon) as type_icon
        `)
      )
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
      .where('documents.tenant', tenant);

      // Get documents directly associated with the entity
      query = query
        .where('document_associations.entity_id', entity_id)
        .andWhere('document_associations.entity_type', entity_type);

    const documents = await query
      .orderBy('documents.entered_at', 'desc')
      .distinct('documents.*');

    console.log('Raw documents from database:', documents); // Debug log

    // Process the documents
    const processedDocuments = documents.map((doc): IDocument => {
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
        createdByFullName: doc.created_by_full_name,
        type_name: doc.type_name,
        type_icon: doc.type_icon,
        entered_at: doc.entered_at,
        updated_at: doc.updated_at
      };

      console.log('Processed document:', processedDoc); // Debug log
      return processedDoc;
    });

    return processedDocuments;
  } catch (error) {
    console.error('Error fetching documents by entity:', error);
    throw new Error('Failed to fetch documents');
  }
}

// Get all documents with optional filtering
export async function getAllDocuments(filters?: DocumentFilters): Promise<IDocument[]> {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    console.log('Getting documents with filters:', filters); // Debug log

    // Start with a base query for documents
    let query = knex('documents')
      .select(
        'documents.*',
        'users.first_name',
        'users.last_name',
        knex.raw("CONCAT(users.first_name, ' ', users.last_name) as created_by_full_name"),
        knex.raw(`
          COALESCE(dt.type_name, sdt.type_name) as type_name,
          COALESCE(dt.icon, sdt.icon) as type_icon
        `)
      )
      .leftJoin('users', function() {
        this.on('documents.created_by', '=', 'users.user_id')
            .andOn('users.tenant', '=', knex.raw('?', [tenant]));
      })
      // Left join with document_types to get tenant-specific types
      .leftJoin('document_types as dt', function() {
        this.on('documents.type_id', '=', 'dt.type_id')
            .andOn('dt.tenant', '=', knex.raw('?', [tenant]));
      })
      // Left join with shared_document_types to get shared types
      .leftJoin('shared_document_types as sdt', 'documents.shared_type_id', 'sdt.type_id')
      .where('documents.tenant', tenant);

    // Apply filters if provided
    if (filters) {
      if (filters.searchTerm) {
        query = query.where('documents.document_name', 'ilike', `%${filters.searchTerm}%`);
      }

      if (filters.type) {
        query = query.where(function() {
          this.where('dt.type_name', 'like', `${filters.type}%`)
              .orWhere('sdt.type_name', 'like', `${filters.type}%`);
        });
      }

      // Exclude documents that are already associated with the specified entity
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

      // Only apply entity type filter if specified
      if (filters.entityType) {
        query = query
          .leftJoin('document_associations', function() {
            this.on('documents.document_id', '=', 'document_associations.document_id')
                .andOn('document_associations.tenant', '=', knex.raw('?', [tenant]));
          })
          .where('document_associations.entity_type', filters.entityType);
      }
    }

    // Get the documents
    const documents = await query
      .orderBy('documents.entered_at', 'desc')
      .distinct('documents.*');

    console.log('Raw documents from database:', documents); // Debug log

    // Process the documents
    const processedDocuments = documents.map((doc): IDocument => {
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
        createdByFullName: doc.created_by_full_name,
        type_name: doc.type_name,
        type_icon: doc.type_icon,
        entered_at: doc.entered_at,
        updated_at: doc.updated_at
      };

      console.log('Processed document:', processedDoc); // Debug log
      return processedDoc;
    });

    return processedDocuments;
  } catch (error) {
    console.error('Error fetching documents:', error);
    throw error;
  }
}

// Create document associations
export async function createDocumentAssociations(
  entity_id: string,
  entity_type: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset',
  document_ids: string[]
): Promise<{ success: boolean }> {
  try {
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

    await Promise.all(
      associations.map((association): Promise<Pick<IDocumentAssociation, "association_id">> =>
        DocumentAssociation.create(association)
      )
    );

    return { success: true };
  } catch (error) {
    console.error('Error creating document associations:', error);
    throw new Error('Failed to create document associations');
  }
}

// Remove document associations
export async function removeDocumentAssociations(
  entity_id: string,
  entity_type: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset',
  document_ids?: string[]
) {
  try {
    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('No tenant found');
    }

    let query = knex('document_associations')
      .where('entity_id', entity_id)
      .andWhere('entity_type', entity_type)
      .andWhere('tenant', tenant);

    if (document_ids && document_ids.length > 0) {
      query = query.whereIn('document_id', document_ids);
    }

    await query.delete();

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
    companyId?: string;
    ticketId?: string;
    contactNameId?: string;
    scheduleId?: string;
    assetId?: string;
  }
) {
  try {
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
        file_size: fileData.size
      };

      const result = await Document.insert(document);
      const documentWithId = { ...document, document_id: result.document_id };

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

    if (options.companyId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.companyId,
        entity_type: 'company',
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

    if (options.scheduleId) {
      associations.push({
        document_id: documentWithId.document_id,
        entity_id: options.scheduleId,
        entity_type: 'schedule',
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

    // Create all associations
    if (associations.length > 0) {
      await Promise.all(
        associations.map((association): Promise<Pick<IDocumentAssociation, "association_id">> =>
          DocumentAssociation.create(association)
        )
      );
    }

    return {
      success: true,
      document: documentWithId
    };
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
async function getDocumentTypeId(mimeType: string): Promise<{ typeId: string, isShared: boolean }> {
  const { knex, tenant } = await createTenantKnex();

  // First try to find a tenant-specific type
  const tenantType = await knex('document_types')
    .where({ tenant, type_name: mimeType })
    .first();

  if (tenantType) {
    return { typeId: tenantType.type_id, isShared: false };
  }

  // Then try to find a shared type
  const sharedType = await knex('shared_document_types')
    .where({ type_name: mimeType })
    .first();

  if (sharedType) {
    return { typeId: sharedType.type_id, isShared: true };
  }

  // If no exact match, try to find a match for the general type (e.g., "image/*" for "image/png")
  const generalType = mimeType.split('/')[0] + '/*';

  // Check tenant-specific general type first
  const generalTenantType = await knex('document_types')
    .where({ tenant, type_name: generalType })
    .first();

  if (generalTenantType) {
    return { typeId: generalTenantType.type_id, isShared: false };
  }

  // Then check shared general type
  const generalSharedType = await knex('shared_document_types')
    .where({ type_name: generalType })
    .first();

  if (generalSharedType) {
    return { typeId: generalSharedType.type_id, isShared: true };
  }

  // If no match found, return the unknown type (application/octet-stream) from shared types
  const unknownType = await knex('shared_document_types')
    .where({ type_name: 'application/octet-stream' })
    .first();

  if (!unknownType) {
    throw new Error('Unknown document type not found in shared document types');
  }

  return { typeId: unknownType.type_id, isShared: true };
}

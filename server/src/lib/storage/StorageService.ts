async function loadSharp() {
  try {
    const mod = await import('sharp');
    return (mod as any).default ?? (mod as any);
  } catch (error) {
    throw new Error(
      `Failed to load optional dependency "sharp" (required for image processing). ` +
        `Ensure platform-specific sharp binaries are installed. Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
import { fileTypeFromBuffer } from 'file-type';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { StorageProviderFactory, generateStoragePath } from './StorageProviderFactory';
import { FileStoreModel } from '../../models/storage';
import type { FileStore } from '../../types/storage';
import { StorageError } from './providers/StorageProvider';
import { getCurrentUser } from '@alga-psa/users/actions';
import fs from 'fs';

import { 
    getProviderConfig, 
    getStorageConfig, 
    validateFileUpload as validateFileConfig
} from '../../config/storage';
import { LocalProviderConfig, S3ProviderConfig } from '../../types/storage';
import { createTenantKnex } from '../db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { isValidUUID } from '@alga-psa/validation';
import { buildFileUploadedPayload } from '@alga-psa/shared/workflow/streams/domainEventBuilders/mediaEventBuilders';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on('data', (chunk) => chunks.push(new Uint8Array(chunk as Buffer)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks as any)));
  });
}

function changeFileExtension(filename: string, newExtension: string): string {
  const nameParts = filename.split('.');
  if (nameParts.length > 1) {
    nameParts.pop();
  }
  return `${nameParts.join('.')}.${newExtension}`;
}
 
export class StorageService {
  async getFileReadStream(fileId: string, range?: { start: number; end: number }): Promise<Readable> {
    const { knex } = await createTenantKnex();
    const file = await FileStoreModel.findById(knex, fileId);
    if (!file) {
      throw new Error('File not found');
    }
    
    const provider = await StorageProviderFactory.createProvider();
    return provider.getReadStream(file.storage_path, range);
  }
    private static async getTypedProviderConfig<T>(providerType: string): Promise<T> {
        const config = await getStorageConfig();
        const providerConfig = await getProviderConfig(config.defaultProvider);

        switch (providerConfig.type) {
            case 'local':
                return providerConfig as LocalProviderConfig as T;
            case 's3':
                return providerConfig as S3ProviderConfig as T;
            default:
                throw new Error(`Unsupported provider type: ${providerConfig.type}`);
        }
    }

    static async uploadFile(
    tenant: string,
    fileInput: Buffer | Readable,
    originalName: string,
    options: {
      mime_type?: string;
      uploaded_by_id: string;
      metadata?: Record<string, any>;
      isImageAvatar?: boolean;
    }
  ) {
    try {
      const currentUser = await getCurrentUser();
      if (!currentUser) {
        throw new Error('User not found');
      }

      let fileBuffer: Buffer;
      let fileSize: number;

      if (fileInput instanceof Buffer) {
        fileBuffer = fileInput;
        fileSize = fileBuffer.length;
      } else if (fileInput instanceof Readable) {
        fileBuffer = await streamToBuffer(fileInput);
        fileSize = fileBuffer.length;
      } else {
        throw new Error('Invalid file input type. Must be Buffer or Readable stream.');
      }

      const originalMimeType = options.mime_type || 'application/octet-stream';
      validateFileConfig(originalMimeType, fileSize);

      let processedBuffer = fileBuffer;
      let processedMimeType = originalMimeType;
      let processedOriginalName = originalName;
      let processedFileSize = fileSize;

      // --- Image Processing Logic ---
      const isEntityImage = options.isImageAvatar ||
        (options.metadata?.context &&
         ['user_avatar', 'contact_avatar', 'client_logo'].includes(options.metadata.context));

      if (isEntityImage) {
        const detectedType = await fileTypeFromBuffer(new Uint8Array(fileBuffer));
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        if (!detectedType || !allowedMimeTypes.includes(detectedType.mime)) {
          throw new Error('Invalid file format. Only JPEG, PNG, GIF, WebP are allowed for avatars/logos.');
        }

        if (options.mime_type && detectedType.mime !== options.mime_type) {
            console.warn(`Provided MIME type (${options.mime_type}) differs from detected type (${detectedType.mime}). Using detected type.`);
        }

        const sharp = await loadSharp();
        processedBuffer = await sharp(fileBuffer)
          .resize(256, 256, {
            fit: 'cover',
            withoutEnlargement: true,
          })
          .webp({ quality: 85 })
          .toBuffer();

        processedMimeType = 'image/webp';
        processedFileSize = processedBuffer.length;

        processedOriginalName = changeFileExtension(originalName, 'webp');
      }
      // --- End Image Processing Logic ---


      const provider = await StorageProviderFactory.createProvider();

      const storagePath = generateStoragePath(tenant, '', processedOriginalName);

      const uploadResult = await provider.upload(processedBuffer, storagePath, {
        mime_type: processedMimeType,
      });

      const { knex } = await createTenantKnex();
      const fileRecord = await FileStoreModel.create(knex, {
        fileId: uuidv4(),
        file_name: storagePath.split('/').pop()!,
        original_name: processedOriginalName,
        mime_type: processedMimeType,
        file_size: processedFileSize,
        storage_path: uploadResult.path,
        uploaded_by_id: options.uploaded_by_id || currentUser.user_id,
        metadata: options.metadata
      });

      try {
        const uploadedByUserId = isValidUUID(fileRecord.uploaded_by_id) ? fileRecord.uploaded_by_id : undefined;
        await publishWorkflowEvent({
          eventType: 'FILE_UPLOADED',
          payload: buildFileUploadedPayload({
            fileId: fileRecord.file_id,
            uploadedByUserId,
            uploadedAt: fileRecord.created_at,
            fileName: fileRecord.original_name,
            contentType: fileRecord.mime_type,
            sizeBytes: fileRecord.file_size,
            storageKey: fileRecord.storage_path,
          }),
          ctx: {
            tenantId: tenant,
            occurredAt: fileRecord.created_at,
            actor: uploadedByUserId
              ? { actorType: 'USER', actorUserId: uploadedByUserId }
              : { actorType: 'SYSTEM' },
          },
          idempotencyKey: `file_uploaded:${fileRecord.file_id}:${fileRecord.created_at}`,
        });
      } catch (error) {
        console.error('[StorageService] Failed to publish FILE_UPLOADED workflow event', error);
      }

      return fileRecord;
    } catch (error) {
      console.error("Error in uploadFile:", error);
      if (error instanceof StorageError) {
        throw error; // Re-throw specific storage errors
      }
      // Add specific error handling for sharp errors if needed
      if (error instanceof Error && error.message.includes('Input buffer contains unsupported image format')) {
          throw new StorageError(
            'Unsupported image format provided.',
            'UNSUPPORTED_IMAGE_FORMAT',
            'StorageService',
            'upload',
            false,
            error
          );
      }
      throw new Error('Failed to upload file: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

    static async downloadFile(file_id: string): Promise<{
      buffer: Buffer;
      metadata: {
        original_name: string;
        mime_type: string;
        size: number;
      }
    }> {
        try {
            // Get file record
            const { knex } = await createTenantKnex();
            const fileRecord = await FileStoreModel.findById(knex, file_id);
            if (!fileRecord) {
                throw new Error('File not found');
            }

            // Get storage provider 
            const provider = await StorageProviderFactory.createProvider();

            // Download file from storage provider
            const buffer = await provider.download(fileRecord.storage_path);

            return {
                buffer,
                metadata: {
                    original_name: fileRecord.original_name,
                    mime_type: fileRecord.mime_type,
                    size: fileRecord.file_size
                },
            };
        } catch (error) {
            if (error instanceof StorageError) {
                throw error;
            }
            throw new Error('Failed to download file: ' + (error as Error).message);
        }
    }

    static async deleteFile(file_id: string, deleted_by_id: string): Promise<void> {
        try {
            // Get file record
            const { knex } = await createTenantKnex();
            const fileRecord = await FileStoreModel.findById(knex, file_id);
            if (!fileRecord) {
                throw new Error('File not found');
            }

            const config = await getStorageConfig();
            const providerConfig = await this.getTypedProviderConfig<LocalProviderConfig | S3ProviderConfig>(config.defaultProvider);

            // Get storage provider
            const provider = await StorageProviderFactory.createProvider();

            // Delete file from storage provider
            await provider.delete(fileRecord.storage_path);

            // Soft delete file record
            await FileStoreModel.softDelete(knex, file_id, deleted_by_id);
        } catch (error) {
            if (error instanceof StorageError) {
                throw error;
            }
            throw new Error('Failed to delete file: ' + (error as Error).message);
        }
    }

    static async validateFileUpload(
        tenant: string,
        mime_type: string,
        file_size: number
    ): Promise<void> {
        validateFileConfig(mime_type, file_size);
    }

    static async createDocumentSystemEntry(options: {
      fileId: string;
      category: string;
      metadata: Record<string, unknown>;
    }): Promise<void> {
      try {
        const { knex } = await createTenantKnex();
        await FileStoreModel.createDocumentSystemEntry(knex, options);
      } catch (error) {
        throw new Error('Failed to create document system entry: ' + (error as Error).message);
      }
    }
  
    static async getFileMetadata(fileId: string): Promise<FileStore> {
      try {
        const { knex } = await createTenantKnex();
        const file = await FileStoreModel.findById(knex, fileId);
        if (!file) {
          throw new Error('File not found');
        }
        return file;
      } catch (error) {
        throw new Error('Failed to get file metadata: ' + (error as Error).message);
      }
    }
  
    static async updateFileMetadata(fileId: string, metadata: Record<string, unknown>): Promise<void> {
      try {
        const { knex } = await createTenantKnex();
        await FileStoreModel.updateMetadata(knex, fileId, metadata);
      } catch (error) {
        throw new Error('Failed to update file metadata: ' + (error as Error).message);
      }
    }
  
    static async storePDF(
      invoiceId: string,
      invoiceNumber: string,
      buffer: Buffer,
      metadata: Record<string, any>
    ) {
        var {knex, tenant} = await createTenantKnex();
        const currentUser = await getCurrentUser();

        if (!tenant) {
            throw new Error('No tenant found');
        }

        return this.uploadFile(
            tenant,
            buffer,
            `invoice_${invoiceNumber}.pdf`,
            {
                mime_type: 'application/pdf',
                uploaded_by_id: metadata.uploaded_by_id || 'system',
                metadata: {
                    ...metadata,
                    invoice_id: invoiceId
                }
            }
        );
    }
}

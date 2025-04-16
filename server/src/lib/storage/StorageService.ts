import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { StorageProviderFactory, generateStoragePath } from './StorageProviderFactory';
import { FileStoreModel } from '../../models/storage';
import type { FileStore } from '../../types/storage';
import { StorageError } from './providers/StorageProvider';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import fs from 'fs';

import { 
    getProviderConfig, 
    getStorageConfig, 
    validateFileUpload as validateFileConfig
} from '../../config/storage';
import { LocalProviderConfig, S3ProviderConfig } from '../../types/storage';
import { createTenantKnex } from '../db';

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}
 
export class StorageService {
  async getFileReadStream(fileId: string): Promise<Readable> {
    const file = await FileStoreModel.findById(fileId);
    if (!file) {
      throw new Error('File not found');
    }
    
    const provider = await StorageProviderFactory.createProvider();
    return provider.getReadStream(file.storage_path);
  }
    private static getTypedProviderConfig<T>(providerType: string): T {
        const config = getStorageConfig();
        const providerConfig = getProviderConfig(config.defaultProvider);

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
      if (options.isImageAvatar) {
        // 1. Actual File Format Validation
        const detectedType = await fileTypeFromBuffer(fileBuffer);
        const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        if (!detectedType || !allowedMimeTypes.includes(detectedType.mime)) {
          throw new StorageError(
            `Invalid file format for avatar. Detected: ${detectedType?.mime || 'unknown'}. Allowed: ${allowedMimeTypes.join(', ')}`,
            'INVALID_FILE_FORMAT',
            'StorageService',
            'upload',
            false
          );
        }

        // Ensure detected type matches provided mime type if available
        if (options.mime_type && detectedType.mime !== options.mime_type) {
            console.warn(`Provided MIME type (${options.mime_type}) differs from detected type (${detectedType.mime}). Using detected type.`);
            // Optionally, you could throw an error here if strict matching is required.
        }
        processedMimeType = detectedType.mime; // Use detected type going forward

        // 2. Resize/Compress, 3. Metadata Strip, Convert to WebP
        const sharpInstance = sharp(fileBuffer)
          .resize(256, 256, {
            fit: 'cover', // Or 'inside' if you prefer containment
            withoutEnlargement: true, // Don't enlarge small images
          })
          .webp({ quality: 80 }) // Convert to WebP
          .withMetadata();

        processedBuffer = await sharpInstance.toBuffer();
        processedMimeType = 'image/webp'; // Update MIME type
        processedFileSize = processedBuffer.length; // Update size

        // 4. Update File Details (Name)
        const nameParts = originalName.split('.');
        if (nameParts.length > 1) {
          nameParts.pop(); // Remove original extension
        }
        processedOriginalName = `${nameParts.join('.')}.webp`; // Add .webp extension
      }
      // --- End Image Processing Logic ---


      // Get storage provider
      const provider = await StorageProviderFactory.createProvider();

      // Generate storage path based on tenant and potentially processed name
      // Using processedOriginalName ensures the stored file reflects the .webp extension if processed
      const storagePath = generateStoragePath(tenant, '', processedOriginalName);

      // Upload processed file to storage provider
      const uploadResult = await provider.upload(processedBuffer, storagePath, {
        mime_type: processedMimeType, // Use processed MIME type
      });

      // Create file record in database using processed details
      const fileRecord = await FileStoreModel.create({
        fileId: uuidv4(),
        file_name: storagePath.split('/').pop()!,
        original_name: processedOriginalName,
        mime_type: processedMimeType,
        file_size: processedFileSize,
        storage_path: uploadResult.path,
        uploaded_by_id: options.uploaded_by_id || currentUser.user_id,
        metadata: options.metadata
      });

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
            const fileRecord = await FileStoreModel.findById(file_id);
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
            const fileRecord = await FileStoreModel.findById(file_id);
            if (!fileRecord) {
                throw new Error('File not found');
            }

            const config = getStorageConfig();
            const providerConfig = this.getTypedProviderConfig<LocalProviderConfig | S3ProviderConfig>(config.defaultProvider);

            // Get storage provider
            const provider = await StorageProviderFactory.createProvider();

            // Delete file from storage provider
            await provider.delete(fileRecord.storage_path);

            // Soft delete file record
            await FileStoreModel.softDelete(file_id, deleted_by_id);
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
        await FileStoreModel.createDocumentSystemEntry(options);
      } catch (error) {
        throw new Error('Failed to create document system entry: ' + (error as Error).message);
      }
    }
  
    static async getFileMetadata(fileId: string): Promise<FileStore> {
      try {
        return await FileStoreModel.findById(fileId);
      } catch (error) {
        throw new Error('Failed to get file metadata: ' + (error as Error).message);
      }
    }
  
    static async updateFileMetadata(fileId: string, metadata: Record<string, unknown>): Promise<void> {
      try {
        await FileStoreModel.updateMetadata(fileId, metadata);
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

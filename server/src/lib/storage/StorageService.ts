import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { StorageProviderFactory, generateStoragePath } from './StorageProviderFactory';
import { FileStoreModel } from '../../models/storage';
import type { FileStore } from '../../types/storage';
import { StorageError } from './providers/StorageProvider';
import { getCurrentUser } from '@/lib/actions/user-actions/userActions';
import fs from 'fs';

import { 
    getProviderConfig, 
    getStorageConfig, 
    validateFileUpload as validateFileConfig
} from '../../config/storage';
import { LocalProviderConfig, S3ProviderConfig } from '../../types/storage';
import { createTenantKnex } from '../db';

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
        file: Buffer | Readable,
        originalName: string,
        options: {
            mime_type?: string;
            uploaded_by_id: string;
            metadata?: Record<string, any>;
        }
    ) {
        try {
            const currentUser = await getCurrentUser();
            if (!currentUser) {
                throw new Error('User not found');
            }

            // Validate file constraints
            if (file instanceof Buffer) {
                validateFileConfig(options.mime_type || '', file.length);
            }

            // Get storage provider
            const provider = await StorageProviderFactory.createProvider();

            // Generate storage path based on tenant
            const storagePath = generateStoragePath(tenant, '', originalName);

            // Upload file to storage provider
            const uploadResult = await provider.upload(file, storagePath, {
                mime_type: options.mime_type,
            });

            // Create file record in database
            const fileRecord = await FileStoreModel.create({
                fileId: uuidv4(),
                file_name: storagePath.split('/').pop()!,
                original_name: originalName,
                mime_type: uploadResult.mime_type,
                file_size: uploadResult.size,
                storage_path: uploadResult.path,
                uploaded_by_id: currentUser.user_id,
                metadata: options.metadata
            });

            return fileRecord;
        } catch (error) {
            if (error instanceof StorageError) {
                throw error;
            }
            throw new Error('Failed to upload file: ' + (error as Error).message);
        }
    }

    static async downloadFile(tenant: string, file_id: string): Promise<{
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
                    size: fileRecord.file_size,
                },
            };
        } catch (error) {
            if (error instanceof StorageError) {
                throw error;
            }
            throw new Error('Failed to download file: ' + (error as Error).message);
        }
    }

    static async deleteFile(tenant: string, file_id: string, deleted_by_id: string): Promise<void> {
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

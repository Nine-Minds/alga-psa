import { Readable } from 'stream';
import { StorageProviderFactory, generateStoragePath } from './StorageProviderFactory';
import { FileStoreModel } from '../../models/storage';
import { StorageError } from './providers/StorageProvider';

import { 
    getProviderConfig, 
    getStorageConfig, 
    validateFileUpload as validateFileConfig
} from '../../config/storage';
import { LocalProviderConfig, S3ProviderConfig } from '../../types/storage';

export class StorageService {
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
        }
    ) {
        try {
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
                file_name: storagePath.split('/').pop()!,
                original_name: originalName,
                mime_type: uploadResult.mime_type,
                file_size: uploadResult.size,
                storage_path: uploadResult.path,
                uploaded_by_id: options.uploaded_by_id
            });

            return fileRecord;
        } catch (error) {
            if (error instanceof StorageError) {
                throw error;
            }
            throw new Error('Failed to upload file: ' + (error as Error).message);
        }
    }

    static async downloadFile(tenant: string, file_id: string): Promise<{ buffer: Buffer; metadata: any }> {
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
                    file_name: fileRecord.original_name,
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
}

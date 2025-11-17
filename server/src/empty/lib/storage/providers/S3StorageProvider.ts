import { Readable } from 'stream';
import { BaseStorageProvider, UploadResult, StorageError } from '@/lib/storage/providers/StorageProvider';
import { S3ProviderConfig, StorageCapabilities } from '@/types/storage';

export class S3StorageProvider extends BaseStorageProvider {
    constructor(config: S3ProviderConfig) {
        super('s3', config);
    }

    getCapabilities(): StorageCapabilities {
        return {
            supportsBuckets: false,
            supportsStreaming: false,
            supportsMetadata: false,
            supportsTags: false,
            supportsVersioning: false,
            maxFileSize: 0,
        };
    }

    private throwEnterpriseError(operation: 'upload' | 'download' | 'delete' | 'exists' | 'metadata'): never {
        throw new StorageError(
            'S3 storage is only available in Enterprise Edition',
            'ENTERPRISE_FEATURE',
            's3',
            operation,
            false
        );
    }

    async upload(file: Buffer | Readable, path: string, options?: { mime_type?: string; metadata?: Record<string, string> }): Promise<UploadResult> {
        this.throwEnterpriseError('upload');
    }

    async download(path: string): Promise<Buffer> {
        this.throwEnterpriseError('download');
    }

    async delete(path: string): Promise<void> {
        this.throwEnterpriseError('delete');
    }

    async exists(path: string): Promise<boolean> {
        this.throwEnterpriseError('exists');
    }

    async getMetadata(path: string): Promise<Record<string, string>> {
        this.throwEnterpriseError('metadata');
    }
}

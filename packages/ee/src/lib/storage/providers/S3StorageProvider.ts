import { Readable } from 'stream';

export type UploadResult = { path: string };
export type StorageCapabilities = {
    supportsBuckets: boolean;
    supportsStreaming: boolean;
    supportsMetadata: boolean;
    supportsTags: boolean;
    supportsVersioning: boolean;
    maxFileSize: number;
};

export type S3ProviderConfig = Record<string, unknown>;

export class StorageError extends Error {
    constructor(
        message: string,
        public code: string,
        public provider: string,
        public operation: string,
        public retryable: boolean
    ) {
        super(message);
        this.name = 'StorageError';
    }
}

export abstract class BaseStorageProvider {
    constructor(public providerType: string, public config: unknown) {}

    abstract getCapabilities(): StorageCapabilities;
    abstract upload(
        file: Buffer | Readable,
        path: string,
        options?: { mime_type?: string; metadata?: Record<string, string> }
    ): Promise<UploadResult>;
    abstract download(path: string): Promise<Buffer>;
    abstract delete(path: string): Promise<void>;
    abstract exists(path: string): Promise<boolean>;
    abstract getMetadata(path: string): Promise<Record<string, string>>;
}

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

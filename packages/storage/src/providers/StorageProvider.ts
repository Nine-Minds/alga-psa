import { Readable } from 'stream';
import { StorageCapabilities, LocalProviderConfig, S3ProviderConfig } from '../../types/storage';

export interface UploadResult {
    path: string;
    size: number;
    mime_type: string;
    metadata?: Record<string, string>;
}

export interface RangeOptions {
    start: number;
    end: number;
}

export interface StorageProviderInterface {
    getCapabilities(): StorageCapabilities;
    upload(file: Buffer | Readable, path: string, options?: { mime_type?: string; metadata?: Record<string, string> }): Promise<UploadResult>;
    download(path: string): Promise<Buffer>;
    getReadStream(path: string, range?: RangeOptions): Promise<Readable>;
    delete(path: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    getMetadata?(path: string): Promise<Record<string, string>>;
    setMetadata?(path: string, metadata: Record<string, string>): Promise<void>;
    listFiles?(prefix: string): Promise<string[]>;
}

export class StorageError extends Error {
    constructor(
        message: string,
        public readonly code: string,
        public readonly provider: string,
        public readonly operation: 'upload' | 'download' | 'delete' | 'exists' | 'metadata' | 'list',
        public readonly retryable: boolean = false,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'StorageError';
    }
}

export abstract class BaseStorageProvider implements StorageProviderInterface {
    protected constructor(
        protected readonly providerType: 'local' | 's3',
        protected readonly config: LocalProviderConfig | S3ProviderConfig
    ) {
        // Validate config type matches provider type
        if (config.type !== providerType) {
            throw new Error(`Provider type mismatch: expected ${providerType}, got ${config.type}`);
        }
    }

    abstract getCapabilities(): StorageCapabilities;
    abstract upload(file: Buffer | Readable, path: string, options?: { mime_type?: string; metadata?: Record<string, string> }): Promise<UploadResult>;
    abstract download(path: string): Promise<Buffer>;
    
    async getReadStream(path: string, range?: RangeOptions): Promise<Readable> {
        const buffer = await this.download(path);
        
        if (range) {
            // Create a partial buffer based on the range
            const { start, end } = range;
            const partialBuffer = buffer.slice(start, end + 1);
            const readable = new Readable();
            readable.push(partialBuffer);
            readable.push(null); // Signal end of stream
            return readable;
        } else {
            // Return full buffer as stream
            const readable = new Readable();
            readable.push(buffer);
            readable.push(null); // Signal end of stream
            return readable;
        }
    }

    abstract delete(path: string): Promise<void>;
    abstract exists(path: string): Promise<boolean>;

    protected handleError(operation: 'upload' | 'download' | 'delete' | 'exists' | 'metadata' | 'list', error: any): never {
        throw new StorageError(
            error.message || 'Storage operation failed',
            error.code || 'UNKNOWN_ERROR',
            this.providerType,
            operation,
            this.isRetryableError(error),
            error
        );
    }

    protected isRetryableError(error: any): boolean {
        const retryableCodes = [
            'ECONNRESET',
            'ETIMEDOUT',
            'ECONNREFUSED',
            'NETWORK_ERROR',
            'EPIPE',
            'TIMEOUT_ERROR'
        ];
        return retryableCodes.includes(error.code);
    }

    protected async withRetry<T>(
        operation: () => Promise<T>,
        maxRetries: number = 3,
        initialDelay: number = 1000
    ): Promise<T> {
        let lastError: Error | undefined;
        
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error: any) {
                lastError = error;
                if (!this.isRetryableError(error) || attempt === maxRetries - 1) {
                    throw error;
                }
                
                const delay = initialDelay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        throw lastError;
    }
}

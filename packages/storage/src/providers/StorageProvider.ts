import { Readable } from 'stream';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { StorageCapabilities, LocalProviderConfig, S3ProviderConfig } from '../types/storage';

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

/**
 * A location a tool such as ffmpeg can open and seek in directly, without the
 * bytes passing through this process: an absolute file path (local provider)
 * or a time-limited URL on the provider's own (internal) endpoint.
 */
export type SeekableInput = { kind: 'file'; path: string } | { kind: 'url'; url: string };

/** Smallest size of any part that is not the last one (S3's multipart minimum, enforced on every provider). */
export const MIN_NON_FINAL_PART_SIZE = 5 * 1024 * 1024;
/** Highest part number a session accepts (S3's limit, enforced on every provider). */
export const MAX_PART_NUMBER = 10000;
/** Part size used when `upload()` has to split a body into parts itself. */
export const DEFAULT_PART_SIZE = 8 * 1024 * 1024;

export interface WriteSessionOptions {
    mimeType?: string;
    metadata?: Record<string, string>;
}

/**
 * Plain-JSON description of an open write session. It carries everything a fresh
 * provider instance (another pod) needs; no state lives in process memory.
 * `provider` discriminates which provider type may use it.
 */
export type WriteSessionHandle = S3WriteSessionHandle | LocalWriteSessionHandle;

export interface S3WriteSessionHandle {
    provider: 's3';
    bucket: string;
    key: string;
    uploadId: string;
    mimeType?: string;
}

export interface LocalWriteSessionHandle {
    provider: 'local';
    /** Final path, relative to basePath. */
    path: string;
    /** In-progress path, relative to basePath; part n is stored in `<partialPath>.<n>`. */
    partialPath: string;
    mimeType?: string;
    metadata?: Record<string, string>;
}

/** Plain-JSON proof that a part was durably written. */
export interface PartReceipt {
    partNumber: number;
    size: number;
    /** True if the part was declared the last one; required for parts below MIN_NON_FINAL_PART_SIZE. */
    final: boolean;
    /** Provider part identifier (S3 ETag). */
    etag?: string;
}

export interface WritePartOptions {
    /** Declares this to be the last part of the object. */
    final?: boolean;
    /**
     * Cancels the write. A part streamed from a request body that has failed must be abandoned
     * at once: without this an S3 request waits for the bytes its Content-Length promised until
     * the socket times out. A part cancelled this way is never stored.
     */
    signal?: AbortSignal;
}

export type StorageOperation = 'upload' | 'download' | 'delete' | 'exists' | 'metadata' | 'list';

export interface StorageProviderInterface {
    getCapabilities(): StorageCapabilities;
    /** Stable object-store location, without credentials. Durable maintenance
     * must not apply a previous location's object keys to a new provider. */
    getLocationIdentity?(): string;
    /**
     * Writes a whole body. Implemented as beginWrite + parts + completeWrite (abortWrite on failure).
     * `options.size` is accepted but not required; streams of unknown length are chunked internally.
     */
    upload(file: Buffer | Readable, path: string, options?: { mime_type?: string; metadata?: Record<string, string>; size?: number }): Promise<UploadResult>;

    /**
     * Resumable multipart write session. The total size need not be known and nothing is
     * buffered beyond one part. Session errors are StorageErrors with operation 'upload'.
     *
     * Contract (identical on every provider, enforced in BaseStorageProvider):
     *  - Part numbers are integers 1..MAX_PART_NUMBER and parts may arrive in any order.
     *  - Part size rule: a part smaller than MIN_NON_FINAL_PART_SIZE (5 MiB) must be written
     *    with `{ final: true }`, otherwise writePart rejects it (PART_TOO_SMALL). A part declared
     *    final must turn out to be the highest part number: completeWrite rejects the receipt list
     *    (INVALID_PARTS) if any part other than the highest is final or below the minimum.
     *  - completeWrite receives every receipt (any order), requires part numbers 1..N with no gaps
     *    or duplicates, and orders them itself.
     *  - Handles and receipts are plain JSON and can be used from a fresh provider instance.
     *  - A handle of another provider type is rejected (WRITE_HANDLE_PROVIDER_MISMATCH).
     *  - abortWrite is idempotent.
     */
    beginWrite(path: string, options?: WriteSessionOptions): Promise<WriteSessionHandle>;
    writePart(handle: WriteSessionHandle, partNumber: number, part: Readable | Buffer, size: number, options?: WritePartOptions): Promise<PartReceipt>;
    completeWrite(handle: WriteSessionHandle, parts: PartReceipt[]): Promise<UploadResult>;
    abortWrite(handle: WriteSessionHandle): Promise<void>;

    download(path: string): Promise<Buffer>;
    getReadStream(path: string, range?: RangeOptions): Promise<Readable>;
    /** Seekable input for external tools; `ttlSeconds` bounds a URL's validity. */
    getSeekableInput?(path: string, ttlSeconds: number): Promise<SeekableInput>;
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
        public readonly operation: StorageOperation,
        public readonly retryable: boolean = false,
        public readonly cause?: Error
    ) {
        super(message);
        this.name = 'StorageError';
    }
}

export abstract class BaseStorageProvider implements StorageProviderInterface {
    private readonly locationIdentity: string;

    protected constructor(
        protected readonly providerType: 'local' | 's3',
        protected readonly config: LocalProviderConfig | S3ProviderConfig
    ) {
        // Validate config type matches provider type
        if (config.type !== providerType) {
            throw new Error(`Provider type mismatch: expected ${providerType}, got ${config.type}`);
        }
        const location = config.type === 'local' ? [config.type, resolve(config.basePath)]
            : [config.type, config.region ?? null, config.bucket ?? null, config.endpoint ?? null];
        this.locationIdentity = createHash('sha256').update(JSON.stringify(location)).digest('hex');
    }

    getLocationIdentity(): string { return this.locationIdentity; }

    abstract getCapabilities(): StorageCapabilities;

    async upload(
        file: Buffer | Readable,
        path: string,
        options?: { mime_type?: string; metadata?: Record<string, string>; size?: number }
    ): Promise<UploadResult> {
        const handle = await this.beginWrite(path, { mimeType: options?.mime_type, metadata: options?.metadata });
        try {
            const receipts: PartReceipt[] = [];
            let partNumber = 0;
            for await (const chunk of chunkBody(file, DEFAULT_PART_SIZE)) {
                partNumber += 1;
                receipts.push(await this.writePart(handle, partNumber, chunk.data, chunk.data.length, { final: chunk.final }));
            }
            return await this.completeWrite(handle, receipts);
        } catch (error) {
            await this.abortWrite(handle).catch(() => undefined);
            return this.handleError('upload', error);
        }
    }

    async beginWrite(path: string, options: WriteSessionOptions = {}): Promise<WriteSessionHandle> {
        try {
            return await this.doBeginWrite(path, options);
        } catch (error) {
            return this.handleError('upload', error);
        }
    }

    async writePart(
        handle: WriteSessionHandle,
        partNumber: number,
        part: Readable | Buffer,
        size: number,
        options: WritePartOptions = {}
    ): Promise<PartReceipt> {
        try {
            this.assertHandleProvider(handle);
            if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PART_NUMBER) {
                throw this.writeError('INVALID_PART', `Part number must be an integer between 1 and ${MAX_PART_NUMBER}`);
            }
            if (!Number.isSafeInteger(size) || size < 0) {
                throw this.writeError('INVALID_PART', 'Part size must be a non-negative integer (the exact byte length)');
            }
            const final = options.final === true;
            if (size < MIN_NON_FINAL_PART_SIZE && !final) {
                throw this.writeError(
                    'PART_TOO_SMALL',
                    `Part ${partNumber} is ${size} bytes; parts below ${MIN_NON_FINAL_PART_SIZE} bytes must be written with { final: true }`
                );
            }
            const receipt = await this.doWritePart(handle, partNumber, part, size, options.signal);
            return { ...receipt, partNumber, size, final };
        } catch (error) {
            return this.handleError('upload', error);
        }
    }

    async completeWrite(handle: WriteSessionHandle, parts: PartReceipt[]): Promise<UploadResult> {
        try {
            this.assertHandleProvider(handle);
            return await this.doCompleteWrite(handle, this.orderReceipts(parts));
        } catch (error) {
            return this.handleError('upload', error);
        }
    }

    async abortWrite(handle: WriteSessionHandle): Promise<void> {
        try {
            this.assertHandleProvider(handle);
            await this.doAbortWrite(handle);
        } catch (error) {
            this.handleError('upload', error);
        }
    }

    protected abstract doBeginWrite(path: string, options: WriteSessionOptions): Promise<WriteSessionHandle>;
    /** Receives a validated part; returns provider-specific receipt fields (e.g. etag). */
    protected abstract doWritePart(handle: WriteSessionHandle, partNumber: number, part: Readable | Buffer, size: number, signal?: AbortSignal): Promise<Partial<PartReceipt>>;
    /** Receives receipts already validated and sorted by part number. */
    protected abstract doCompleteWrite(handle: WriteSessionHandle, parts: PartReceipt[]): Promise<UploadResult>;
    protected abstract doAbortWrite(handle: WriteSessionHandle): Promise<void>;

    protected writeError(code: string, message: string): StorageError {
        return new StorageError(message, code, this.providerType, 'upload', false);
    }

    protected assertHandleProvider(handle: WriteSessionHandle): void {
        if (!handle || typeof handle !== 'object' || typeof (handle as { provider?: unknown }).provider !== 'string') {
            throw this.writeError('INVALID_WRITE_HANDLE', 'Write session handle is malformed');
        }
        if (handle.provider !== this.providerType) {
            throw this.writeError(
                'WRITE_HANDLE_PROVIDER_MISMATCH',
                `Write session handle belongs to provider '${handle.provider}', not '${this.providerType}'`
            );
        }
    }

    /** Validates the receipt list against the shared contract and returns it sorted by part number. */
    protected orderReceipts(parts: PartReceipt[]): PartReceipt[] {
        if (!Array.isArray(parts) || parts.length === 0) {
            throw this.writeError('INVALID_PARTS', 'completeWrite requires at least one part receipt');
        }
        const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
        sorted.forEach((part, index) => {
            const last = index === sorted.length - 1;
            if (!part || !Number.isInteger(part.partNumber) || !Number.isSafeInteger(part.size) || part.size < 0) {
                throw this.writeError('INVALID_PARTS', 'Malformed part receipt');
            }
            if (part.partNumber !== index + 1) {
                throw this.writeError('INVALID_PARTS', `Part receipts must cover parts 1..N exactly once; expected part ${index + 1}, found ${part.partNumber}`);
            }
            if (!last && (part.final || part.size < MIN_NON_FINAL_PART_SIZE)) {
                throw this.writeError('INVALID_PARTS', `Part ${part.partNumber} is ${part.final ? 'declared final' : `below ${MIN_NON_FINAL_PART_SIZE} bytes`} but is not the highest part`);
            }
        });
        return sorted;
    }
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

    protected handleError(operation: StorageOperation, error: any): never {
        if (error instanceof StorageError) {
            throw error;
        }
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

/**
 * Splits a body into parts of exactly `partSize` bytes plus a remainder, holding at most one
 * part (plus one source chunk) in memory. Only a part followed by more data is emitted as
 * non-final, so the last part is the only short one; an empty body yields one empty final part.
 */
export async function* chunkBody(
    body: Buffer | Readable,
    partSize: number
): AsyncGenerator<{ data: Buffer; final: boolean }> {
    if (Buffer.isBuffer(body)) {
        for (let offset = 0; offset + partSize < body.length; offset += partSize) {
            yield { data: body.subarray(offset, offset + partSize), final: false };
        }
        const tail = Math.max(0, Math.ceil(body.length / partSize) - 1) * partSize;
        yield { data: body.subarray(tail), final: true };
        return;
    }
    let pending: Buffer[] = [];
    let pendingBytes = 0;
    for await (const raw of body) {
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        pending.push(chunk);
        pendingBytes += chunk.length;
        while (pendingBytes > partSize) {
            const joined = Buffer.concat(pending, pendingBytes);
            yield { data: joined.subarray(0, partSize), final: false };
            const rest = Buffer.from(joined.subarray(partSize));
            pending = [rest];
            pendingBytes = rest.length;
        }
    }
    yield { data: Buffer.concat(pending, pendingBytes), final: true };
}

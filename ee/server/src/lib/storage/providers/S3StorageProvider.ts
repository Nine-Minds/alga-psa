import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    S3ServiceException,
    S3
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { BaseStorageProvider, UploadResult, StorageError, RangeOptions } from '@/lib/storage/providers/StorageProvider';
import type { S3ProviderConfig, StorageCapabilities } from 'server/src/types/storage';

export class S3StorageProvider extends BaseStorageProvider {
    private readonly client: S3Client;
    private readonly bucket: string;

    constructor(config: S3ProviderConfig) {
        super('s3', config);

        const { region, bucket, accessKey, secretKey, endpoint } = config;

        this.bucket = bucket;
        const forcePathStyle = String(process.env.STORAGE_S3_FORCE_PATH_STYLE ?? (endpoint ? 'true' : 'false')) === 'true';
        this.client = new S3Client({
            region,
            endpoint,
            forcePathStyle,
            credentials: {
                accessKeyId: accessKey,
                secretAccessKey: secretKey,
            },
        });
    }

    getCapabilities(): StorageCapabilities {
        return {
            supportsBuckets: true,
            supportsStreaming: true,
            supportsMetadata: true,
            supportsTags: true,
            supportsVersioning: true,
            maxFileSize: 5 * 1024 * 1024 * 1024, // 5GB - S3's maximum object size for single PUT
        };
    }

    async upload(file: Buffer | Readable, path: string, options?: { mime_type?: string; metadata?: Record<string, string> }): Promise<UploadResult> {
        try {
            return await this.withRetry(async () => {
                const command = new PutObjectCommand({
                    Bucket: this.bucket,
                    Key: path,
                    Body: file,
                    ContentType: options?.mime_type,
                    Metadata: options?.metadata,
                });

                await this.client.send(command);

                // Get the uploaded object's metadata
                const headCommand = new HeadObjectCommand({
                    Bucket: this.bucket,
                    Key: path,
                });

                const headResponse = await this.client.send(headCommand);

                return {
                    path,
                    size: headResponse.ContentLength || 0,
                    mime_type: headResponse.ContentType || options?.mime_type || 'application/octet-stream',
                    metadata: headResponse.Metadata,
                };
            });
        } catch (error) {
            throw this.handleError('upload', error);
        }
    }

    async download(path: string): Promise<Buffer> {
        try {
            return await this.withRetry(async () => {
                const command = new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: path,
                });

                const response = await this.client.send(command);
                
                if (!response.Body) {
                    throw new Error('Empty response body');
                }

                // Convert the readable stream to a buffer
                const chunks: Buffer[] = [];
                for await (const chunk of response.Body as Readable) {
                    chunks.push(Buffer.from(chunk));
                }
                return Buffer.concat(chunks);
            });
        } catch (error) {
            throw this.handleError('download', error);
        }
    }

    async delete(path: string): Promise<void> {
        try {
            await this.withRetry(async () => {
                const command = new DeleteObjectCommand({
                    Bucket: this.bucket,
                    Key: path,
                });

                await this.client.send(command);
            });
        } catch (error) {
            throw this.handleError('delete', error);
        }
    }

    async exists(path: string): Promise<boolean> {
        try {
            await this.withRetry(async () => {
                const command = new HeadObjectCommand({
                    Bucket: this.bucket,
                    Key: path,
                });

                await this.client.send(command);
            });
            return true;
        } catch (error) {
            if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
                return false;
            }
            throw this.handleError('exists', error);
        }
    }

    async getMetadata(path: string): Promise<Record<string, string>> {
        try {
            return await this.withRetry(async () => {
                const command = new HeadObjectCommand({
                    Bucket: this.bucket,
                    Key: path,
                });

                const response = await this.client.send(command);
                return response.Metadata || {};
            });
        } catch (error) {
            throw this.handleError('metadata', error);
        }
    }

    protected override isRetryableError(error: unknown): boolean {
        if (error instanceof S3ServiceException) {
            // AWS specific retryable error codes
            const retryableCodes = [
                'RequestTimeout',
                'RequestTimeoutException',
                'PriorRequestNotComplete',
                'ConnectionError',
                'NetworkingError',
                'ThrottlingException',
                'TooManyRequestsException',
                'InternalError',
                'ServiceUnavailable',
                'SlowDown',
            ];
            return retryableCodes.includes(error.name) || super.isRetryableError(error);
        }
        return super.isRetryableError(error);
    }

    async getReadStream(path: string, range?: RangeOptions): Promise<Readable> {
        try {
            return await this.withRetry(async () => {
                const command = new GetObjectCommand({
                    Bucket: this.bucket,
                    Key: path,
                    Range: range ? `bytes=${range.start}-${range.end}` : undefined,
                });

                const response = await this.client.send(command);
                
                if (!response.Body) {
                    throw new Error('Empty response body');
                }

                return response.Body as Readable;
            });
        } catch (error) {
            throw this.handleError('download', error);
        }
    }

    private streamToBuffer(stream: Readable): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
            stream.on('error', (error) => reject(error));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    }
}

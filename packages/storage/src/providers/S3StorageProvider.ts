import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { S3ProviderConfig, StorageCapabilities } from '../types/storage';
import { BaseStorageProvider } from './StorageProvider';

export class S3StorageProvider extends BaseStorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3ProviderConfig) {
    super('s3', config);

    const { region, bucket, accessKey, secretKey, endpoint } = config;
    if (!region || !bucket || !accessKey || !secretKey) {
      throw new Error('S3 storage configuration is incomplete');
    }

    this.bucket = bucket;
    const forcePathStyle =
      String(process.env.STORAGE_S3_FORCE_PATH_STYLE ?? (endpoint ? 'true' : 'false')) === 'true';

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
      maxFileSize: 5 * 1024 * 1024 * 1024,
    };
  }

  async upload(
    file: Buffer | Readable,
    path: string,
    options?: { mime_type?: string; metadata?: Record<string, string> },
  ) {
    try {
      return await this.withRetry(async () => {
        await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: path,
            Body: file,
            ContentType: options?.mime_type,
            Metadata: options?.metadata,
          }),
        );

        const head = await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: path,
          }),
        );

        return {
          path,
          size: head.ContentLength || 0,
          mime_type: head.ContentType || options?.mime_type || 'application/octet-stream',
          metadata: head.Metadata,
        };
      });
    } catch (error) {
      this.handleError('upload', error);
    }
  }

  async download(path: string): Promise<Buffer> {
    try {
      return await this.withRetry(async () => {
        const response = await this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: path,
          }),
        );

        if (!response.Body) {
          throw new Error('Empty response body');
        }

        const chunks: Buffer[] = [];
        for await (const chunk of response.Body as Readable) {
          chunks.push(Buffer.from(chunk));
        }
        return Buffer.concat(chunks);
      });
    } catch (error) {
      this.handleError('download', error);
    }
  }

  async getReadStream(path: string, range?: { start: number; end: number }): Promise<Readable> {
    try {
      return await this.withRetry(async () => {
        const response = await this.client.send(
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: path,
            Range: range ? `bytes=${range.start}-${range.end}` : undefined,
          }),
        );
        if (!response.Body) {
          throw new Error('Empty response body');
        }
        return response.Body as Readable;
      });
    } catch (error) {
      this.handleError('download', error);
    }
  }

  async delete(path: string): Promise<void> {
    try {
      await this.withRetry(async () => {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: path,
          }),
        );
      });
    } catch (error) {
      this.handleError('delete', error);
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.withRetry(async () => {
        await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: path,
          }),
        );
      });
      return true;
    } catch (error: any) {
      if (error instanceof S3ServiceException && error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      this.handleError('exists', error);
    }
  }

  async getMetadata(path: string): Promise<Record<string, string>> {
    try {
      return await this.withRetry(async () => {
        const head = await this.client.send(
          new HeadObjectCommand({
            Bucket: this.bucket,
            Key: path,
          }),
        );
        return head.Metadata || {};
      });
    } catch (error) {
      this.handleError('metadata', error);
    }
  }

  protected override isRetryableError(error: unknown): boolean {
    if (error instanceof S3ServiceException) {
      const retryableNames = new Set([
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
      ]);
      return retryableNames.has(error.name) || super.isRetryableError(error);
    }
    return super.isRetryableError(error);
  }
}

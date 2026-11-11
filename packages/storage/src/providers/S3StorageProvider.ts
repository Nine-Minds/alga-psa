import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  UploadPartCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import type { S3ProviderConfig, StorageCapabilities } from '../types/storage';
import {
  BaseStorageProvider,
  type PartReceipt,
  type S3WriteSessionHandle,
  type UploadResult,
  type WriteSessionHandle,
  type WriteSessionOptions,
} from './StorageProvider';

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

  protected async doBeginWrite(path: string, options: WriteSessionOptions): Promise<S3WriteSessionHandle> {
    const created = await this.withRetry(() =>
      this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: path,
          ContentType: options.mimeType,
          Metadata: options.metadata,
        }),
      ),
    );
    if (!created.UploadId) {
      throw new Error('S3 did not return an upload id');
    }
    return { provider: 's3', bucket: this.bucket, key: path, uploadId: created.UploadId, mimeType: options.mimeType };
  }

  protected async doWritePart(
    handle: WriteSessionHandle,
    partNumber: number,
    part: Readable | Buffer,
    size: number,
  ): Promise<Partial<PartReceipt>> {
    const { key, uploadId } = this.s3Handle(handle);
    const send = () =>
      this.client.send(
        new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: part,
          // The SDK cannot measure a stream; without ContentLength the request fails.
          ContentLength: size,
        }),
      );
    // A Readable can be consumed only once, so only Buffer parts are retried.
    const response = await (Buffer.isBuffer(part) ? this.withRetry(send) : send());
    if (!response.ETag) {
      throw new Error(`S3 did not return an ETag for part ${partNumber}`);
    }
    return { etag: response.ETag };
  }

  protected async doCompleteWrite(handle: WriteSessionHandle, parts: PartReceipt[]): Promise<UploadResult> {
    const { key, uploadId, mimeType } = this.s3Handle(handle);
    if (parts.some((part) => !part.etag)) {
      throw this.writeError('INVALID_PARTS', 'S3 part receipts must include an etag');
    }
    await this.withRetry(() =>
      this.client.send(
        new CompleteMultipartUploadCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
        }),
      ),
    );
    return await this.withRetry(async () => {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        path: key,
        size: head.ContentLength || 0,
        mime_type: head.ContentType || mimeType || 'application/octet-stream',
        metadata: head.Metadata,
      };
    });
  }

  protected async doAbortWrite(handle: WriteSessionHandle): Promise<void> {
    const { key, uploadId } = this.s3Handle(handle);
    try {
      await this.withRetry(() =>
        this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: key, UploadId: uploadId })),
      );
    } catch (error) {
      // Already aborted or completed: abort is idempotent.
      if (error instanceof S3ServiceException && (error.name === 'NoSuchUpload' || error.$metadata?.httpStatusCode === 404)) {
        return;
      }
      throw error;
    }
  }

  private s3Handle(handle: WriteSessionHandle): S3WriteSessionHandle {
    const h = handle as S3WriteSessionHandle;
    if (typeof h.key !== 'string' || !h.key || typeof h.uploadId !== 'string' || !h.uploadId) {
      throw this.writeError('INVALID_WRITE_HANDLE', 'S3 write session handle requires key and uploadId');
    }
    if (h.bucket !== this.bucket) {
      throw this.writeError('INVALID_WRITE_HANDLE', 'S3 write session handle was issued for a different bucket');
    }
    return h;
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

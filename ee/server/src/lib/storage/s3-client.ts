import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type HeadObjectCommandInput,
  type GetObjectCommandInput,
  type PutObjectCommandInput,
  type CreateMultipartUploadCommandInput,
  type CompleteMultipartUploadCommandInput,
  type AbortMultipartUploadCommandInput,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/**
 * Environment variable names (documented):
 * - STORAGE_S3_ENDPOINT (optional)
 * - STORAGE_S3_ACCESS_KEY
 * - STORAGE_S3_SECRET_KEY
 * - STORAGE_S3_REGION
 * - STORAGE_S3_BUCKET
 * - STORAGE_S3_FORCE_PATH_STYLE (optional, "true"/"false")
 */

type Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
};

export type S3EnvConfig = {
  endpoint?: string;
  region: string;
  credentials?: Credentials;
  forcePathStyle: boolean;
  bucket: string;
};

export type HeadObjectResult = {
  exists: boolean;
  eTag?: string;
  contentLength?: number;
  contentType?: string;
  lastModified?: Date;
};

export type GetObjectResult = {
  stream: NodeJS.ReadableStream | ReadableStream;
  eTag?: string;
  contentLength?: number;
  contentType?: string;
  lastModified?: Date;
};

export type PutObjectOptions = {
  contentType?: string;
  cacheControl?: string;
  contentLength?: number;
  /**
   * If-None-Match precondition value (e.g., "*").
   * Note: S3 PutObject does not officially document If-None-Match enforcement.
   * We attempt to pass the header through; some S3-compatible providers (e.g., MinIO)
   * may enforce it. For strict immutability, prefer multipart initiation with a prior head check.
   */
  ifNoneMatch?: string;
};

export type MultipartInitOptions = {
  contentType?: string;
  cacheControl?: string;
  /**
   * Optional If-None-Match semantic. Since CreateMultipartUpload doesn't support
   * If-None-Match, we perform a best-effort check via HeadObject when provided.
   * This is race-prone; only "best-effort".
   */
  ifNoneMatch?: string;
};

export type CompletedUploadPart = {
  etag: string;
  partNumber: number;
};

class S3ClientError extends Error {
  readonly statusCode?: number;
  readonly code?: string;

  constructor(message: string, statusCode?: number, code?: string) {
    super(message);
    this.name = "S3ClientError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

let s3ClientSingleton: S3Client | undefined;
let s3ConfigSingleton: S3EnvConfig | undefined;

/**
 * Parse boolean from env string.
 */
function parseBool(input: string | undefined, defaultValue: boolean): boolean {
  if (input == null) return defaultValue;
  const val = input.trim().toLowerCase();
  if (val === "true") return true;
  if (val === "false") return false;
  return defaultValue;
}

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new S3ClientError(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Normalize ETag values by removing surrounding quotes if present.
 */
function normalizeETag(e?: string | null): string | undefined {
  if (!e) return undefined;
  const trimmed = e.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * Wrap AWS SDK errors with a consistent error class and message.
 */
function wrapAwsError(e: unknown, context: string): never {
  const err = e as any;
  const status = err?.$metadata?.httpStatusCode ?? err?.$metadata?.httpStatusCode;
  const code = err?.name ?? err?.Code ?? err?.code;
  const message = typeof err?.message === "string" ? err.message : String(err);
  throw new S3ClientError(`${context}: ${message}`, status, code);
}

/**
 * Load and validate S3 configuration from environment variables.
 * - Requires STORAGE_S3_BUCKET and STORAGE_S3_REGION.
 * - If STORAGE_S3_ENDPOINT is provided, requires STORAGE_S3_ACCESS_KEY and STORAGE_S3_SECRET_KEY.
 * - forcePathStyle defaults:
 *   - When endpoint is provided: defaults to true unless STORAGE_S3_FORCE_PATH_STYLE is explicitly set.
 *   - When endpoint is not provided: defaults to false unless STORAGE_S3_FORCE_PATH_STYLE is set.
 */
export function getS3Config(): S3EnvConfig {
  if (s3ConfigSingleton) return s3ConfigSingleton;

  const endpoint = process.env.STORAGE_S3_ENDPOINT?.trim() || undefined;
  const region = required("STORAGE_S3_REGION", process.env.STORAGE_S3_REGION?.trim());
  const bucket = required("STORAGE_S3_BUCKET", process.env.STORAGE_S3_BUCKET?.trim());

  const forcePathStyle = endpoint
    ? parseBool(process.env.STORAGE_S3_FORCE_PATH_STYLE, true)
    : parseBool(process.env.STORAGE_S3_FORCE_PATH_STYLE, false);

  let credentials: Credentials | undefined;
  const accessKey = process.env.STORAGE_S3_ACCESS_KEY?.trim();
  const secretKey = process.env.STORAGE_S3_SECRET_KEY?.trim();

  if (endpoint) {
    // For custom endpoints (e.g., MinIO), make credentials mandatory.
    const access = required("STORAGE_S3_ACCESS_KEY", accessKey);
    const secret = required("STORAGE_S3_SECRET_KEY", secretKey);
    credentials = { accessKeyId: access, secretAccessKey: secret };
  } else if (accessKey && secretKey) {
    // If explicitly provided for AWS S3 too, honor them.
    credentials = { accessKeyId: accessKey, secretAccessKey: secretKey };
  } // else allow AWS default credential resolution

  s3ConfigSingleton = {
    endpoint,
    region,
    credentials,
    forcePathStyle,
    bucket,
  };

  return s3ConfigSingleton;
}

/**
 * Get the configured bucket name.
 */
export function getBucket(): string {
  return getS3Config().bucket;
}

/**
 * Returns the bucket to use for extension bundles, falling back to the default bucket.
 * Set STORAGE_S3_BUNDLE_BUCKET to use a separate bucket for bundles.
 */
export function getBundleBucket(): string {
  const override = process.env.STORAGE_S3_BUNDLE_BUCKET?.trim();
  if (override && override.length > 0) return override;
  throw new S3ClientError(
    'Extension bundles bucket not configured. Set STORAGE_S3_BUNDLE_BUCKET',
    500,
    'BUNDLE_CONFIG_MISSING'
  );
}

/**
 * Return a singleton S3Client instance configured for AWS S3 or S3-compatible providers (e.g., MinIO).
 */
export function getS3Client(): S3Client {
  if (s3ClientSingleton) return s3ClientSingleton;

  const cfg = getS3Config();

  s3ClientSingleton = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: cfg.credentials,
  });

  return s3ClientSingleton;
}

/**
 * HEAD object metadata.
 * @param key Object key
 * @returns { exists, eTag?, contentLength?, contentType?, lastModified? }
 */
export async function headObject(key: string, bucketOverride?: string): Promise<HeadObjectResult> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  const input: HeadObjectCommandInput = { Bucket, Key: key };

  try {
    const out = await client.send(new HeadObjectCommand(input));
    return {
      exists: true,
      eTag: normalizeETag(out.ETag ?? undefined),
      contentLength: typeof out.ContentLength === "number" ? out.ContentLength : undefined,
      contentType: out.ContentType ?? undefined,
      lastModified: out.LastModified ?? undefined,
    };
  } catch (e: any) {
    const status = e?.$metadata?.httpStatusCode;
    // Normalized not found handling
    if (status === 404 || e?.name === "NotFound" || e?.Code === "NotFound" || e?.code === "NotFound") {
      return { exists: false };
    }
    wrapAwsError(e, `headObject(${key}) failed`);
  }
}

/**
 * GET object as a stream with metadata.
 * @param key Object key
 */
export async function getObjectStream(key: string, bucketOverride?: string): Promise<GetObjectResult> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  const input: GetObjectCommandInput = { Bucket, Key: key };

  try {
    const out = await client.send(new GetObjectCommand(input));
    if (!out.Body) {
      throw new S3ClientError(`getObject(${key}) returned empty body`, out.$metadata?.httpStatusCode);
    }
    return {
      stream: out.Body as any, // NodeJS.ReadableStream in Node runtimes
      eTag: normalizeETag(out.ETag ?? undefined),
      contentLength: typeof out.ContentLength === "number" ? out.ContentLength : undefined,
      contentType: out.ContentType ?? undefined,
      lastModified: out.LastModified ?? undefined,
    };
  } catch (e) {
    wrapAwsError(e, `getObjectStream(${key}) failed`);
  }
}

/**
 * PUT object (small direct upload).
 * Best-effort support for If-None-Match precondition via header injection.
 * @param key Object key
 * @param body Data to upload
 * @param opts contentType, cacheControl, ifNoneMatch
 */
export async function putObject(
  key: string,
  body: Uint8Array | Buffer | NodeJS.ReadableStream | ReadableStream,
  opts?: PutObjectOptions,
  bucketOverride?: string
): Promise<{ eTag: string }> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  const input: PutObjectCommandInput = {
    Bucket,
    Key: key,
    Body: body as any,
    ContentType: opts?.contentType,
    CacheControl: opts?.cacheControl,
    ContentLength: typeof opts?.contentLength === "number" ? opts.contentLength : undefined,
  };

  const cmd = new PutObjectCommand(input);

  // Best-effort: inject If-None-Match header for providers that honor it (e.g., MinIO).
  // We add a one-off middleware to set the header for this specific send() call.
  const mwName = `put-if-none-match-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let added = false;
  if (opts?.ifNoneMatch) {
    client.middlewareStack.addRelativeTo(
      (next: any) => async (args: any) => {
        const req = args.request as any;
        req.headers = { ...(req.headers ?? {}), "if-none-match": opts.ifNoneMatch! };
        return next(args);
      },
      { name: mwName, relation: "after", toMiddleware: "contentLengthMiddleware" }
    );
    added = true;
  }

  // Some S3-compatible providers require x-amz-decoded-content-length for chunked streams.
  // If ContentLength is known, inject the header explicitly to avoid 'undefined' errors.
  const decodedLen = input.ContentLength;
  const mwDecodedName = `put-x-amz-decoded-len-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let addedDecoded = false;
  if (typeof decodedLen === 'number') {
    client.middlewareStack.addRelativeTo(
      (next: any) => async (args: any) => {
        const req = args.request as any;
        req.headers = { ...(req.headers ?? {}), 'x-amz-decoded-content-length': String(decodedLen) };
        return next(args);
      },
      { name: mwDecodedName, relation: 'after', toMiddleware: 'contentLengthMiddleware' }
    );
    addedDecoded = true;
  }

  try {
    const out = await client.send(cmd);
    const eTag = normalizeETag(out.ETag ?? undefined);
    if (!eTag) {
      if (added) client.middlewareStack.remove(mwName);
      if (addedDecoded) client.middlewareStack.remove(mwDecodedName);
      throw new S3ClientError(`putObject(${key}) did not return an ETag`, out.$metadata?.httpStatusCode);
    }
    if (added) client.middlewareStack.remove(mwName);
    if (addedDecoded) client.middlewareStack.remove(mwDecodedName);
    return { eTag };
  } catch (e) {
    if (added) client.middlewareStack.remove(mwName);
    if (addedDecoded) client.middlewareStack.remove(mwDecodedName);
    wrapAwsError(e, `putObject(${key}) failed`);
  }
}

/**
 * Get a presigned URL for PUT.
 * Note: If-None-Match cannot be part of PutObjectCommand input in AWS SDK v3,
 * but ContentType and CacheControl can be signed. Some providers may still allow
 * If-None-Match via custom signed headers; this function focuses on standard headers.
 * @param key Object key
 * @param expiresSeconds Expiration in seconds
 * @param opts contentType, cacheControl, ifNoneMatch (best-effort)
 */
export async function getPresignedPutUrl(
  key: string,
  expiresSeconds: number,
  opts?: PutObjectOptions,
  bucketOverride?: string
): Promise<string> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  const input: PutObjectCommandInput = {
    Bucket,
    Key: key,
    ContentType: opts?.contentType,
    CacheControl: opts?.cacheControl,
  };

  // Note: If-None-Match is not a recognized input field for PutObjectCommand.
  // Some S3-compatible services might honor it if included as a header during upload,
  // but including it in the signed headers via SDK isn't officially supported.
  const cmd = new PutObjectCommand(input);

  try {
    // Type assertion needed due to nested node_modules causing @smithy/types version mismatch
    return await getSignedUrl(client as any, cmd as any, { expiresIn: expiresSeconds });
  } catch (e) {
    wrapAwsError(e, `getPresignedPutUrl(${key}) failed`);
  }
}

/**
 * Get a presigned URL for GET.
 * @param key Object key
 * @param expiresSeconds Expiration in seconds
 */
export async function getPresignedGetUrl(key: string, expiresSeconds: number, bucketOverride?: string): Promise<string> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  const input: GetObjectCommandInput = { Bucket, Key: key };
  const cmd = new GetObjectCommand(input);

  try {
    // Type assertion needed due to nested node_modules causing @smithy/types version mismatch
    return await getSignedUrl(client as any, cmd as any, { expiresIn: expiresSeconds });
  } catch (e) {
    wrapAwsError(e, `getPresignedGetUrl(${key}) failed`);
  }
}

/**
 * Initiate multipart upload.
 * Best-effort If-None-Match: perform a HEAD check first when provided.
 * @param key Object key
 * @param opts contentType, cacheControl, ifNoneMatch (best-effort via HEAD)
 */
export async function initiateMultipartUpload(
  key: string,
  opts?: MultipartInitOptions,
  bucketOverride?: string
): Promise<{ uploadId: string }> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  if (opts?.ifNoneMatch) {
    // Best-effort: fail fast if object exists and ifNoneMatch is "*".
    try {
      const head = await headObject(key);
      if (head.exists && opts.ifNoneMatch === "*") {
        throw new S3ClientError("Precondition failed: object already exists (If-None-Match: \"*\")", 412);
      }
      if (head.exists && head.eTag && opts.ifNoneMatch === head.eTag) {
        throw new S3ClientError(`Precondition failed: existing ETag matches (${head.eTag})`, 412);
      }
    } catch (e) {
      if (e instanceof S3ClientError) throw e;
      wrapAwsError(e, `initiateMultipartUpload(${key}) head precheck failed`);
    }
  }

  const input: CreateMultipartUploadCommandInput = {
    Bucket,
    Key: key,
    ContentType: opts?.contentType,
    CacheControl: opts?.cacheControl,
  };

  try {
    const out = await client.send(new CreateMultipartUploadCommand(input));
    const uploadId = out.UploadId;
    if (!uploadId) {
      throw new S3ClientError(`initiateMultipartUpload(${key}) did not return an UploadId`, out.$metadata?.httpStatusCode);
    }
    return { uploadId };
  } catch (e) {
    wrapAwsError(e, `initiateMultipartUpload(${key}) failed`);
  }
}

/**
 * Complete multipart upload.
 * @param key Object key
 * @param uploadId Upload ID from initiation
 * @param parts Array of { etag, partNumber }
 */
export async function completeMultipartUpload(
  key: string,
  uploadId: string,
  parts: Array<CompletedUploadPart>,
  bucketOverride?: string
): Promise<{ eTag: string }> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  const CompletedParts: CompletedPart[] = parts
    .map((p) => ({
      ETag: p.etag,
      PartNumber: p.partNumber,
    }))
    .sort((a, b) => (a.PartNumber! - b.PartNumber!));

  const input: CompleteMultipartUploadCommandInput = {
    Bucket,
    Key: key,
    UploadId: uploadId,
    MultipartUpload: { Parts: CompletedParts },
  };

  try {
    const out = await client.send(new CompleteMultipartUploadCommand(input));
    const eTag = normalizeETag(out.ETag ?? undefined);
    if (!eTag) {
      throw new S3ClientError(`completeMultipartUpload(${key}) did not return an ETag`, out.$metadata?.httpStatusCode);
    }
    return { eTag };
  } catch (e) {
    wrapAwsError(e, `completeMultipartUpload(${key}) failed`);
  }
}

/**
 * Abort multipart upload.
 * @param key Object key
 * @param uploadId Upload ID to abort
 */
export async function abortMultipartUpload(key: string, uploadId: string, bucketOverride?: string): Promise<void> {
  const client = getS3Client();
  const Bucket = bucketOverride ?? getBucket();

  const input: AbortMultipartUploadCommandInput = {
    Bucket,
    Key: key,
    UploadId: uploadId,
  };

  try {
    await client.send(new AbortMultipartUploadCommand(input));
  } catch (e) {
    wrapAwsError(e, `abortMultipartUpload(${key}) failed`);
  }
}

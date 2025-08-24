/**
 * S3-backed implementation of the IBundleStore interface.
 *
 * This module adapts the provider-agnostic bundle storage API to S3 using the
 * shared S3 helpers in ../s3-client. Error handling wraps AWS SDK errors into a
 * concise Error with an httpStatusCode property when available.
 */

import type { CompletedPart as AwsCompletedPart } from "@aws-sdk/client-s3";
import {
  headObject as s3HeadObject,
  getObjectStream as s3GetObjectStream,
  putObject as s3PutObject,
  getPresignedPutUrl as s3GetPresignedPutUrl,
  getPresignedGetUrl as s3GetPresignedGetUrl,
  initiateMultipartUpload as s3InitiateMultipartUpload,
  completeMultipartUpload as s3CompleteMultipartUpload,
  abortMultipartUpload as s3AbortMultipartUpload,
  getBundleBucket,
} from "../s3-client";
import type {
  IBundleStore,
  HeadResult,
  BundleStoreConfig,
  BundleObjectKey,
  PutObjectOptions,
  PresignPutOptions,
  PresignGetOptions,
  InitiateMultipartResult,
  CompletedPart,
  CompleteMultipartResult,
} from "./types";
import { normalizeBasePrefix } from "./types";

/**
 * Normalize and rethrow errors with concise message and httpStatusCode.
 * Adds `httpStatusCode` numeric property when derivable from the source error.
 */
function rethrowConcise(e: unknown, context?: string): never {
  const err = e as any;
  const status =
    err?.httpStatusCode ??
    err?.statusCode ??
    err?.$metadata?.httpStatusCode ??
    undefined;
  const baseMsg = typeof err?.message === "string" ? err.message : String(err);
  const msg = context ? `${context}: ${baseMsg}` : baseMsg;
  const out = new Error(status ? `${msg} (status ${status})` : msg);
  (out as any).httpStatusCode = status;
  throw out;
}

/**
 * Create an S3-backed bundle store.
 *
 * - Uses normalizeBasePrefix for forward compatibility with any future
 *   base-prefix logic in higher layers; keys provided to this store are already
 *   fully-resolved object keys, so the prefix is currently not used here.
 * - All calls delegate to the shared S3 helpers for consistency.
 */
export function createS3BundleStore(config?: BundleStoreConfig): IBundleStore {
  // Normalize once for possible future use; currently not used for direct key operations.
  const _basePrefix = normalizeBasePrefix(config?.basePrefix);

  const bundleBucket = getBundleBucket();
  const store: IBundleStore = {
    /**
     * HEAD object metadata.
     */
    async headObject(key: BundleObjectKey): Promise<HeadResult> {
      try {
        const out = await s3HeadObject(key, bundleBucket);
        // Map one-to-one (types are aligned)
        return {
          exists: out.exists,
          eTag: out.eTag,
          contentLength: out.contentLength,
          contentType: out.contentType,
          lastModified: out.lastModified,
        };
      } catch (e) {
        rethrowConcise(e, `headObject(${key})`);
      }
    },

    /**
     * GET object as a stream with metadata.
     */
    async getObjectStream(
      key: BundleObjectKey
    ): Promise<{
      stream: NodeJS.ReadableStream | ReadableStream;
      contentType?: string;
      contentLength?: number;
      eTag?: string;
      lastModified?: Date;
    }> {
      try {
        const out = await s3GetObjectStream(key, bundleBucket);
        return {
          stream: out.stream,
          eTag: out.eTag,
          contentLength: out.contentLength,
          contentType: out.contentType,
          lastModified: out.lastModified,
        };
      } catch (e) {
        rethrowConcise(e, `getObjectStream(${key})`);
      }
    },

    /**
     * PUT object (small direct upload).
     * Enforces immutability by defaulting If-None-Match to "*"
     * unless explicitly overridden in opts.
     */
    async putObject(
      key: BundleObjectKey,
      body: Uint8Array | Buffer | NodeJS.ReadableStream,
      opts?: PutObjectOptions
    ): Promise<{ eTag: string }> {
      const effective: PutObjectOptions = {
        contentType: opts?.contentType,
        cacheControl: opts?.cacheControl,
        ifNoneMatch: opts?.ifNoneMatch ?? "*",
        contentLength: opts?.contentLength,
      };
      try {
        return await s3PutObject(key, body as any, effective, bundleBucket);
      } catch (e) {
        rethrowConcise(e, `putObject(${key})`);
      }
    },

    /**
     * Create a presigned PUT URL.
     * Best-effort immutability: If opts.ifNoneMatch is not provided, default to "*".
     * Note: The underlying helper focuses on standard headers (ContentType/CacheControl).
     * Including If-None-Match in presigned headers is not officially supported by AWS SDK v3.
     */
    async getPresignedPutUrl(
      key: BundleObjectKey,
      opts: PresignPutOptions
    ): Promise<string> {
      const effective: PutObjectOptions = {
        contentType: opts.contentType,
        cacheControl: opts.cacheControl,
        ifNoneMatch: opts.ifNoneMatch ?? "*",
      };
      try {
        return await s3GetPresignedPutUrl(key, opts.expiresSeconds, effective, bundleBucket);
      } catch (e) {
        rethrowConcise(e, `getPresignedPutUrl(${key})`);
      }
    },

    /**
     * Create a presigned GET URL.
     */
    async getPresignedGetUrl(
      key: BundleObjectKey,
      opts: PresignGetOptions
    ): Promise<string> {
      try {
        return await s3GetPresignedGetUrl(key, opts.expiresSeconds, bundleBucket);
      } catch (e) {
        rethrowConcise(e, `getPresignedGetUrl(${key})`);
      }
    },

    /**
     * Initiate multipart upload.
     * Carries contentType/cacheControl. Best-effort immutability via prior HEAD when opts.ifNoneMatch is provided.
     */
    async initiateMultipartUpload(
      key: BundleObjectKey,
      opts?: PutObjectOptions
    ): Promise<InitiateMultipartResult> {
      try {
        const out = await s3InitiateMultipartUpload(key, {
          contentType: opts?.contentType,
          cacheControl: opts?.cacheControl,
          ifNoneMatch: opts?.ifNoneMatch ?? "*",
        }, bundleBucket);
        return { uploadId: out.uploadId };
      } catch (e) {
        rethrowConcise(e, `initiateMultipartUpload(${key})`);
      }
    },

    /**
     * Complete multipart upload with the provided parts.
     */
    async completeMultipartUpload(
      key: BundleObjectKey,
      uploadId: string,
      parts: CompletedPart[]
    ): Promise<CompleteMultipartResult> {
      try {
        const mapped = parts.map((p): { etag: string; partNumber: number } => ({
          etag: p.etag,
          partNumber: p.partNumber,
        }));
        const out = await s3CompleteMultipartUpload(key, uploadId, mapped, bundleBucket);
        return { eTag: out.eTag };
      } catch (e) {
        rethrowConcise(e, `completeMultipartUpload(${key})`);
      }
    },

    /**
     * Abort multipart upload.
     */
    async abortMultipartUpload(key: BundleObjectKey, uploadId: string): Promise<void> {
      try {
        await s3AbortMultipartUpload(key, uploadId, bundleBucket);
      } catch (e) {
        rethrowConcise(e, `abortMultipartUpload(${key})`);
      }
    },
  };

  return store;
}

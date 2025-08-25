/**
 * Bundle store types and key policy helpers for content-addressed storage.
 * Pure TypeScript; no provider-specific logic or external imports.
 */

/**
 * Canonical object names within a bundle.
 * Use union type for ergonomic literal typing while exporting values list.
 */
export type BundleObjectName = "bundle.tar.zst" | "manifest.json" | "entry.wasm";

/**
 * Canonical precompiled object name pattern within a bundle.
 * Example: "precompiled/foo.cwasm"
 */
export type PrecompiledObjectName = `precompiled/${string}.cwasm`;

/**
 * Content address details. Only sha256 is supported.
 */
export interface ContentAddress {
  algorithm: "sha256";
  /** Lowercase hex sha256 hash (64 chars) */
  hash: string;
}

/**
 * Full object key within the blob store (e.g., "sha256/<hash>/bundle.tar.zst").
 */
export type BundleObjectKey = string;

/**
 * Bundle store configuration.
 */
export interface BundleStoreConfig {
  /**
   * Base key prefix for the address namespace.
   * Example: "sha256/" (default).
   */
  basePrefix: string;
}

/**
 * Options for simple PUT operations.
 */
export interface PutObjectOptions {
  contentType?: string;
  cacheControl?: string;
  /** Known content length in bytes (used by some providers). */
  contentLength?: number;
  /**
   * Optional content length hint for streaming uploads. When provided, the
   * underlying client can avoid chunked uploads and ambiguous headers.
   */
  contentLength?: number;
  /**
   * Write-once protection. If unspecified, helpers will default to If-None-Match: "*".
   */
  ifNoneMatch?: string;
}

/**
 * Result from headObject calls.
 */
export interface HeadResult {
  exists: boolean;
  eTag?: string;
  contentLength?: number;
  contentType?: string;
  lastModified?: Date;
}

/**
 * Options for creating a presigned PUT URL.
 */
export interface PresignPutOptions {
  contentType?: string;
  cacheControl?: string;
  ifNoneMatch?: string;
  /** Link expiration time in seconds. */
  expiresSeconds: number;
}

/**
 * Options for creating a presigned GET URL.
 */
export interface PresignGetOptions {
  /** Link expiration time in seconds. */
  expiresSeconds: number;
}

/**
 * Result when initiating a multipart upload.
 */
export interface InitiateMultipartResult {
  uploadId: string;
}

/**
 * A completed part descriptor for finalizing multipart uploads.
 */
export interface CompletedPart {
  etag: string;
  partNumber: number;
}

/**
 * Result returned after completing a multipart upload.
 */
export interface CompleteMultipartResult {
  eTag: string;
}

/**
 * Public bundle store interface. Implementations (e.g., S3) should conform to this contract.
 */
export interface IBundleStore {
  headObject(key: BundleObjectKey): Promise<HeadResult>;
  getObjectStream(
    key: BundleObjectKey
  ): Promise<{
    stream: NodeJS.ReadableStream | ReadableStream;
    contentType?: string;
    contentLength?: number;
    eTag?: string;
    lastModified?: Date;
  }>;
  putObject(
    key: BundleObjectKey,
    body: Uint8Array | Buffer | NodeJS.ReadableStream,
    opts?: PutObjectOptions
  ): Promise<{ eTag: string }>;
  getPresignedPutUrl(key: BundleObjectKey, opts: PresignPutOptions): Promise<string>;
  getPresignedGetUrl(key: BundleObjectKey, opts: PresignGetOptions): Promise<string>;
  initiateMultipartUpload(
    key: BundleObjectKey,
    opts?: PutObjectOptions
  ): Promise<InitiateMultipartResult>;
  completeMultipartUpload(
    key: BundleObjectKey,
    uploadId: string,
    parts: CompletedPart[]
  ): Promise<CompleteMultipartResult>;
  abortMultipartUpload(key: BundleObjectKey, uploadId: string): Promise<void>;
}

/**
 * Validate a sha256 hash: lowercase hex, 64 characters.
 */
export function isValidSha256Hash(hash: string): boolean {
  return /^[a-f0-9]{64}$/.test(hash);
}

/**
 * Normalize the base prefix used for keys.
 * - Defaults to "sha256/"
 * - Ensures exactly one trailing "/"
 * - Strips all leading "/" characters
 */
export function normalizeBasePrefix(prefix?: string): string {
  const raw = prefix ?? "sha256/";
  // Remove leading slashes, collapse trailing slashes, then ensure a single trailing "/"
  let cleaned = raw.replace(/^\/+/, "").replace(/\/+$/, "");
  if (cleaned.length === 0) cleaned = "sha256";
  return `${cleaned}/`;
}

/**
 * Compute the bundle root key (`<basePrefix><hash>/`) for a content address.
 * Throws if the algorithm is unsupported or the hash is invalid.
 */
export function bundleRootKey(addr: ContentAddress, cfg?: BundleStoreConfig): string {
  if (addr.algorithm !== "sha256") {
    throw new Error(`Unsupported content address algorithm: ${addr.algorithm}`);
  }
  if (!isValidSha256Hash(addr.hash)) {
    throw new Error("Invalid sha256 hash (must be 64 chars, lowercase hex).");
  }
  const base = normalizeBasePrefix(cfg?.basePrefix);
  return `${base}${addr.hash}/`;
}

/**
 * Determine if the provided name is an allowed bundle object name.
 * For precompiled objects, the name must match: ^precompiled/[^/]+\.cwasm$
 */
export function isAllowedObjectName(name: string): name is BundleObjectName | PrecompiledObjectName {
  if (
    name === "bundle.tar.zst" ||
    name === "manifest.json" ||
    name === "entry.wasm"
  ) {
    return true;
  }
  // precompiled/<no-slash>.cwasm
  return /^precompiled\/[^\/]+\.cwasm$/.test(name);
}

/**
 * Construct the full object key for a given content address and object name.
 * Enforces allowed names and prevents path traversal.
 */
export function objectKeyFor(
  addr: ContentAddress,
  name: BundleObjectName | PrecompiledObjectName,
  cfg?: BundleStoreConfig
): BundleObjectKey {
  if (!isAllowedObjectName(name)) {
    throw new Error(`Disallowed object name: ${name}`);
  }
  const root = bundleRootKey(addr, cfg);
  return `${root}${name}`;
}

/**
 * Build headers enforcing write-once semantics and passing through optional hints.
 * - Ensures "If-None-Match" is set to "*", unless already provided.
 * - Mirrors contentType and cacheControl to standard HTTP header names.
 */
export function ensureImmutabilityHeaders(
  opts?: PutObjectOptions
): Record<string, string | undefined> {
  return {
    "If-None-Match": opts?.ifNoneMatch ?? "*",
    "Content-Type": opts?.contentType,
    "Cache-Control": opts?.cacheControl,
  };
}

/**
 * Exported list of canonical bundle object names (for iteration or validation UIs).
 */
export const BUNDLE_OBJECT_NAMES: ReadonlyArray<BundleObjectName> = [
  "bundle.tar.zst",
  "manifest.json",
  "entry.wasm",
] as const;

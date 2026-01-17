"use server";

/**
 * Server actions for extension bundle upload flow.
 * - Business logic and IO live here.
 * - API routes handle RBAC/rate-limiting/logging and delegate to these actions.
 */

import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createS3BundleStore } from "../storage/bundles/s3-bundle-store";
import { isValidSha256Hash, objectKeyFor, normalizeBasePrefix } from "../storage/bundles/types";
import { Readable } from "node:stream";
import { getS3Client, getBundleBucket } from "../storage/s3-client";
import { createTenantKnex } from '@/lib/db/index';
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import {
  hashSha256Stream,
  loadTrustBundle,
  verifySignature,
} from "../extensions/bundles/verify";
import {
  parseManifestJson,
  extractEndpoints,
  getUiEntry,
  getUiHooks,
  getRuntime,
  getCapabilities,
  type ManifestV2,
} from "../extensions/bundles/manifest";
import { upsertVersionFromManifest } from "../extensions/registry-v2";
import { ensureRegistryV2KnexRepo } from "../extensions/registry-v2-repo-knex";
import type { Knex } from "knex";
import { getAdminConnection } from '@alga-psa/db/admin';
// import { createTenantKnex } from '@/lib/db/index';

//
// Prefer a global/admin knex since registry tables are global
async function getAdminKnex(): Promise<Knex> {
  try {
    return await getAdminConnection();
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    // const { createTenantKnex } = require('@/lib/db');
    const out = await createTenantKnex();
    return out.knex as Knex;
  } catch (e) {
    throw new Error('RegistryV2: failed to resolve a Knex connection for repository registration');
  }
}

/** Error with HTTP status and machine code for route mapping */
class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const MAX_BUNDLE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MiB
const BASE_PREFIX = "sha256/";

// Types
// Initiate/presign flow removed; uploads now use server-proxied streaming.
export async function extUploadProxy(formData: FormData): Promise<{ upload: { key: string; strategy: "staging" }; filename: string; size: number; declaredHash?: string; }> {
  const filename = String(formData.get("filename") ?? "").trim();
  const sizeRaw = String(formData.get("size") ?? "").trim();
  const declaredHashRaw = formData.get("declaredHash");
  const file = formData.get("file") as unknown as File | null;

  try { console.log(JSON.stringify({ ts: new Date().toISOString(), event: "ext_bundles.upload_proxy.action.entry", filenamePresent: filename.length > 0, sizeRaw, hasFile: Boolean(file) })); } catch {}

  if (!filename) throw new Error("filename is required");
  if (!sizeRaw) throw new Error("size is required");
  const size = Number(sizeRaw);
  if (!Number.isFinite(size) || size <= 0) throw new Error("size must be a positive number");
  if (size > MAX_BUNDLE_SIZE_BYTES) throw new Error(`size exceeds maximum of ${MAX_BUNDLE_SIZE_BYTES} bytes`);

  let declaredHash: string | undefined;
  if (typeof declaredHashRaw === "string" && declaredHashRaw.length > 0) {
    if (!isValidSha256Hash(declaredHashRaw)) throw new Error("declaredHash must be 64-char lowercase hex sha256");
    declaredHash = declaredHashRaw;
  }

  if (!file || typeof (file as any).stream !== "function") throw new Error("file is required and must be a File");

  const { tenant } = await createTenantKnex();
  if (!tenant) throw new Error('Tenant not found');
  const id = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const key = `tenants/${tenant}/_staging/${id}/bundle.tar.zst`;

  const contentType: string = (file as any).type || "application/octet-stream";

  const store = createS3BundleStore();
  const started = Date.now();
  // Preflight: verify bucket exists; surface clear error if not
  try {
    const s3 = getS3Client();
    const Bucket = getBundleBucket();
    await s3.send(new HeadBucketCommand({ Bucket } as any));
  } catch (e: any) {
    const code = (e?.code || e?.name || '').toString();
    if (code === 'BUNDLE_CONFIG_MISSING') {
      throw new HttpError(500, 'BUNDLE_CONFIG_MISSING', 'Extension bundle storage not configured (set STORAGE_S3_BUNDLE_BUCKET)');
    }
    throw new HttpError(500, "BUCKET_NOT_FOUND", "Storage bucket not found. Please contact an administrator to configure extension storage.");
  }
  try {
    const webStream = (file as any).stream() as unknown as ReadableStream;
    const nodeStream = Readable.fromWeb(webStream as any);

    await store.putObject(
      key,
      nodeStream as unknown as NodeJS.ReadableStream,
      { contentType, ifNoneMatch: "*", contentLength: size }
    );
  } catch (e: any) {
    const status = e?.httpStatusCode ?? e?.statusCode;
    const code = (e?.code || e?.name || '').toString();
    try { console.log(JSON.stringify({ ts: new Date().toISOString(), event: "ext_bundles.upload_proxy.action.s3_error", message: typeof e?.message === "string" ? e.message : String(e), status, code })); } catch {}
    if (code === 'NoSuchBucket' || status === 404) {
      throw new HttpError(500, 'BUCKET_NOT_FOUND', 'Storage bucket not found. Please contact an administrator to configure extension storage.');
    }
    throw new HttpError(500, 'S3_PUT_FAILED', e?.message || 'Failed to store upload');
  }

  try { console.log(JSON.stringify({ ts: new Date().toISOString(), event: "ext_bundles.upload_proxy.action.success", key, filename, size, durationMs: Date.now() - started })); } catch {}

  return { upload: { key, strategy: "staging" }, filename, size, ...(declaredHash ? { declaredHash } : {}) };
}

export type FinalizeParams = {
  key: string;
  size?: number;
  declaredHash?: string;
  manifestJson?: string;
  signature?: { text?: string; algorithm?: "cosign" | "x509" | "pgp" };
  responseMode?: "throw" | "result";
};

export type FinalizeResult = {
  extension: { id: string; name: string; publisher?: string };
  version: { id: string; version: string };
  contentHash: string;
  canonicalKey: string;
};

export type FinalizeUploadResponse =
  | { success: true; data: FinalizeResult }
  | { success: false; error: { message: string; code?: string; details?: unknown } };

type FinalizeParamsInternal = Omit<FinalizeParams, "responseMode">;

function formatFinalizeError(err: unknown): { message: string; code?: string; details?: unknown } {
  if (err instanceof HttpError) {
    const payload: { message: string; code?: string; details?: unknown } = {
      message: err.message,
    };
    if (err.code) payload.code = err.code;
    if (typeof err.details !== "undefined") payload.details = err.details;
    return payload;
  }

  if (err && typeof err === "object") {
    const maybe = err as { message?: unknown; code?: unknown; details?: unknown };
    const message = typeof maybe.message === "string" && maybe.message.length > 0
      ? maybe.message
      : "Unexpected error finalizing upload";
    const payload: { message: string; code?: string; details?: unknown } = { message };
    if (typeof maybe.code === "string" && maybe.code.length > 0) {
      payload.code = maybe.code;
    }
    if (typeof maybe.details !== "undefined") {
      payload.details = maybe.details;
    }
    return payload;
  }

  return { message: "Unexpected error finalizing upload" };
}

async function finalizeUploadInternal(params: FinalizeParamsInternal): Promise<FinalizeResult> {
  // Ensure Registry v2 repository is wired before any DB writes
  await ensureRegistryV2KnexRepo(getAdminKnex);
  const { key, size, declaredHash, manifestJson, signature } = params ?? ({} as any);

  // Require bundle storage configuration
  try {
    void getBundleBucket();
  } catch (e: any) {
    throw new HttpError(500, 'BUNDLE_CONFIG_MISSING', 'Extension bundle storage not configured (set STORAGE_S3_BUNDLE_BUCKET)');
  }

  // Validate key
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", "key is required");
  }
  if (!key.includes('/_staging/') || !key.endsWith('/bundle.tar.zst')) {
    throw new HttpError(400, "BAD_REQUEST", 'invalid staging key (expected tenants/<tenant>/_staging/<id>/bundle.tar.zst)');
  }

  // Validate size (optional)
  if (typeof size !== "undefined") {
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      throw new HttpError(400, "BAD_REQUEST", "size must be a positive number");
    }
    if (size > MAX_BUNDLE_SIZE_BYTES) {
      throw new HttpError(
        400,
        "BAD_REQUEST",
        `size exceeds maximum of ${MAX_BUNDLE_SIZE_BYTES} bytes`
      );
    }
  }

  // Validate declaredHash (optional)
  let declared: string | undefined;
  if (typeof declaredHash !== "undefined") {
    if (typeof declaredHash !== "string" || !isValidSha256Hash(declaredHash)) {
      throw new HttpError(
        400,
        "BAD_REQUEST",
        "declaredHash must be 64-char lowercase hex sha256"
      );
    }
    declared = declaredHash;
  }

  // Verify staging object exists before we proceed
  const store = createS3BundleStore();
  try {
    const h = await store.headObject(key);
    try { console.info("ext.finalize.debug.staging_head", { key, exists: h.exists, contentLength: h.contentLength, eTag: h.eTag }); } catch {}
    if (!h.exists) {
      throw new HttpError(400, "STAGING_NOT_FOUND", "Uploaded staging object not found in storage");
    }
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(500, "S3_HEAD_FAILED", e?.message || "Failed to head staging object");
  }

  // Stream and hash the bundle
  let got: { stream: NodeJS.ReadableStream | ReadableStream; contentType?: string; contentLength?: number; eTag?: string; lastModified?: Date };
  try {
    got = await store.getObjectStream(key);
  } catch (e: any) {
    const status = e?.httpStatusCode ?? e?.statusCode;
    const code = (e?.code || e?.name || '').toString();
    if (code === 'NoSuchBucket' || status === 404) {
      throw new HttpError(500, 'OBJECT_NOT_FOUND', 'Uploaded bundle was not found in storage. The bucket may be missing or misconfigured.');
    }
    throw new HttpError(500, 'S3_GET_FAILED', e?.message || 'Failed to read uploaded object');
  }
  const nodeStream = got.stream as NodeJS.ReadableStream;
  const hashResult = await hashSha256Stream(nodeStream, { maxBytes: MAX_BUNDLE_SIZE_BYTES });
  const computedHash = hashResult.hashHex;

  if (declared && declared !== computedHash) {
    throw new HttpError(400, "HASH_MISMATCH", "Declared hash does not match computed content hash", {
      declared,
      computed: computedHash,
    });
  }

  // canonical copy moved below after registry upsert to know tenant/extension

  // Require manifest for this milestone
  if (typeof manifestJson === "undefined") {
    throw new HttpError(400, "MANIFEST_REQUIRED", "manifestJson is required for this milestone");
  }
  if (typeof manifestJson !== "string" || manifestJson.trim().length === 0) {
    throw new HttpError(
      400,
      "BAD_REQUEST",
      "manifestJson, if provided, must be a non-empty string"
    );
  }

  // Temporary debug logging to disambiguate flows and surface parse issues
  try {
    // eslint-disable-next-line no-console
    console.info("ext.finalize.debug.input", {
      hasManifestJson: typeof manifestJson === "string",
      manifestLength: typeof manifestJson === "string" ? manifestJson.length : 0,
      key,
      hasSignature: Boolean(signature?.text),
      sigAlg: signature?.algorithm,
    });
  } catch {
    // ignore logging errors
  }

  const parsed = parseManifestJson(manifestJson);
  if (!parsed.manifest) {
    try {
      // eslint-disable-next-line no-console
      console.info("ext.finalize.debug.invalid_manifest", {
        issues: parsed.issues,
        key,
      });
    } catch {
      // ignore
    }
    throw new HttpError(400, "INVALID_MANIFEST", "Invalid manifest", { issues: parsed.issues });
  }

  const manifest = parsed.manifest as ManifestV2;
  const parsedEndpoints = extractEndpoints(manifest);
  const parsedUiEntry = getUiEntry(manifest);
  // Build a sanitized UI object (type/entry/known hooks only) for persistence
  const parsedUi = (() => {
    try {
      const ui = (manifest as any).ui;
      if (!ui || ui.type !== 'iframe') return undefined;
      const entry = parsedUiEntry ?? (typeof ui.entry === 'string' ? ui.entry : undefined);
      if (!entry) return undefined;
      const hooks = getUiHooks(manifest);
      return hooks ? { type: 'iframe' as const, entry, hooks } : { type: 'iframe' as const, entry };
    } catch {
      return undefined;
    }
  })();
  const parsedRuntime = getRuntime(manifest);
  const parsedCapabilities = getCapabilities(manifest);

  // manifest write moved below after canonical copy

  // Signature policy
  const trustBundle = loadTrustBundle(process.env as any);
  const sigResult = await verifySignature({
    bundleBytes: undefined,
    signatureText: signature?.text,
    algorithm: signature?.algorithm,
    trustBundle,
  });

  // Registry upsert
  const runtime = parsedRuntime ?? manifest.runtime;

  try {
    // eslint-disable-next-line no-console
    console.info("ext.finalize.debug.upsert_start", {
      name: manifest.name,
      version: manifest.version,
      publisher: manifest.publisher,
      runtime,
      hasUi: Boolean(parsedUiEntry),
      endpointsCount: parsedEndpoints.length,
      contentHash: computedHash,
    });
  } catch {
    // ignore
  }

  const upsertResult = await upsertVersionFromManifest({
    manifest,
    contentHash: computedHash,
    parsed: {
      ui: parsedUi,
      uiEntry: parsedUiEntry,
      endpoints: parsedEndpoints,
      runtime,
      capabilities: parsedCapabilities,
    },
    signature: sigResult,
  });

  try { console.info("ext.finalize.debug.upsert_ok", { extensionId: upsertResult.extension.id, versionId: upsertResult.version.id }); } catch {}

  // Compute tenant-local canonical key and copy staging → canonical
  const { tenant } = await createTenantKnex();
  if (!tenant) throw new HttpError(500, 'INTERNAL', 'Tenant not found during finalize');
  const canonicalKey = `tenants/${tenant}/extensions/${upsertResult.extension.id}/sha256/${computedHash}/bundle.tar.zst`;
  if (key !== canonicalKey) {
    const s3 = getS3Client();
    const bucket = getBundleBucket();
    // Pass CopySource without encoding slashes to avoid invalid source path
    const cmd = new CopyObjectCommand({ Bucket: bucket, Key: canonicalKey, CopySource: `${bucket}/${key}` } as any);
    const mwName = `copy-if-none-match-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s3.middlewareStack.addRelativeTo((next: any) => async (args: any) => { const req = args.request as any; req.headers = { ...(req.headers ?? {}), 'if-none-match': '*' }; return next(args); }, { name: mwName, relation: 'after', toMiddleware: 'contentLengthMiddleware' });
    try { await s3.send(cmd); } finally { s3.middlewareStack.remove(mwName); }
    // Verify
    try { const h2 = await store.headObject(canonicalKey); try { console.info("ext.finalize.debug.canonical_head", { key: canonicalKey, exists: h2.exists, contentLength: h2.contentLength, eTag: h2.eTag }); } catch {}; if (!h2.exists) throw new Error('canonical missing'); }
    catch (e: any) { throw new HttpError(500, 'CANONICAL_MISSING', e?.message || 'Canonical object missing'); }
  }

  // Write manifest duplicate alongside canonical
  const manifestKey = `tenants/${tenant}/extensions/${upsertResult.extension.id}/sha256/${computedHash}/manifest.json`;
  try {
    const store2 = createS3BundleStore();
    await store2.putObject(manifestKey, Buffer.from(manifestJson, 'utf-8'), { contentType: 'application/json', cacheControl: 'public, max-age=31536000, immutable', ifNoneMatch: '*' });
  } catch (e: any) {
    const status = e?.httpStatusCode ?? e?.statusCode;
    if (status === 412 || status === 409) { try { console.info('ext.finalize.debug.manifest_exists', { key: manifestKey, status }); } catch {} }
    else { throw new HttpError(500, 'MANIFEST_STORE_FAILED', 'Failed to store manifest duplicate'); }
  }

  return {
    extension: {
      id: upsertResult.extension.id,
      name: upsertResult.extension.name,
      publisher: upsertResult.extension.publisher,
    },
    version: {
      id: upsertResult.version.id,
      version: upsertResult.version.version,
    },
    contentHash: computedHash,
    canonicalKey,
  };
}

export async function extFinalizeUpload(params: FinalizeParams & { responseMode: "result" }): Promise<FinalizeUploadResponse>;
export async function extFinalizeUpload(params: FinalizeParams & { responseMode?: "throw" }): Promise<FinalizeResult>;
export async function extFinalizeUpload(params: FinalizeParams): Promise<FinalizeResult | FinalizeUploadResponse> {
  const { responseMode = "throw", ...rest } = (params ?? {}) as FinalizeParams;
  try {
    const result = await finalizeUploadInternal(rest as FinalizeParamsInternal);
    if (responseMode === "result") {
      return { success: true, data: result };
    }
    return result;
  } catch (err) {
    if (responseMode === "result") {
      return { success: false, error: formatFinalizeError(err) };
    }
    throw err;
  }
}

export type AbortParams = { key: string; reason?: string };
export type AbortResult = { status: "deleted" | "noop"; key: string; area: "staging" | "canonical" };

export async function extAbortUpload(params: AbortParams): Promise<AbortResult> {
  const { key } = params ?? ({} as any);

  if (!key || typeof key !== "string") {
    throw new HttpError(400, "BAD_REQUEST", "Missing or invalid 'key' (string required)");
  }
  const isStaging = key.includes("/_staging/");
  if (!isStaging) {
    return { status: "noop", key, area: "canonical" };
  }

  const client = getS3Client();
  // Ensure deletion targets the bundle bucket (not the docs bucket)
  const Bucket = getBundleBucket();
  const Key = key;

  try {
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
    return { status: "deleted", key, area: "staging" };
  } catch (e: any) {
    const status = e?.$metadata?.httpStatusCode;
    const code = e?.name ?? e?.Code ?? e?.code;
    if (status === 404 || code === "NotFound") {
      return { status: "deleted", key, area: "staging" };
    }
    const message = typeof e?.message === "string" ? e.message : "Unexpected error during delete";
    throw new HttpError(500, "INTERNAL_ERROR", message);
  }
}

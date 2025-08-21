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
import { getS3Client, getBucket } from "../storage/s3-client";
import {
  hashSha256Stream,
  loadTrustBundle,
  verifySignature,
} from "../extensions/bundles/verify";
import {
  parseManifestJson,
  extractEndpoints,
  getUiEntry,
  getRuntime,
  getCapabilities,
  type ManifestV2,
} from "../extensions/bundles/manifest";
import { upsertVersionFromManifest } from "../extensions/registry-v2";
import { ensureRegistryV2KnexRepo } from "../extensions/registry-v2-repo-knex";
import type { Knex } from "knex";
// Prefer a global/admin knex since registry tables are global
async function getAdminKnex(): Promise<Knex> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const db = require('../../../server/src/lib/db/index.ts');
    if (db?.getAdminConnection) return await db.getAdminConnection();
  } catch {}
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createTenantKnex } = require('@/lib/db');
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

  const basePrefix = normalizeBasePrefix(BASE_PREFIX);
  const id = (globalThis as any).crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
  const key = `${basePrefix}_staging/${id}/bundle.tar.zst`;

  const contentType: string = (file as any).type || "application/octet-stream";

  const store = createS3BundleStore();
  const started = Date.now();
  try {
    const webStream = (file as any).stream() as unknown as ReadableStream;
    const nodeStream = Readable.fromWeb(webStream as any);
    await store.putObject(key, nodeStream as unknown as NodeJS.ReadableStream, { contentType, ifNoneMatch: "*", contentLength: size });
  } catch (e: any) {
    try { console.log(JSON.stringify({ ts: new Date().toISOString(), event: "ext_bundles.upload_proxy.action.s3_error", message: typeof e?.message === "string" ? e.message : String(e), status: e?.httpStatusCode ?? e?.statusCode })); } catch {}
    throw new Error("Failed to store upload");
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
};

export type FinalizeResult = {
  extension: { id: string; name: string; publisher?: string };
  version: { id: string; version: string };
  contentHash: computedHashstring;
  canonicalKey: string;
};

export async function extFinalizeUpload(params: FinalizeParams): Promise<FinalizeResult> {
  // Ensure Registry v2 repository is wired before any DB writes
  await ensureRegistryV2KnexRepo(getAdminKnex);
  const { key, size, declaredHash, manifestJson, signature } = params ?? ({} as any);

  // Validate key
  if (typeof key !== "string" || key.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", "key is required");
  }
  if (!key.startsWith(BASE_PREFIX)) {
    throw new HttpError(400, "BAD_REQUEST", `key must start with "${BASE_PREFIX}"`);
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

  // Stream and hash the bundle
  const store = createS3BundleStore();
  const got = await store.getObjectStream(key);
  const nodeStream = got.stream as NodeJS.ReadableStream;
  const hashResult = await hashSha256Stream(nodeStream, { maxBytes: MAX_BUNDLE_SIZE_BYTES });
  const computedHash = hashResult.hashHex;

  if (declared && declared !== computedHash) {
    throw new HttpError(400, "HASH_MISMATCH", "Declared hash does not match computed content hash", {
      declared,
      computed: computedHash,
    });
  }

  const canonicalKey = objectKeyFor(
    { algorithm: "sha256", hash: computedHash },
    "bundle.tar.zst",
    { basePrefix: BASE_PREFIX }
  );

  // If staging → canonical copy needed
  if (key !== canonicalKey) {
    const s3 = getS3Client();
    const bucket = getBucket();
    const input = {
      Bucket: bucket,
      Key: canonicalKey,
      CopySource: encodeURIComponent(`${bucket}/${key}`),
    };

    const cmd = new CopyObjectCommand(input as any);
    const mwName = `copy-if-none-match-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // inject If-None-Match: "*"
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    s3.middlewareStack.addRelativeTo(
      (next: any) => async (args: any) => {
        const req = args.request as any;
        req.headers = { ...(req.headers ?? {}), "if-none-match": "*" };
        return next(args);
      },
      { name: mwName, relation: "after", toMiddleware: "contentLengthMiddleware" }
    );

    try {
      await s3.send(cmd);
    } catch (e: any) {
      const status = e?.$metadata?.httpStatusCode ?? e?.statusCode ?? e?.httpStatusCode;
      const code = e?.name ?? e?.Code ?? e?.code;
      if (status === 412 || status === 409) {
        throw new HttpError(
          409,
          "OBJECT_EXISTS",
          "Canonical object already exists",
          { key: canonicalKey, status, s3Code: code }
        );
      }
      throw new HttpError(500, "COPY_FAILED", "Failed to copy object to canonical location");
    } finally {
      s3.middlewareStack.remove(mwName);
    }
  }

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
  const parsedRuntime = getRuntime(manifest);
  const parsedCapabilities = getCapabilities(manifest);

  // Write manifest duplicate (immutable)
  const manifestKey = objectKeyFor(
    { algorithm: "sha256", hash: computedHash },
    "manifest.json",
    { basePrefix: BASE_PREFIX }
  );
  try {
    const store2 = createS3BundleStore();
    await store2.putObject(
      manifestKey,
      Buffer.from(manifestJson, "utf-8"),
      {
        contentType: "application/json",
        cacheControl: "public, max-age=31536000, immutable",
        ifNoneMatch: "*",
      }
    );
  } catch (e: any) {
    const status = e?.httpStatusCode ?? e?.statusCode;
    if (status === 412 || status === 409) {
      try {
        // eslint-disable-next-line no-console
        console.info("ext.finalize.debug.manifest_exists", { key: manifestKey, status });
      } catch {}
    } else {
      throw new HttpError(500, "MANIFEST_STORE_FAILED", "Failed to store manifest duplicate");
    }
  }

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
    contentHash: `sha256:${computedHash}`,
    parsed: {
      uiEntry: parsedUiEntry,
      endpoints: parsedEndpoints,
      runtime,
      capabilities: parsedCapabilities,
    },
    signature: sigResult,
  });

  try {
    // eslint-disable-next-line no-console
    console.info("ext.finalize.debug.upsert_ok", {
      extensionId: upsertResult.extension.id,
      versionId: upsertResult.version.id,
    });
  } catch {
    // ignore
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

export type AbortParams = { key: string; reason?: string };
export type AbortResult = { status: "deleted" | "noop"; key: string; area: "staging" | "canonical" };

export async function extAbortUpload(params: AbortParams): Promise<AbortResult> {
  const { key } = params ?? ({} as any);

  if (!key || typeof key !== "string") {
    throw new HttpError(400, "BAD_REQUEST", "Missing or invalid 'key' (string required)");
  }
  if (!key.startsWith(BASE_PREFIX)) {
    throw new HttpError(400, "BAD_REQUEST", `Invalid key: must start with '${BASE_PREFIX}'`);
  }

  const isStaging = key.startsWith("sha256/_staging/");
  if (!isStaging) {
    return { status: "noop", key, area: "canonical" };
  }

  const client = getS3Client();
  const Bucket = getBucket();
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

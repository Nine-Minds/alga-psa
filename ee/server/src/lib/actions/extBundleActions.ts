"use server";

/**
 * Server actions for extension bundle upload flow.
 * - Business logic and IO live here.
 * - API routes handle RBAC/rate-limiting/logging and delegate to these actions.
 */

import { CopyObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createS3BundleStore } from "../storage/bundles/s3-bundle-store";
import {
  isValidSha256Hash,
  objectKeyFor,
  normalizeBasePrefix,
} from "../storage/bundles/types";
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
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const EXPIRES_SECONDS = 900; // 15 minutes
const BASE_PREFIX = "sha256/";

// Types
export type InitiateParams = {
  filename: string;
  size: number;
  declaredHash?: string;
  contentType?: string;
  cacheControl?: string;
};

export type InitiateResult = {
  upload: {
    key: string;
    url: string;
    method: "PUT";
    expiresSeconds: number;
    requiredHeaders: Record<string, string>;
    strategy: "canonical" | "staging";
  };
  filename: string;
  size: number;
  declaredHash?: string;
};

export async function extInitiateUpload(params: InitiateParams): Promise<InitiateResult> {
  // Validate inputs (mirrors previous route logic)
  const { filename, size, declaredHash, contentType, cacheControl } = params ?? ({} as any);

  if (typeof filename !== "string" || filename.trim().length === 0) {
    throw new HttpError(400, "BAD_REQUEST", "filename is required");
  }

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

  let contentTypeEff =
    typeof contentType === "string" && contentType.trim().length > 0
      ? contentType
      : DEFAULT_CONTENT_TYPE;

  if (typeof cacheControl !== "undefined" && typeof cacheControl !== "string") {
    throw new HttpError(400, "BAD_REQUEST", "cacheControl must be a string");
  }

  let hash: string | undefined;
  if (typeof declaredHash !== "undefined") {
    if (typeof declaredHash !== "string" || !isValidSha256Hash(declaredHash)) {
      throw new HttpError(
        400,
        "BAD_REQUEST",
        "declaredHash must be 64-char lowercase hex sha256"
      );
    }
    hash = declaredHash;
  }

  // Choose object key
  const basePrefix = normalizeBasePrefix(BASE_PREFIX); // ensures "sha256/"
  let key: string;
  let strategy: "canonical" | "staging";

  if (hash) {
    key = objectKeyFor({ algorithm: "sha256", hash }, "bundle.tar.zst", { basePrefix });
    strategy = "canonical";
  } else {
    const id =
      globalThis.crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    key = `${basePrefix}_staging/${id}/bundle.tar.zst`;
    strategy = "staging";
  }

  // Presign PUT
  const store = createS3BundleStore();
  const url = await store.getPresignedPutUrl(key, {
    contentType: contentTypeEff,
    cacheControl: cacheControl as string | undefined,
    ifNoneMatch: "*",
    expiresSeconds: EXPIRES_SECONDS,
  });

  const requiredHeaders: Record<string, string> = {
    "content-type": contentTypeEff,
    "if-none-match": "*",
  };
  if (typeof cacheControl === "string" && cacheControl.length > 0) {
    requiredHeaders["cache-control"] = cacheControl;
  }

  return {
    filename,
    size,
    ...(hash ? { declaredHash: hash } : {}),
    upload: {
      key,
      url,
      method: "PUT",
      expiresSeconds: EXPIRES_SECONDS,
      requiredHeaders,
      strategy,
    },
  };
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
  contentHash: string;
  canonicalKey: string;
};

export async function extFinalizeUpload(params: FinalizeParams): Promise<FinalizeResult> {
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

  const parsed = parseManifestJson(manifestJson);
  if (!parsed.manifest) {
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
      throw new HttpError(409, "OBJECT_EXISTS", "Canonical manifest already exists", {
        key: manifestKey,
        status,
      });
    }
    throw new HttpError(500, "MANIFEST_STORE_FAILED", "Failed to store manifest duplicate");
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
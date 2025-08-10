/**
 * Finalize an uploaded extension bundle.
 *
 * Flow:
 *  - Validate inputs
 *  - Stream and hash uploaded bundle.tar.zst (sha256)
 *  - If declaredHash provided, ensure it matches computed hash
 *  - Resolve canonical object key sha256/<hash>/bundle.tar.zst
 *  - If client uploaded to staging key, server-side COPY → canonical with immutability (If-None-Match: "*")
 *  - Optionally accept manifest JSON (temporary) → validate and duplicate to canonical manifest.json
 *  - Verify signature via policy-aware stubs
 *  - Registry write via upsertVersionFromManifest
 *
 * Notes:
 *  - Route runs in app server (Node runtime)
 *  - TODO: Replace pragmatic header RBAC with project auth/session RBAC integration.
 *  - TODO: Replace in-process rate limiting with centralized (e.g., Redis) in production.
 */
import { CopyObjectCommand } from "@aws-sdk/client-s3";
import { createS3BundleStore } from "../../../../lib/storage/bundles/s3-bundle-store";
import {
  isValidSha256Hash,
  objectKeyFor,
} from "../../../../lib/storage/bundles/types";
import { getS3Client, getBucket } from "../../../../lib/storage/s3-client";
import {
  hashSha256Stream,
  loadTrustBundle,
  verifySignature,
} from "../../../../lib/extensions/bundles/verify";
import {
  parseManifestJson,
  extractEndpoints,
  getUiEntry,
  getRuntime,
  getCapabilities,
  type ManifestV2,
} from "../../../../lib/extensions/bundles/manifest";
import { upsertVersionFromManifest } from "../../../../lib/extensions/registry-v2";

const MAX_BUNDLE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MiB
const BASE_PREFIX = "sha256/";

// Structured log helper
function log(event: string, data?: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...(data ?? {}),
      })
    );
  } catch {
    // ignore logging failures
  }
}

// RBAC helpers (pragmatic header gate)
function insecureBypassAllowed() {
  return (process.env.EXT_BUNDLES_ALLOW_INSECURE ?? "").toLowerCase() === "true";
}
function isAdmin(req: Request) {
  const v = req.headers.get("x-alga-admin");
  return typeof v === "string" && v.toLowerCase() === "true";
}

// Actor key (best-effort IP) from headers
function getActorKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr.trim();
  return "unknown";
}

// Lightweight in-memory rate limiter (sliding window)
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.EXT_BUNDLES_RATELIMIT_WINDOW_MS ?? "60000", 10);
const RATE_LIMIT_MAX = parseInt(process.env.EXT_BUNDLES_RATELIMIT_MAX ?? "30", 10);
const rlMap: Map<string, number[]> = new Map();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const arr = rlMap.get(key) ?? [];
  const pruned = arr.filter((t) => t >= windowStart);
  if (pruned.length >= RATE_LIMIT_MAX) {
    rlMap.set(key, pruned);
    return false;
  }
  pruned.push(now);
  rlMap.set(key, pruned);
  return true;
}

// Small helper for consistent JSON responses
function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FinalizeBody = {
  key: unknown;
  size?: unknown;
  declaredHash?: unknown;
  manifestJson?: unknown;
  signature?: unknown;
};

type SignatureInput = {
  text?: string;
  algorithm?: "cosign" | "x509" | "pgp";
};

export async function POST(req: Request) {
  const actor = getActorKey(req);

  // RBAC
  if (!insecureBypassAllowed() && !isAdmin(req)) {
    log("ext_bundles.finalize.rbac_forbidden", { actor });
    return json(403, { error: "Forbidden", code: "RBAC_FORBIDDEN" });
  }

  // Rate limit
  if (!checkRateLimit(actor)) {
    log("ext_bundles.finalize.rate_limited", {
      actor,
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    });
    return json(429, { error: "Too Many Requests", code: "RATE_LIMIT" });
  }

  try {
    // Parse JSON body
    let bodyRaw: unknown;
    try {
      bodyRaw = await req.json();
    } catch {
      log("ext_bundles.finalize.validation_failed", { actor, reason: "invalid_json" });
      return json(400, { error: "Invalid JSON body", code: "BAD_REQUEST" });
    }

    if (typeof bodyRaw !== "object" || bodyRaw === null) {
      log("ext_bundles.finalize.validation_failed", { actor, reason: "body_not_object" });
      return json(400, { error: "Body must be a JSON object", code: "BAD_REQUEST" });
    }
    const { key, size, declaredHash, manifestJson, signature } = bodyRaw as FinalizeBody;

    log("ext_bundles.finalize.request", {
      actor,
      key: typeof key === "string" ? key : undefined,
      declaredHash: typeof declaredHash === "string" ? declaredHash : undefined,
    });

    // Validate key
    if (typeof key !== "string" || key.trim().length === 0) {
      log("ext_bundles.finalize.validation_failed", { actor, reason: "key_required" });
      return json(400, { error: "key is required", code: "BAD_REQUEST" });
    }
    if (!key.startsWith(BASE_PREFIX)) {
      log("ext_bundles.finalize.validation_failed", { actor, reason: "key_prefix", key });
      return json(400, {
        error: `key must start with "${BASE_PREFIX}"`,
        code: "BAD_REQUEST",
      });
    }

    // Validate size (optional)
    if (typeof size !== "undefined") {
      if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
        log("ext_bundles.finalize.validation_failed", { actor, reason: "size_invalid" });
        return json(400, { error: "size must be a positive number", code: "BAD_REQUEST" });
      }
      if (size > MAX_BUNDLE_SIZE_BYTES) {
        log("ext_bundles.finalize.validation_failed", {
          actor,
          reason: "size_exceeds_cap",
          size,
          max: MAX_BUNDLE_SIZE_BYTES,
        });
        return json(400, {
          error: `size exceeds maximum of ${MAX_BUNDLE_SIZE_BYTES} bytes`,
          code: "BAD_REQUEST",
        });
      }
    }

    // Validate declaredHash (optional)
    let declared: string | undefined;
    if (typeof declaredHash !== "undefined") {
      if (typeof declaredHash !== "string" || !isValidSha256Hash(declaredHash)) {
        log("ext_bundles.finalize.validation_failed", { actor, reason: "declaredHash_invalid" });
        return json(400, {
          error: "declaredHash must be 64-char lowercase hex sha256",
          code: "BAD_REQUEST",
        });
      }
      declared = declaredHash;
    }

    // Fetch and hash the object via bundle store
    const store = createS3BundleStore();
    const got = await store.getObjectStream(key);
    const nodeStream = got.stream as NodeJS.ReadableStream; // Node runtime is assumed here
    const hashResult = await hashSha256Stream(nodeStream, { maxBytes: MAX_BUNDLE_SIZE_BYTES });
    const computedHash = hashResult.hashHex;

    // If declaredHash provided, ensure it matches computed
    if (declared && declared !== computedHash) {
      log("ext_bundles.finalize.validation_failed", {
        actor,
        reason: "hash_mismatch",
        declared,
        computed: computedHash,
      });
      return json(400, {
        error: "Declared hash does not match computed content hash",
        code: "HASH_MISMATCH",
        details: { declared, computed: computedHash },
      });
    }

    // Determine canonical key
    const canonicalKey = objectKeyFor(
      { algorithm: "sha256", hash: computedHash },
      "bundle.tar.zst",
      { basePrefix: BASE_PREFIX }
    );

    // If key differs, server-side COPY (staging → canonical) with immutability
    if (key !== canonicalKey) {
      const s3 = getS3Client();
      const bucket = getBucket();
      const input = {
        Bucket: bucket,
        Key: canonicalKey,
        CopySource: encodeURIComponent(`${bucket}/${key}`),
      };

      // Inject If-None-Match: "*" header via a one-off middleware (best-effort)
      const cmd = new CopyObjectCommand(input as any);
      const mwName = `copy-if-none-match-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}`;

      // Add header injection for this single send
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
        // Normalize common precondition/exists errors
        const status = e?.$metadata?.httpStatusCode ?? e?.statusCode ?? e?.httpStatusCode;
        const code = e?.name ?? e?.Code ?? e?.code;
        // Map 412/409 to a conflict-like message; prefer not to expose internals
        if (status === 412 || status === 409) {
          log("ext_bundles.finalize.copy_conflict", { actor, status, s3Code: code, canonicalKey });
          return json(409, {
            error: "Canonical object already exists",
            code: "OBJECT_EXISTS",
            details: { key: canonicalKey, status, s3Code: code },
          });
        }
        // Unexpected AWS error → generic 500
        log("ext_bundles.finalize.copy_failed", { actor, canonicalKey });
        return json(500, {
          error: "Failed to copy object to canonical location",
          code: "COPY_FAILED",
        });
      } finally {
        s3.middlewareStack.remove(mwName);
      }
    }

    // Manifest handling (temporary: accept via body)
    let manifest: ManifestV2 | undefined;
    let parsedEndpoints: ReturnType<typeof extractEndpoints> = [];
    let parsedUiEntry: string | undefined;
    let parsedRuntime: string | undefined;
    let parsedCapabilities: string[] = [];

    if (typeof manifestJson !== "undefined") {
      if (typeof manifestJson !== "string" || manifestJson.trim().length === 0) {
        log("ext_bundles.finalize.validation_failed", { actor, reason: "manifest_empty" });
        return json(400, {
          error: "manifestJson, if provided, must be a non-empty string",
          code: "BAD_REQUEST",
        });
      }

      const parsed = parseManifestJson(manifestJson);
      if (!parsed.manifest) {
        log("ext_bundles.finalize.validation_failed", { actor, reason: "manifest_invalid" });
        return json(400, {
          error: "Invalid manifest",
          code: "INVALID_MANIFEST",
          issues: parsed.issues,
        });
      }

      manifest = parsed.manifest;
      parsedEndpoints = extractEndpoints(manifest);
      parsedUiEntry = getUiEntry(manifest);
      parsedRuntime = getRuntime(manifest);
      parsedCapabilities = getCapabilities(manifest);

      // Write manifest.json duplicate to canonical path
      const manifestKey = objectKeyFor(
        { algorithm: "sha256", hash: computedHash },
        "manifest.json",
        { basePrefix: BASE_PREFIX }
      );
      try {
        const store = createS3BundleStore();
        await store.putObject(
          manifestKey,
          Buffer.from(manifestJson, "utf-8"),
          {
            contentType: "application/json",
            cacheControl: "public, max-age=31536000, immutable",
            ifNoneMatch: "*",
          }
        );
      } catch (e: any) {
        // If object already exists due to immutability, surface a 409
        const status = e?.httpStatusCode ?? e?.statusCode;
        if (status === 412 || status === 409) {
          log("ext_bundles.finalize.manifest_exists", { actor, status });
          return json(409, {
            error: "Canonical manifest already exists",
            code: "OBJECT_EXISTS",
            details: { key: manifestKey, status },
          });
        }
        log("ext_bundles.finalize.manifest_store_failed", { actor });
        return json(500, {
          error: "Failed to store manifest duplicate",
          code: "MANIFEST_STORE_FAILED",
        });
      }
    } else {
      // For this milestone, require manifestJson so registry can be written.
      log("ext_bundles.finalize.validation_failed", { actor, reason: "manifest_required" });
      return json(400, {
        error: "manifestJson is required for this milestone",
        code: "MANIFEST_REQUIRED",
      });
    }

    // Signature verification
    const sig = (signature ?? {}) as SignatureInput;
    const trustBundle = loadTrustBundle(process.env as any);
    const sigResult = await verifySignature({
      bundleBytes: undefined, // streaming path; stub does not require bytes
      signatureText: sig.text,
      algorithm: sig.algorithm,
      trustBundle,
    });

    // Registry write (requires manifest)
    // Ensure minimal required parsed fields are present
    const runtime = parsedRuntime ?? (manifest as ManifestV2).runtime;
    const upsertResult = await upsertVersionFromManifest({
      manifest: manifest as ManifestV2,
      contentHash: `sha256:${computedHash}`,
      parsed: {
        uiEntry: parsedUiEntry,
        endpoints: parsedEndpoints,
        runtime,
        capabilities: parsedCapabilities,
      },
      signature: sigResult,
    });

    log("ext_bundles.finalize.success", {
      actor,
      contentHash: computedHash,
      canonicalKey,
      extensionId: upsertResult.extension.id,
      versionId: upsertResult.version.id,
    });

    // Success response
    return json(200, {
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
    });
  } catch (err: any) {
    // Generic guard fallback
    const message = typeof err?.message === "string" ? err.message : "Unexpected error";
    log("ext_bundles.finalize.error", { message });
    return json(500, {
      error: message,
      code: "INTERNAL_ERROR",
    });
  }
}
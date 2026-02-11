/**
 * Upload Proxy: Streams browser upload to S3 via server.
 *
 * Flow:
 *  - Validate RBAC and rate limit (same pattern as other ext-bundles routes)
 *  - Validate query params (filename, size, optional declaredHash)
 *  - Create staging key: sha256/_staging/<uuid>/bundle.tar.zst
 *  - Stream req.body to S3 via createS3BundleStore().putObject(...)
 *  - Respond with { upload: { key, strategy: 'staging' }, filename, size }
 */

import { createS3BundleStore } from "../../../../lib/storage/bundles/s3-bundle-store";
import { getS3Client, getBucket, getBundleBucket } from "../../../../lib/storage/s3-client";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { isValidSha256Hash, normalizeBasePrefix } from "../../../../lib/storage/bundles/types";
import { Readable } from "node:stream";

const MAX_BUNDLE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MiB
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const BASE_PREFIX = normalizeBasePrefix("sha256/");

// Structured log helper
function log(event: string, data?: Record<string, unknown>) {
  try {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({ ts: new Date().toISOString(), event, ...(data ?? {}) })
    );
  } catch {
    // ignore logging failures
  }
}

// RBAC helpers (pragmatic header gate) like other routes
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

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request) {
  const actor = getActorKey(req);
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  // Entry log with context headers
  log("ext_bundles.upload_proxy.entry", {
    requestId,
    actor,
    method: "POST",
    url: req.url,
    userAgent: req.headers.get("user-agent") ?? undefined,
    referer: req.headers.get("referer") ?? undefined,
    origin: req.headers.get("origin") ?? undefined,
    contentType: req.headers.get("content-type") ?? undefined,
    contentLength: req.headers.get("content-length") ?? undefined,
    hasCookie: Boolean(req.headers.get("cookie")),
    xAlgaAdmin: req.headers.get("x-alga-admin") ?? undefined,
    insecureBypass: insecureBypassAllowed(),
  });

  // RBAC
  if (!insecureBypassAllowed() && !isAdmin(req)) {
    log("ext_bundles.upload_proxy.rbac_forbidden", {
      requestId,
      actor,
      reason: "missing_x_alga_admin_true",
    });
    const res = json(403, { error: "Forbidden", code: "RBAC_FORBIDDEN" });
    res.headers.set("x-request-id", requestId);
    res.headers.set("x-upload-proxy-why", "rbac_forbidden_missing_admin_header");
    return res;
  }

  // Rate limit
  if (!checkRateLimit(actor)) {
    log("ext_bundles.upload_proxy.rate_limited", {
      requestId,
      actor,
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    });
    const res = json(429, { error: "Too Many Requests", code: "RATE_LIMIT" });
    res.headers.set("x-request-id", requestId);
    res.headers.set("x-upload-proxy-why", "rate_limited");
    return res;
  }

  try {
    const url = new URL(req.url);
    const filename = url.searchParams.get("filename");
    const sizeRaw = url.searchParams.get("size");
    const declaredHash = url.searchParams.get("declaredHash") ?? undefined;

    log("ext_bundles.upload_proxy.request", {
      requestId,
      actor,
      filename: filename ?? undefined,
      size: sizeRaw ?? undefined,
      hasBody: Boolean(req.body),
    });

    if (!filename || filename.trim().length === 0) {
      const r = json(400, { error: "filename is required", code: "BAD_REQUEST" });
      r.headers.set("x-request-id", requestId);
      r.headers.set("x-upload-proxy-why", "filename_required");
      return r;
    }
    if (!sizeRaw) {
      const r = json(400, { error: "size is required", code: "BAD_REQUEST" });
      r.headers.set("x-request-id", requestId);
      r.headers.set("x-upload-proxy-why", "size_required");
      return r;
    }
    const size = Number(sizeRaw);
    if (!Number.isFinite(size) || size <= 0) {
      const r = json(400, { error: "size must be a positive number", code: "BAD_REQUEST" });
      r.headers.set("x-request-id", requestId);
      r.headers.set("x-upload-proxy-why", "size_invalid");
      return r;
    }
    if (size > MAX_BUNDLE_SIZE_BYTES) {
      const r = json(400, {
        error: `size exceeds maximum of ${MAX_BUNDLE_SIZE_BYTES} bytes`,
        code: "BAD_REQUEST",
      });
      r.headers.set("x-request-id", requestId);
      r.headers.set("x-upload-proxy-why", "size_exceeds_cap");
      return r;
    }
    if (typeof declaredHash !== "undefined") {
      if (!isValidSha256Hash(declaredHash)) {
        const r = json(400, {
          error: "declaredHash must be 64-char lowercase hex sha256",
          code: "BAD_REQUEST",
        });
        r.headers.set("x-request-id", requestId);
        r.headers.set("x-upload-proxy-why", "declared_hash_invalid");
        return r;
      }
    }

    const contentType = req.headers.get("content-type") || DEFAULT_CONTENT_TYPE;
    const contentLengthHeader = req.headers.get("content-length");
    if (contentLengthHeader) {
      const cl = Number(contentLengthHeader);
      if (!Number.isNaN(cl) && cl !== size) {
        const r = json(400, {
          error: "content-length header does not match size param",
          code: "BAD_REQUEST",
        });
        r.headers.set("x-request-id", requestId);
        r.headers.set("x-upload-proxy-why", "content_length_mismatch");
        return r;
      }
    }

    if (!req.body) {
      const r = json(400, { error: "Missing request body", code: "BAD_REQUEST" });
      r.headers.set("x-request-id", requestId);
      r.headers.set("x-upload-proxy-why", "missing_body");
      return r;
    }

    // Preflight: verify bucket exists to avoid silent failures
    try {
      const s3 = getS3Client();
      const Bucket = getBundleBucket();
      await s3.send(new HeadBucketCommand({ Bucket } as any));
    } catch (e: any) {
      const code = (e?.code || e?.name || '').toString();
      const message = typeof e?.message === 'string' ? e.message : 'unknown';
      const cfgMissing = code === 'BUNDLE_CONFIG_MISSING' || /not configured|Missing required environment variable/i.test(message);
      log("ext_bundles.upload_proxy.bucket_missing", { requestId, actor, message, code });
      const r = json(500, { error: cfgMissing ? "Extension bundle storage not configured" : "Storage bucket not found", code: cfgMissing ? "BUNDLE_CONFIG_MISSING" : "BUCKET_NOT_FOUND" });
      r.headers.set("x-request-id", requestId);
      r.headers.set("x-upload-proxy-why", cfgMissing ? "bundle_config_missing" : "bucket_missing");
      return r;
    }

    // Generate staging key
    const id =
      (globalThis as any).crypto?.randomUUID?.() ??
      Math.random().toString(36).slice(2) + Date.now().toString(36);
    const key = `${BASE_PREFIX}_staging/${id}/bundle.tar.zst`;

    // Convert to Node stream and stream to S3
    const nodeStream = Readable.fromWeb(req.body as any);
    const store = createS3BundleStore();

    const started = Date.now();
    let eTag: string | undefined;
    try {
      const out = await store.putObject(key, nodeStream as any, {
        contentType,
        cacheControl: undefined,
        ifNoneMatch: "*",
        contentLength: size,
      });
      eTag = out?.eTag;
    } catch (e: any) {
      log("ext_bundles.upload_proxy.s3_error", {
        requestId,
        actor,
        key,
        message: typeof e?.message === "string" ? e.message : String(e),
        status: e?.httpStatusCode ?? e?.statusCode,
      });
      let code: string | undefined = undefined;
      try { code = (e?.code || e?.name || '').toString(); } catch {}
      const isBucketMissing = code === 'NoSuchBucket' || (e?.httpStatusCode ?? e?.statusCode) === 404;
      const r = json(500, { error: isBucketMissing ? "Storage bucket not found" : "Failed to store upload", code: isBucketMissing ? "BUCKET_NOT_FOUND" : "S3_PUT_FAILED" });
      r.headers.set("x-request-id", requestId);
      r.headers.set("x-upload-proxy-why", "s3_put_failed");
      return r;
    }

    const durationMs = Date.now() - started;
    log("ext_bundles.upload_proxy.success", { requestId, actor, key, filename, size, durationMs, eTag });

    const r = json(200, {
      upload: { key, strategy: "staging" as const },
      filename,
      size,
      ...(declaredHash ? { declaredHash } : {}),
    });
    r.headers.set("x-request-id", requestId);
    return r;
  } catch (err: any) {
    const message = typeof err?.message === "string" ? err.message : "Unexpected error";
    log("ext_bundles.upload_proxy.error", { requestId, message, stack: err?.stack });
    const r = json(500, { error: message, code: "INTERNAL_ERROR" });
    r.headers.set("x-request-id", requestId);
    r.headers.set("x-upload-proxy-why", "unhandled_exception");
    return r;
  }
}

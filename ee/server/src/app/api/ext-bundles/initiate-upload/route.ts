/**
 * Initiate upload for an extension bundle artifact.
 *
 * Behavior:
 * - Validates inputs (filename, size, optional declaredHash, optional contentType/cacheControl).
 * - Chooses canonical or staging object key under the sha256 namespace.
 * - Issues a presigned PUT URL with write-once semantics (If-None-Match: "*").
 * - Returns URL, key, method, expiry, and required headers.
 *
 * Notes:
 * - No object is created here; presigned PUT only.
 * - Route runs in app server runtime (Node, suitable for S3 SDK).
 *
 * TODO: Replace pragmatic header RBAC with project auth/session RBAC integration.
 * TODO: Replace in-process rate limiting with centralized (e.g., Redis) in production.
 */
import { createS3BundleStore } from "../../../../lib/storage/bundles/s3-bundle-store";
import {
  isValidSha256Hash,
  objectKeyFor,
  normalizeBasePrefix,
} from "../../../../lib/storage/bundles/types";

const MAX_BUNDLE_SIZE_BYTES = 200 * 1024 * 1024; // 200 MiB
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
const EXPIRES_SECONDS = 900; // 15 minutes

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
    // swallow logging errors
  }
}

// RBAC helpers (pragmatic header gate)
// Accept header "x-alga-admin: true" case-insensitive OR bypass when EXT_BUNDLES_ALLOW_INSECURE === "true"
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

// Lightweight in-memory rate limiter (token-bucket-ish via sliding window)
const RATE_LIMIT_WINDOW_MS = parseInt(process.env.EXT_BUNDLES_RATELIMIT_WINDOW_MS ?? "60000", 10);
const RATE_LIMIT_MAX = parseInt(process.env.EXT_BUNDLES_RATELIMIT_MAX ?? "30", 10);
const rlMap: Map<string, number[]> = new Map();

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const arr = rlMap.get(key) ?? [];
  // prune
  const pruned = arr.filter((t) => t >= windowStart);
  if (pruned.length >= RATE_LIMIT_MAX) {
    rlMap.set(key, pruned);
    return false;
  }
  pruned.push(now);
  rlMap.set(key, pruned);
  return true;
}

export async function POST(req: Request) {
  const actor = getActorKey(req);
  log("ext_bundles.initiate_upload.request", { actor });

  // RBAC
  if (!insecureBypassAllowed() && !isAdmin(req)) {
    log("ext_bundles.initiate_upload.rbac_forbidden", { actor });
    return new Response(JSON.stringify({ error: "Forbidden", code: "RBAC_FORBIDDEN" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  // Rate limit
  if (!checkRateLimit(actor)) {
    log("ext_bundles.initiate_upload.rate_limited", {
      actor,
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    });
    return new Response(JSON.stringify({ error: "Too Many Requests", code: "RATE_LIMIT" }), {
      status: 429,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    // Parse and basic validation
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      log("ext_bundles.initiate_upload.validation_failed", {
        actor,
        reason: "invalid_json",
      });
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    if (typeof json !== "object" || json === null) {
      log("ext_bundles.initiate_upload.validation_failed", {
        actor,
        reason: "body_not_object",
      });
      return new Response(
        JSON.stringify({ error: "Body must be a JSON object", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const {
      filename,
      size,
      declaredHash,
      contentType: bodyContentType,
      cacheControl,
    } = json as {
      filename?: unknown;
      size?: unknown;
      declaredHash?: unknown;
      contentType?: unknown;
      cacheControl?: unknown;
    };

    // filename: required non-empty string (informational only)
    if (typeof filename !== "string" || filename.trim().length === 0) {
      log("ext_bundles.initiate_upload.validation_failed", {
        actor,
        reason: "filename_required",
      });
      return new Response(
        JSON.stringify({ error: "filename is required", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // size: required number > 0 and <= cap
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      log("ext_bundles.initiate_upload.validation_failed", {
        actor,
        reason: "size_invalid",
      });
      return new Response(
        JSON.stringify({ error: "size must be a positive number", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    if (size > MAX_BUNDLE_SIZE_BYTES) {
      log("ext_bundles.initiate_upload.validation_failed", {
        actor,
        reason: "size_exceeds_cap",
        size,
        max: MAX_BUNDLE_SIZE_BYTES,
      });
      return new Response(
        JSON.stringify({
          error: `size exceeds maximum of ${MAX_BUNDLE_SIZE_BYTES} bytes`,
          code: "BAD_REQUEST",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // contentType: optional; default to application/octet-stream
    const contentType =
      typeof bodyContentType === "string" && bodyContentType.trim().length > 0
        ? bodyContentType
        : DEFAULT_CONTENT_TYPE;

    // cacheControl: optional if provided must be string
    if (typeof cacheControl !== "undefined" && typeof cacheControl !== "string") {
      log("ext_bundles.initiate_upload.validation_failed", {
        actor,
        reason: "cacheControl_not_string",
      });
      return new Response(
        JSON.stringify({ error: "cacheControl must be a string", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // declaredHash: optional; if provided must be valid sha256 lowercase hex
    let hash: string | undefined;
    if (typeof declaredHash !== "undefined") {
      if (typeof declaredHash !== "string" || !isValidSha256Hash(declaredHash)) {
        log("ext_bundles.initiate_upload.validation_failed", {
          actor,
          reason: "declaredHash_invalid",
        });
        return new Response(
          JSON.stringify({
            error: "declaredHash must be 64-char lowercase hex sha256",
            code: "BAD_REQUEST",
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }
      hash = declaredHash;
    }

    // Build object key
    const basePrefix = normalizeBasePrefix("sha256/"); // ensures "sha256/"
    let key: string;
    let strategy: "canonical" | "staging";

    if (hash) {
      // Canonical content-addressed key
      key = objectKeyFor({ algorithm: "sha256", hash }, "bundle.tar.zst", { basePrefix });
      strategy = "canonical";
    } else {
      // Staging object under sha256 namespace to simplify later copy
      // Use crypto.randomUUID() for collision-avoidance
      const id = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : // Fallback if not available (very unlikely in Node 18+ / Next runtime)
          Math.random().toString(36).slice(2) + Date.now().toString(36);
      key = `${basePrefix}_staging/${id}/bundle.tar.zst`;
      strategy = "staging";
    }

    // Presign PUT with immutability headers
    const store = createS3BundleStore();
    const url = await store.getPresignedPutUrl(key, {
      contentType,
      cacheControl: cacheControl as string | undefined,
      ifNoneMatch: "*",
      expiresSeconds: EXPIRES_SECONDS,
    });

    // Required headers for the client to send with PUT
    const requiredHeaders: Record<string, string> = {
      "content-type": contentType,
      "if-none-match": "*",
    };
    if (typeof cacheControl === "string" && cacheControl.length > 0) {
      requiredHeaders["cache-control"] = cacheControl;
    }

    const responseBody = {
      filename,
      size,
      ...(hash ? { declaredHash: hash } : {}),
      upload: {
        key,
        url,
        method: "PUT" as const,
        expiresSeconds: EXPIRES_SECONDS,
        requiredHeaders,
        strategy,
      },
    };

    log("ext_bundles.initiate_upload.success", {
      actor,
      key,
      strategy,
      expiresSeconds: EXPIRES_SECONDS,
      filename,
      size,
    });

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message =
      (err as any)?.message ?? "An unexpected error occurred while initiating upload";
    log("ext_bundles.initiate_upload.error", { message });
    return new Response(
      JSON.stringify({ error: String(message), code: "INTERNAL_ERROR" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
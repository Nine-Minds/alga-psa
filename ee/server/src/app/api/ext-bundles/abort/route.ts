/*
Adds:
- Admin-only RBAC via x-alga-admin: true header with insecure bypass via EXT_BUNDLES_ALLOW_INSECURE === "true"
- Basic in-memory rate limiting per actor key (ip) with env-configurable window/max
- Structured logs for key events

TODO: Replace pragmatic header RBAC with project auth/session RBAC integration.
TODO: Replace in-process rate limiting with centralized (e.g., Redis) in production.
*/

import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getS3Client, getBucket } from "../../../../lib/storage/s3-client";

type AbortRequest = {
  key: string;
  reason?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

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
    // ignore log failures
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

export async function POST(req: Request) {
  const actor = getActorKey(req);
  log("ext_bundles.abort.request_received", { actor });

  // RBAC
  if (!insecureBypassAllowed() && !isAdmin(req)) {
    log("ext_bundles.abort.rbac_forbidden", { actor });
    return jsonResponse({ error: "Forbidden", code: "RBAC_FORBIDDEN" }, 403);
  }

  // Rate limit
  if (!checkRateLimit(actor)) {
    log("ext_bundles.abort.rate_limited", {
      actor,
      windowMs: RATE_LIMIT_WINDOW_MS,
      max: RATE_LIMIT_MAX,
    });
    return jsonResponse({ error: "Too Many Requests", code: "RATE_LIMIT" }, 429);
  }

  let payload: AbortRequest;
  try {
    payload = (await req.json()) as AbortRequest;
  } catch {
    log("ext_bundles.abort.validation_failed", { actor, reason: "invalid_json" });
    return jsonResponse({ error: "Invalid JSON body", code: "BAD_REQUEST" }, 400);
  }

  const { key, reason } = payload ?? {};

  // Basic validation
  if (!key || typeof key !== "string") {
    log("ext_bundles.abort.validation_failed", { actor, reason: "key_required" });
    return jsonResponse(
      { error: "Missing or invalid 'key' (string required)", code: "BAD_REQUEST" },
      400
    );
  }
  if (!key.startsWith("sha256/")) {
    log("ext_bundles.abort.validation_failed", { actor, reason: "key_prefix_invalid", key });
    return jsonResponse(
      { error: "Invalid key: must start with 'sha256/'", code: "BAD_REQUEST" },
      400
    );
  }

  if (typeof reason === "string" && reason.length > 0) {
    log("ext_bundles.abort.reason", { actor, reason, key });
  }

  const isStaging = key.startsWith("sha256/_staging/");
  log("ext_bundles.abort.start", { actor, key, area: isStaging ? "staging" : "canonical" });

  if (!isStaging) {
    // Canonical area is immutable; no-op
    log("ext_bundles.abort.success", { actor, key, status: "noop" });
    return jsonResponse({ status: "noop", key, area: "canonical" });
  }

  // Staging area: attempt deletion
  const client = getS3Client();
  const Bucket = getBucket();
  const Key = key;

  try {
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
    // S3 DeleteObject is idempotent; treat as success even if object didn't exist
    log("ext_bundles.abort.success", { actor, key, status: "deleted" });
    return jsonResponse({ status: "deleted", key, area: "staging" });
  } catch (e: any) {
    const status = e?.$metadata?.httpStatusCode;
    const code = e?.name ?? e?.Code ?? e?.code;

    // Some S3-compatible providers could return 404; treat as success (idempotent)
    if (status === 404 || code === "NotFound") {
      log("ext_bundles.abort.success", { actor, key, status: "deleted" });
      return jsonResponse({ status: "deleted", key, area: "staging" });
    }

    const message = typeof e?.message === "string" ? e.message : "Unexpected error during delete";
    log("ext_bundles.abort.error", { actor, key, message });
    return jsonResponse({ error: message, code: "INTERNAL_ERROR" }, 500);
  }
}
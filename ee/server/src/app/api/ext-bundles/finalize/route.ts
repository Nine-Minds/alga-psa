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
import { isValidSha256Hash } from "../../../../lib/storage/bundles/types";
import { extFinalizeUpload } from "@product/actions/extBundleActions";

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

    // Delegate to server action for IO/business logic
    const sig = (signature ?? {}) as SignatureInput;
    const result = await extFinalizeUpload({
      key,
      size: size as number | undefined,
      declaredHash: declared,
      manifestJson: manifestJson as string | undefined,
      signature: { text: sig.text, algorithm: sig.algorithm },
    });
 
    log("ext_bundles.finalize.success", {
      actor,
      contentHash: result.contentHash,
      canonicalKey: result.canonicalKey,
      extensionId: result.extension.id,
      versionId: result.version.id,
    });
 
    return json(200, result);
  } catch (err: any) {
    const status = err?.status;
    const code = err?.code ?? (status ? "ERROR" : "INTERNAL_ERROR");
    const message = typeof err?.message === "string" ? err.message : "Unexpected error";
    log("ext_bundles.finalize.error", { message, code, status });
    return json(typeof status === "number" ? status : 500, {
      error: message,
      code,
      ...(err?.details ? { details: err.details } : {}),
    });
  }
}
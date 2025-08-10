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
 * TODO: RBAC - admin-only (restrict to admins)
 * TODO: Rate limiting - enforce per-tenant and global limits
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

export async function POST(req: Request) {
  try {
    // Parse and basic validation
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    if (typeof json !== "object" || json === null) {
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
      return new Response(
        JSON.stringify({ error: "filename is required", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // size: required number > 0 and <= cap
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      return new Response(
        JSON.stringify({ error: "size must be a positive number", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }
    if (size > MAX_BUNDLE_SIZE_BYTES) {
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
      return new Response(
        JSON.stringify({ error: "cacheControl must be a string", code: "BAD_REQUEST" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    // declaredHash: optional; if provided must be valid sha256 lowercase hex
    let hash: string | undefined;
    if (typeof declaredHash !== "undefined") {
      if (typeof declaredHash !== "string" || !isValidSha256Hash(declaredHash)) {
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

    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message =
      (err as any)?.message ?? "An unexpected error occurred while initiating upload";
    return new Response(
      JSON.stringify({ error: String(message), code: "INTERNAL_ERROR" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
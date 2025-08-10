/*
TODO: RBAC - admin-only
TODO: Validate request schema (basic validation implemented below)
TODO: Wire to bundle store and verification
TODO: Observability - structured logs
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

export async function POST(req: Request) {
  let payload: AbortRequest;
  try {
    payload = (await req.json()) as AbortRequest;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { key, reason } = payload ?? {};

  // Basic validation
  if (!key || typeof key !== "string") {
    return jsonResponse({ error: "Missing or invalid 'key' (string required)" }, 400);
  }
  if (!key.startsWith("sha256/")) {
    return jsonResponse({ error: "Invalid key: must start with 'sha256/'" }, 400);
  }

  // Log reason informationally (TODO: replace with structured logs)
  if (typeof reason === "string" && reason.length > 0) {
    console.info("[ext-bundles/abort] reason:", reason, "key:", key);
  }

  const isStaging = key.startsWith("sha256/_staging/");

  if (!isStaging) {
    // Canonical area is immutable; no-op
    return jsonResponse({ status: "noop", key, area: "canonical" });
  }

  // Staging area: attempt deletion
  const client = getS3Client();
  const Bucket = getBucket();
  const Key = key;

  try {
    await client.send(new DeleteObjectCommand({ Bucket, Key }));
    // S3 DeleteObject is idempotent; treat as success even if object didn't exist
    return jsonResponse({ status: "deleted", key, area: "staging" });
  } catch (e: any) {
    const status = e?.$metadata?.httpStatusCode;
    const code = e?.name ?? e?.Code ?? e?.code;

    // Some S3-compatible providers could return 404; treat as success (idempotent)
    if (status === 404 || code === "NotFound") {
      return jsonResponse({ status: "deleted", key, area: "staging" });
    }

    const message = typeof e?.message === "string" ? e.message : "Unexpected error during delete";
    return jsonResponse({ error: message, code: "INTERNAL_ERROR" }, 500);
  }
}
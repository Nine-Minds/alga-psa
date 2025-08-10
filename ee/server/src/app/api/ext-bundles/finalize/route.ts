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
 *  - TODO: RBAC - admin-only enforcement
 *  - TODO: Rate limiting / idempotency
 *  - TODO: Future: Read manifest.json from inside bundle.tar.zst and validate signature over bytes
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
  try {
    // Parse JSON body
    let bodyRaw: unknown;
    try {
      bodyRaw = await req.json();
    } catch {
      return json(400, { error: "Invalid JSON body", code: "BAD_REQUEST" });
    }

    if (typeof bodyRaw !== "object" || bodyRaw === null) {
      return json(400, { error: "Body must be a JSON object", code: "BAD_REQUEST" });
    }
    const { key, size, declaredHash, manifestJson, signature } = bodyRaw as FinalizeBody;

    // RBAC placeholder
    // TODO: Enforce admin-only access here.

    // Validate key
    if (typeof key !== "string" || key.trim().length === 0) {
      return json(400, { error: "key is required", code: "BAD_REQUEST" });
    }
    if (!key.startsWith(BASE_PREFIX)) {
      return json(400, {
        error: `key must start with "${BASE_PREFIX}"`,
        code: "BAD_REQUEST",
      });
    }

    // Validate size (optional)
    if (typeof size !== "undefined") {
      if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
        return json(400, { error: "size must be a positive number", code: "BAD_REQUEST" });
      }
      if (size > MAX_BUNDLE_SIZE_BYTES) {
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
          return json(409, {
            error: "Canonical object already exists",
            code: "OBJECT_EXISTS",
            details: { key: canonicalKey, status, s3Code: code },
          });
        }
        // Unexpected AWS error → generic 500
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
        return json(400, {
          error: "manifestJson, if provided, must be a non-empty string",
          code: "BAD_REQUEST",
        });
      }

      const parsed = parseManifestJson(manifestJson);
      if (!parsed.manifest) {
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
          return json(409, {
            error: "Canonical manifest already exists",
            code: "OBJECT_EXISTS",
            details: { key: manifestKey, status },
          });
        }
        return json(500, {
          error: "Failed to store manifest duplicate",
          code: "MANIFEST_STORE_FAILED",
        });
      }
    } else {
      // TODO: Future: Read manifest.json from inside bundle.tar.zst and validate signature over bytes
      // For this milestone, require manifestJson so registry can be written.
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
    return json(500, {
      error: message,
      code: "INTERNAL_ERROR",
    });
  }
}
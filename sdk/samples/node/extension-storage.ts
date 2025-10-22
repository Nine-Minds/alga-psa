export {};

/**
 * Standalone sample: demonstrate CRUD operations with the tenant-wide Alga storage service.
 * Official reference: ../../../docs/storage-system.md
 *
 * Usage:
 *   ALGA_STORAGE_BASE_URL="https://algapsa.com" \
 *   ALGA_STORAGE_KEY="tenant-storage-key" \
 *   npm run sample:extension-storage -- \
 *     --namespace "settings" \
 *     --key "welcome-message" \
 *     --value '{"message":"Hello from the storage API"}'
 *
 * Environment:
 * - ALGA_STORAGE_KEY is required. For backwards compatibility ALGA_API_KEY is accepted.
 * - ALGA_STORAGE_BASE_URL defaults to https://algapsa.com (ALGA_API_URL is also respected).
 *
 * Flags:
 * --namespace   Storage namespace to target (defaults to "sample-storage").
 * --key         Record key to operate on (defaults to "welcome-message").
 * --value       JSON string for the record value (defaults to a sample payload).
 * --metadata    Optional JSON string for record metadata (defaults to contentType metadata).
 * --ttl         Optional TTL in seconds to apply when writing the record.
 * --skip-delete Leave the record in storage when provided (any truthy value).
 */

const colors = {
  reset: "\x1b[0m",
  step: "\x1b[36m",
  success: "\x1b[32m",
  info: "\x1b[35m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

function logStep(message: string): void {
  console.log(`${colors.step}→ ${message}${colors.reset}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.success}✓ ${message}${colors.reset}`);
}

function logWarn(message: string): void {
  console.log(`${colors.warn}! ${message}${colors.reset}`);
}

function logError(message: string): void {
  console.error(`${colors.error}${message}${colors.reset}`);
}

function logData(label: string, data: unknown): void {
  console.log(`${colors.info}${label}:${colors.reset}`);
  console.log(`${colors.info}${JSON.stringify(data, null, 2)}${colors.reset}`);
}

const STORAGE_BASE_URL = process.env.ALGA_STORAGE_BASE_URL ?? process.env.ALGA_API_URL ?? "https://algapsa.com";
const STORAGE_API_KEY = process.env.ALGA_STORAGE_KEY ?? process.env.ALGA_API_KEY;
if (!STORAGE_API_KEY) {
  logError("Missing ALGA_STORAGE_KEY environment variable (ALGA_API_KEY fallback no longer recommended).");
  process.exit(1);
}

const flags = parseFlags();
const namespace = flags.namespace ?? "sample-storage";
const recordKey = flags.key ?? "welcome-message";
const ttlSeconds = flags.ttl ? Number(flags.ttl) : undefined;
const skipDelete = Boolean(flags["skip-delete"] ?? false);
const enableCacheBust = Boolean(flags["cache-bust"] ?? false);

let value: JsonValue = { message: "Hello from the storage API sample" };
if (flags.value) {
  try {
    value = JSON.parse(flags.value);
  } catch (error) {
    logError(`Failed to parse --value JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

let metadata: Record<string, JsonValue> | undefined = { contentType: "application/json" };
if (flags.metadata) {
  try {
    const parsed = JSON.parse(flags.metadata);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("metadata must be a JSON object");
    }
    metadata = parsed as Record<string, JsonValue>;
  } catch (error) {
    logError(`Failed to parse --metadata JSON: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

(async () => {
  try {
    logStep(`Writing record ${namespace}/${recordKey}...`);
    const putResult = await putRecord({
      namespace,
      key: recordKey,
      value,
      metadata,
      ttlSeconds,
    });
    logSuccess(`Stored revision ${putResult.revision}`);
    logData("Put response", putResult);
    const initialRevision = putResult.revision;

    logStep("Reading record (initial revision)...");
    const initialGet = await getRecord({
      namespace,
      key: recordKey,
    });
    logData("Get response", initialGet);

    logStep("Updating record with optimistic guard...");
    const guardedPutResult = await putRecord({
      namespace,
      key: recordKey,
      value,
      metadata,
      ttlSeconds,
      ifRevision: initialRevision,
    });
    logSuccess(`Update applied at revision ${guardedPutResult.revision}`);
    logData("Update response", guardedPutResult);
    const latestRevision = guardedPutResult.revision;

    logStep("Reading record after update...");
    const latestGet = await getRecord({
      namespace,
      key: recordKey,
    });
    logData("Get response", latestGet);

    logStep("Attempting a stale revision write (expected to fail)...");
    try {
      await putRecord({
        namespace,
        key: recordKey,
        value,
        metadata,
        ttlSeconds,
        ifRevision: initialRevision,
      });
      logWarn("Stale revision write unexpectedly succeeded — investigate service configuration.");
    } catch (error) {
      logWarn(error instanceof Error ? error.message : String(error));
    }

    logStep("Listing records in namespace...");
    const listResult = await listRecords({
      namespace,
      includeValues: true,
      includeMetadata: true,
    });
    logData("List response", listResult);

    if (!skipDelete) {
      logStep("Deleting record...");
      await deleteRecord({
        namespace,
        key: recordKey,
        ifRevision: latestRevision,
      });
      logSuccess("Record deleted. Re-run without --skip-delete to keep the sample record.");
    } else {
      logWarn("Skipping delete as requested.");
    }
  } catch (error) {
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();

interface FetchOptions {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

async function apiFetch<T>({ method, path, body, headers }: FetchOptions): Promise<T> {
  const url = `${STORAGE_BASE_URL}${appendCacheBust(path)}`;
  const requestHeaders: Record<string, string> = {
    "x-api-key": STORAGE_API_KEY!,
    ...headers,
    ...(enableCacheBust
      ? {
          "Cache-Control": "no-cache, no-store",
          Pragma: "no-cache",
        }
      : {}),
  };

  const response = await fetch(url, {
    method,
    cache: "no-store",
    headers:
      body !== undefined
        ? {
            ...requestHeaders,
            "Content-Type": "application/json",
          }
        : requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${method} ${path} failed: ${response.status} ${response.statusText} – ${detail}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

interface PutArgs {
  namespace: string;
  key: string;
  value: JsonValue;
  metadata?: Record<string, JsonValue>;
  ttlSeconds?: number;
  ifRevision?: number;
}

async function putRecord(args: PutArgs): Promise<StoragePutResponse> {
  return apiFetch<StoragePutResponse>({
    method: "PUT",
    path: `/api/v1/storage/namespaces/${encodeURIComponent(args.namespace)}/records/${encodeURIComponent(args.key)}`,
    body: {
      value: args.value,
      metadata: args.metadata,
      ttlSeconds: args.ttlSeconds,
      ifRevision: args.ifRevision,
    },
  });
}

interface GetArgs {
  namespace: string;
  key: string;
  ifRevision?: number;
}

async function getRecord(args: GetArgs): Promise<StorageGetResponse> {
  const headers: Record<string, string> = {};
  if (typeof args.ifRevision === "number") {
    headers["if-revision-match"] = String(args.ifRevision);
  }

  return apiFetch<StorageGetResponse>({
    method: "GET",
    path: `/api/v1/storage/namespaces/${encodeURIComponent(args.namespace)}/records/${encodeURIComponent(args.key)}`,
    headers,
  });
}

interface DeleteArgs {
  namespace: string;
  key: string;
  ifRevision?: number;
}

async function deleteRecord(args: DeleteArgs): Promise<void> {
  const query = args.ifRevision !== undefined ? `?ifRevision=${encodeURIComponent(String(args.ifRevision))}` : "";
  await apiFetch<void>({
    method: "DELETE",
    path: `/api/v1/storage/namespaces/${encodeURIComponent(args.namespace)}/records/${encodeURIComponent(args.key)}${query}`,
  });
}

interface ListArgs {
  namespace: string;
  limit?: number;
  cursor?: string;
  keyPrefix?: string;
  includeValues?: boolean;
  includeMetadata?: boolean;
}

async function listRecords(args: ListArgs): Promise<StorageListResponse> {
  const params = new URLSearchParams();
  if (args.limit !== undefined) params.set("limit", String(args.limit));
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.keyPrefix) params.set("keyPrefix", args.keyPrefix);
  if (args.includeValues !== undefined) params.set("includeValues", String(args.includeValues));
  if (args.includeMetadata !== undefined) params.set("includeMetadata", String(args.includeMetadata));
  if (enableCacheBust) params.set("__ts", Date.now().toString());

  const query = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<StorageListResponse>({
    method: "GET",
    path: `/api/v1/storage/namespaces/${encodeURIComponent(args.namespace)}/records${query}`,
  });
}

// Minimal flag parser
function parseFlags(): Record<string, string> {
  const flags: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = 'true';
    }
  }
  return flags;
}

// Types shared with the API response
interface StoragePutResponse {
  namespace: string;
  key: string;
  revision: number;
  ttlExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StorageGetResponse {
  namespace: string;
  key: string;
  revision: number;
  value: JsonValue;
  metadata: Record<string, JsonValue>;
  ttlExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StorageListResponse {
  items: Array<{
    namespace: string;
    key: string;
    revision: number;
    value?: JsonValue;
    metadata?: Record<string, JsonValue>;
    ttlExpiresAt: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  nextCursor: string | null;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function appendCacheBust(path: string): string {
  if (!enableCacheBust) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}__ts=${Date.now()}`;
}

export {};

/**
 * Standalone sample: demonstrate CRUD operations with the Alga storage API.
 *
 * Usage:
 *   ALGA_API_URL="https://algapsa.com" \
 *   ALGA_API_KEY="your-api-key" \
 *   npm run sample:extension-storage -- \
 *     --namespace "settings" \
 *     --key "welcome-message" \
 *     --value '{"message":"Hello from the storage API"}'
 *
 * Environment:
 * - ALGA_API_KEY is required.
 * - ALGA_API_URL defaults to https://algapsa.com.
 *
 * Flags:
 * --namespace   Storage namespace to target (defaults to "sample-storage").
 * --key         Record key to operate on (defaults to "welcome-message").
 * --value       JSON string for the record value (defaults to a sample payload).
 * --metadata    Optional JSON string for record metadata (defaults to contentType metadata).
 * --ttl         Optional TTL in seconds to apply when writing the record.
 * --skip-delete Leave the record in storage when provided (any truthy value).
 */

const API_BASE_URL = process.env.ALGA_API_URL ?? "https://algapsa.com";
const API_KEY = process.env.ALGA_API_KEY;
if (!API_KEY) {
  console.error("Missing ALGA_API_KEY environment variable");
  process.exit(1);
}

const flags = parseFlags();
const namespace = flags.namespace ?? "sample-storage";
const recordKey = flags.key ?? "welcome-message";
const ttlSeconds = flags.ttl ? Number(flags.ttl) : undefined;
const skipDelete = Boolean(flags["skip-delete"] ?? false);

let value: JsonValue = { message: "Hello from the storage API sample" };
if (flags.value) {
  try {
    value = JSON.parse(flags.value);
  } catch (error) {
    console.error("Failed to parse --value JSON:", error instanceof Error ? error.message : error);
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
    console.error("Failed to parse --metadata JSON:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

(async () => {
  try {
    console.log(`Writing record ${namespace}/${recordKey}...`);
    const putResult = await putRecord({
      namespace,
      key: recordKey,
      value,
      metadata,
      ttlSeconds,
    });
    console.log("Put response:");
    console.log(JSON.stringify(putResult, null, 2));

    console.log("\nFetching record...");
    const getResult = await getRecord({
      namespace,
      key: recordKey,
    });
    console.log(JSON.stringify(getResult, null, 2));

    console.log("\nListing records in namespace...");
    const listResult = await listRecords({
      namespace,
      includeValues: true,
      includeMetadata: true,
    });
    console.log(JSON.stringify(listResult, null, 2));

    if (!skipDelete) {
      console.log("\nDeleting record...");
      await deleteRecord({
        namespace,
        key: recordKey,
      });
      console.log("Record deleted. Re-run without --skip-delete to keep the sample record.");
    } else {
      console.log("Skipping delete as requested.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
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
  const url = `${API_BASE_URL}${path}`;
  const requestHeaders: Record<string, string> = {
    "x-api-key": API_KEY!,
    ...headers,
  };

  const response = await fetch(url, {
    method,
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
}

async function putRecord(args: PutArgs): Promise<StoragePutResponse> {
  return apiFetch<StoragePutResponse>({
    method: "PUT",
    path: `/api/v1/storage/namespaces/${encodeURIComponent(args.namespace)}/records/${encodeURIComponent(args.key)}`,
    body: {
      value: args.value,
      metadata: args.metadata,
      ttlSeconds: args.ttlSeconds,
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

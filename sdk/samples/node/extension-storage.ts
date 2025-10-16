export {};

/**
 * Standalone sample: demonstrate CRUD operations with the Alga extension storage API.
 *
 * Usage:
 *   ALGA_API_URL="https://algapsa.com" \
 *   ALGA_API_KEY="your-api-key" \
 *   ALGA_TENANT_ID="your-tenant-id" \
 *   ALGA_EXTENSION_INSTALL_ID="your-install-id" \
 *   npm run sample:extension-storage -- \
 *     --namespace "settings" \
 *     --key "welcome-message" \
 *     --value '{"message":"Hello from the storage API"}'
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
const TENANT_ID = process.env.ALGA_TENANT_ID;
const INSTALL_ID = process.env.ALGA_EXTENSION_INSTALL_ID;

if (!API_KEY) {
  console.error("Missing ALGA_API_KEY environment variable");
  process.exit(1);
}

const flags = parseFlags();
const namespace = flags.namespace ?? "sample-storage";
const recordKey = flags.key ?? "welcome-message";
const ttlSeconds = flags.ttl ? Number(flags.ttl) : undefined;
const skipDelete = Boolean(flags["skip-delete"] ?? false);
const extensionInstallId = flags.install ?? INSTALL_ID;

if (!extensionInstallId) {
  console.error(
    "Missing extension install identifier. Provide ALGA_EXTENSION_INSTALL_ID env var or --install flag.",
  );
  process.exit(1);
}

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
      installId: extensionInstallId,
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
      installId: extensionInstallId,
      namespace,
      key: recordKey,
    });
    console.log(JSON.stringify(getResult, null, 2));

    console.log("\nListing records in namespace...");
    const listResult = await listRecords({
      installId: extensionInstallId,
      namespace,
      includeValues: true,
      includeMetadata: true,
    });
    console.log(JSON.stringify(listResult, null, 2));

    if (!skipDelete) {
      console.log("\nDeleting record...");
      await deleteRecord({
        installId: extensionInstallId,
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

  if (TENANT_ID) {
    requestHeaders["x-tenant-id"] = TENANT_ID;
  }

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
  installId: string;
  namespace: string;
  key: string;
  value: JsonValue;
  metadata?: Record<string, JsonValue>;
  ttlSeconds?: number;
}

async function putRecord(args: PutArgs): Promise<StoragePutResponse> {
  return apiFetch<StoragePutResponse>({
    method: "PUT",
    path: `/api/ext-storage/install/${encodeURIComponent(args.installId)}/${encodeURIComponent(args.namespace)}/records/${encodeURIComponent(args.key)}`,
    body: {
      value: args.value,
      metadata: args.metadata,
      ttlSeconds: args.ttlSeconds,
    },
  });
}

interface GetArgs {
  installId: string;
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
    path: `/api/ext-storage/install/${encodeURIComponent(args.installId)}/${encodeURIComponent(args.namespace)}/records/${encodeURIComponent(args.key)}`,
    headers,
  });
}

interface ListArgs {
  installId: string;
  namespace: string;
  limit?: number;
  cursor?: string;
  keyPrefix?: string;
  includeValues?: boolean;
  includeMetadata?: boolean;
}

async function listRecords(args: ListArgs): Promise<StorageListResponse> {
  const params = new URLSearchParams();
  if (args.limit) params.set("limit", String(args.limit));
  if (args.cursor) params.set("cursor", args.cursor);
  if (args.keyPrefix) params.set("keyPrefix", args.keyPrefix);
  if (args.includeValues) params.set("includeValues", String(args.includeValues));
  if (args.includeMetadata) params.set("includeMetadata", String(args.includeMetadata));

  return apiFetch<StorageListResponse>({
    method: "GET",
    path: `/api/ext-storage/install/${encodeURIComponent(args.installId)}/${encodeURIComponent(args.namespace)}/records?${params.toString()}`,
  });
}

interface DeleteArgs {
  installId: string;
  namespace: string;
  key: string;
  ifRevision?: number;
}

async function deleteRecord(args: DeleteArgs): Promise<void> {
  const params = new URLSearchParams();
  if (typeof args.ifRevision === "number") {
    params.set("ifRevision", String(args.ifRevision));
  }

  await apiFetch<void>({
    method: "DELETE",
    path: `/api/ext-storage/install/${encodeURIComponent(args.installId)}/${encodeURIComponent(args.namespace)}/records/${encodeURIComponent(args.key)}${params.size ? `?${params.toString()}` : ""}`,
  });
}

function parseFlags(): Record<string, string> {
  const result: Record<string, string> = {};
  const argv = process.argv.slice(2);

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];

    if (!value || value.startsWith("--")) {
      result[key] = "true";
      continue;
    }

    result[key] = value;
    index += 1;
  }

  return result;
}

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

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

interface StorageListItem {
  namespace: string;
  key: string;
  revision: number;
  value?: JsonValue;
  metadata?: Record<string, JsonValue>;
  ttlExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StorageListResponse {
  items: StorageListItem[];
  nextCursor: string | null;
}

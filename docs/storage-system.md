# Alga Storage Service

The Alga storage service is a multi-tenant, JSON document store designed for lightweight configuration, caching, and coordination data. It is no longer coupled to the extension runtime; every tenant can provision and manage namespaces directly through the public API regardless of whether extensions are in use.

## Resource Model

```
tenant
  └─ namespace (≤ 64 chars, lowercase slug)
       └─ key (≤ 256 chars, UTF-8, `/` not permitted)
            └─ record {
                 revision,
                 value,
                 metadata,
                 ttlExpiresAt,
                 createdAt,
                 updatedAt
               }
```

- **Namespaces** partition records within a tenant. Namespaces can be created implicitly by writing a record.
- **Keys** uniquely identify records inside a namespace. Keys are case-sensitive and treated as opaque identifiers.
- **Records** store JSON documents in the `value` field plus optional `metadata` (flat JSON object) and bookkeeping attributes.

## Authentication

All requests require an API key with the `storage` capability. Supply the key via the `x-api-key` header. Keys are tenant-scoped; a key cannot access data belonging to another tenant.

```
x-api-key: <tenant-storage-key>
```

## API Surface

| HTTP Method | Path                                                        | Description                       |
|-------------|-------------------------------------------------------------|-----------------------------------|
| `PUT`       | `/api/v1/storage/namespaces/{namespace}/records/{key}`      | Create or update a record         |
| `GET`       | `/api/v1/storage/namespaces/{namespace}/records/{key}`      | Retrieve a record                 |
| `GET`       | `/api/v1/storage/namespaces/{namespace}/records`            | List records with optional filters|
| `DELETE`    | `/api/v1/storage/namespaces/{namespace}/records/{key}`      | Delete a record                   |

Bulk write and archival operations remain in private preview. Contact the platform team for access.

## Record Representation

`PUT` and `GET` operations exchange JSON payloads with the following structure:

```jsonc
{
  "namespace": "settings",
  "key": "invoice-defaults",
  "revision": 12,
  "value": { "currency": "USD", "netTerms": 30 },
  "metadata": { "contentType": "application/json" },
  "ttlExpiresAt": "2025-01-01T12:00:00Z",
  "createdAt": "2024-12-31T12:00:00Z",
  "updatedAt": "2024-12-31T12:00:00Z"
}
```

- `revision` increases by one on every successful write.
- `ttlExpiresAt` is null when no TTL is applied.
- Timestamps are returned in RFC 3339 format.

## Revisions & Concurrency

Revisions allow optimistic concurrency control without global locks.

- **Conditional write:** Provide `ifRevision` in the `PUT` body. The write only succeeds when the stored revision matches.
- **Conditional fetch:** Provide `If-Revision-Match` header on `GET`. A `412 Precondition Failed` response indicates the revision changed.
- **Conflict handling:** When a conditional write fails, the service returns a `REVISION_MISMATCH` error with the current revision so clients can refresh and retry.

This mechanism is intended for collaborative scenarios where multiple workers coordinate on the same configuration entry.

## Time-To-Live (TTL)

Use the `ttlSeconds` field on `PUT` requests to attach an expiration. TTLs:

- Are measured in seconds from the time the write is processed.
- Can be updated or cleared by issuing another `PUT` without `ttlSeconds`.
- Trigger record removal by a background sweeper shortly after the expiry timestamp.
- Treat expired records as `NOT_FOUND` for all read operations.

The current maximum TTL is 30 days. For longer retention, omit `ttlSeconds` and prune data explicitly.

## List Filtering

`GET /records` accepts the following query parameters:

- `limit` (default 25, max 100)
- `cursor` (opaque token for pagination)
- `keyPrefix` (string prefix filter on keys)
- `includeValues=true|false`
- `includeMetadata=true|false`

The response includes `items` and optionally `nextCursor` when more data is available.

## Example Usage

### Curl

```bash
curl -X PUT \
  -H "x-api-key: $ALGA_STORAGE_KEY" \
  -H "Content-Type: application/json" \
  https://algapsa.com/api/v1/storage/namespaces/settings/records/invoice-defaults \
  -d '{
    "value": { "currency": "USD", "netTerms": 30 },
    "metadata": { "contentType": "application/json" },
    "ttlSeconds": 86400
  }'
```

### Node.js Fetch

```ts
const response = await fetch(`${baseUrl}/api/v1/storage/namespaces/${namespace}/records/${key}`, {
  method: "PUT",
  headers: {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    value,
    metadata: { contentType: "application/json" },
    ttlSeconds: 3600,
    ifRevision,
  }),
});
```

## Quotas & Limits

- Maximum record size: 64 KiB serialized JSON.
- Namespaces per tenant: 128.
- Requests per second: burst 50, sustained 20 (per tenant). Rate limit headers mirror the standard REST API format.
- Metadata must be a flat JSON object with string keys and scalar/JSON literal values.

## Migration Notes

- Existing extension storage data has been migrated to tenant-owned namespaces using the pattern `<extension_slug>.<namespace>`.
- Extension runners must now request storage access via the tenant storage API key instead of implicit extension credentials.
- You can remove extension-specific storage configuration from manifests; storage scopes are now defined at the tenant level.

For authoritative updates, bookmark this document or reach out to the platform team in the `#alga-storage` Slack channel.


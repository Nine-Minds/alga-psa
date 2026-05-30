# Unified Full-Text Search

The `GET /api/v1/search` endpoint searches across all indexed business records in a single request, returning results from any combination of tickets, clients, contacts, projects, assets, invoices, contracts, documents, knowledge-base articles, and more — filtered by the caller's permissions and scoped to the caller's tenant.

Before this endpoint, callers had to query each resource's dedicated `/search` route separately and merge results themselves. The unified endpoint handles that fan-out internally.

## Authentication

Include your API key in the `x-api-key` header. No separate search permission is required — any valid API key may call this endpoint. Client-portal API keys are automatically scoped to their own client's records.

```
GET /api/v1/search
x-api-key: <your-api-key>
```

## Query parameters

| Parameter | Required | Type | Description |
|-----------|----------|------|-------------|
| `query` | Yes | string (1–200 chars) | Full-text query. Supports `OR` for alternatives (e.g. `laptop OR workstation`). |
| `types` | No | string | Comma-separated object types to include. Omit to search every type the caller can read. See [Supported types](#supported-types). |
| `limit` | No | integer (1–100) | Maximum results per page. Defaults to 30. |
| `cursor` | No | string | Opaque pagination cursor from a prior response's `nextCursor`. |
| `sort` | No | `relevance` \| `recent` | Ordering. `relevance` (default) ranks by full-text score; `recent` orders by last-updated timestamp. |

## Access control

Results pass two filters before being returned:

1. **Per-type permission gate** — Any object type the caller's role cannot read is silently excluded. For example, an API key without `invoice:read` receives no invoice, invoice item, or invoice annotation results.
2. **Per-row ACL check** — Each candidate result is verified against the per-row access-control record in the search index. Only records the user could see in-app are returned.

## Response

```json
{
  "data": {
    "results": [
      {
        "type": "ticket",
        "id": "9a4b...",
        "title": "Network outage at main office",
        "subtitle": "Acme Corp · Open",
        "snippet": "...the <mark>router</mark> stopped responding...",
        "url": "/tickets/9a4b...",
        "score": 0.91,
        "updatedAt": "2026-05-28T10:15:00Z"
      }
    ],
    "groups": {
      "ticket": 4,
      "asset": 2
    },
    "totalCount": 6,
    "nextCursor": "eyJ..."
  }
}
```

### Response fields

| Field | Type | Description |
|-------|------|-------------|
| `results` | array | Matched records for this page, ordered by `sort`. |
| `results[].type` | string | Object type (e.g. `ticket`, `client`, `asset`). |
| `results[].id` | string | Record identifier within its type. |
| `results[].parentId` | string? | Parent record identifier for nested types (e.g. the ticket ID for a `ticket_comment`). |
| `results[].title` | string | Primary display label. |
| `results[].subtitle` | string? | Secondary context line. |
| `results[].snippet` | string? | Matched-text excerpt with `<mark>` tags around highlighted terms. |
| `results[].url` | string | Relative in-app URL for the record. |
| `results[].score` | number | Full-text relevance score; higher is more relevant. |
| `results[].updatedAt` | string (ISO 8601) | Last-updated timestamp of the source record. |
| `groups` | object | Per-type total match counts across all pages. |
| `totalCount` | integer | Total matches across all permitted types. |
| `nextCursor` | string? | Cursor for the next page; absent when all results fit in the current page. |

## Pagination

The endpoint uses cursor-based pagination. When a response includes `nextCursor`, pass it as the `cursor` parameter on the next call with the same `query`, `types`, and `sort` values. The `groups` and `totalCount` fields always reflect the full result set, not just the current page.

## Rate limiting

Subject to the standard API rate limit: 120-request burst, 60 requests per minute sustained. See [API Rate Limiting and Webhooks](api-rate-limiting-and-webhooks.md).

## Supported types

Pass any comma-separated subset of these values in the `types` parameter:

`client`, `contact`, `user`, `ticket`, `ticket_comment`, `project`, `project_phase`, `project_task`, `project_task_comment`, `asset`, `invoice`, `invoice_item`, `invoice_annotation`, `contract`, `client_contract`, `document`, `kb_article`, `service_catalog`, `service_request_submission`, `service_request_definition`, `workflow_task`, `interaction`, `schedule_entry`, `time_entry`, `board`, `category`, `tag`, `status`

Types the caller's role cannot read are automatically excluded even if listed explicitly.

## Examples

**Search across all types:**
```bash
curl "https://algapsa.com/api/v1/search?query=network+outage" \
  -H "x-api-key: $ALGA_API_KEY"
```

**Restrict to tickets and assets, sort by recency:**
```bash
curl "https://algapsa.com/api/v1/search?query=router&types=ticket,asset&sort=recent&limit=20" \
  -H "x-api-key: $ALGA_API_KEY"
```

**Fetch the next page:**
```bash
curl "https://algapsa.com/api/v1/search?query=router&types=ticket,asset&sort=recent&limit=20&cursor=$NEXT_CURSOR" \
  -H "x-api-key: $ALGA_API_KEY"
```

# n8n-nodes-alga-psa

Alga PSA community node package for self-hosted n8n instances.

## What This Package Provides

This package adds one node to n8n:

- Node name: `Alga PSA`
- Credential: `Alga PSA API`
- Resources:
  - Ticket
  - Contact
  - Client
  - Board
  - Status
  - Priority

## Requirements

- Self-hosted n8n (community nodes are not available on n8n Cloud when unverified)
- Alga PSA API access with an API key

## Installation

### Option 1: n8n UI (Self-Hosted)

1. Open your n8n instance.
2. Go to `Settings -> Community Nodes`.
3. Install package: `n8n-nodes-alga-psa`.
4. Restart n8n if prompted.

### Option 2: Manual npm Install (Self-Hosted)

Install in the n8n environment where your instance runs:

```bash
npm install n8n-nodes-alga-psa
```

Then restart n8n.

For manual/custom installation paths, follow n8n's manual community-node installation guidance for your deployment type.

## Credential Setup

Create credential type `Alga PSA API` with:

- `Base URL` example: `https://algapsa.com`
- `API Key` your Alga PSA key (sent as `x-api-key` header)
- Field names in node credentials: `baseUrl`, `apiKey`

## Operation Matrix

| Resource | Operations |
| --- | --- |
| Ticket | Create, Get, List, List Comments, Search, Update, Add Comment, Update Status, Update Assignment, Delete |
| Contact | Create, Get, List, Update, Delete |
| Client | List |
| Board | List |
| Status | List |
| Priority | List |

## Ticket Field Requirements

Ticket create requires:

- `title`
- `client_id`
- `board_id`
- `status_id`
- `priority_id`

Create/Update optional fields are grouped under additional options.

## Contact Field Requirements

Contact create requires:

- `full_name`

Contact create/update optional fields:

- `email`
- `primary_email_canonical_type`
- `primary_email_custom_type`
- `additional_email_addresses`
- `client_id`
- `role`
- `notes`
- `is_inactive`
- `phone_numbers`

Contact list supports:

- `Page`
- `Limit`
- `client_id`
- `search_term`
- `is_inactive`

`phone_numbers` is authored as JSON in the first pass and must be an array of objects with a required `phone_number` field.

`additional_email_addresses` is authored as JSON and should be an array of objects with a required `email_address` field plus optional `canonical_type`, `custom_type`, and `display_order`.

Use `primary_email_canonical_type` for canonical labels such as `work`, `personal`, `billing`, or `other`. Use `primary_email_custom_type` when you need a freeform primary label instead.

## Ticket Comment Operations

Ticket comment support stays under the `Ticket` resource:

- `List Comments` requires `ticketId` and supports optional `limit`, `offset`, and `order`.
- `Add Comment` requires `ticketId` and `comment_text`, with optional `is_internal`.
- `time_spent` is intentionally not exposed because the current Alga PSA ticket comment implementation does not persist or use it.

## Lookup Fields and Manual Fallback

For ticket `client_id`, `board_id`, `status_id`, and `priority_id`, plus contact `client_id`:

- Use dynamic list lookups (`From List`) when available.
- Use manual UUID input (`By ID`) if lookups fail or if you already know the ID.

## Output and Error Behavior

- API responses unwrap `{ data: ... }` for easier downstream use.
- Paginated list responses, including `Contact -> List`, preserve `pagination` metadata.
- Delete, including `Contact -> Delete`, returns a non-empty success object containing `success`, `id`, and `deleted`.
- Continue On Fail is supported with item-level error objects containing `error.code`, `error.message`, and `error.details` when available.

## Example Workflows

Four minimal importable examples are included:

- `examples/create-update-assignment.workflow.json`
- `examples/search-update-status.workflow.json`
- `examples/add-comment-then-list-comments.workflow.json`
- `examples/create-update-contact.workflow.json`

These demonstrate:

1. Ticket create -> update assignment
2. Ticket search -> update status
3. Ticket add comment -> list comments
4. Contact create -> update

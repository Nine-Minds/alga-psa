# API Rate Limiting and Webhooks

This document covers two related public API behaviors:

- Authenticated `/api/v1/*` requests are protected by per-key rate limiting.
- Ticket and project lifecycle events can be delivered to tenant-managed outbound webhooks.

## Rate Limiting

### Scope

Rate limiting applies to authenticated public REST API requests that use
`x-api-key`.

It does not apply to:

- health/version endpoints
- internal runner/storage/scheduler/invoicing/client/service endpoints
- mobile auth endpoints

### Default Limits

- Burst capacity: `120` requests
- Sustained refill: `60` requests per minute

That is equivalent to roughly `1` request per second sustained with a burst of
`120`.

Limits are tracked per `(tenant, api_key_id)`.

### Success Headers

Successful authenticated responses include:

- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`

Example:

```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 87
Content-Type: application/json
```

### 429 Responses

When a key exceeds its bucket, the API returns `429 Too Many Requests` with:

- `Retry-After`: integer seconds until a token is available
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`: ISO 8601 timestamp

Example:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 2026-05-05T14:22:31.000Z
Content-Type: application/json
```

```json
{
  "error": {
    "message": "Too many requests",
    "code": "RATE_LIMITED",
    "details": {
      "retry_after_ms": 12000,
      "remaining": 0
    }
  }
}
```

### Observation Mode Versus Enforcement

Rollout can run in observation mode with `RATE_LIMIT_ENFORCE=false`.

In observation mode:

- the same limit calculation still runs
- the same rate-limit headers still appear
- throttled requests are logged for analysis
- the request is allowed through instead of returning `429`

In enforcement mode (`RATE_LIMIT_ENFORCE=true`), throttled requests return
`429`.

### Client Guidance

- Treat `429` as retryable.
- Use `Retry-After` first if present.
- Back off per key, not globally across unrelated tenants/keys.
- Do not assume a successful request means the next one will also succeed
  immediately if `X-RateLimit-Remaining` is low.

## Ticket Webhooks

### Supported Events

Ticket webhooks support these event types in v1:

- `ticket.created`
- `ticket.updated`
- `ticket.status_changed`
- `ticket.assigned`
- `ticket.closed`
- `ticket.comment.added`
- `ticket.response_state_changed` (payload adds `previous_response_state` / `new_response_state`, and `response_state` always reflects the current state — equal to `new_response_state` on this event; `comment` and `comments[]` entries now also carry `author_type`, and `contact_id` / `contact_name` when a contact wrote them)

### Notification Suppression

`ticket.created`, `ticket.updated`, `ticket.assigned`, and `ticket.closed`
payloads carry two boolean flags that reflect whether notifications were
suppressed when the operation was performed:

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `suppress_contact_notifications` | boolean | `false` | `true` when the contact (end-customer) was not notified about this update. |
| `suppress_internal_notifications` | boolean | `false` | `true` when all notifications were suppressed — neither internal users nor the contact were notified. Implies `suppress_contact_notifications`. |

Both fields are always present in the payload and default to `false`.
Integrations that forward ticket events to an external system can read these
flags to avoid double-notifying contacts when the MSP operator already chose
to suppress the native notification.

### Delivery Envelope

Every outbound webhook is delivered as JSON:

```json
{
  "event_id": "6e8d9668-e7af-4a71-b734-9e3cb74b06b7",
  "event_type": "ticket.assigned",
  "occurred_at": "2026-05-05T14:10:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "ticket_id": "22222222-2222-2222-2222-222222222222",
    "ticket_number": "T-1042",
    "title": "Printer offline",
    "status_id": "33333333-3333-3333-3333-333333333333",
    "status_name": "Open",
    "priority_id": "44444444-4444-4444-4444-444444444444",
    "priority_name": "High",
    "client_id": "55555555-5555-5555-5555-555555555555",
    "client_name": "Acme Manufacturing",
    "contact_name_id": "66666666-6666-6666-6666-666666666666",
    "contact_name": "Jordan Smith",
    "contact_email": "jordan@example.com",
    "assigned_to": "77777777-7777-7777-7777-777777777777",
    "assigned_to_name": "Pat Lee",
    "assigned_team_id": null,
    "board_id": "88888888-8888-8888-8888-888888888888",
    "board_name": "Support",
    "category_id": "99999999-9999-9999-9999-999999999999",
    "subcategory_id": null,
    "is_closed": false,
    "entered_at": "2026-05-05T13:55:00.000Z",
    "updated_at": "2026-05-05T14:10:00.000Z",
    "closed_at": null,
    "due_date": null,
    "tags": ["printer", "onsite"],
    "suppress_contact_notifications": false,
    "suppress_internal_notifications": false,
    "url": "https://algapsa.com/msp/tickets/22222222-2222-2222-2222-222222222222"
  }
}
```

### Example Payloads

#### `ticket.created`

```json
{
  "event_id": "11111111-aaaa-bbbb-cccc-111111111111",
  "event_type": "ticket.created",
  "occurred_at": "2026-05-05T14:00:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "ticket_id": "22222222-2222-2222-2222-222222222222",
    "ticket_number": "T-1042",
    "title": "Printer offline",
    "status_name": "Open",
    "priority_name": "High",
    "client_name": "Acme Manufacturing",
    "tags": [],
    "suppress_contact_notifications": false,
    "suppress_internal_notifications": false,
    "url": "https://algapsa.com/msp/tickets/22222222-2222-2222-2222-222222222222"
  }
}
```

#### `ticket.updated`

```json
{
  "event_id": "11111111-aaaa-bbbb-cccc-222222222222",
  "event_type": "ticket.updated",
  "occurred_at": "2026-05-05T14:05:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "ticket_id": "22222222-2222-2222-2222-222222222222",
    "ticket_number": "T-1042",
    "title": "Printer offline at front desk",
    "status_name": "Open",
    "tags": ["printer"],
    "url": "https://algapsa.com/msp/tickets/22222222-2222-2222-2222-222222222222",
    "suppress_contact_notifications": false,
    "suppress_internal_notifications": false,
    "changes": {
      "title": {
        "previous": "Printer offline",
        "new": "Printer offline at front desk"
      }
    }
  }
}
```

#### `ticket.status_changed`

```json
{
  "event_id": "11111111-aaaa-bbbb-cccc-333333333333",
  "event_type": "ticket.status_changed",
  "occurred_at": "2026-05-05T14:07:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "ticket_id": "22222222-2222-2222-2222-222222222222",
    "ticket_number": "T-1042",
    "status_id": "33333333-3333-3333-3333-333333333334",
    "status_name": "In Progress",
    "previous_status_id": "33333333-3333-3333-3333-333333333333",
    "previous_status_name": "Open",
    "tags": [],
    "url": "https://algapsa.com/msp/tickets/22222222-2222-2222-2222-222222222222"
  }
}
```

#### `ticket.assigned`

```json
{
  "event_id": "11111111-aaaa-bbbb-cccc-444444444444",
  "event_type": "ticket.assigned",
  "occurred_at": "2026-05-05T14:10:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "ticket_id": "22222222-2222-2222-2222-222222222222",
    "assigned_to": "77777777-7777-7777-7777-777777777777",
    "assigned_to_name": "Pat Lee",
    "status_name": "In Progress",
    "tags": [],
    "suppress_contact_notifications": false,
    "suppress_internal_notifications": false,
    "url": "https://algapsa.com/msp/tickets/22222222-2222-2222-2222-222222222222"
  }
}
```

#### `ticket.closed`

```json
{
  "event_id": "11111111-aaaa-bbbb-cccc-555555555555",
  "event_type": "ticket.closed",
  "occurred_at": "2026-05-05T16:20:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "ticket_id": "22222222-2222-2222-2222-222222222222",
    "status_name": "Closed",
    "is_closed": true,
    "closed_at": "2026-05-05T16:20:00.000Z",
    "tags": [],
    "suppress_contact_notifications": false,
    "suppress_internal_notifications": false,
    "url": "https://algapsa.com/msp/tickets/22222222-2222-2222-2222-222222222222"
  }
}
```

#### `ticket.comment.added`

```json
{
  "event_id": "11111111-aaaa-bbbb-cccc-666666666666",
  "event_type": "ticket.comment.added",
  "occurred_at": "2026-05-05T14:25:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "ticket_id": "22222222-2222-2222-2222-222222222222",
    "ticket_number": "T-1042",
    "status_name": "In Progress",
    "tags": [],
    "url": "https://algapsa.com/msp/tickets/22222222-2222-2222-2222-222222222222",
    "comment": {
      "text": "Scheduled onsite visit for 3 PM.",
      "author": "Pat Lee",
      "timestamp": "2026-05-05T14:25:00.000Z",
      "is_internal": false,
      "author_type": "internal"
    }
  }
}
```

`author_type` identifies whether the comment was posted by an MSP agent or by a client through the client portal. Possible values are `"internal"` (an MSP team member wrote the comment), `"client"` (a contact replied via the client portal), or `null` (the author type is unknown, for example on comments created before this field was tracked). Use `author_type` to distinguish client-initiated replies from agent replies without a separate user-record lookup.

The `author` field is always populated. For comments from an internal user or contact, `author` carries their display name. For inbound-email comments whose sender does not match any contact or user record, `author` is resolved from the message's sender name and email address. If no sender identity is available, `author` falls back to `"System"`.

Comment payloads never include attachments.

## Project Webhooks

### Supported Events

Project webhooks fire for both project-level and project-task lifecycle changes:

- `project.created`
- `project.updated`
- `project.status_changed`
- `project.assigned`
- `project.closed`
- `project.completed` — **deprecated alias** for `project.closed`. Existing subscribers continue to receive it; new integrations should subscribe to `project.closed`.
- `project.task.created`
- `project.task.updated`
- `project.task.status_changed`
- `project.task.assigned`
- `project.task.completed`

### Payload Allowlist and Correlation Keys

Project-level and task-level events share a **single `project` allowlist** in the `payload_fields` configuration; you cannot allowlist task fields independently of project fields.

Two keys are always retained regardless of the allowlist:

- `project_id` — present on every project-family delivery.
- `task_id` — additionally retained on every `project.task.*` delivery.

The supported allowlist values are documented inline in `payload_fields` on the `POST /api/v1/webhooks` request schema (and in the source of truth at `server/src/lib/webhooks/payloadFields.ts`).

### Delivery Envelope

Every outbound webhook is delivered as JSON. Project-level event example:

```json
{
  "event_id": "abc12300-1111-2222-3333-444444444444",
  "event_type": "project.assigned",
  "occurred_at": "2026-05-12T10:00:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "project_name": "Acme Onboarding",
    "wbs_code": "01.02.03",
    "description": "Initial cutover engagement.",
    "status_id": "55555555-5555-5555-5555-555555555555",
    "status_name": "In Progress",
    "is_closed": false,
    "client_id": "66666666-6666-6666-6666-666666666666",
    "client_name": "Acme Manufacturing",
    "contact_name_id": "77777777-7777-7777-7777-777777777777",
    "contact_name": "Jordan Smith",
    "contact_email": "jordan@example.com",
    "assigned_to": "88888888-8888-8888-8888-888888888888",
    "assigned_to_name": "Pat Lee",
    "start_date": "2026-05-01",
    "end_date": "2026-07-31",
    "budgeted_hours": 120,
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333"
  }
}
```

Project-task envelope (`project.task.*` events) carries a flattened task record alongside the parent project identifiers:

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-555555555555",
  "event_type": "project.task.assigned",
  "occurred_at": "2026-05-12T10:30:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "project_name": "Acme Onboarding",
    "client_id": "66666666-6666-6666-6666-666666666666",
    "client_name": "Acme Manufacturing",
    "task_id": "99999999-9999-9999-9999-999999999999",
    "phase_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "phase_name": "Discovery",
    "task_name": "Inventory legacy mailboxes",
    "status_id": "55555555-5555-5555-5555-555555555556",
    "status_name": "In Progress",
    "is_closed": false,
    "assigned_to": "88888888-8888-8888-8888-888888888888",
    "assigned_to_name": "Pat Lee",
    "estimated_hours": 8,
    "actual_hours": 0,
    "due_date": "2026-05-20",
    "priority_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    "priority_name": "High",
    "wbs_code": "01.02.03.01",
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333?taskId=99999999-9999-9999-9999-999999999999",
    "tags": ["onboarding"]
  }
}
```

### Example Payloads

#### `project.created`

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-100000000000",
  "event_type": "project.created",
  "occurred_at": "2026-05-12T09:00:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "project_name": "Acme Onboarding",
    "status_name": "Planning",
    "client_name": "Acme Manufacturing",
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333"
  }
}
```

#### `project.updated`

`changes` is a key-by-key diff of fields that changed in this update; absent fields did not change.

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-200000000000",
  "event_type": "project.updated",
  "occurred_at": "2026-05-12T09:15:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "project_name": "Acme Onboarding — Phase 1",
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333",
    "changes": {
      "project_name": {
        "previous": "Acme Onboarding",
        "new": "Acme Onboarding — Phase 1"
      },
      "end_date": {
        "previous": "2026-07-31",
        "new": "2026-08-31"
      }
    }
  }
}
```

#### `project.status_changed`

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-300000000000",
  "event_type": "project.status_changed",
  "occurred_at": "2026-05-12T09:30:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "status_id": "55555555-5555-5555-5555-555555555555",
    "status_name": "In Progress",
    "previous_status_id": "55555555-5555-5555-5555-555555555550",
    "previous_status_name": "Planning",
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333"
  }
}
```

#### `project.assigned`

See the [Delivery Envelope](#delivery-envelope-1) example above.

#### `project.closed`

`project.closed` fires when `is_closed` transitions to `true`.

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-400000000000",
  "event_type": "project.closed",
  "occurred_at": "2026-08-30T17:00:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "status_name": "Completed",
    "is_closed": true,
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333"
  }
}
```

#### `project.completed`

Same payload as `project.closed`, with `event_type` set to `project.completed`. Delivered for backwards compatibility alongside `project.closed`; new integrations should subscribe to `project.closed`.

#### `project.task.created`

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-500000000000",
  "event_type": "project.task.created",
  "occurred_at": "2026-05-12T10:05:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "project_name": "Acme Onboarding",
    "task_id": "99999999-9999-9999-9999-999999999999",
    "task_name": "Inventory legacy mailboxes",
    "phase_name": "Discovery",
    "status_name": "Not Started",
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333?taskId=99999999-9999-9999-9999-999999999999",
    "tags": []
  }
}
```

#### `project.task.updated`

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-600000000000",
  "event_type": "project.task.updated",
  "occurred_at": "2026-05-12T10:10:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "task_id": "99999999-9999-9999-9999-999999999999",
    "due_date": "2026-05-22",
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333?taskId=99999999-9999-9999-9999-999999999999",
    "tags": ["onboarding"],
    "changes": {
      "due_date": { "previous": "2026-05-20", "new": "2026-05-22" },
      "tags": { "previous": [], "new": ["onboarding"] }
    }
  }
}
```

When `changes.tags` is present it carries the **authoritative post-change tag set**; clients should prefer it over the cached `tags` snapshot.

#### `project.task.status_changed`

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-700000000000",
  "event_type": "project.task.status_changed",
  "occurred_at": "2026-05-12T10:20:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "task_id": "99999999-9999-9999-9999-999999999999",
    "status_id": "55555555-5555-5555-5555-555555555556",
    "status_name": "In Progress",
    "previous_status_id": "55555555-5555-5555-5555-555555555551",
    "previous_status_name": "Not Started",
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333?taskId=99999999-9999-9999-9999-999999999999",
    "tags": ["onboarding"]
  }
}
```

#### `project.task.assigned`

See the project-task [Delivery Envelope](#delivery-envelope-1) example above.

#### `project.task.completed`

`project.task.completed` fires when a task transitions to a closed status.

```json
{
  "event_id": "abc12300-aaaa-bbbb-cccc-800000000000",
  "event_type": "project.task.completed",
  "occurred_at": "2026-05-19T16:45:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "project_id": "33333333-3333-3333-3333-333333333333",
    "task_id": "99999999-9999-9999-9999-999999999999",
    "status_name": "Done",
    "is_closed": true,
    "url": "https://algapsa.com/msp/projects/33333333-3333-3333-3333-333333333333?taskId=99999999-9999-9999-9999-999999999999",
    "tags": ["onboarding"]
  }
}
```

## Client, Contact, and Client Location Webhooks

Twelve events cover the lifecycle of clients, contacts, and client locations. They use the same delivery envelope, signature, retry, auto-disable, event allowlist, and `entity_ids` filter as ticket and project events.

### Supported Events

| Entity | Events |
| --- | --- |
| Client | `client.created`, `client.updated`, `client.deactivated`, `client.deleted` |
| Contact | `contact.created`, `contact.updated`, `contact.deactivated`, `contact.deleted` |
| Client location | `client_location.created`, `client_location.updated`, `client_location.deactivated`, `client_location.deleted` |
| Quote | `quote.sent`, `quote.viewed`, `quote.approved`, `quote.accepted`, `quote.rejected`, `quote.expired`, `quote.converted`, `quote.conversion_reverted`, `quote.superseded`, `quote.cancelled` |

### What Triggers Each Event

An event fires for the same change no matter where it was made.

| Event | Fires when | Made from |
| --- | --- | --- |
| `client.created` | A client is created. | Web UI, REST API, workflow actions (`clients.create`, `clients.duplicate`), CSV import, Xero client import, onboarding, Entra sync, client lookup, inbound email |
| `client.updated` | A client's fields change, its lifecycle status changes (prospect, active, former), or its primary contact changes. | Web UI, REST API, workflow actions, CSV import |
| `client.deactivated` | `is_inactive` goes from `false` to `true`. | Web UI, REST API, workflow actions |
| `client.deleted` | A client is deleted, or a client is merged into another one. For a merge, `client_id` is the **source** (merged-away) client. | Web UI, REST API, workflow actions, client merge |
| `contact.created` | A contact is created. | Web UI (including the client and contact dialog), REST API, workflow actions, contact CSV import, onboarding, inbound email and inbound webhooks, Entra sync, migration import, portal invitations, ticket import, marketing capture, 3CX |
| `contact.updated` | A contact's fields change. This includes a contact moved to another client (`client_id` in `changed_fields`) and a contact re-parented by a client merge. | Web UI, REST API, workflow actions, contact CSV import, bulk contact moves, inbound webhooks, Entra sync, client merge, portal and onboarding flows, marketing capture, 3CX |
| `contact.deactivated` | `is_inactive` goes from `false` to `true`. This includes each contact deactivated when you deactivate a client with "deactivate contacts": one `contact.deactivated` is sent per contact. | Web UI, REST API, workflow actions, Entra sync |
| `contact.deleted` | A contact is deleted. | Web UI, REST API, workflow actions |
| `client_location.created` | A location is created. | Web UI, REST API, CSV import, onboarding, Xero client import, workflow actions |
| `client_location.updated` | A location's fields change. This includes the implicit change when another location becomes the default (the previous default gets `is_default` in `changed_fields`, and a promoted location does too) and a location re-parented by a client merge. | Web UI, REST API, onboarding, Xero client import, workflow actions, client merge |
| `client_location.deactivated` | `is_active` goes from `true` to `false`. | Web UI, REST API |
| `client_location.deleted` | A location is deleted on its own. | Web UI, REST API |

Not every internal write is delivered. These do not produce events:

- Un-archiving is not a separate event. Reactivating a client or contact (including with the "reactivate contacts" choice) arrives as `client.updated` or `contact.updated` with `is_inactive` in `changed_fields`.
- Child records removed because their client was deleted, and the records seeded when a tenant is created or deleted. See [Delete and merge semantics](#delete-and-merge-semantics).

### Payload

Every delivery carries the standard envelope and a small `data` object:

- The entity id: `client_id`, `contact_id`, or `location_id`.
- `client_id` on contact and client location events, when the record belongs to a client. A contact with no client has no `client_id`.
- `changed_fields` on `*.updated` events, only when the change reported which fields changed. Names are snake_case.

Payloads never contain the record itself. Fetch the record from the REST API when you need its current values.

`client.created`:

```json
{
  "event_id": "0f5c2d8e-6a4b-4e0a-9d52-1c7b7f1e2a10",
  "event_type": "client.created",
  "occurred_at": "2026-10-20T14:10:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "client_id": "55555555-5555-5555-5555-555555555555"
  }
}
```

`contact.updated`:

```json
{
  "event_id": "7a1d4c52-93f0-4c1e-8a37-5d2f8b6e0c44",
  "event_type": "contact.updated",
  "occurred_at": "2026-10-20T14:12:30.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "contact_id": "66666666-6666-6666-6666-666666666666",
    "client_id": "55555555-5555-5555-5555-555555555555",
    "changed_fields": ["email", "phone_number"]
  }
}
```

`client_location.deleted`:

```json
{
  "event_id": "c3e90b17-2d6a-47f9-b1c8-0a9e4d7f3b21",
  "event_type": "client_location.deleted",
  "occurred_at": "2026-10-20T14:15:00.000Z",
  "tenant_id": "11111111-1111-1111-1111-111111111111",
  "data": {
    "location_id": "88888888-8888-8888-8888-888888888888",
    "client_id": "55555555-5555-5555-5555-555555555555"
  }
}
```

Use `payload_fields` to drop the optional keys (`client_id` on contacts and locations, `changed_fields`). The entity id is always sent.

### Entity ID Filter

For contact and client location events, an `entity_ids` filter matches either the record's own id or its parent `client_id`. Filter on a client id to receive every contact and location event for that client.

### Deactivated, Deleted, and Merge Semantics

- **Deactivated.** The record still exists and is marked inactive. Deactivating a client with "deactivate contacts" cascades: every previously active contact sends its own `contact.deactivated`. Only the `false` to `true` change fires `*.deactivated`. Turning the flag back off fires no `*.deactivated` and no separate event; look for `is_inactive` or `is_active` in `changed_fields` on the matching `*.updated` event.
- **Deleted.** The record is gone. Deleting a client does **not** send `contact.deleted` or `client_location.deleted` for its children. Treat a `client.deleted` as covering everything under that client.
- **Merge.** Merging client A into client B sends one `client.deleted` with A's id. B receives no event. Each contact and location that moved from A to B sends its own `contact.updated` or `client_location.updated` with the new `client_id` (B) and `changed_fields` of `["client_id"]`, published after the merge commits. A location that stops being the default in the process also sends `client_location.updated` with `is_default` in `changed_fields`.
- **Follow-up fetches.** If you fetch a record after a `*.deleted` event, a `404` is the expected answer. Treat it as success.

## Quote Lifecycle Webhooks

Quote events publish after the transaction commits. Ordinary edits and repeated writes of the same status do not emit lifecycle events. Linking an existing quote to an opportunity does not emit them either.

| Event | Fires when | Sources |
| --- | --- | --- |
| `quote.sent` | A quote becomes sent. Resending or sending a reminder does not fire it again. | MSP actions, REST, workflow actions |
| `quote.viewed` | The first client-portal view sets `viewed_at`. Later views do not fire it. | Client portal |
| `quote.approved` | Internal approval changes pending approval to approved. | MSP actions, REST, workflow updates |
| `quote.accepted` | A sent quote is accepted. | Client portal, MSP on behalf of the client, REST, workflow updates |
| `quote.rejected` | A quote becomes rejected. | Client portal, REST, workflow updates |
| `quote.expired` | A sent quote expires. Competing expiry paths produce one transition. | Scheduled expiry job, expiry on access in the application or workflow worker |
| `quote.converted` | Conversion creates draft destination records and changes the quote to converted. Combined conversion emits one event with both targets. | MSP actions, REST, workflow actions |
| `quote.conversion_reverted` | Deleting the only converted draft invoice returns the quote to accepted. A quote also linked to a contract keeps its status. | Invoice deletion |
| `quote.superseded` | A revision replaces an existing quote version. | MSP actions, REST |
| `quote.cancelled` | A quote becomes cancelled. | MSP actions, REST, workflow updates |

Use `event_filter.entity_ids` to match either the quote ID or its client ID. Use `payload_fields.quote` to select fields; `quote_id` is always included. The default payload carries quote number and version, client/contact/opportunity references, previous and new status, currency, total amount in minor units, actor type/ID, and the event timestamp. Legacy quotes may have a null quote number or client reference.

Acceptance includes `accepted_by_name`, `accepted_on_behalf`, and `selected_optional_item_ids`. Optional selections contain IDs only. Rejection includes `rejection_reason`. Conversion includes `conversion_targets` and destination IDs; a converted contract may still be a draft. Fetch `GET /api/v1/quotes/{id}` for line items, prices, and terms.

Treat `quote.conversion_reverted` and `quote.superseded` as retractions of earlier facts. The former includes `released_invoice_id`; the latter identifies `superseded_by_quote_id` and `next_version`. A later conversion has a new event ID. There is no generic `quote.status_changed` event, and submitting a quote for internal approval or requesting approval changes emits no event in this version.

```json
{
  "event_id": "43146901-a180-5d98-896c-3c8c550179ae",
  "event_type": "quote.accepted",
  "occurred_at": "2026-10-28T12:00:00.000Z",
  "tenant_id": "96228f61-4ec1-4ec4-84dc-91ed82977765",
  "data": {
    "quote_id": "b1ff62e5-f93c-4b5f-a04d-2bf9f740dcba",
    "quote_number": "Q-0042",
    "previous_status": "sent",
    "new_status": "accepted",
    "accepted_on_behalf": false,
    "selected_optional_item_ids": []
  }
}
```

Event IDs are stable for the tenant and recorded transition. Successful outbound deliveries retain a database receipt, so replay after Redis cache expiry does not create another successful delivery. Network failures still require idempotent consumers: a receiver can process a request before its response is lost.

## Shared Webhook Mechanics

Signature, verification, delivery semantics, retry, and outbound rate limits apply to all webhook events regardless of family (ticket, project, client, contact, client location).

### Signature Headers

Each delivery includes these headers:

- `X-Alga-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>`
- `X-Alga-Webhook-Id`
- `X-Alga-Event-Id`
- `X-Alga-Event-Type`
- `X-Alga-Delivery-Id`
- `X-Alga-Delivery-Attempt`

The signature is computed over:

```text
${timestamp}.${raw_request_body}
```

### Verification Recipe

#### Node.js

```js
import crypto from 'node:crypto';

function verifySignature(secret, rawBody, signatureHeader) {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((item) => item.split('='))
  );

  const payload = `${parts.t}.${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return expected === parts.v1;
}
```

#### Python

```python
import hmac
import hashlib

def verify_signature(secret: str, raw_body: str, signature_header: str) -> bool:
    parts = dict(item.split("=", 1) for item in signature_header.split(","))
    payload = f"{parts['t']}.{raw_body}".encode("utf-8")
    expected = hmac.new(
        secret.encode("utf-8"),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, parts["v1"])
```

Reject payloads whose timestamp is too old for your replay window. A
five-minute window is recommended.

### Delivery Semantics

- Delivery is at least once.
- `event_id` is the idempotency key.
- Ordering is not guaranteed across different webhook subscriptions.
- Ordering is not guaranteed across different event types for the same ticket.
- Consumers should make handlers idempotent and safe to replay.

### Retry Behavior

Failed non-test deliveries are retried with this schedule:

| Attempt after failure | Delay |
| --- | --- |
| 1 | 1 minute |
| 2 | 5 minutes |
| 3 | 30 minutes |
| 4 | 2 hours |
| 5 | 12 hours |

After the fifth failed attempt, the delivery is abandoned.

### Retrying Failed Deliveries

#### Per-delivery retry

Retry a single delivery attempt:

```http
POST /api/v1/webhooks/{id}/deliveries/{delivery_id}/retry
```

Returns `202` with a queued result:

```json
{
  "queued": true,
  "webhook_id": "...",
  "delivery_id": "...",
  "event_id": "..."
}
```

The delivery is re-queued through the normal delivery queue, preserving
rate limiting, backoff, and auto-disable behavior.

#### Bulk retry

Re-queue all failed or abandoned non-test deliveries for a webhook in one
call:

```http
POST /api/v1/webhooks/{id}/retry-failed
Content-Type: application/json

{
  "since": "2026-10-01T00:00:00Z",  // optional ISO-8601; defaults to all time
  "limit": 200                        // optional; max 1000, default 500
}
```

Returns `202`:

```json
{
  "queued": 200,
  "skipped": 12,
  "total_candidates": 212,
  "truncated": false
}
```

- `queued` — deliveries re-queued in this call.
- `skipped` — candidates already in a pending retry attempt.
- `total_candidates` — total matching failed/abandoned deliveries found.
- `truncated` — `true` when `total_candidates` exceeded `limit`; call again
  with a later `since` to page through the remainder.

`retry-failed` is also surfaced as a HATEOAS `links.retry-failed` action on
the webhook resource returned by `GET /api/v1/webhooks/{id}`.

### Per-Webhook Outbound Rate Limit

Webhook delivery also has an outbound cap per webhook. The default is
`100 deliveries per minute` per `(tenant, webhook_id)`.

Test deliveries sent through `POST /api/v1/webhooks/{id}/test` do not consume
that outbound bucket.

### Subscriptions with Retired Event Names

The webhook API no longer offers `time.entry.*`, `invoice.*`, `asset.*`, `system.*`, `workflow.*`, or `custom.event`. Alga never delivered these events.

Webhooks that already store one of these names keep working:

- The row is kept as it is. Nothing is migrated or deleted.
- Reading or listing the webhook never fails because of the name.
- The name never receives a delivery, so it never causes a failed delivery or counts toward auto-disable.
- On update, a retired name that is already stored can stay in `event_types`. Adding a retired name that is not already stored is rejected with `400`.
- Creating a webhook with any unknown event name is rejected with `400`.
- The admin UI lists retired names in a separate "no longer supported" group. Remove them when you are ready; they do nothing.

Call `GET /api/v1/webhooks/events` for the current list of names you can subscribe to.

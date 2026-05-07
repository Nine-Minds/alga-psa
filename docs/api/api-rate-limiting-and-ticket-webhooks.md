# API Rate Limiting And Ticket Webhooks

This document covers two related public API behaviors:

- Authenticated `/api/v1/*` requests are protected by per-key rate limiting.
- Ticket lifecycle events can be delivered to tenant-managed outbound webhooks.

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
      "is_internal": false
    }
  }
}
```

Comment payloads never include attachments.

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

### Per-Webhook Outbound Rate Limit

Webhook delivery also has an outbound cap per webhook. The default is
`100 deliveries per minute` per `(tenant, webhook_id)`.

Test deliveries sent through `POST /api/v1/webhooks/{id}/test` do not consume
that outbound bucket.

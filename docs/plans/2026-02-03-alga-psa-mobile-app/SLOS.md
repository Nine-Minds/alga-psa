# Mobile API SLOs (MVP)

These SLOs are initial targets for Alga-hosted environments for the Mobile Ticketing MVP.
They are intended to be measured from **server-side metrics** where possible, and correlated with **mobile telemetry** (`api.request.succeeded` / `api.request.failed`) for end-to-end experience.

## Definitions

- **Scope**: Alga-hosted only (V1).
- **Population**: authenticated mobile clients (`x-alga-client` prefixed with `mobile/`).
- **Latency**: server-side route latency (preferred) and end-to-end mobile-observed duration (supplemental).
- **Percentiles**: p50 / p95 / p99.
- **Error rate**: % of requests resulting in 5xx or network/timeout at the client.

## SLOs (targets)

### Ticket list

- Route: `GET /api/v1/tickets` (mobile list DTO: `fields=mobile_list`)
- Latency (server): p95 ≤ 800ms, p99 ≤ 1500ms
- Error rate: ≤ 0.5% 5xx over 30 days

### Ticket detail

- Route: `GET /api/v1/tickets/:id`
- Latency (server): p95 ≤ 900ms, p99 ≤ 1800ms
- Error rate: ≤ 0.5% 5xx over 30 days

### Ticket comments

- Route: `GET /api/v1/tickets/:id/comments`
- Latency (server): p95 ≤ 900ms, p99 ≤ 1800ms
- Error rate: ≤ 0.5% 5xx over 30 days

### Mutations (core)

- Add comment: `POST /api/v1/tickets/:id/comments` → p95 ≤ 1200ms, p99 ≤ 2500ms
- Change status: `PUT /api/v1/tickets/:id/status` → p95 ≤ 1200ms, p99 ≤ 2500ms
- Assign/unassign: `PUT /api/v1/tickets/:id/assignment` → p95 ≤ 1200ms, p99 ≤ 2500ms
- Update fields: `PUT /api/v1/tickets/:id` → p95 ≤ 1500ms, p99 ≤ 3000ms
- Error rate (mutations): ≤ 0.8% 5xx over 30 days

### Mobile auth (handoff + refresh)

- OTT exchange: `POST /api/v1/mobile/auth/exchange` → p95 ≤ 900ms, p99 ≤ 1800ms
- Refresh: `POST /api/v1/mobile/auth/refresh` → p95 ≤ 900ms, p99 ≤ 1800ms
- Error rate: ≤ 0.3% 5xx over 30 days

## Measurement notes

- Server-side: track latency and error rate per route + tenant, with a `mobile` dimension derived from `x-alga-client`.
- Mobile-side: use `api.request.succeeded` and `api.request.failed` events:
  - `path` is normalized (`:id`) to allow route aggregation without leaking IDs.
  - `durationMs` captures client-observed duration including retry delays.
- Alerting should use server-side metrics; mobile telemetry is used for validation and debugging.


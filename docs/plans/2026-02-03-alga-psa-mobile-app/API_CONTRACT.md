# Mobile API Contract (Ticketing MVP)

Last updated: 2026-02-03

This document describes the REST API surface used by the React Native mobile app (`mobile/`) for the Ticketing MVP.

## Authentication (mobile)

### Web sign-in + mobile OTT

- Browser login: `GET /auth/signin` (SSO providers as configured)
- Mobile handoff: `GET /auth/mobile/handoff?redirect={deepLink}&state={state}`
  - Redirects to `redirect` with `ott` + `state` query params

### Mobile token exchange/refresh

- `GET /api/v1/mobile/auth/capabilities`
- `POST /api/v1/mobile/auth/exchange`
- `POST /api/v1/mobile/auth/refresh`
- `POST /api/v1/mobile/auth/revoke`

### API key usage for ticket APIs

Mobile uses a short-lived API key for API v1 routes:

- Header: `x-api-key: {accessToken}`
- Header: `x-tenant-id: {tenantId}` (recommended; required for some validation paths)

## Ticketing APIs

### List tickets

`GET /api/v1/tickets`

Query params (mobile):

- Pagination: `page`, `limit`
- Sorting: `sort`, `order`
- Search: `search`
- Filters:
  - `is_open=true|false`
  - `is_closed=true|false`
  - `assigned_to={userId}`
  - `has_assignment=true|false`
  - `priority_name={string}`
  - `status_name={string}`
  - `updated_from={ISO datetime}`
  - `updated_to={ISO datetime}`
- Field selection:
  - `fields=mobile_list` (recommended for mobile list payload)

### Ticket stats

`GET /api/v1/tickets/stats`

Returns aggregate counts (open/unassigned/overdue).

### Ticket detail

`GET /api/v1/tickets/{ticketId}`

Returns ticket fields and additional joined fields as available.

### Ticket comments

- `GET /api/v1/tickets/{ticketId}/comments`
  - Supports pagination in the mobile client (client-side paging today).
- `POST /api/v1/tickets/{ticketId}/comments`
  - Body: `{ comment_text: string, is_internal: boolean }`

### Statuses + update

- `GET /api/v1/tickets/statuses`
- `PUT /api/v1/tickets/{ticketId}/status`
  - Body: `{ status_id: string }`

### Assignment

`PUT /api/v1/tickets/{ticketId}/assignment`

Body: `{ assigned_to: string | null }`

### Priorities

- `GET /api/v1/tickets/priorities`
- Priority update uses `PUT /api/v1/tickets/{ticketId}` with `{ priority_id }`

### Partial update (attributes)

`PUT /api/v1/tickets/{ticketId}`

Used by mobile for updating `attributes` (e.g. due date, watchers).

### Time entry create

`POST /api/v1/time-entries`

Used by mobile to create a time entry linked to a ticket (`work_item_type=ticket`, `work_item_id={ticketId}`).


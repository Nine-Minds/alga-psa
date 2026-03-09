# PRD — Alga PSA n8n Ticket Node CRUD

- Slug: `n8n-ticket-node-crud`
- Date: `2026-02-16`
- Status: Draft

## Summary

Build and publish a new npm-distributed n8n community node package for Alga PSA with a single `Alga PSA` node that supports ticket CRUD, ticket comments, and helper lookup operations.

The v1 node will use one credential (`baseUrl` + `apiKey`) and expose:

- Ticket operations: Create, Get by ID, List, Search, Update, Update Status, Update Assignment, Delete, List Comments, Add Comment.
- Helper operations: List Clients, List Boards, List Statuses, List Priorities.
- Dynamic dropdowns for required ticket reference fields (`client_id`, `board_id`, `status_id`, `priority_id`) with manual UUID fallback.

## Problem

Alga PSA users who want automation in n8n currently need to use generic HTTP Request nodes, manually model request payloads, and discover IDs for required ticket fields. This is error-prone and slows down workflow creation.

## Goals

1. Provide a first-party-feeling `Alga PSA` n8n node for ticket CRUD operations.
2. Make the package installable by Alga PSA users via npm without requiring n8n community-portal verification.
3. Minimize setup friction with a single credential and dynamic lookup dropdowns.
4. Support real-world ticket workflow patterns by including status and assignment update operations.
5. Support common ticket collaboration workflows by allowing comment creation and comment retrieval on existing tickets.
6. Return predictable outputs for downstream n8n nodes, including delete behavior.

## Non-goals

- n8n trigger/webhook node support in v1.
- Public submission/verification to n8n community directory in v1.
- Full CRUD for non-ticket resources (clients/boards/statuses/priorities are read-only helpers in v1).
- OAuth2 credential flow in v1.
- Additional ticket-adjacent operations beyond list/add comments (comment update/delete, stats, from-asset) in v1.

## Users and Primary Flows

Primary users:

- MSP operators and automation engineers running self-hosted n8n.
- Alga PSA admins creating internal workflow automations.

Primary flows:

1. Install package from npm on self-hosted n8n and restart n8n.
2. Add `Alga PSA` credential (`baseUrl`, `apiKey`).
3. Build workflow with `Ticket -> Create` using dropdown-selected client/board/status/priority.
4. Build workflow with `Ticket -> List/Search` then branch to `Update Status` or `Update Assignment`.
5. Build workflow with `Ticket -> Add Comment` to append automation notes or customer-facing updates to an existing ticket.
6. Build workflow with `Ticket -> List Comments` to inspect or branch on ticket conversation history.
7. Build cleanup workflows using `Ticket -> Delete` with explicit output for downstream steps.

## UX / UI Notes

- One node name: `Alga PSA`.
- Resource-first UX: `Ticket`, `Client`, `Board`, `Status`, `Priority`.
- Operation list should only show operations valid for selected resource.
- Ticket create/update forms should prioritize commonly-used fields and group optional fields under additional options.
- Ticket comment operations should remain under the `Ticket` resource rather than introducing a separate comment resource.
- `Add Comment` should only expose fields that Alga PSA currently persists (`comment_text`, optional `is_internal`) and must not expose stale fields that are ignored server-side.
- Dropdown-backed fields must still allow manual UUID entry when lookup calls fail.
- Error messages should preserve Alga API details (`error.code`, `error.message`, `error.details`) in n8n-friendly format.

## Requirements

### Functional Requirements

1. Implement package scaffold compatible with n8n custom/community node loading conventions.
2. Implement credential type with fields:
   - `baseUrl`
   - `apiKey` (secret)
3. All requests must include `x-api-key` header and use configured `baseUrl`.
4. Implement `Ticket -> Create` mapped to `POST /api/v1/tickets`.
5. Implement `Ticket -> Get` mapped to `GET /api/v1/tickets/{id}`.
6. Implement `Ticket -> List` mapped to `GET /api/v1/tickets` with filters + pagination options.
7. Implement `Ticket -> Search` mapped to `GET /api/v1/tickets/search`.
8. Implement `Ticket -> Update` mapped to `PUT /api/v1/tickets/{id}` (partial payload support).
9. Implement `Ticket -> Update Status` mapped to `PUT /api/v1/tickets/{id}/status`.
10. Implement `Ticket -> Update Assignment` mapped to `PUT /api/v1/tickets/{id}/assignment`.
11. Implement `Ticket -> Delete` mapped to `DELETE /api/v1/tickets/{id}`.
12. Implement `Ticket -> List Comments` mapped to `GET /api/v1/tickets/{id}/comments`.
13. Implement `Ticket -> Add Comment` mapped to `POST /api/v1/tickets/{id}/comments`.
14. `Ticket -> Add Comment` must send `comment_text` and may optionally send `is_internal`.
15. `Ticket -> List Comments` must expose optional `limit`, `offset`, and `order` query parameters matching the existing API contract.
16. Do not expose `time_spent` in the n8n node because the current Alga PSA ticket comment implementation does not persist or consume it.
17. Implement helper resources:
  - `Client -> List` -> `GET /api/v1/clients`
  - `Board -> List` -> `GET /api/v1/boards`
  - `Status -> List` -> `GET /api/v1/statuses`
  - `Priority -> List` -> `GET /api/v1/priorities`
18. Implement dynamic load-options for `client_id`, `board_id`, `status_id`, `priority_id` in ticket create/update operations.
19. Implement manual UUID fallback entry when load-options cannot populate values.
20. Normalize outputs so successful operations provide usable JSON payloads and delete returns a non-empty success object.
21. Support n8n Continue On Fail behavior for item-level failures.

### Non-functional Requirements

- Use declarative-first node design where feasible; use programmatic logic only where needed for request/response shaping and load-options.
- Ensure compatibility with self-hosted n8n installation paths documented by n8n.
- Maintain readable, stable parameter naming aligned with Alga API payload fields.
- Keep scope to core functionality only; exclude observability/metrics hardening unless later requested.

## Data / API / Integrations

Alga API dependencies (existing in this repo):

- Ticket routes:
  - `GET /api/v1/tickets`
  - `POST /api/v1/tickets`
  - `GET /api/v1/tickets/{id}`
  - `PUT /api/v1/tickets/{id}`
  - `DELETE /api/v1/tickets/{id}`
  - `GET /api/v1/tickets/search`
  - `PUT /api/v1/tickets/{id}/status`
  - `PUT /api/v1/tickets/{id}/assignment`
  - `GET /api/v1/tickets/{id}/comments`
  - `POST /api/v1/tickets/{id}/comments`
- Lookup routes:
  - `GET /api/v1/clients`
  - `GET /api/v1/boards`
  - `GET /api/v1/statuses`
  - `GET /api/v1/priorities`

Known ticket create requirements:

- Required: `title`, `client_id`, `board_id`, `status_id`, `priority_id`.
- Optional include: `location_id`, `contact_name_id`, `category_id`, `subcategory_id`, `assigned_to`, `url`, `attributes`, `tags`.

Known ticket comment requirements:

- `POST /api/v1/tickets/{id}/comments` accepts `comment_text` and optional `is_internal`.
- The API schema currently mentions `time_spent`, but the ticket comment service and `comments` table do not persist or use it; the n8n node should not expose it.
- `GET /api/v1/tickets/{id}/comments` supports optional `limit`, `offset`, and `order`.

Auth model:

- Required header: `x-api-key`.
- `x-tenant-id` is not part of v1 credential UX and is omitted unless required by future tenant-routing changes.

## Security / Permissions

- API key is stored via n8n credential secrets, not plain text node parameters.
- Node must surface auth and RBAC failures clearly:
  - `401` invalid/missing key
  - `403` key user lacks permissions
- Node must not log raw API key values.

## Observability

- v1 scope is limited to node-level error surfaces in n8n executions.
- No additional telemetry/metrics/logging features are included in this plan.

## Rollout / Migration

1. Build and publish npm package under valid n8n naming rules (`n8n-nodes-*` or `@org/n8n-nodes-*`).
2. Document installation options for self-hosted n8n (GUI npm install, manual CLI install).
3. Document that unverified community nodes are self-hosted only and not available on n8n Cloud.
4. Provide a minimal release note and upgrade guidance for future versions.

## Open Questions

1. Final npm package name/scope (`n8n-nodes-alga-psa` vs scoped org package) for best discoverability.
2. Exact minimum n8n version we will officially support in README.
3. Whether to include optional `x-tenant-id` credential field in v1.1 if users report tenant routing ambiguity.

## Acceptance Criteria (Definition of Done)

1. Package can be installed from npm into a self-hosted n8n instance and node appears in UI.
2. Credential setup requires only `baseUrl` and `apiKey` and authenticates against Alga APIs.
3. Ticket CRUD operations execute successfully end-to-end against Alga APIs.
4. Ticket list/search operations return structured outputs usable by downstream n8n nodes.
5. Required ticket reference fields are selectable via dynamic dropdowns with manual UUID fallback.
6. Helper list operations for clients/boards/statuses/priorities are available and functional.
7. Ticket comment list/add operations execute successfully against the existing Alga PSA ticket comment APIs.
8. `Add Comment` only exposes fields backed by current Alga PSA behavior and does not present unsupported `time_spent` UI.
9. Error handling exposes actionable API error details in n8n execution output.
10. Delete operation returns a usable success payload for downstream workflow steps.
11. README includes installation and usage guidance for Alga users, including self-hosted limitation notes.

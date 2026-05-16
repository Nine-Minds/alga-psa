# PRD — Inbound Webhooks

- Slug: `2026-05-11-inbound-webhooks`
- Date: `2026-05-11`
- Status: Draft

## Summary

Add user-configurable inbound webhook endpoints to Alga PSA so MSPs can wire external systems (RMM alerts, accounting platforms, Zapier/n8n, custom integrations) into Alga without writing code. Each inbound webhook accepts authenticated HTTP requests, verifies them, dedupes replays, logs the delivery, and dispatches the payload to one of two handlers:

1. **Direct action** — invoke a canned operation (create ticket, update ticket by external ref, upsert asset, mark invoice paid) with field-level mapping from the payload.
2. **Workflow trigger** — start an Alga workflow with a normalized envelope containing the body, headers, and verification metadata.

Outbound webhooks already exist; this work surfaces both inbound and outbound under a unified Settings → Webhooks page.

## Problem

Today, the only way to move data *into* Alga from external systems is the public REST API or one of the **purpose-built** integrations (NinjaOne RMM, Tactical RMM, Tanium, Xero, QBO, Entra, Microsoft Graph, Google). Those bundled integrations work well for the systems they cover but don't help MSPs who:

- Use an RMM Alga doesn't have a bundled integration for (e.g. N-able, Auvik, Liongard, Kaseya, Pulseway, or in-house monitoring).
- Run custom internal tooling (scripts, dashboards, alerting glue) that emits JSON over HTTP.
- Use automation platforms (Zapier, n8n, Make) where the only thing required is a URL that accepts a webhook.
- Want a non-RMM signal to drive an Alga action (e.g. SIEM alert → ticket, build failure → ticket, payment gateway event → invoice paid for a payment processor we don't bundle).

The existing bundled integrations already use inbound webhook patterns internally (NinjaOne has `webhookHandler.ts` + `alertProcessor.ts` + `ticketCreator.ts`; Tactical RMM stores a webhook secret). This work generalizes the pattern: any MSP admin can wire any HTTP source to any Alga entity action or workflow without code.

Result: integration friction is the #1 reason MSPs report Alga "doesn't fit our stack."

## Goals

- MSP admins can create, edit, and delete inbound webhook configurations from Settings → Webhooks.
- Each inbound webhook has a unique URL, a configurable authentication scheme, and a handler (direct action OR workflow).
- Verified payloads are persisted, deduped, and visible in a delivery log with replay capability.
- **Direct-action coverage spans the major mutable entities** — tickets, clients, contacts, assets, invoices, time entries, project tasks, plus a cross-cutting tag action. An action **registry pattern** lets any `@alga-psa/*` package contribute additional actions without touching the inbound webhook core.
- External-ID lookup for "update by external reference" operations uses the **existing** `tenant_external_entity_mappings` table — no new per-entity `external_ref` columns.
- Workflow handlers receive a parsed, normalized envelope that includes raw body and headers, so workflow authors don't reimplement parsing.
- Field mapping reuses the existing workflow expression editor (JSONata + Monaco) — no new mapping UI is built from scratch.
- Asset upsert via inbound webhook reuses the existing `ingestNormalizedRmmDeviceSnapshot` pipeline (used by Tanium, NinjaOne, Tactical RMM) so device data flows through the same normalization path as bundled RMM integrations.

## Non-goals

- Per-source presets (preconfigured templates for specific RMM/accounting vendors). v1 ships generic config only; presets land in v2 once we see real-world payload shapes from custom configurations.
- Refactoring existing bundled integrations (NinjaOne, Tactical RMM, Tanium, Xero, QBO, Entra) to ride on the user-configurable system. They continue working as today. Consolidation is a separate v2+ effort.
- Visual drag-drop field mapper. JSONata text editor (already used in workflow editor) is the only mapping UX.
- Per-source normalizer shims. The "normalized envelope" is identity in v1: `{source: slug, body, headers, verified, delivery_id}`.
- Public Zapier/n8n/Make app listings in their directories. The inbound endpoint *enables* those integrations; building distributable apps is separate work.
- Outbound webhook feature changes beyond UI re-layout (tabbed under Settings → Webhooks).
- Multi-handler chains per webhook (run action AND workflow). One handler per webhook in v1.
- Client Portal webhook configuration. MSP portal only.
- Bidirectional sync semantics — inbound webhooks are one-way (external → Alga). Writing back to external systems is a separate outbound-webhook concern.

## Users and Primary Flows

**Primary persona:** MSP Admin (technical, comfortable with HTTP/JSON, may not be a developer).

**Flow A — Wire RMM alert to create a ticket (direct action):**
1. Admin navigates to Settings → Webhooks → Inbound tab → "New Webhook."
2. Names it ("ConnectWise Alerts"), picks auth method (HMAC-SHA256), generates a secret.
3. Picks handler type "Direct Action," selects "Create Ticket" from action dropdown.
4. UI renders the target field list for `createTicket` (title, description, priority, asset_id, external_ref, etc.). Each target field has an `ExpressionTextArea` for JSONata mapping.
5. Admin captures a sample payload by sending one test request to the URL (capture mode). The expression editor's autocomplete now suggests paths from the captured sample.
6. Admin maps `title` ← `alert.message`, `priority` ← `alert.severity`, `external_ref` ← `alert.id`, etc.
7. Saves. Copies URL + secret into ConnectWise.
8. Real alert arrives → verified → mapped → ticket created. Delivery shows in the log.

**Flow B — Wire alert to a workflow (workflow handler):**
1. Same setup as A, but handler type "Workflow."
2. Admin picks an existing workflow from a dropdown (e.g. "Triage Critical Alert").
3. Payload arrives → workflow starts with `context.input = { source: "connectwise-alerts", body: {...}, headers: {...}, verified: true, delivery_id, idempotency_key }`.
4. Workflow branches, calls actions, creates tickets, pages on-call.

**Flow C — Debug a failed delivery:**
1. Admin opens delivery log row → sees full request body, headers, response, latency, error.
2. Clicks "Replay" → request is re-dispatched against current config (with current mapping/handler).
3. Replay shows as a new delivery row marked as a replay.

## UX / UI Notes

- Existing `AdminWebhooksSetup.tsx` (Settings → Security) becomes the **Outbound** tab in a new `AdminWebhooksSetup` containing two tabs (`Inbound` | `Outbound`). No regressions to outbound feature set.
- Inbound list view mirrors outbound: table with name, URL, handler type, last delivery, active state, kebab menu.
- Inbound create/edit dialog has sections: Identity (name, slug), Auth (method + config), Idempotency (key source), Handler (type + action/workflow + mapping), Active.
- Handler section is conditional:
  - `Direct Action`: dropdown of supported actions; below that, the action's target fields rendered as labeled `ExpressionTextArea` rows. A side panel shows the captured sample payload tree for click-to-insert path.
  - `Workflow`: dropdown of tenant's workflows; an info card explains the envelope shape the workflow receives.
- Sample payload capture: button "Capture sample request" toggles a 5-minute capture window. The first verified request lands in the editor as the schema source. Re-capture overwrites.
- Delivery log: identical shape to outbound delivery log (drawer with request/response, replay button).
- All strings via `t('translation.key')` (i18n requirement per CLAUDE.md).
- All interactive elements need `id` attributes (UI reflection requirement per CLAUDE.md).

## Requirements

### Functional Requirements

**Configuration:**
- F-CRUD inbound webhook configs: name, slug (URL-safe, unique per tenant), is_active, description.
- F-Auth schemes: HMAC-SHA256 (configurable signature header name + secret), Bearer token, IP allowlist (CIDR list), Shared-secret-in-path (`?token=`).
- F-Auth secrets stored in the secrets vault; never returned in API responses after creation.
- F-Idempotency key source: HTTP header name (e.g. `X-Idempotency-Key`) OR JSONata expression evaluated on the body (e.g. `alert.id`). Configurable per webhook.
- F-Duplicate detection: within a configurable window (default 24h), same idempotency key returns `200 OK` no-op without re-dispatching.

**Endpoint:**
- F-Catch-all route: `POST /api/inbound/[tenant_slug]/[webhook_slug]` (also accepts `PUT`, `PATCH` if the source needs it).
- F-Tenant slug resolution from URL → tenant context bootstrapped before further processing.
- F-Auth verification per config; rejected requests get `401` with no body details (avoid leaking config).
- F-Successful verification stores a delivery row before dispatch (so failed dispatches are still visible).
- F-Response: `200 OK` with `{delivery_id}` on accepted; `4xx` for auth/validation; `5xx` for internal dispatch failure.

**Direct Action Handler:**
- F-Action **registry pattern**: each `@alga-psa/*` package contributes inbound-callable actions via a typed registration (`name`, `entityType`, `targetFields[]`, `handle()`). Core lives in `server/src/lib/inboundWebhooks/actions/registry.ts`.
- F-V1 ships the following actions:
  - **Tickets**: `createTicket`, `updateTicketByExternalId`, `addTicketCommentByExternalId`, `changeTicketStatusByExternalId`
  - **Clients**: `upsertClientByExternalId`, `setClientActiveByExternalId`
  - **Contacts (client_users)**: `upsertContactByExternalId`
  - **Assets**: `upsertAssetByExternalId` — routes through existing `ingestNormalizedRmmDeviceSnapshot` from `@alga-psa/integrations/lib/rmm/sharedAssetIngestionService` when payload is flagged as an RMM device snapshot; otherwise plain asset upsert
  - **Invoices**: `markInvoicePaidByExternalId`, `updateInvoiceStatusByExternalId`
  - **Time Entries**: `createTimeEntry`
  - **Project Tasks**: `createProjectTask`, `updateProjectTaskStatusByExternalId`
  - **Cross-cutting**: `addTagToEntityByExternalId` (accepts target entity_type)
- F-Action selector dropdown in UI, grouped by entity type.
- F-Each action declares its target field list (typed: string, int, enum, ref-to-entity), with required/optional flags.
- F-Field mapping: each target field is a JSONata expression evaluated against the request body.
- F-`*ByExternalId` actions look up the target entity via `tenant_external_entity_mappings` using `integration_type = webhook_slug`, `alga_entity_type = <ticket|client|asset|...>`, `external_entity_id = <mapped value>`. **No new `external_ref` columns are added to entity tables.**
- F-Create actions (`createTicket`, `upsertClient*`, `upsertContact*`, `upsertAsset*`) MAY optionally write a mapping row when an `external_id` field is mapped — so subsequent webhooks can resolve back to the created entity.
- F-Lookup miss on `update*` / `addComment*` / `markPaid*` actions returns a failed delivery (not silent no-op).
- F-Validation errors (missing required mapped field, type mismatch) record a failed delivery with a clear error message.

**Workflow Handler:**
- F-Workflow selector dropdown (lists tenant's workflows).
- F-Payload envelope: `{ source: webhook_slug, body: parsed_json, headers: filtered_safe_headers, verified: true, delivery_id, idempotency_key, received_at }`.
- F-Workflow run is triggered with the envelope as `context.input`.
- F-Workflow failure does NOT mark inbound delivery failed; the delivery's job was to start the workflow, not complete it. Delivery log links to the workflow run for debugging.

**Field Mapping UX (reuse workflow expression editor):**
- F-Reuse `ExpressionTextArea` and `ExpressionEditor` from `ee/server/src/components/workflow-designer/`.
- F-New webhook payload context adapter (`webhookPayloadContextAdapter.ts`) that introspects a captured sample payload to feed autocomplete.
- F-Sample payload capture: a "capture next request" mode that stores the first verified body to the webhook config; the editor reads from this for autocomplete.
- F-Editor diagnostics: invalid JSONata path → inline warning. Type mismatch (e.g. mapping string to int field) → inline warning.

**Delivery Log:**
- F-Persist every verified request: request body, headers (filtered), response status, response body, latency, handler outcome, error message, retry count.
- F-Auth-rejected requests logged separately with limited detail (no body) to support abuse triage.
- F-List view filtered by webhook, date range, status.
- F-Detail drawer mirrors outbound's.
- F-Replay button re-dispatches against current config; result is a new delivery row tagged `is_replay=true`, `replayed_from=<original_id>`.

**Permissions:**
- F-New permission resource `inbound_webhook` with `create`, `read`, `update`, `delete`, `replay` actions.
- F-Outbound webhook permissions unchanged.
- F-`admin` role gets full inbound_webhook permissions by default.

### Non-functional Requirements

- N-Multi-tenant isolation: all queries scoped by `tenant`; slug uniqueness enforced per-tenant.
- N-Auth failures are constant-time where possible (HMAC compare via `crypto.timingSafeEqual`).
- N-Rate limit: per-webhook configurable limit (default 600/min), Redis-backed token bucket. Distinct from outbound rate limiter — share the bucket implementation, not the instance.
- N-Storage: raw delivery body retained 30 days, then truncated to a fixed-size head + metadata; status/idempotency keys retained longer for dedup integrity.
- N-Webhook URL slugs are URL-safe ASCII; tenant slug derives from existing tenant identifier (must already exist or we add one).

## Data / API / Integrations

### New tables

- `inbound_webhooks`
  - `inbound_webhook_id` (pk, uuid), `tenant` (fk, **always in pk** per CitusDB rule), `name`, `slug`, `description`
  - `auth_type` (enum: hmac_sha256, bearer, ip_allowlist, path_token)
  - `auth_config` (jsonb: per-type — signature header, secret_vault_path, ip_cidrs, etc.)
  - `idempotency_source` (jsonb: `{type: 'header'|'jsonata', value: string}`)
  - `idempotency_window_seconds` (default 86400)
  - `handler_type` (enum: direct_action, workflow)
  - `handler_config` (jsonb: for direct_action `{action: string, field_mapping: {field: jsonata_expression}}`; for workflow `{workflow_id}`)
  - `sample_payload` (jsonb, nullable — captured sample for autocomplete)
  - `is_active`, `auto_disabled_at`, `created_at`, `updated_at`, `created_by`

- `inbound_webhook_deliveries`
  - `delivery_id` (pk), `tenant` (in pk), `inbound_webhook_id` (fk)
  - `idempotency_key` (nullable), `received_at`
  - `request_method`, `request_path`, `request_headers` (jsonb, filtered), `request_body` (jsonb or text)
  - `source_ip`, `user_agent`
  - `auth_status` (verified | rejected_signature | rejected_bearer | rejected_ip | rejected_no_auth)
  - `dispatch_status` (pending | dispatched | duplicate | failed)
  - `handler_outcome` (jsonb: action result or workflow_run_id, error message)
  - `response_status`, `response_body`, `duration_ms`
  - `is_replay`, `replayed_from` (nullable fk)

### Reused existing tables

- **`tenant_external_entity_mappings`** (already exists; migration `20250502173321_create_tenant_external_entity_mappings.cjs`) is the canonical external-ID-to-Alga-entity lookup. The inbound webhook system uses `integration_type = <webhook_slug>` to namespace mappings per webhook config.
- Schema: `(tenant_id, integration_type, alga_entity_type, alga_entity_id, external_entity_id, external_realm_id, sync_status, last_synced_at, metadata)`.
- Unique indexes guarantee `(tenant_id, integration_type, alga_entity_type, alga_entity_id)` is one-to-one with the external side.
- **No new `external_ref` columns are added to `tickets`, `assets`, `invoices`, etc.** Lookups go through this table.

### Asset ingestion reuse

- `upsertAssetByExternalId` delegates to `ingestNormalizedRmmDeviceSnapshot` from `@alga-psa/integrations/lib/rmm/sharedAssetIngestionService` when the mapped payload conforms to the device-snapshot shape — same path used by Tanium, NinjaOne, and Tactical RMM. For non-device assets, a simpler `assets` upsert is used.

### Server actions (in `server/src/lib/actions/inboundWebhookActions.ts`)

- `listInboundWebhooks()`, `getInboundWebhook(id)`, `upsertInboundWebhook(input)`, `deleteInboundWebhook(id)`
- `rotateInboundWebhookSecret(id)`, `setInboundWebhookActiveState(id, active)`
- `listInboundDeliveries(filter, page)`, `getInboundDelivery(id)`, `replayInboundDelivery(id)`
- `captureSamplePayload(id)` (toggles capture mode), `clearSamplePayload(id)`
- `sendInboundWebhookTest(id, body, headers)` (synthetic request for UI testing)
- All wrapped in `withAuth` per CLAUDE.md pattern.

### Inbound HTTP route

- `server/src/app/api/inbound/[tenantSlug]/[webhookSlug]/route.ts`
- Handlers for `POST`, `PUT`, `PATCH`.
- Tenant resolution → config lookup → auth → idempotency → persist delivery → dispatch → respond.

### Public REST API and OpenAPI registration

The inbound webhook system has two API surfaces that must be registered in the OpenAPI spec at `server/src/lib/api/openapi/registry.ts` and a new file `server/src/lib/api/openapi/routes/inboundWebhooks.ts`:

**Management API** (mirrors outbound webhook API at `/api/v1/webhooks/*`):
- `GET    /api/v1/inbound-webhooks` — list
- `POST   /api/v1/inbound-webhooks` — create
- `GET    /api/v1/inbound-webhooks/{id}` — read
- `PUT    /api/v1/inbound-webhooks/{id}` — update
- `DELETE /api/v1/inbound-webhooks/{id}` — delete
- `POST   /api/v1/inbound-webhooks/{id}/rotate-secret`
- `POST   /api/v1/inbound-webhooks/{id}/test` — synthetic dispatch
- `POST   /api/v1/inbound-webhooks/{id}/capture-sample` / `DELETE` — sample capture toggle
- `GET    /api/v1/inbound-webhooks/{id}/deliveries` — delivery log list
- `GET    /api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}`
- `POST   /api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}/replay`

**Action discovery API:**
- `GET    /api/v1/inbound-webhooks/actions` — returns the registered action set: `[{ name, entityType, displayName, description, targetFields: [{name, type, required, description, enumValues?}] }]`. Lets SDK clients and external tooling build mapping UIs without hardcoding the action list.

**Receiver endpoint:**
- `POST   /api/inbound/{tenantSlug}/{webhookSlug}` — registered as a single templated entry. Body is `application/json` (per-webhook shape varies). Documented headers: signature header (configurable name), idempotency key header, content-type. Response codes: 200, 401, 409 (duplicate idempotency), 429, 4xx, 5xx. Response body: `{delivery_id}` on success.

**Schemas registered in OpenAPI components:**
- `InboundWebhookConfig`, `InboundWebhookCreateInput`, `InboundWebhookUpdateInput`
- `InboundWebhookAuthConfig` (discriminated union by `auth_type`)
- `InboundWebhookHandlerConfig` (discriminated union by `handler_type`)
- `InboundWebhookDelivery`
- `InboundActionDefinition`, `InboundActionTargetField`
- `WorkflowWebhookEnvelope` — the envelope shape workflow handlers receive (`{source, body, headers, verified, delivery_id, idempotency_key, received_at}`)

**Generation and validation:**
- After registration, `sdk/scripts/generate-openapi.ts` regenerates `alga-openapi.{ce,ee}.{yaml,json}`.
- New contract tests under `server/src/test/unit/api/` follow the `projectTasksOpenApi.contract.test.ts` pattern: assert handler types match the registered schema.
- Generated SDK clients (in `sdk/`) pick up the new endpoints on next generation.

### Action handler registry

- `server/src/lib/inboundWebhooks/actions/registry.ts` — central registry with `registerAction(def)` and `listActions()`.
- Each action exports `{ name, entityType, displayName, description, targetFields[], handle(ctx, mapped_values) }`.
- Actions live alongside the entity they target (e.g. `packages/tickets/src/actions/inboundActions.ts`, `packages/clients/src/actions/inboundActions.ts`) and call into the same internal handlers used by existing server actions. The registry imports each package's contributions at startup.
- UI dropdown is grouped by `entityType` and populated dynamically from the registry.
- Adding a new action in v2+ is a single file in the relevant package + a `registerAction()` call — no inbound webhook core changes needed.

### Workflow trigger integration

- Identify the workflow engine's external-trigger entrypoint (likely an event bus publish or direct `startWorkflow`).
- Implementation note: `webhookSubscriber.ts` pattern is for outbound only; inbound needs the reverse direction. Spike during implementation.

### Expression editor reuse

- Import `ExpressionTextArea` from `ee/server/src/components/workflow-designer/mapping/`.
- New context adapter at `shared/workflow/expression-authoring/adapters/webhookPayloadContextAdapter.ts` that returns the captured sample's path tree.

## Security / Permissions

- New permission `inbound_webhook` with `create | read | update | delete | replay`.
- HMAC verification uses `crypto.timingSafeEqual`.
- Bearer comparison also timing-safe.
- Auth secrets in vault, never returned in API responses (only at creation, one-time display).
- Auth-rejected requests log limited detail (no body) — separate retention so they can be purged faster.
- Sample payloads may contain PII (device names, financial data) — mark as sensitive; only retrievable by webhook owner; redact obvious patterns (credit card-like, email-like) on display? **Open question.**
- Slug enumeration: 401 responses identical for "unknown slug" vs "bad auth" to avoid leaking which webhooks exist.

## Rollout / Migration

- One migration creates `inbound_webhooks` and `inbound_webhook_deliveries` (Citus-distributed by `tenant`).
- Migrations to add `external_ref`/`external_id` columns are additive, nullable, indexed.
- New `inbound_webhook` permission seeded into the existing role-permission seed for `admin` role.
- Settings page UI changes are tabbed; existing outbound users see no behavior change, just a new tab.
- Feature flag `inbound_webhooks_enabled` (PostHog) to gate the Settings UI tab and the `/api/inbound/*` route. Default off for first release; enable per-tenant for early MSPs.

## Open Questions

1. **Workflow trigger entrypoint** — does the engine accept synchronous `startWorkflow(workflowId, input)` calls, or must inbound dispatch via an event bus publish? Reference existing inbound trigger paths in NinjaOne (`alertProcessor.ts`) which may already invoke workflows. Spike before sprint start.
2. **Tenant slug source** — do tenants already have a URL-safe slug, or do we need to add one? Affects URL stability.
3. **Sample payload PII redaction** — do we redact on display, on capture, or trust the admin? Lean toward "no redaction, mark sensitive, admin-only access."
4. **Mapping table integration_type namespace collisions** — bundled integrations write to `tenant_external_entity_mappings` with `integration_type` values like `'ninjaone'`, `'tactical_rmm'`. User-defined webhook slugs must not collide with these reserved values. Solution: prefix user slugs with `user:` (e.g. `user:my-monitor`) or maintain a reserved-name list. Decide before F032.
5. **Replay against current config vs original config** — replaying after the mapping has changed: re-evaluate with current mapping (current plan) or store the original mapping snapshot with the delivery? Current plan = simpler, may surprise users.
6. **Action registration order / discovery** — registry needs all package contributions loaded before the dropdown renders. Static imports vs dynamic discovery? Static is simpler; dynamic supports plugins later.
7. **Optional v1 action: `attachDocumentByExternalId`** — adding a note/document to an entity is common for "this alert details" use cases. Defer to v1.1 unless user requests.
8. **Consolidation with bundled integrations** — should NinjaOne / Tactical RMM eventually consume the same user-configurable webhook plumbing (with their secrets preset)? Out of scope for v1; flag as v2 candidate.

## Acceptance Criteria (Definition of Done)

1. MSP admin can create an inbound webhook via Settings → Webhooks → Inbound, receive a URL + secret, and POST an HMAC-signed JSON request → response `200 OK` with `delivery_id`.
2. Direct action `createTicket` with a JSONata field mapping creates a ticket whose fields match the mapped payload values; if an `external_id` is mapped, a row is written to `tenant_external_entity_mappings`.
3. `updateTicketByExternalId` resolves the ticket via `tenant_external_entity_mappings` (using `integration_type = webhook_slug`) and applies status / priority / assignment / board updates per mapping.
4. Workflow handler triggers a workflow run; workflow's `context.input` matches the documented envelope shape.
5. Duplicate idempotency keys within the window return `200 OK` without re-dispatching.
6. Delivery log shows request, response, status, latency; failed deliveries show error messages.
7. Replay button creates a new delivery linked to the original.
8. JSONata expression editor (reused from workflow designer) provides autocomplete against the captured sample payload.
9. Outbound webhook feature regression: all existing outbound tests pass; UI is now tabbed but functionality unchanged.
10. Auth: HMAC, Bearer, IP-allowlist, and path-token schemes each reject mismatched requests with `401` and accept matching ones.
11. Permissions: a user without `inbound_webhook:create` cannot create inbound webhooks via the UI or server action.
12. Citus rule compliance: every query includes `tenant`; new tables use composite PKs including `tenant`.
13. i18n: no hardcoded English strings in new UI components.
14. Feature flag `inbound_webhooks_enabled` correctly gates UI and route.
15. Action registry includes all v1 actions (13 actions across 8 entity types: ticket×4, client×2, contact×1, asset×1, invoice×2, time_entry×1, project_task×2, cross-cutting tag×1) and dropdown groups them by entity type.
16. `upsertAssetByExternalId` for RMM-shaped payloads delegates to `ingestNormalizedRmmDeviceSnapshot` and produces the same asset record shape as Tanium / NinjaOne / Tactical RMM ingestion.
17. Bundled integrations (NinjaOne, Tactical RMM, Tanium, Xero, QBO, Entra) continue to function unchanged — no regressions in their existing inbound webhook paths.
18. Reserved `integration_type` values from bundled integrations cannot be used as user webhook slugs (or user slugs are namespaced to avoid collision).
19. All `/api/v1/inbound-webhooks/*` management endpoints + the templated `/api/inbound/{tenantSlug}/{webhookSlug}` receiver endpoint are registered in the OpenAPI spec; generated `alga-openapi.{ce,ee}.{yaml,json}` files include them.
20. `GET /api/v1/inbound-webhooks/actions` returns the registered action set with target field schemas; SDK consumers can build mapping UIs from this response without hardcoding actions.
21. OpenAPI contract tests pass for every new management endpoint, asserting handler types match registered schemas.

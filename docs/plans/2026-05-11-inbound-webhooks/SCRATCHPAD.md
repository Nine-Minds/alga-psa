# Scratchpad — Inbound Webhooks

- Plan slug: `2026-05-11-inbound-webhooks`
- Created: `2026-05-11`

## What This Is

Working memory for inbound webhook implementation. Capture discoveries, decisions, and gotchas as we go.

## Decisions

- (2026-05-11) **No source presets in v1.** Ship generic configurable webhooks only. Per-source presets deferred to v2 once we see actual payload shapes in production.
- (2026-05-11) **Action registry pattern, not hardcoded action list.** Core registry in `server/src/lib/inboundWebhooks/actions/registry.ts`; each `@alga-psa/*` package contributes via its own `inboundActions.ts`. v1 ships 13 actions across 8 entity types: tickets (4), clients (2), contacts (1), assets (1 with RMM/non-RMM branches), invoices (2), time entries (1), project tasks (2), cross-cutting tag (1).
- (2026-05-11) **External-ID lookup uses existing `tenant_external_entity_mappings`.** No new `external_ref` columns are added to entity tables. `integration_type` is set to the webhook slug to namespace mappings per user-defined webhook.
- (2026-05-11) **Asset upsert reuses `ingestNormalizedRmmDeviceSnapshot`** when payload is RMM-shaped — same pipeline used by Tanium, NinjaOne, Tactical RMM. Generic asset upsert path for non-device payloads.
- (2026-05-11) **Reuse workflow editor's JSONata expression authoring** (`ExpressionTextArea`, `useExpressionAutocomplete`, expression-authoring path discovery). New context adapter introspects the captured sample payload. This avoids building a separate mapping UI.
- (2026-05-11) **Workflow handler receives a normalized envelope + raw body.** Envelope: `{source, body, headers, verified, delivery_id, idempotency_key, received_at}`. Since v1 has no per-source normalizers, the envelope is "identity normalization" — body is the parsed JSON as received.
- (2026-05-11) **Settings page becomes tabbed** (Inbound | Outbound). Existing `AdminWebhooksSetup.tsx` (outbound) gets factored into the Outbound tab; no behavior changes to outbound.
- (2026-05-11) **Feature flag** `inbound_webhooks_enabled` (PostHog) gates both the Settings tab and the `/api/inbound/*` route. Default off; enable per-tenant for early adopters.
- (2026-05-11) **Replay re-evaluates with CURRENT config.** Simpler than snapshotting mapping per delivery. Document this in the UI so users know what to expect.
- (2026-05-11) **Bundled integrations stay as-is in v1.** NinjaOne / Tactical RMM / Tanium / Xero / QBO / Entra continue to use their existing code paths. Consolidation under the generic system is a v2+ candidate.

## Discoveries / Constraints

- (2026-05-11) **F001 implemented** in `server/migrations/20260511100000_create_inbound_webhooks_table.cjs`. The table uses composite PK `(tenant, inbound_webhook_id)`, unique `(tenant, slug)`, Citus distribution by `tenant`, and keeps auth secrets indirect through `auth_config` (vault path/config metadata). Added `sample_capture_expires_at` and `rate_limit_per_minute` now because later capture/rate-limit features need persistent state.
- (2026-05-11) **F002 implemented** in `server/migrations/20260511101000_create_inbound_webhook_deliveries_table.cjs`. The table uses composite PK `(tenant, delivery_id)`, indexes webhook/date, status/date, idempotency-window lookup, and replay links. `inbound_webhook_id` is nullable so rejected requests for unknown/disabled slugs can still be logged with limited detail without revealing config existence.
- (2026-05-11) **F003 implemented** in `server/src/lib/inboundWebhooks/reservedIntegrationTypes.ts`. Decision: reject reserved slugs rather than prefixing user slugs. The reserved set includes observed mapping values (`ninjaone`, `tacticalrmm`, `tanium`, `xero`, `xero_csv`, `quickbooks_online`, `quickbooks_csv`) plus PRD aliases (`tactical_rmm`, `qbo`, `entra`, Microsoft/Google aliases) to prevent future bundled integration collisions.
- (2026-05-11) **F004 implemented** in `server/src/lib/inboundWebhooks/externalEntityMappings.ts`. `lookupAlgaEntityByExternalId` queries `tenant_external_entity_mappings` with `tenant_id`, `integration_type = webhookSlug`, `alga_entity_type`, and `external_entity_id`; no entity tables get external-ref columns. The helper accepts an optional Knex instance for future transactional action handlers.
- (2026-05-11) **F005 implemented** in `server/src/lib/inboundWebhooks/externalEntityMappings.ts`. `writeEntityMapping` upserts by `(tenant_id, integration_type, alga_entity_type, alga_entity_id)`, checks first for external ID collisions in the same realm, sets `sync_status='synced'`, and accepts an optional Knex instance for transactional create actions.
- (2026-05-11) **F006 implemented** in `server/migrations/20260511102000_add_inbound_webhook_permissions.cjs` and `server/seeds/dev/47_permissions.cjs`. Added `inbound_webhook` actions `create/read/update/delete/replay` as MSP-only permissions and backfilled them onto existing MSP Admin roles. The migration intentionally does not grant Manager/Technician roles by default, matching T007.
- (2026-05-11) **F007 implemented** in `packages/core/src/lib/featureFlagRuntime.ts` and `server/src/lib/inboundWebhooks/featureFlag.ts`. `inbound_webhooks_enabled` defaults to `false` when PostHog is unavailable; later UI and receiver-route gates should call `isInboundWebhooksEnabled({ tenantId, userId })`.
- (2026-05-11) **F010 implemented** in `server/src/lib/inboundWebhooks/types.ts`. Added discriminated auth config unions, handler config unions, idempotency source types, runtime config/delivery shapes, and `WorkflowWebhookEnvelope`. Runtime-facing types use camelCase; DB mapping functions will translate from snake_case rows.
- (2026-05-11) **F011 implemented** in `server/src/lib/inboundWebhooks/schemas.ts`. Input schemas are snake_case to match server/API payloads, use discriminated unions for `auth_config` and `handler_config`, enforce matching top-level `auth_type`/`handler_type`, validate URL-safe lowercase slugs, and reject reserved integration slugs through F003 helper.
- (2026-05-11) **F012 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `listInboundWebhooks` is wrapped in `withAuth`, checks `inbound_webhook:read`, queries `inbound_webhooks` with `where({ tenant })`, orders by update time/name, maps snake_case DB rows to camelCase runtime types, and redacts any raw auth secret/token fields by returning only vault paths/config metadata.
- (2026-05-11) **F013 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `getInboundWebhook(id)` uses the same auth/permission/mapping path as list and scopes lookup by both `tenant` and `inbound_webhook_id`, so missing or cross-tenant IDs return `null`.
- (2026-05-11) **F014 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `upsertInboundWebhook` validates input with F011 schemas, checks `inbound_webhook:create/update`, enforces `(tenant, slug)` uniqueness before DB write, writes HMAC/Bearer/path-token secrets to tenant secret storage, returns the generated/provided secret once, and stores only vault path metadata in `auth_config`.
- (2026-05-11) **F015 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `deleteInboundWebhook` checks `inbound_webhook:delete`, fetches by `(tenant, inbound_webhook_id)`, deletes the config row, and deletes the associated HMAC/Bearer/path-token tenant secret. Delivery rows are retained with nullable `inbound_webhook_id` per the F002 migration rather than cascaded.
- (2026-05-11) **F016 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `rotateInboundWebhookSecret` checks `inbound_webhook:update`, rejects IP allowlist configs, writes a new generated secret/token to the existing or generated tenant-secret vault path, updates `auth_config` metadata if needed, and returns the new value once.
- (2026-05-11) **F017 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `setInboundWebhookActiveState` checks `inbound_webhook:update`, updates `is_active` by `(tenant, inbound_webhook_id)`, clears `auto_disabled_at` when re-enabling, and returns the redacted config view.
- (2026-05-11) **F018 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `listInboundDeliveries(filter, page, limit)` checks `inbound_webhook:read`, filters by tenant plus optional webhook/status/date range, paginates with a 100-row cap, and maps rows to camelCase delivery views.
- (2026-05-11) **F019 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `getInboundDelivery(id)` checks `inbound_webhook:read`, scopes by `(tenant, delivery_id)`, and returns `null` for missing/cross-tenant deliveries.
- (2026-05-11) **F020 deferred** until the inbound dispatch pipeline exists. A correct replay needs to re-run auth-verified request dispatch against current config; cloning a delivery row without dispatching would not satisfy the PRD.
- (2026-05-11) **F021 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `captureSamplePayload(id)` checks `inbound_webhook:update`, scopes by `(tenant, inbound_webhook_id)`, and sets `sample_capture_expires_at` to now + 5 minutes.
- (2026-05-11) **F022 implemented** in `server/src/lib/actions/inboundWebhookActions.ts`. `clearSamplePayload(id)` checks `inbound_webhook:update`, scopes by `(tenant, inbound_webhook_id)`, clears both `sample_payload` and `sample_capture_expires_at`, and returns the redacted config.
- (2026-05-11) **F023 deferred** until the inbound dispatch pipeline exists. The synthetic test action should exercise the same in-process dispatch path as the receiver/replay code.
- (2026-05-11) **F050 implemented** in `server/src/lib/inboundWebhooks/actions/registry.ts`. Added `registerAction`, `getAction`, `listActions`, duplicate-name rejection, deterministic list ordering by entity/name, and a test-only clear helper.
- (2026-05-11) **F051 implemented** in `server/src/lib/inboundWebhooks/actions/registry.ts`. `InboundActionDefinition` includes `{ name, entityType, displayName, description, targetFields, handle(ctx, mappedValues) }` and returns a structured `InboundActionResult`.
- (2026-05-11) **F052 implemented** in `server/src/lib/inboundWebhooks/actions/registry.ts`. `InboundActionTargetField` includes `{ name, type, required, description, enumValues?, refEntityType? }`; `refEntityType` is an additive helper for PRD `ref-to-entity` fields.
- (2026-05-11) **F053 deferred** until the first package-contributed action modules exist. Bootstrap should import actual registration files, not empty placeholders.
- (2026-05-11) **F054 implemented** in `server/src/lib/inboundWebhooks/actions/mappingEvaluator.ts`. `evaluateFieldMapping` evaluates each mapped target field using the existing workflow JSONata runtime (`@alga-psa/workflows/runtime/expressionEngine`) with both `body` and `payload` bound to the inbound request body.
- (2026-05-11) **F055 deferred** until delivery dispatch/update plumbing exists; validation failures need to update an actual delivery row to satisfy the PRD.
- (2026-05-11) **F061 implemented** in `server/src/lib/inboundWebhooks/workflowEnvelope.ts`. `buildWorkflowWebhookEnvelope` returns the documented shape `{source, body, headers, verified, delivery_id, idempotency_key, received_at}` and normalizes `received_at` to ISO string.
- (2026-05-11) **F070 implemented** in `shared/workflow/expression-authoring/adapters/webhookPayloadContextAdapter.ts` and exported from `adapters/index.ts`. The adapter exposes context roots/path options for captured webhook payloads. Also corrected `evaluateFieldMapping` to evaluate JSONata directly against the request body, matching PRD examples like `alert.message`.
- (2026-05-11) **F071 implemented** in `shared/workflow/expression-authoring/adapters/webhookPayloadContextAdapter.ts`. The adapter infers schema nodes recursively from captured samples, supports nested objects/arrays/primitives/nulls, and builds path options via existing `buildPathOptionsFromContextRoots`.
- (2026-05-11) **F043 implemented** in `server/src/lib/inboundWebhooks/headerFilter.ts`. `filterInboundWebhookHeaders` accepts `Headers` or plain records, lowercases persisted names, and strips `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization`, and `X-Api-Key`.
- (2026-05-11) **F038 implemented** in `server/src/lib/inboundWebhooks/idempotency.ts`. `extractInboundWebhookIdempotencyKey` supports case-insensitive header lookup from `Headers` or plain header records and returns `null` for missing/blank keys.
- (2026-05-11) **F039 implemented** in `server/src/lib/inboundWebhooks/idempotency.ts`. JSONata idempotency sources evaluate directly against the request body via the workflow expression runtime and normalize non-null results to trimmed strings.
- (2026-05-11) **F040 implemented** in `server/src/lib/inboundWebhooks/idempotency.ts`. `findDuplicateInboundDelivery` checks `(tenant, inbound_webhook_id, idempotency_key)` within the configured window and only treats `pending`, `dispatched`, or prior `duplicate` rows as dedup hits.
- (2026-05-11) **F041 implemented** in `server/src/lib/inboundWebhooks/deliveryPersistence.ts`. `createInboundDelivery` inserts tenant-scoped rows before dispatch, filters persisted headers through F043, stores request bodies only for `auth_status='verified'`, and supports replay linkage fields.
- (2026-05-11) **F033 implemented** in `server/src/lib/inboundWebhooks/authVerifier.ts`. HMAC-SHA256 verification uses configurable signature header names, supports `sha256=<hex>` or raw hex signatures, reads secrets from tenant secret storage, and compares with padded `crypto.timingSafeEqual`.
- (2026-05-11) **F034 implemented** in `server/src/lib/inboundWebhooks/authVerifier.ts`. Bearer auth reads `Authorization: Bearer <token>`, loads the tenant secret by vault path metadata, and uses the same timing-safe comparison helper.
- (2026-05-11) **F035 implemented** in `server/src/lib/inboundWebhooks/authVerifier.ts`. IP allowlist auth supports exact IP strings and IPv4 CIDR ranges without adding a new dependency. IPv6 is currently exact-match only; add a CIDR library if IPv6 CIDR support becomes required.
- (2026-05-11) **F036 implemented** in `server/src/lib/inboundWebhooks/authVerifier.ts`. Path-token auth reads the configured query parameter (default `token`), loads the tenant token secret, and compares with the timing-safe helper.
- (2026-05-11) **F037 implemented** in `server/src/lib/inboundWebhooks/responses.ts`. `unauthorizedInboundWebhookResponse()` returns a bodyless `401` `NextResponse` to reuse for unknown tenant, unknown webhook, disabled webhook, and bad auth cases.
- (2026-05-11) **F031 implemented** in `server/src/lib/inboundWebhooks/tenantResolver.ts`. Uses existing `@alga-psa/db.getTenantIdBySlug` and caches positive/negative lookups for 60 seconds; tenant slugs are the existing 12-hex portal slug format derived from tenant UUIDs.
- (2026-05-11) **F032 implemented** in `server/src/lib/inboundWebhooks/configLookup.ts`. `lookupInboundWebhookBySlug(knex, tenant, webhookSlug)` queries `inbound_webhooks` with both `tenant` and `slug`, returning only receiver-needed fields; backed by F001 unique `(tenant, slug)` index.
- (2026-05-11) **F044 implemented** in `server/src/lib/inboundWebhooks/sampleCapture.ts`. `captureInboundWebhookSampleIfRequested` stores the first verified body only while `sample_capture_expires_at > now`, clears the capture window after storing, and leaves existing samples untouched until the admin explicitly re-captures/clears.
- (2026-05-11) **F042 implemented** in `server/src/lib/inboundWebhooks/rateLimitConfig.ts`. Inbound webhooks use the shared Redis token bucket with a distinct `webhook-in` namespace, default to 600/min, and load per-webhook overrides from `inbound_webhooks.rate_limit_per_minute` scoped by tenant and webhook id.
- (2026-05-11) **F030 implemented** with `server/src/app/api/inbound/[tenantSlug]/[webhookSlug]/route.ts` plus shared `server/src/lib/inboundWebhooks/requestProcessor.ts`. The route supports POST/PUT/PATCH, gates on the inbound feature flag, resolves tenant slug, verifies auth, applies rate limit/idempotency, persists deliveries before dispatch, captures samples, and dispatches direct actions through the registry. Workflow dispatch still remains a later feature (F060).
- (2026-05-11) **Bundled integrations already in the codebase** — the user-configurable system complements these, not replaces them:
  - **Tanium** (EE) — `ee/server/src/lib/integrations/tanium/` + `taniumGatewayClient.ts`. Outbound sync (devices → assets) + webhook. Uses `ingestNormalizedRmmDeviceSnapshot`.
  - **NinjaOne** (EE) — `ee/server/src/lib/integrations/ninjaone/` — has a full inbound webhook implementation (`webhooks/webhookHandler.ts`, `webhooks/webhookRegistration.ts`, `alerts/alertProcessor.ts`, `alerts/ticketCreator.ts`). The user-configurable inbound webhook system is the generic equivalent.
  - **Tactical RMM** (CE+EE) — `packages/integrations/src/lib/rmm/tacticalrmm/`. Has webhook secret support (`tacticalrmm_webhook_secret`).
  - **Xero, QBO** (EE accounting) — outbound only currently.
  - **Entra ID** (EE) — bidirectional user/group sync; Direct mode + CIPP mode.
  - **Microsoft Graph / Teams, Google** — OAuth integrations for calendar/messaging.
- (2026-05-11) **`tenant_external_entity_mappings`** is the canonical external-ID-to-Alga-entity lookup table. Created in `server/migrations/20250502173321_create_tenant_external_entity_mappings.cjs`. Schema: `(tenant_id, integration_type, alga_entity_type, alga_entity_id, external_entity_id, external_realm_id, sync_status, last_synced_at, metadata)`. Two unique constraints enforce one-to-one mapping. **The plan uses this instead of adding `external_ref` columns to individual entity tables.**
- (2026-05-11) **`@alga-psa/integrations/lib/rmm/sharedAssetIngestionService`** exports `ingestNormalizedRmmDeviceSnapshot` — the shared device normalization path used by all RMM integrations. The inbound webhook asset action delegates here for RMM-shaped payloads.
- (2026-05-11) **Domain entity surface is large** — 60+ mutable entities across `packages/*/src/actions/`. v1 covers the high-leverage subset (tickets, clients, contacts, assets, invoices, time entries, project tasks, tags). Registry pattern means more can be added per package without touching inbound webhook core.
- (2026-05-11) Outbound webhook system at `server/src/lib/webhooks/` is mature: signing (`X-Alga-Signature` v1), Redis queue, retries, auto-disable, SSRF guards, per-webhook rate limits. Most of this is dispatch-side and not directly reusable for inbound, but the **delivery log + replay** pattern is the right shape to copy.
- (2026-05-11) **OpenAPI infrastructure is in place:**
  - Central registry: `server/src/lib/api/openapi/registry.ts`
  - Per-area route files: `server/src/lib/api/openapi/routes/*.ts` — outbound webhooks already registered at `routes/webhooks.ts` (model for inbound).
  - Generator: `sdk/scripts/generate-openapi.ts` → outputs `sdk/docs/openapi/alga-openapi.{ce,ee}.{yaml,json}`.
  - Contract test pattern: `server/src/test/unit/api/projectTasksOpenApi.contract.test.ts`.
  - Outbound webhook v1 API: `/api/v1/webhooks`, `/[id]`, `/test`, `/verify`, `/templates`, `/events`, `/analytics`, `/[id]/health`. Mirror this surface for inbound.
- (2026-05-11) Existing Settings UI for outbound: `server/src/components/settings/security/AdminWebhooksSetup.tsx`. Uses DataTable, Dialog, DropdownMenu primitives from `@alga-psa/ui`. Already i18n-ready.
- (2026-05-11) Workflow editor's expression infra is rich:
  - `ee/server/src/components/workflow-designer/expression-editor/ExpressionEditor.tsx` — Monaco-based JSONata editor with completion, hover, diagnostics, signature help.
  - `ee/server/src/components/workflow-designer/mapping/ExpressionTextArea.tsx` — single-line mapping editor (probably the right entry point for per-field rows).
  - `shared/workflow/expression-authoring/` — `pathDiscovery.ts`, `pathValidation.ts`, `validation.ts`, `context.ts`, adapters for workflow/invoice contexts.
  - `shared/workflow/runtime/expressionEngine.ts` — JSONata runtime evaluator. Use at request time to evaluate field mappings.
- (2026-05-11) Context adapter pattern: see `shared/workflow/expression-authoring/adapters/invoiceContextAdapter.ts` for a model of what `webhookPayloadContextAdapter.ts` should look like.
- (2026-05-11) CitusDB multi-tenant rules from CLAUDE.md:
  - All queries WHERE on `tenant`
  - JOIN conditions include `tenant`
  - Composite PKs include `tenant`
  - `app.current_tenant` doesn't propagate to all shards — use `withAuth` / `runWithTenant`
- (2026-05-11) Migrations split: CE migrations in `server/migrations/`, EE in `ee/server/migrations/`. Inbound webhooks are CE (community-edition feature).
- (2026-05-11) Authentication wrapper: `withAuth` from `@alga-psa/auth` is the canonical pattern. Sets tenant context via AsyncLocalStorage.
- (2026-05-11) UI reflection: every interactive element needs a kebab-case `id` attribute (e.g. `id="inbound-webhook-create-button"`). Mandatory per CLAUDE.md.

## Commands / Runbooks

- (2026-05-11) Find workflow trigger entrypoint:
  - `grep -rn "startWorkflow\|triggerWorkflow\|emit.*workflow" shared/workflow/runtime/ shared/workflow/services/`
  - Check `services/workflow-worker/` for the bus consumer.
- (2026-05-11) Test inbound endpoint locally:
  - `curl -X POST http://localhost:3000/api/inbound/<tenant>/<slug> -H "X-Signature: ..." -d '{...}'`
- (2026-05-11) Run migrations after changes:
  - `npm run migrate`
- (2026-05-11) Reset feature flag in PostHog UI or via API for testing.
- (2026-05-11) Type check after F014:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F015:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F016:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F017:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F018:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F019:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F021:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F022:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F050:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F054:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F061:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F070:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F043:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F038:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F040:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F041:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F033:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F037:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F031:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F032:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F044:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F042:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`
- (2026-05-11) Type check after F030:
  - `npx tsc -p server/tsconfig.json --noEmit --pretty false`

## Links / References

- PRD: `./PRD.md`
- Features: `./features.json`
- Tests: `./tests.json`
- Commit groups (for /loop): `./COMMIT_GROUPS.md`
- Outbound webhook system: `server/src/lib/webhooks/`
- Outbound subscriber: `server/src/lib/eventBus/subscribers/webhookSubscriber.ts`
- Outbound UI: `server/src/components/settings/security/AdminWebhooksSetup.tsx`
- Outbound migrations: `server/migrations/20260505140000_create_webhook_tables.cjs`
- OpenAPI registry: `server/src/lib/api/openapi/registry.ts`
- OpenAPI route file (outbound, model for inbound): `server/src/lib/api/openapi/routes/webhooks.ts`
- OpenAPI generator: `sdk/scripts/generate-openapi.ts`
- OpenAPI output: `sdk/docs/openapi/alga-openapi.{ce,ee}.{yaml,json}`
- Contract test pattern: `server/src/test/unit/api/projectTasksOpenApi.contract.test.ts`
- Workflow expression editor: `ee/server/src/components/workflow-designer/expression-editor/`
- Workflow mapping components: `ee/server/src/components/workflow-designer/mapping/`
- Expression-authoring core: `shared/workflow/expression-authoring/`
- JSONata runtime: `shared/workflow/runtime/expressionEngine.ts`
- Server action auth pattern: CLAUDE.md → "Server Action Authentication Pattern"
- Citus multi-tenant rules: CLAUDE.md → "Critical Multi-Tenant Rules (CitusDB)"

## Open Questions

- **Workflow trigger entrypoint:** Does the engine expose a synchronous `startWorkflow(workflowId, input)` API, or must inbound dispatch via event bus? Reference NinjaOne `alertProcessor.ts` — it may already invoke workflows and would show the pattern. Spike during F060.
- **Tenant slug source:** Tenants need a URL-safe identifier for `/api/inbound/[tenantSlug]/...`. Does an appropriate column exist (e.g. `tenants.url_slug`)? If not, add one in a prerequisite migration.
- **Reserved integration_type collision:** Bundled integrations write to `tenant_external_entity_mappings` with `integration_type` like `'ninjaone'`, `'tactical_rmm'`, `'tanium'`, `'xero'`, `'qbo'`, `'entra'`. User webhook slugs must not collide. Solutions: (a) maintain a reserved-name list and reject; (b) prefix user slugs with `user:` namespace; (c) use a separate column `integration_source` (system vs user). Decide before F003. Lean toward (a) — explicit reject with clear error.
- **Bootstrap action loading:** Server start must load all package action contributions before first inbound request. Static imports from `server/src/lib/inboundWebhooks/actions/bootstrap.ts` is simplest; dynamic discovery supports plugins later but adds complexity.
- **Missing idempotency key behavior:** When idempotency_source is configured but the request doesn't include the key — accept (single dispatch, no dedup) or reject (400)? Lean toward accept-with-warning logged.
- **Sample payload PII:** Captured samples may contain sensitive data. Plan: mark as sensitive, restrict access to webhook owner, no auto-redaction in v1. Revisit if security raises concerns.
- **Replay against changed config:** Documented behavior is "uses current config." Should the delivery detail show a banner if the mapping changed since the original delivery? Nice-to-have, not v1.
- **Delivery retention:** PRD says 30 days for raw body. Confirm with ops/legal that this is acceptable for financial/device data.
- **Rate limit defaults:** 600/min per webhook is a guess. Review against expected RMM alert volumes.
- **`upsertContactByExternalId` client linkage:** Should the action require a `client_external_id` mapped (with lookup) or accept `client_id` directly, or both? Confirm at design time.
- **Consolidation with bundled integrations (v2 candidate):** Should NinjaOne / Tactical RMM eventually consume the same user-configurable webhook plumbing with their secrets/normalizers preset? Out of scope for v1.

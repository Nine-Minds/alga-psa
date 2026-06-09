# SCRATCHPAD — Hudu Integration

Rolling working memory. Append freely.

## Context

- Branch: `integrations_hudu`. Greenfield — zero "hudu" references in repo at start.
- Goal: pull-only (Hudu → AlgaPSA) integration, EE-only, gated behind `hudu-integration` feature flag.
- Hudu = MSP IT-documentation platform. REST JSON API. Auth = `x-api-key` header + per-instance base URL (NOT OAuth).
- Local reference skills (not committed; `.claude/` is gitignored): `hudu-api-patterns`, `hudu-companies`, `hudu-assets`, `hudu-articles`, `hudu-passwords`, `hudu-websites`.

## Hudu API facts (from reference skills)

- Base URL: `https://<instance>/api/v1/<resource>`; Hudu Cloud or self-hosted.
- Pagination: `?page=N`, fixed 25 items/page; page < 25 results ⇒ last page.
- Rate limit: 300 req/min; 429 ⇒ backoff (`Retry-After` + jitter / exponential).
- UI→API naming traps: Passwords→`asset_passwords`, Processes→`procedures`.
- `id_in_integration` / `integration_slug` on companies = PSA cross-link hook.
- Asset passwords API returns **plaintext** password values. API-key password access is a per-key permission (403 if denied).

## AlgaPSA architecture findings (from repo exploration)

### Integration framework
- EE integration libs: `ee/server/src/lib/integrations/<provider>/` (ninjaone, entra, tanium). Axios clients.
- Canonical client example: `ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts` (credential layering: tenant secret → app secret → env).
- Settings catalog (renders Settings→Integrations): `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx` — `categories` array of `IntegrationItem { id, name, description, component, isEE? }`. Add a new "IT Documentation" category (don't shoehorn into RMM — Hudu is docs, not RMM).
- RMM provider registry (pattern ref only): `packages/integrations/src/lib/rmm/providerRegistry.ts`.

### Feature flags
- Server: `featureFlags.isEnabled('hudu-integration', { userId, tenantId })`. Guard pattern: `ee/server/src/app/api/integrations/entra/_guards.ts` (`requireEntraUiFlagEnabled`).
- Client: `useFeatureFlag('hudu-integration', { defaultValue: false })`.

### CE/EE stub
- CE route lazy-imports EE via `@enterprise/...` alias, else returns `eeUnavailable()` 501.
- Example: `server/src/app/api/integrations/entra/route.ts` + `_ceStub.ts`. Simple re-export variant: `server/src/app/api/integrations/ninjaone/callback/route.ts`.
- tsconfig aliases (`tsconfig.base.json`): `@enterprise`→`packages/ee/src`, `@ee`→`packages/ee/src`. EDITION env: `isEnterpriseEdition = EDITION==='ee' || NEXT_PUBLIC_EDITION==='enterprise'`.

### Secrets
- `ISecretProvider`: `getAppSecret`, `getTenantSecret(tenantId,name)`, `setTenantSecret(tenantId,name,value|null)`, `deleteTenantSecret`.
- Get instance: `getSecretProviderInstance()`. Store Hudu creds as `hudu_api_key`, `hudu_base_url` (per tenant). NinjaOne stores JSON blob under one key — viable too.
- Metadata layer: `tenant_secrets` table + `createTenantSecretProvider(knex, tenantId)`. Perms: `secrets.view/manage/use`.

### Server actions & DB
- Server actions: `'use server'` + `withAuth(async (user, { tenant }, args) => ...)` + `createTenantKnex()`.
- Migrations: CE in `server/migrations/*.cjs`, EE in `ee/server/migrations/*.cjs` (Knex CJS). Tenant tables: PK `(tenant uuid, <id> uuid)`, FKs `(tenant, ref)`, `updated_at` trigger `on_update_timestamp()`, Citus-distributed by `tenant`. App-layer isolation (no RLS).
- Connection-state shape precedent: `server/migrations/20251124000001_create_rmm_integration_tables.cjs` → `rmm_integrations (tenant, integration_id, provider, instance_url, is_active, connected_at, last_sync_at, settings jsonb)`. **BUT location**: `rmm_integrations` is CE only because the RMM layer is partly CE; Hudu is wholly EE, so `hudu_integrations` goes in **`ee/server/migrations/`** (exists, 49 migrations, Citus-distributes EE-only tables). EE precedent to mirror: `ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs` (Entra = EE-only, flag-gated, connection-state — the true peer). CE route 501s before any DB access, so CE never needs the table.
- Generic mapping table: `external_entity_mappings (tenant, ..., asset_id NOT NULL, import_source_id, external_id, external_hash, metadata)` — **asset-scoped only**, so NOT reusable for company↔client. Need dedicated Hudu mapping table(s).

### Entity mapping targets
| Hudu | Alga table | Interface |
|---|---|---|
| Company | `clients` | `IClient` (`client_id`, `client_name`, `properties` jsonb) |
| Contact | `contact_names` | `IContact` |
| Asset | `assets` (+ `asset_facts` for synced metadata) | `Asset`, `AssetFact` (`provider`, `integration_id`, `namespace`, `fact_key`) |
| Article | `documents` (polymorphic via `document_associations (tenant, document_id, entity_id, entity_type)`) | `IDocument` |
| Asset Password | **no native table** | — |
| Website | none (lives in `clients.properties`) | — DEFERRED |

### Asset Passwords placeholder (KEY)
- `packages/assets/src/components/tabs/DocumentsPasswordsTab.tsx`: passwords half is a STUB — card titled "Passwords & Secrets", text "Secure password management coming soon." No DB table, no persistence.
- Tab registered in `packages/assets/src/components/AssetDetailTabs.tsx` (id `documents-passwords`, icon Lock), rendered by `AssetDetailView.tsx`.
- Documents already attach to assets (real) via `document_associations` (entity_type='asset'); see `packages/assets/src/components/AssetDocuments.tsx`.
- NOTE scope mismatch: Hudu `asset_passwords` are **company-scoped**, but the placeholder tab is on the **asset**. Resolve where company-scoped Hudu creds surface.

## Hard constraints / decisions

- **SECURITY: never store Hudu password plaintext in an Alga DB column.** Live-fetch + mask + reveal-on-demand; if persistence ever needed, encrypt via `secretProvider` only. Respect API-key password permission (handle 403). Audit reveals.
- Data model kept **direction-agnostic** (external-id mapping tables) so push (Alga→Hudu) is additive later.
- Websites + push = out of scope for Phase 1.
- **EE/CE deletion boundary (NFR7)**: `hudu_integrations` is EE-only → all its DELETEs (disconnect + client/tenant cascade) live in EE code + EE migrations; CE must never name the table. Mapping cleanup is fine in CE (shared `tenant_external_entity_mappings`). User flagged: don't let a CE path try to delete from an EE-only table.
- Vault confirmed as tenant-secret backend: `packages/core/src/lib/secrets/VaultSecretProvider.ts` + `CompositeSecretProvider` (read-chain/write-target). So `setTenantSecret` can persist to Vault (encrypted store, NOT a DB column).

## Decisions (resolved 2026-06-08, evidence-based)

Research thread A (Hudu ecosystem) + thread B (repo mapping patterns) drove these:

1. **Sync model → persist mappings only; fetch a mapped company's lists on demand (cached + manual Refresh); deep-link for content.** No scheduled sync engine in Phase 1. Rationale: Hudu has NO consumer webhooks (only Slack/Teams alerts), 300 req/min, 25/page, no bulk endpoints; the whole ecosystem polls low-frequency (Hudu PSA syncs 3h, CIPP 24h) — per-mapped-company on-demand is within limits; bulk-on-every-view is not.
2. **Assets/Articles/Passwords → reference + deep-link, do NOT import as native Alga records.** Hudu is the system of record; PSAs deep-link back (ConnectWise "Quick Links"); pulling Hudu assets into a PSA is an unfilled HaloPSA request. Passwords especially: never duplicate secrets.
3. **Surface point → CLIENT page only** (revised 2026-06-09): Client "Hudu" tab (assets + articles) + a SEPARATE Client "Passwords" tab (Hudu asset_passwords), shown only when Hudu enabled/connected + client mapped. NOT on the asset tab — Hudu passwords are company-scoped, can't map to an asset; the asset "Documents & Passwords" stub is left untouched (future native-password effort).
4. **Company↔Client matching → reuse generic `tenant_external_entity_mappings`** (Xero/QBO modern shared table; `integration_type='hudu'`, `alga_entity_type='client'`) with **NinjaOne `OrganizationMappingManager` single-table UX**. Auto-suggest by `id_in_integration` (exact) → exact name → fuzzy name, admin confirms/overrides. NO new mapping migration.

### Key Hudu API facts confirmed by research
- PSA is source of truth for companies; Hudu imports them and stamps `id_in_integration` + `integration_slug`. Query filter `?id_in_integration=` + deep-link `/api/v1/companies/jump?integration_id=&integration_slug=&integration_type=company` exist (shipped v2.1.1+).
- No external webhooks/change-feed (only admin Slack/Teams alerts on create/update/delete). 300 req/min, 25/page, ~90 polling GET endpoints, no bulk read.
- Reveal passwords via deep-link to Hudu (Phase 1) → zero secret transit through Alga, satisfies no-plaintext constraint.
- Caveat: support.hudu.com returns 403 to fetchers; claims corroborated via hudu.com, Canny, community, and lwhitelock/HuduAPI.

### Repo mapping pattern confirmed
- Shared generic table: `server/migrations/20250502173321_create_tenant_external_entity_mappings.cjs` + CRUD `packages/integrations/src/actions/externalMappingActions.ts` (publishes EXTERNAL_MAPPING_CHANGED, 30s cache, 23505→"already exists"). REUSE — no new migration.
- NinjaOne org-mapping UI: `ee/server/src/components/settings/integrations/ninjaone/OrganizationMappingManager.tsx` (ClientPicker per row, status badges, Refresh) — copy this UX.
- Entra matchers (`ee/server/src/lib/integrations/entra/mapping/matchers/`) return 0–1 confidence — pattern for the auto-suggest.

### Password model — RESOLVED 2026-06-09
- **On-demand reveal, NO storage.** List shows metadata only; reveal = single live GET of one asset_password, value transits to the browser (masked, reveal-on-click), audited, never persisted to DB/Vault/cache or logged. Satisfies the no-plaintext constraint by construction.
- Vault IS the tenant-secret backend (`VaultSecretProvider`), so a Vault-cached reveal was technically allowed — rejected to avoid secret duplication/staleness/blast-radius and bypassing Hudu's own access revocation.
- **Native AlgaPSA password store + importing Hudu into it = OUT OF SCOPE** (separate future plan, "if demanded"). User confirmed 2026-06-09.
- Plan threads: F067 (reveal action), F068 (audit), F073/F082 (inline Reveal UI), T067–T069/T082/T110 (incl. "never to Vault"); NFR1 + Non-goals + OQ1 updated.

### OQ2/3/4 — RESOLVED 2026-06-09
- **OQ2**: passwords → dedicated Client "Passwords" tab (company-scoped); NOT asset tab; asset stub untouched. Plan group renamed `asset-passwords-tab` → `client-passwords-tab` (F080–F083, T080–T083); removed Hudu-tab passwords section (old F073/T072).
- **OQ3**: reuse existing **`system_settings`** resource (`read`=view, `update`=manage). Evidence: Entra/Teams/Tactical-RMM/SSO all use `system_settings`; only billing/accounting (Xero/QBO + `externalMappingActions`) use `billing_settings`. So Hudu mapping actions write `tenant_external_entity_mappings` directly gated on `system_settings` — do NOT call the `billing_settings`-gated `externalMappingActions` wrappers. Dropped the new-`hudu`-resource + seeding (old F091/T092 removed).
- **OQ4**: one instance per tenant (`unique(tenant)`). Multiple is rare (M&A/sandbox); deferred.

### Still-open (none — all OQs resolved)
- OQ2 asset↔password relation is best-effort/company-scoped (Hudu passwords aren't strongly asset-linked).
- OQ3 new `hudu` RBAC resource vs reuse (default: new `hudu` resource, seed rows).
- OQ4 one Hudu instance per tenant in Phase 1 (confirm).

## Reference plan (house style)

- `ee/docs/plans/2026-04-06-tanium-rmm-integration-plan/` — closest analog (EE, pull-oriented RMM). Note: its features.json predates commitGroup; THIS plan WILL include `commitGroup` per software-planner spec.

## Implementation log

### `scaffold` (F001–F005) — DONE + verified 2026-06-09 (uncommitted)
CE↔EE wiring pattern (reuse for ALL later route/lib groups):
- `@enterprise` alias is edition-swapped in `server/next.config.mjs:319-320`: EE → `ee/server/src`, CE → `packages/ee/src`. (`server/tsconfig.json` statically points `@enterprise` at `packages/ee/src` for typecheck.)
- So every EE route needs TWO files: the REAL impl at `ee/server/src/app/api/integrations/hudu/<route>` and a 501 stub copy at `packages/ee/src/app/api/integrations/hudu/<route>`. The CE entry at `server/src/app/api/integrations/hudu/<route>` lazy-imports `@enterprise/app/api/integrations/hudu/<route>` guarded by `isEnterpriseEdition` + `assertSessionProductAccess`, else `eeUnavailable()` 501.
- Files created: EE lib `ee/server/src/lib/integrations/hudu/{contracts.ts,index.ts}`; EE route `ee/server/src/app/api/integrations/hudu/{_guards.ts,_responses.ts,route.ts}`; EE stub `packages/ee/src/app/api/integrations/hudu/{_stub.ts,route.ts}`; CE entry `server/src/app/api/integrations/hudu/{_ceStub.ts,route.ts}`; client gate `packages/integrations/src/components/settings/integrations/useHuduIntegrationEnabled.ts`.
- Guard `requireHuduUiFlagEnabled('read'|'update')` mirrors Entra `requireEntraUiFlagEnabled`: flag `hudu-integration` via `featureFlags.isEnabled`, RBAC `system_settings`, EE tier+add-on, 404 when flag off. **Reuse this guard in every EE Hudu route/action.**
- `contracts.ts` exports `HUDU_INTEGRATION_TYPE` + value-stripped `HuduAssetPasswordSummary` (no `password` field) for list payloads.
- Verified: focused tsc on all 10 files = 0 errors; `tsc -p packages/integrations/tsconfig.json` clean for our files; remaining server/ee baseline errors are pre-existing and reference no hudu file.
- Tests T001–T004 written + green (13 cases). Group committed `eca8008` (also includes the plan folder).

### `hudu-client` (F010–F017, T010–T018) — DONE + verified 2026-06-09, committed
- `ee/server/src/lib/integrations/hudu/huduClient.ts` (axios, x-api-key, pagination stop-at-<25, 429 Retry-After+jitter backoff capped at 4 attempts, 5xx exp backoff, validateConnection w/ password-access probe) + `secrets.ts` (`HUDU_SECRET_KEYS` = `hudu_api_key`/`hudu_base_url`; resolve tenant secret → env via `getSecretProviderInstance()`/`getTenantSecret`). Barrel updated.
- Result shape: `HuduResult<T> = {ok:true,data} | {ok:false,error:HuduError}`; `HuduError.kind ∈ invalid_key|no_password_access|not_found|validation|rate_limited|server_error|network_error|unknown`. Read methods THROW `HuduRequestError` (carrying the typed HuduError); consuming actions (connection/reference-fetch groups) map throw→envelope. `validateConnection()` returns the struct directly.
- Backoff `sleep` is injectable so tests run fast (no real timers). Redaction: errors built from status only, never bodies/headers/key.
- 22 unit tests (axios `vi.mock`ed, no network). Reuse `createHuduClient()` in later groups; do NOT add OAuth (x-api-key only).

### `connection` (F020–F028, T020–T028) — DONE + verified 2026-06-09 (uncommitted)
- Migration `ee/server/migrations/20260609120000_create_hudu_integrations.cjs`: tenant uuid FIRST col, integration_id default gen_random_uuid(), PK (tenant,integration_id), unique(tenant) (one connection/tenant), FK tenants CASCADE, settings jsonb '{}', `update_hudu_integrations_updated_at` trigger (on_update_timestamp), Entra-style citus guard (pg_is_in_recovery + pg_extension + pg_dist_partition, `colocate_with => 'tenants'` — Entra ensureDistributedTable precedent; teams uses microsoft_profiles only because of its FK), console.warn+skip when citus absent, GRANT to DB_USER_SERVER, `transaction:false`. down() drops the table.
- Repository `ee/server/src/lib/integrations/hudu/huduIntegrationRepository.ts`: `getHuduIntegration/upsertHuduIntegration/setHuduIntegrationActive/touchHuduIntegrationLastSynced`, all `(knex, tenant, ...)` (contactLinkRepository style — callers/tests inject the handle). Upsert = insert onConflict(['tenant']).merge, partial-field merge keeps untouched cols. Exported from barrel.
- Actions `ee/server/src/lib/actions/integrations/huduActions.ts` ('use server'): `connectHudu/testHuduConnection/getHuduConnectionStatus/disconnectHudu`, each wrapped in `withHuduSettingsAccess(perm)` = withAuth + user_type!=='client' + `system_settings` RBAC + assertTierAccess(INTEGRATIONS) + assertAddOnAccess(ENTERPRISE) + `hudu-integration` flag (action-level mirror of requireHuduUiFlagEnabled). Capability stored in `settings.password_access`. getStatus/route NEVER read or return the key. disconnect deletes both tenant secrets + setActive(false); mappings untouched. createTenantKnex imported from 'server/src/lib/db' (NOT '@/lib/db' — vitest alias for that subpath doesn't exist in EE).
- EE route GET now returns real status via repository (status/baseUrl/connectedAt/lastSyncedAt/passwordAccess).
- `contracts.ts` adds `HUDU_MAPPING_TABLE = 'tenant_external_entity_mappings'` — mapping group MUST use it (NFR7 boundary anchor; boundary test asserts it).
- Tests (49 hudu tests green total): T020–T022 REAL DB (`src/__tests__/integration/hudu-integrations.migration.integration.test.ts` — direct knex to local `server` DB :5432, postgres + secrets/postgres_password, single-migration up()/down() re-apply pattern; tests self-contained because vitest shuffles); T023–T026 unit-mocked (`huduConnectionActions.test.ts` — mock '@alga-psa/auth' withAuth, repo + HuduClient via '@ee/...' specifiers which dedupe with relative imports); T027/T028 static fs sweep (`huduDeletionBoundary.test.ts`). T028 client-delete-removes-mapping-rows half deferred to the mapping group (noted in test).
- Gotchas: `array_agg(a.attname)` (name[]) comes back as unparsed `{tenant}` string — cast `::text`; ee tsconfig is non-strict so `if (!result.success)` does NOT narrow unions in tests — use toMatchObject.

### `settings-ui` (F030–F034, T030–T034) — DONE + verified 2026-06-09 (uncommitted)
- Bridging decision: NinjaOne/Tanium precedent (NOT the heavier Entra entry-swap). Real component `ee/server/src/components/settings/integrations/HuduIntegrationSettings.tsx` imports `huduActions` directly (relative path, like TaniumIntegrationSettings); CE placeholder stub at `packages/ee/src/components/settings/integrations/HuduIntegrationSettings.tsx`; the page loads it via `dynamic(() => import('@enterprise/components/settings/integrations/HuduIntegrationSettings'))` — `@enterprise` is already edition-swapped in next.config (ee/server/src vs packages/ee/src), so NO new aliases/routes needed. CE delegator route untouched (still 3/3).
- Page: `IntegrationsSettingsPage.tsx` gets an `it-documentation` category (icon BookOpen, single `hudu` item, isEE) spread-gated on `useHuduIntegrationEnabled().enabled`; `calendarAvailability.getVisibleIntegrationCategoryIds` EE branch now includes `IT_DOCUMENTATION_SETTINGS_CATEGORY = 'it-documentation'` (CE list unchanged → CE can never show it).
- F033 additive huduActions change: `connectHudu` takes `HuduConnectInput` (`apiKey?`) — blank key falls back to stored key via `resolveHuduCredentials`, error unchanged when neither exists; `testHuduConnection` merges partial candidates with stored creds; failure arm of `HuduActionResult` gains optional `errorKind` (set from validation error) so the UI maps 401→invalid-key / 404→bad-base-URL messages. UI only sends `apiKey` when non-empty.
- Component: status badge Not connected/Connected/Error (Badge secondary/success/error), detected instance + password-access indicator when connected, inline URL-format validation, `useToast` (destructive) on failures, key input `type=password` `autoComplete=new-password` never prefilled, cleared after connect.
- i18n: `integrations.categories.itDocumentation` + `integrations.items.hudu` in `server/public/locales/en/msp/settings.json`; `integrations.hudu.settings.*` in `en/msp/integrations.json`. Component uses NinjaOne-style `t(key, { defaultValue })`.
- Tests (ee/server vitest, jsdom + @testing-library, entra-test house style): `huduSettingsPageCategory.test.tsx` (T030, 3 cases — gate on/off/CE; mocks sibling components via `@alga-psa/integrations/...` specifiers that dedupe with relative imports) + `huduIntegrationSettings.component.test.tsx` (T031–T034, 15 cases). 3 keep-existing-key cases added to `huduConnectionActions.test.ts` (one strict-equality assertion extended for `errorKind`). All 67 hudu tests green.
- Harness gotchas (REUSE): mock `@alga-psa/ui/lib/i18n/client` with a STABLE `t` identity (new-per-render t retriggers useCallback'd loaders → infinite loading flicker); added vitest alias `@product/billing/entry` → `packages/product-billing/oss/entry.tsx` in ee/server/vitest.config.ts (page's Stripe dynamic import broke Vite transform); jest-dom matcher TYPES don't resolve in ee/server (nested vitest 4.1.5 vs root 4.0.18 — pre-existing, entra tests have same errors) → use plain assertions (`toBeTruthy`/`.disabled`/`textContent`); `entraIntegrationSettings.initialSyncCta.test.tsx` & co fail PRE-EXISTING on this branch (i18n strings unresolved) — verified identical 22-file/50-test failure set with changes stashed.

### `company-mapping-data` (F040–F046, T040–T048) — DONE + verified 2026-06-09 (uncommitted)
- `ee/server/src/lib/integrations/hudu/companyMapping.ts`: matcher + cache shaping (pure) AND knex-level persistence/resolvers (all `(knex, tenant, ...)`, table via `HUDU_MAPPING_TABLE`); `ee/server/src/lib/actions/integrations/huduMappingActions.ts` ('use server', own copy of `withHuduSettingsAccess` — can't export a sync wrapper from a 'use server' file): `syncHuduCompanies` (update), `getHuduCompanyMappings` (read), `setHuduCompanyMapping`/`clearHuduCompanyMapping` (update), `resolveHuduCompanyIdForClient`/`resolveClientIdForHuduCompany` (read). Barrel updated.
- Matcher: per-company priority id_in_integration string-equals client_id (1.0) → exact case-insensitive name (0.9) → fuzzy normalized-Levenshtein ≥ 0.8 (score); already-mapped companies/clients excluded; greedy one-to-one claiming (best pass/score wins a client). Cache shape: `settings.companies_cache = { companies: [{id,name,id_in_integration:string|null,url}], fetched_at: ISO }` — read-modify-write merge preserves `password_access`.
- SCHEMA FACTS (verified live): shared table column is `tenant` (NOT `tenant_id` — renamed by 20250512094730_standardize_tenant_columns), PK `(id, tenant)`; BOTH one-to-one directions already DB-enforced (`idx_unique_alga_mapping` + `idx_unique_external_mapping` w/ COALESCE(realm,'')); `sync_status` is unconstrained varchar(20) → `'manual_link'` used. Pre-checks give friendly typed errors (`client_already_mapped`/`company_already_mapped`); racing 23505 → `mapping_conflict`. Replace = explicit clear+set only.
- Tests (97 hudu tests green across 10 files): `unit/huduCompanyMatcher.test.ts` (T041–T043, pure), `unit/huduMappingActions.test.ts` (T040/T046 — partial vi.mock of companyMapping via importOriginal keeps matcher real, fakes row fns), `integration/hudu-company-mappings.integration.test.ts` (T044/T045/T047/T048 — real DB :5432, random-uuid tenant + 2 clients fixtures, full cleanup, beforeEach wipes tenant's mapping rows for shuffle-safety).
- Gotchas: non-strict ee tsconfig doesn't narrow `result.ok` unions in SOURCE either → `Extract<HuduMappingWriteResult, { ok: false }>` cast in the action; vitest 4 `importOriginal` is untyped → cast the awaited result, not a type argument. Levenshtein note: 'Acme Corp' vs 'Acme Corporation' is only ~0.56 — pick near-variants (≤20% edits) for fuzzy fixtures. Pre-existing (NOT this group): `huduSettingsPageCategory.test.tsx(28)` TS2347.

### `company-mapping-ui` (F050–F053, T050–T053) — DONE + verified 2026-06-09 (uncommitted)
- `ee/server/src/components/settings/integrations/hudu/HuduCompanyMappingManager.tsx` modeled on NinjaOne `OrganizationMappingManager` (Card + counters + table + per-row `ClientPicker` + Refresh via `useTransition`). NO CE stub: like `ninjaone/` (no `packages/ee/.../ninjaone` dir exists), the manager is only imported relatively by the EE-injected `HuduIntegrationSettings`, which now renders it in a `mt-6` sibling div below the connection card when `isConnected` (the action sets `connected = row.is_active`, so connected already implies active).
- Row state from `getHuduCompanyMappings` views: status = mapping→Mapped(success) / suggestion→Suggested(primary) / else Unmapped(warning); counters mapped/suggested/unmapped/total (`hudu-mapping-count-*`). Picker pre-fill `mapping?.client_id ?? suggestion?.client_id`; suggested rows get a source+confidence note (`hudu-mapping-suggestion-<id>`). Select → `setHuduCompanyMapping` (metadata from the row), clear → `clearHuduCompanyMapping({mappingId})`, change on a mapped row = explicit clear-then-set (server rejects overwrites); typed codes (`client_already_mapped` etc.) map to friendly messages + destructive toast. Refresh = `syncHuduCompanies` then `loadData()` (mappings untouched server-side). Clients via `getAllClients(false)` from `@alga-psa/clients/actions`.
- i18n: `integrations.hudu.mapping.*` added to `server/public/locales/en/msp/integrations.json`; component uses `t(key, { defaultValue })` throughout.
- Tests: `unit/huduCompanyMappingManager.component.test.tsx` (T050–T053, 9 cases — mapping actions + `@alga-psa/clients/actions` mocked, ClientPicker mocked as a plain `<select>` ('' = null), same Card/Badge/Button/Alert/toast/i18n mock idioms); settings test gains the manager stub mock + 2 embedding cases (renders when connected, absent otherwise). All 9 hudu unit files green (101 tests). Focused tsc: 0 errors in touched files (the only hudu hit is the PRE-EXISTING `huduSettingsPageCategory.test.tsx(28)` TS2347 — re-verified with changes stashed).
- Gotchas (REUSE): testing-library `getByText` matches DIRECT text nodes, but client names appear in every picker mock's `<option>`s too — assert row `textContent` instead; `fireEvent.change` to the already-selected value does NOT fire React onChange (value tracking), so "confirm the suggested client" can't be simulated by re-selecting it.

### `company-mapping-ui` (F050–F053, T050–T053) — DONE + verified 2026-06-09, committed
- `ee/server/src/components/settings/integrations/hudu/HuduCompanyMappingManager.tsx` — NinjaOne OrganizationMappingManager pattern: counters, per-row ClientPicker (pre-filled with mapping or suggestion), Mapped/Suggested/Unmapped badges, Refresh Companies. Rendered inside HuduIntegrationSettings when connected (sibling div, NinjaOne precedent — no CE stub needed: only imported relatively by the EE-injected parent).
- Mapped-row change = explicit clear-then-set (server rejects overwrites); typed conflict codes → friendly toast.
- **Gotcha fixed: cross-file Postgres deadlock (40P01)** — the migration test's `DROP TABLE hudu_integrations` (needs lock on `tenants` for the FK) vs the mapping test's `DELETE FROM tenants` (cascade needs lock on `hudu_integrations`) when vitest ran both files in parallel. Fix: both hudu integration test files take `pg_advisory_lock(hashtext('hudu-db-integration-tests'))` in beforeAll on a single-connection pool (`pool:{min:1,max:1}`), unlock_all+destroy in afterAll. Full suite 108/108 ×3.

### `reference-fetch` (F060–F068, T060–T069) — DONE + verified 2026-06-09 (uncommitted)
- `ee/server/src/lib/integrations/hudu/referenceData.ts`: capped-FIFO module Map cache keyed `${tenant}:${companyId}:${resource}` (TTL 60s, cap 200, lazy expiry; externalMappingActions pattern), allowlist `toHuduAssetPasswordSummary` (only id/company_id/name/username/url/password_folder_name/description/timestamps — `password`/`otp_secret`/unknown fields can never pass), deep-link builders `buildHuduRecordUrl` (record url absolute as-is / relative resolved via `huduInstanceBaseUrl`) + `buildHuduCompanyUrl` (company url → `/companies/jump` API URL only when id_in_integration+slug known → null). `contracts.ts` gains explicit `otp_secret` and Summary = `Omit<…,'password'|'otp_secret'>`.
- `ee/server/src/lib/actions/integrations/huduDataActions.ts` ('use server', own `withHuduSettingsAccess` copy): `getHuduCompanyAssets/Articles/Passwords(clientId, {refresh?})` + `revealHuduPassword(clientId, huduPasswordId)` — ALL read-gated (PRD flow 4 = technician view; reveal's compensating control is the mandatory audit, not a harder gate). Shared `fetchCompanyList`: row-level resolver (unmapped ⇒ `{state:'unmapped'}` before ANY Hudu call), cache-or-fetch, project BEFORE cache (passwords stripped pre-cache), per-record `hudu_url` = record url → company url (from companies_cache + base_url) → null. 403 ⇒ `{state:'no_password_access'}`; HuduRequestError ⇒ `{state:'error',errorKind}`.
- Reveal: single `getAssetPassword(id)` GET, company_id must equal the mapped company (else `not_found` — no cross-company leak), 404→not_found, 403→no_password_access; audit BEFORE value, **fail-closed** (audit throw ⇒ error state, no value); value never cached/persisted/logged (logger gets ids only). Read actions stay write-free (no `touch…LastSynced` on fetch — same as the mapping read path).
- **Audit sink** `ee/server/src/lib/integrations/hudu/revealAudit.ts`: shared `audit_logs` table via `auditLog` from `server/src/lib/logging/auditLog` (EE precedent: ninjaoneActions REMOTE_ACCESS audit) — BUT auditLog silently SKIPS when the `app.current_tenant` GUC is unset (new pool model never sets it), so wrap in `knex.transaction` + `set_config('app.current_tenant', tenant, true)` first (expiredCreditsHandler precedent; audit_logs trigger stamps tenant from the GUC). Row: operation `hudu_password_reveal`, table `clients`, record clientId, details `{integration,tenant,hudu_password_id,hudu_company_id,revealed_at}` — never the value.
- Tests (141 hudu tests green across 14 files, ×2 shuffled seeds): `unit/huduReferenceData.test.ts` (cache TTL/keying/eviction via fake timers, stripping, deep links), `unit/huduRevealAudit.test.ts` (GUC-before-auditLog ordering, payload key audit, fail-closed propagation), `unit/huduDataActions.test.ts` (T060–T063/T065–T069; partial importOriginal mocks keep HuduRequestError + parseCompaniesCache + the REAL referenceData cache; asserts client-never-called on unmapped, single-GET reveal with zero repo/Vault/knex/cache writes and value absent from every logger+console call).
- Gotcha (REUSE): static-importing a partially-mocked module (`vi.mock(..., importOriginal)`) from the test file TDZ-crashes on the factory's closure over mock consts — use top-level `await import(...)` after the const declarations instead.

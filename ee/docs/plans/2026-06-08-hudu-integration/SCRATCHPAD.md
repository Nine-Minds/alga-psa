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

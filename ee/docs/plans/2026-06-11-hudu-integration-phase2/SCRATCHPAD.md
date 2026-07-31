# Scratchpad — Hudu Phase 2 (Assets & Documents)

## Decisions

- 2026-06-11 — Scope settled with Natallia via three options questions:
  assets = **import + pull sync** (not mapping-only, not one-time import);
  articles = **link-only** section in client Documents tab; global view =
  **Documents page "Hudu" tab** (not global-search-only).
- Sync is **manual-only** this phase (button per client); scheduled refresh
  stays a future enhancement (was already a Phase 1 non-goal).
- Sync conflict policy: **Hudu wins on synced fields only** (`name`,
  `serial_number`); everything else in Alga untouched; `asset_type` never
  retro-changed after import/mapping.
- Hudu disappearance → mapping metadata `stale: true` + badge. Never delete.
- Layout→type map lives in `hudu_integrations.settings.asset_layout_type_map`
  (no new table); UI block inside HuduIntegrationSettings.
- Asset mapping UI reuses the **staged Save/Discard confirmation pattern**
  built for company mappings on 2026-06-11 (picker stages; Save commits;
  dismissible suggestions; row revert/unmap actions).

## Discoveries (verified in code)

- `tenant_external_entity_mappings` unique indexes
  (`server/migrations/20250502173321_…`) are scoped by
  `(tenant…, integration_type, alga_entity_type, …)` → asset mappings
  (`alga_entity_type='asset'`) coexist with Phase 1 client mappings. The
  original migration named the column `tenant_id` but Phase 1's
  companyMapping.ts queries `tenant` and its real-DB tests pass — a later
  rename superseded it. **Mirror companyMapping.ts, not the old migration.**
- `CreateAssetRequest` (`packages/types/src/interfaces/asset.interfaces.ts:378`):
  fixed enum `asset_type: 'workstation'|'network_device'|'server'|
  'mobile_device'|'printer'|'unknown'`; **required** `asset_tag`, `name`,
  `status`, `client_id`; optional `serial_number`; per-type extension blobs.
- `createAsset` = `packages/assets/src/actions/assetActions.ts:755`
  (withAuth wrapper → asset RBAC).
- Client Documents tab: `packages/clients/src/components/clients/
  ClientDetails.tsx` tab id `documents` (~line 1715). Phase 1 EE-injection
  precedent: `useHuduClientTab(client.client_id)` at line 283 + spread tabs
  at ~1844.
- Main documents page: `server/src/app/msp/documents/page.tsx` →
  `packages/documents/src/components/DocumentsPage.tsx`.
- Hudu API (plan dir `hudu-api-reference.md`): assets by company
  `GET /api/v1/assets?company_id=&page=&archived=false`; articles
  `GET /api/v1/articles?company_id=&page=`; global articles = omit
  company_id. Asset layouts: `GET /api/v1/asset_layouts` (verify response
  shape on local instance). 25/page, 300 req/min.
- Hudu asset payload carries `primary_serial`, `asset_layout_id`, `fields[]`
  (layout custom fields), `archived`.

## Environment / testing

- Local Hudu: `http://hudu.localtest.me` (stack in `~/hudu2`), API key
  unscoped, password access on. Companies: ExampleCo (1), Emerald City Ltd
  (2). Alga dev: bigmac worktree, `localhost:3001`, tenant
  `c7c99e9f-19dd-46b0-80be-0a2a59f5ab7a` (has `enterprise` add-on row).
  Flags forced via `server/.env.local` (`NEXT_PUBLIC_FORCE_FEATURE_FLAGS`
  + `DISABLE_FEATURE_FLAGS=true`).
- Unit tests: `cd ee/server && npx vitest run src/__tests__/unit/hudu` —
  273 passing pre-Phase-2 (incl. staged-save mapping manager rewrite).

## Implementation findings

- **FR1 correction**: `idx_unique_external_mapping` is `(tenant,
  integration_type, external_entity_id, COALESCE(external_realm_id,''))` —
  NOT scoped by alga_entity_type (only the alga-direction index is). Hudu
  company and asset ids overlap numerically → asset mapping rows carry
  `external_realm_id = String(hudu company id)` (client rows use null).
  T215 proves coexistence with identical external ids.
- `getHuduAssetMappings` reuses the Phase 1 `getHuduCompanyAssets` action
  for fetch+cache → effectively requires system_settings read in addition
  to asset read (technicians already have it for the client tab). Acceptable.
- regression-phase2 DONE (2026-06-11): huduPermissions.test.ts now enumerates
  all 8 action modules (Phase 1 three + layoutMap/assetMapping/assetImport/
  assetSync/globalDocs) — 97 tests. Layout-map actions joined the
  system_settings manage/view lists; the Technician flows got a
  resource+permission matrix (asset read/update/create, client read) plus an
  unauthenticated sweep over every entry (withAuth mock now drops the session
  user). T093 exhaustiveness still fails on any future unlisted export.
  T250 = information_schema column-list check in
  hudu-regression.integration.test.ts (real-DB harness): exactly the 12
  Phase 1 columns, no pull-only additions (NFR4). T110 expected-file list
  extended with the 5 new action modules.
- Found while running tsc for regression-phase2: 6 hudu type errors from
  earlier groups, all fixed — HuduAssetMappingManager.tsx relied on
  `!result.success` narrowing, which the non-strict EE tsconfig doesn't do
  (added isImportFailure/isBulkImportFailure guards, the file's existing
  isMappingFailure idiom); two TS2347s (type args on untyped vi helpers) in
  huduSettingsPageCategory.test.tsx / huduDocumentsTabGate.test.tsx became
  post-call casts. Remaining tsc errors are the known pre-existing chat
  registry / mcp agent-tooling / msp-composition ones (14).
- `HuduAsset` in contracts.ts lacks `asset_layout_id` (runtime has it);
  typed locally in actions as HuduAssetListItem — consider lifting to
  contracts in a later group.

## OQ resolutions (2026-06-11, verified on local instance)

- **OQ1 RESOLVED**: `GET /api/v1/articles?search=` does case-insensitive
  partial matching ("vpn" → "VPN Setup Guide"); `?name=` is exact-only.
  Use `?search=`. Global list = omit `company_id`; response carries
  `company_id` per article.
- **OQ2 RESOLVED**: `assets.asset_tag` is notNullable but has NO unique
  constraint (migration `20241112031330_create_asset_management_tables.cjs`).
  `primary_serial` as tag is safe; `hudu-<id>` fallback only for missing
  serials. NOTE: assets table column is `company_id` (legacy name for
  client) + `type_id` uuid — the `asset_type` enum in CreateAssetRequest is
  the action-level API; verify createAsset's mapping when implementing.
- Hudu asset payload verified: `{id, name, company_id, asset_layout_id,
  primary_serial, archived, fields[]}`. Default layouts on fresh instance
  incl. "Computer Assets" (7), "Databases" (9), "Applications" (3).
- Seeded local data: articles (2× ExampleCo + 3 pre-existing, 1× Emerald),
  assets EC-WS-001 (SN-EC-1001), EC-SRV-01 (SN-EC-2001) in Computer Assets.
- Git: commits require Natallia's explicit request (auto-mode enforces) —
  implement all groups, flip flags, let her commit per group at the end.

## Gotchas

- `asset_tag` uniqueness semantics unverified (R2) — check before using
  `primary_serial` as tag; fallback `hudu-<id>`.
- Hudu article search param name unverified (OQ1): try `?search=`, fall back
  to `?name=`.
- i18n: every new string needs en + de/es/fr/it/nl/pl/pt keys, and the
  Phase 1 static i18n test (`huduI18n.test.ts`) must be extended to scan the
  new components (it whitelists scanned sources explicitly).
- DocumentsPage is a CE package — EE tab must inject via gate hook, never a
  hard import of EE components (R4).

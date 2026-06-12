# Hudu Integration — Phase 2: Assets & Documents

- Status: Draft (pending scope confirmation)
- Phase: 2 (still pull-only, Hudu → AlgaPSA)
- Predecessor: `ee/docs/plans/2026-06-08-hudu-integration` (Phase 1, complete)

## Overview

Phase 1 connected Hudu and surfaced a mapped company's assets, articles, and
passwords read-only on the client page. Phase 2 deepens two of those surfaces:

1. **Assets become first-class**: Hudu assets can be **mapped** to existing
   AlgaPSA assets, **imported** (created in Alga from Hudu), and kept current
   with a **manual pull sync** that updates synced fields on mapped assets.
2. **Articles meet Alga's Documents surfaces** (link-only, no content copy):
   a "Hudu Documentation" section on the client's Documents tab, and a "Hudu"
   tab on the main Documents page listing/searching articles across all
   mapped companies.

Phase 1 principles that still hold: EE-only behind the `hudu-integration`
flag; pull-only; deep-link to Hudu for content; never persist article bodies
or passwords; `system_settings` RBAC for integration administration.

## Problem / User Value

- Technicians track devices in both systems by hand. A Hudu asset and its
  Alga asset (used for tickets/billing) have no link, so device context is
  re-discovered on every ticket.
- MSPs onboarding to AlgaPSA already have their device inventory in Hudu;
  re-entering it manually is the single biggest adoption blocker for Alga's
  asset module.
- Runbooks/KB articles live in Hudu but technicians work documents from
  Alga's Documents surfaces; today they must remember which system holds what.

## Goals

- G1. Per-asset mapping between Hudu assets and Alga assets (per client).
- G2. One-click import of unmatched Hudu assets into Alga (single + bulk).
- G3. Manual "Sync from Hudu" per client that pull-updates synced fields on
  mapped assets and flags Hudu-side disappearances.
- G4. Link-only "Hudu Documentation" section in the client Documents tab.
- G5. "Hudu" tab on the main Documents page: cross-client article list with
  search, client resolution, and deep-links.

## Non-goals (Phase 2)

- **Push (Alga → Hudu)** in any form; the data model stays direction-agnostic.
- **Scheduled/background sync** (Temporal or otherwise). Sync is manual this
  phase; a low-frequency scheduled refresh remains a documented future step.
- **Importing article content** as Alga documents (link-only by decision).
- **Custom-field sync** beyond the core field set (name, serial number,
  asset type via layout map). Hudu layout custom fields are displayed in
  Phase 1's read-only view only.
- **Deleting or archiving Alga assets** in response to Hudu changes — sync
  never destroys Alga data; it only flags.
- Mapping Hudu passwords to assets (unchanged from Phase 1; company-scoped).

## Personas & Primary Flows

- **MSP Admin** — configures the asset-layout→asset-type map; runs bulk import.
- **MSP Technician** — maps/imports individual assets, runs Sync, browses
  Hudu documentation from Documents surfaces.

Flows:

1. **Configure layout map** (Admin): Settings → Integrations → Hudu →
   "Asset layouts" block → each Hudu asset layout gets an Alga asset type
   (heuristic prefill, `unknown` fallback) → Save.
2. **Map/import assets** (Technician): Client → Hudu tab → Assets section now
   shows per-asset state (Mapped / Suggested / Unmapped) with an Alga-asset
   picker per row, an Import action per unmatched row, and "Import all
   unmatched". Staged changes commit via an explicit **Save** bar (same
   confirmation pattern as Phase 1 company mappings).
3. **Sync** (Technician): Client → Hudu tab → "Sync from Hudu" → re-fetches
   the company's assets, updates synced fields on mapped Alga assets,
   reports created/updated/stale counts.
4. **Client documents** (Technician): Client → Documents tab → "Hudu
   Documentation" section lists the mapped company's articles (name,
   updated_at) → click → opens in Hudu.
5. **Global documents** (Technician): Documents page → "Hudu" tab → paged,
   searchable article list across companies; each row shows the resolved
   Alga client (or "unmapped") and deep-links to Hudu.

## UX / UI Notes

- **Settings — Asset layouts block** (inside `HuduIntegrationSettings`, below
  Company Mappings): table of Hudu asset layouts (fetched live) × Alga asset
  type select (`workstation | network_device | server | mobile_device |
  printer | unknown`). Heuristic prefill by layout-name keywords
  (server→server; workstation/desktop/laptop→workstation; printer→printer;
  phone/mobile/tablet→mobile_device; network/switch/router/firewall/access
  point→network_device; else unknown). Explicit Save; persisted per tenant.
- **Client Hudu tab — Assets section** becomes an asset mapping manager,
  visually consistent with the company mapping manager: counters
  (mapped/suggested/unmapped), per-row Alga asset picker + status badge,
  row actions (revert / unmap / dismiss suggestion), Import per row,
  "Import all unmatched" button, staged-changes Save/Discard bar, and a
  "Sync from Hudu" button with last-synced timestamp and result summary.
  Mapped rows whose Hudu asset disappeared/archived show a **Stale** badge.
- **Client Documents tab — Hudu section**: collapsed-by-default section
  "Hudu Documentation (N)" listing articles name + updated_at + external-link
  icon. Only rendered when the Phase 1 client-tab gate passes (EE + flag +
  connected + mapped). No upload/edit affordances.
- **Documents page — Hudu tab**: tab visible when EE + flag + connected.
  Search box (server-side, passed to Hudu), paged table (25/page mirroring
  Hudu pages): article name, company name → resolved client name (or
  "Unmapped" badge), updated_at, open-in-Hudu. No bulk fetch of all pages.
- All new strings via i18n (en + de/es/fr/it/nl/pl/pt), following Phase 1
  key families (`integrations.hudu.assets.*`, `integrations.hudu.documents.*`,
  `documents.huduTab.*`, `clientDetails.huduDocs.*` as applicable).

## Functional Requirements

Assets — mapping:
- FR1. Asset mapping rows reuse `tenant_external_entity_mappings` with
  `integration_type='hudu'`, `alga_entity_type='asset'`,
  `external_entity_id=<hudu asset id>`; metadata carries
  `hudu_asset_name`, `hudu_company_id`, `asset_layout_id`,
  `asset_layout_name`, `primary_serial`, `url`. One-to-one both directions
  per tenant (existing unique indexes are scoped by `alga_entity_type`).
- FR2. Auto-suggest matches per Hudu asset against the client's Alga assets:
  serial exact (confidence 1.0) → name exact (0.9) → name fuzzy ≥0.8
  (reusing the Phase 1 normalized-Levenshtein matcher incl. suffix rules);
  one-to-one greedy claiming, mapped rows/assets excluded.
- FR3. Mapping UI follows the staged-changes pattern: picker stages, Save
  commits (clear+set for replace), Discard reverts, suggestions are
  confirmed by Save and dismissible per row.

Assets — import:
- FR4. Import creates an Alga asset via the existing `createAsset` action:
  `client_id` = the mapped client, `name` = Hudu asset name,
  `serial_number` = `primary_serial` (when present), `asset_type` = layout
  map lookup (fallback `unknown`), `asset_tag` = `primary_serial` if unique
  else `hudu-<hudu asset id>`, `status` = the tenant's default/first asset
  status (same default the manual create form uses). A mapping row is
  created atomically with the asset.
- FR5. "Import all unmatched" imports every unmapped, unsuggested Hudu asset
  for the client sequentially, reporting created/failed counts; individual
  failures don't abort the batch.
- FR6. Import requires the `asset` RBAC create permission (in addition to the
  Phase 1 client-tab gate); the UI hides Import affordances without it.

Assets — sync:
- FR7. "Sync from Hudu" re-fetches the company's Hudu assets and, for each
  mapped pair, updates the Alga asset's synced fields — `name`,
  `serial_number` — when they differ (Hudu wins on synced fields only;
  other Alga fields untouched). `asset_type` is not retro-changed.
- FR8. Sync flags mappings whose Hudu asset is archived/absent as stale
  (metadata `stale: true` + UI badge); it never deletes Alga assets or
  mappings. Unflagging happens automatically if the asset reappears.
- FR9. Sync records `last_synced_at` on affected mapping rows and surfaces a
  result summary (updated / unchanged / stale counts) in the UI.
- FR10. Sync requires the `asset` RBAC update permission.

Layout→type map:
- FR11. `hudu_integrations.settings.asset_layout_type_map` (jsonb:
  `{ "<layout_id>": "<alga asset_type>" }`) with server action get/set
  (system_settings update RBAC) and live layout listing via
  `GET /api/v1/asset_layouts`.
- FR12. Heuristic prefill computes suggested types for unconfigured layouts
  (UI-side); unconfigured layouts import as `unknown`.

Documents — client section:
- FR13. Client Documents tab renders a link-only "Hudu Documentation"
  section (name, updated_at, deep-link) using the Phase 1 per-company
  articles fetch/cache; same gate as the client Hudu tab; collapsed by
  default; independent error/empty states that never break the native
  documents UI.

Documents — global tab:
- FR14. A server action lists Hudu articles across companies (no
  `company_id` filter), one Hudu page per request (25 items), passing the
  user's search term to Hudu, and resolves each article's `company_id` to
  the mapped Alga client via the companies cache + mapping rows.
- FR15. Documents page "Hudu" tab renders the paged list with search,
  resolved client names ("Unmapped" badge otherwise), and deep-links.
  Visible only when EE + flag + connected; CE/flag-off tenants see no trace.
- FR16. All new server surfaces enforce the Phase 1 guard chain (EE add-on +
  tier + flag + RBAC) server-side, not just in the UI.

## Non-functional Requirements

- NFR1. Pull-only; no Hudu writes anywhere.
- NFR2. Respect Hudu limits: never fan out unbounded page fetches; bulk
  import/sync fetch the company's assets with bounded pagination and stop on
  rate-limit (429) with a typed, user-visible error.
- NFR3. Article content is never persisted; only ids/names/timestamps already
  cached for lists.
- NFR4. Mapping rows remain direction-agnostic (no pull-only columns).
- NFR5. New UI strings fully translated (8 locales) and pass the Phase 1
  i18n static checks (extended to new components).

## Data / Integration Notes

- No new tables. Asset mappings reuse `tenant_external_entity_mappings`
  (indexes verified: uniqueness is per `alga_entity_type`, so client and
  asset mappings coexist). Layout map lives in `hudu_integrations.settings`.
- New `HuduClient` surfaces: `GET /api/v1/asset_layouts`, global
  `GET /api/v1/articles?page=&search=` (verify Hudu's article search param
  name during implementation; fall back to `?name=` filter if needed).
- Alga asset creation: `createAsset` in `packages/assets/src/actions/
  assetActions.ts` (`CreateAssetRequest`: fixed `asset_type` enum, required
  `asset_tag`/`status`).
- Client Documents tab host: `ClientDetails.tsx` tab id `documents`;
  EE injection follows the Phase 1 `useHuduClientTab` precedent.
- Documents page: `packages/documents/src/components/DocumentsPage.tsx`.

## Risks

- R1. Hudu asset layouts are arbitrary per instance; the heuristic prefill
  will misclassify exotic layouts → mitigated by explicit admin map +
  `unknown` fallback.
- R2. `asset_tag` uniqueness semantics in Alga need verification before
  using `primary_serial` as tag (fallback `hudu-<id>` is always unique).
- R3. Cross-client article listing's client resolution depends on the
  companies cache freshness; stale cache shows "Unmapped" — acceptable,
  refreshable.
- R4. DocumentsPage is a CE package surface; the EE tab must be injected
  without breaking CE builds (follow the ClientDetails gate-hook pattern).

## Open Questions

- OQ1. Hudu global article search: exact query param (`search` vs `name`)
  and whether it spans body or title only — verify against the local
  instance during implementation.
- OQ2. Asset status default on import: confirm the tenant's default status
  source used by the manual create form and reuse it.

## Acceptance Criteria

- AC1. A technician can map, import (single + bulk), and sync a client's
  Hudu assets entirely from the client Hudu tab, with explicit Save
  confirmation and no destructive surprises (stale ≠ deleted).
- AC2. An imported asset appears in Alga's asset module with correct client,
  name, serial, and type per the layout map, and is immediately mapped.
- AC3. Sync updates renamed/re-serialed Hudu assets' mapped Alga twins and
  flags disappeared ones, reporting counts.
- AC4. The client Documents tab shows the mapped company's Hudu articles and
  deep-links correctly; unmapped/disconnected clients show nothing extra.
- AC5. The Documents page Hudu tab lists and searches articles across
  companies with correct client resolution and pagination; invisible on CE
  or with the flag off.
- AC6. All new strings translated in 8 locales; i18n static checks extended
  and green; full Hudu unit suite green.

# Hudu Integration — Phase 2.1: Attributes, Layout Exclusion, Multi-Source Guard

- Status: Approved (scope picked by Natallia 2026-06-12)
- Phase: 2.1 (pull-only, Hudu → AlgaPSA)
- Predecessors: Phase 1 (`2026-06-08-hudu-integration`), Phase 2 (`2026-06-11-hudu-integration-phase2`)

## Overview

Three gaps surfaced while reviewing Phase 2:

1. **Hudu field data (incl. Notes) isn't imported** — Hudu assets carry their
   real documentation in per-layout custom `fields[]`; Phase 2 imported only
   name/serial/type.
2. **Every Hudu layout is importable** — but most layouts (API Secrets,
   Contracts & SLAs, Cloud Accounts…) aren't devices and shouldn't become
   AlgaPSA assets at all.
3. **Multi-source sync is unguarded** — NinjaOne's sync engine already
   creates/updates Alga assets; Hudu sync writing name/serial to the same
   asset means last-writer-wins ping-pong, and import can create duplicates
   when serials are absent or unmatched.

## Verified foundations

- Live `assets` columns include `attributes jsonb` (NinjaOne precedent for
  integration extras), `rmm_provider/rmm_device_id/agent_status/last_seen_at`
  (direct RMM-ownership signal), and `notes_document_id` (document-backed
  notes — NOT used here; creating documents from Hudu content would break the
  link-only philosophy and invite drift).
- Hudu `fields[]` shape (live): `{ id, label, value, position }`, ordered by
  position; values are strings/dates/numbers/null.

## Goals

- G1. Import and sync copy a Hudu asset's `fields[]` into the Alga asset's
  `attributes` under a Hudu namespace; the asset detail page renders them.
- G2. The layout map supports **Don't import** per layout; import paths skip
  excluded layouts.
- G3. Hudu sync never fights an RMM for device facts; import never silently
  creates a serial-duplicate of an existing asset.

## Non-goals

- Per-field mapping UI (Hudu field → specific Alga column) — the namespace
  copy is wholesale and read-only.
- Writing Hudu data into `notes_document_id` / creating Alga documents.
- Per-tenant configurable field-precedence matrix (the fixed RMM-wins rule is
  this phase; config comes if a real need appears).
- Touching NinjaOne's sync engine.

## Functional Requirements

Hudu attributes (group `hudu-attributes`):
- FR1. `HuduAsset` contract gains `asset_layout_id` and `fields[]` (lifting
  the Phase 2 local typing into contracts.ts).
- FR2. Import writes `attributes.hudu_fields = [{label, value}]` (position
  order preserved) and `attributes.hudu_synced_at`; other attributes keys
  untouched.
- FR3. Sync refreshes `attributes.hudu_fields` on every mapped, live Hudu
  asset (the Hudu namespace is always Hudu-won, independent of the RMM rule);
  a row counts as `updated` if name/serial OR hudu_fields changed.
- FR4. Asset detail page renders a read-only "Hudu Documentation" card
  listing label/value pairs whenever `attributes.hudu_fields` is non-empty.
  Pure data-presence gate — no EE import, no flag check (the data only exists
  if the EE integration wrote it), so the card lives in packages/assets (CE)
  next to its siblings.
- FR5. New UI strings i18n'd in all 8 locales in whatever namespace the
  asset detail components already use.

Layout exclusion (group `layout-exclude`):
- FR6. The layout-type map accepts `'excluded'` alongside the six asset
  types; normalization/validation updated; `resolveAssetTypeForLayout`
  exposes exclusion distinctly (not as 'unknown').
- FR7. Settings UI type select gains a "Don't import" option.
- FR8. Single import of an excluded-layout asset returns a typed
  `layout_excluded` failure; bulk import skips excluded-layout assets and
  reports a `skipped` count in the summary.
- FR9. The client-tab mapping manager hides the Import affordance (and
  excludes the row from "Import all unmatched" counts) for excluded-layout
  rows; mapping an excluded-layout Hudu asset to an EXISTING Alga asset
  remains allowed (context-linking is harmless).

Multi-source guard (group `multi-source-guard`):
- FR10. Sync skips `name`/`serial_number` writes for assets with
  `rmm_provider` set (RMM owns device facts); it still refreshes
  `attributes.hudu_fields` and stale flags for them. Summary gains an
  `rmmSkipped` count surfaced in the UI alongside updated/unchanged/stale.
- FR11. Import pre-checks tenant-wide for an existing asset with the same
  non-blank serial_number; hit → typed `serial_conflict` failure naming the
  existing asset (id + name); bulk records these per-row under `failed` with
  the code.
- FR12. Mapping manager renders bulk-import summaries distinguishing
  created / skipped (excluded) / failed (incl. serial conflicts).

Cross-cutting:
- FR13. Permissions sweep and i18n static scan stay green (no new action
  modules; new strings added to scans where components are Hudu-owned).

## Acceptance Criteria

- AC1. Importing EC-WS-001 lands its Hudu fields on the Alga asset and they
  render on the asset page; re-sync after editing a field in Hudu updates it.
- AC2. "API Secrets" marked Don't import → invisible to Import-all, single
  import fails typed, row not importable in UI but still mappable.
- AC3. An asset with rmm_provider='ninjaone' mapped to a Hudu asset keeps its
  RMM name/serial through a Hudu sync, while its hudu_fields refresh; the
  summary shows it under rmmSkipped.
- AC4. Importing a Hudu asset whose serial matches any existing tenant asset
  fails with serial_conflict naming the existing asset.
- AC5. Full hudu suites green; locale files updated in 8 languages.

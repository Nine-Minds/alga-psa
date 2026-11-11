# Scratchpad — Asset checkout parity

## Origin

- alga-2026-0002944: a customer asked about Snipe-IT-style assignments so they can migrate off Snipe-IT.
- Previous plan: `ee/plans/2026-10-09-asset-fields-assignment-bundles-merge/` (PR #3763, merged 2026-10-17). Its non-goals (lines 36-44) deferred check-in/check-out with acceptance, licenses, accessories, consumables, components and the Snipe-IT connector. This plan picks them up.

## State of main (4039f46381, 2026-11-09)

- **Assignment**
  - `asset_assignments` (`server/migrations/20261009122000_create_asset_assignments.cjs`) is contact-only (`contact_name_id NOT NULL`). Its sources are manual, api, rmm, bundle, import, merge, system. One open row per asset is enforced in the app only.
  - Writer: `setAssetAssignee` in `shared/models/assetAssignmentModel.ts:116` (re-exported from `packages/assets/src/lib/assetAssignment.ts`). It writes `asset_history` change_type `assignee_changed`.
  - Callers:
    - `assetActions.ts:1193` (create) and `:1552` (update)
    - `AssetService.ts:774` (REST)
    - `shared/rmm/autoAssignFromSignedInUser.ts:88`, `shared/rmm/signedInUserMappings.ts:336,390`, `shared/rmm/moveRmmOrganizationAssets.ts:83`
    - `shared/models/assetGroupContactModel.ts:42`
    - `assetGroups.ts:275,291,373,457`
    - `server/src/lib/migrations/appliers/entityAppliers.ts:508-556`
  - `assignAssetContact` (`packages/assets/src/actions/assetAssignmentActions.ts:127`) publishes only `ASSET_UPDATED` (the comment says so deliberately).
- **Events:** `ASSET_ASSIGNED` / `ASSET_UNASSIGNED` payloads already have owner type/id fields (`packages/event-schemas/src/schemas/domain/assetMediaEventSchemas.ts:31-49`). Today they fire only for ticket/project association and client transfer (`assetActions.ts:1640, 3737, 3806`).
- **UI**
  - Assign: `AssetAssigneeRow.tsx` (Identity tile, ContactPicker dialog), `AssetForm.tsx:1445`, `QuickAddAsset.tsx:310`
  - Bulk assign: `AssetDashboardClient.tsx:769-880`
  - Holder pages: `ContactAssetsSection.tsx`
  - History: timeline only (`AssetTimeline.tsx:125`). `getAssetAssignments` has no UI consumer.
- **Groups:** `assetGroups.ts`. A bundle owner cascades to members; shared-workspace members are holder-less.
- **Relationships:** `asset_relationships` is free-text parent/child (`RelatedAssetsTab.tsx`). It has no holder semantics, so we use holder_kind=asset rather than overloading relationships.
- **Loaners** (`packages/inventory/src/actions/loanerActions.ts`): `stock_units.loan_due_at`, client-level only. Overdue is computed in the UI only (`LoanersManager.tsx:162`).
- **Inventory**
  - `stock_levels` is per (service_id, location_id) with on_hand, reserved and held.
  - `stock_movements` is append-only.
  - `product_inventory_settings` has is_serialized and creates_asset_on_delivery.
  - `stock_locations` has no client column; location_type defaults to warehouse.
- **Licenses:** nothing. `software_catalog.is_managed` is a flag only; `asset_software` is RMM-discovered installs.
- **Acceptance:** quotes have the full pattern:
  - `quote_decisions` (`20261101130000`, plus `agreement_version` in `20261101130100`)
  - `quote_access_links` (`20261108000000`)
  - services `packages/billing/src/services/quoteDecisionService.ts`, `quoteLinkDecisionService.ts`, `quoteAcceptanceFinalizationService.ts`, `lib/quoteAcceptance.ts`
  - public page `server/src/app/quote/[token]/page.tsx`
  - decision route `server/src/app/api/quote/[token]/decision/route.ts`
- **Date triggers**
  - Sources live in `packages/jobs/src/lib/dateTriggers/sources/` (`assetWarrantyEnd.ts` and `assetMaintenanceDue.ts` are the models), with registry `dateTriggers/registry.ts`.
  - Definitions: `packages/event-schemas/src/schemas/domain/dateTriggerSourceDefinitions.ts`.
  - The hourly scan dedupes through `date_trigger_emissions`.
  - Do not add per-tenant pg-boss crons (LEVERAGE note in `initializeScheduledJobs.ts:63`).
- **Email**
  - Templates: `system_email_templates` and `tenant_email_templates`, with notification categories and subtypes as the gate.
  - Seed pattern: `20251217211644_add_project_task_assigned_email_templates.cjs`.
  - Send pattern: `projectEmailSubscriber.ts:339-445` and `sendEventEmail` (`server/src/lib/notifications/sendEventEmail.ts`).
  - `OutboundMailClass` has no asset class; `general` fits.
- **Service requests:** field types live in `basicFormBuilder.ts:5-11`. Answer-mapping destinations live in `server/src/lib/service-requests/mapping/destinations/` (`assetDestinationProvider.ts` writes onto an asset).
- **Portal visibility:** `asset_scope` in `packages/authorization/src/portal/visibility.server.ts:196-245`, applied through `applyAssetVisibilityFilter` (`portal/visibility.ts:386`) on `assets.contact_name_id`. Keeping `contact_name_id` equal to the effective contact keeps this working unchanged.
- **Import:** there is no Snipe-IT importer. The AMP migration framework is `packages/migration-spec`, `migration-connectors` (csv, connectwise), `migration-sdk` and `migration-cli`, plus appliers. The CSV asset import (`server/src/lib/imports/assetFieldDefinitions.ts`) has no assignee field.
- **Mobile:** `ee/mobile/src/screens/AssetDetailScreen.tsx:283` shows the assignee read-only.

## Decisions

- **One checkout engine and ledger for every item kind and holder kind,** rather than adding expected-date columns to `asset_assignments` and separate tables for licenses and accessories. Snipe-IT's model is exactly this product (holdable × holder). One engine makes the asset, license and stock paths one invariant set and one event stream.
- **Keep `assets.contact_name_id` as the effective contact,** resolved through asset-holder chains. Portal visibility, list filters, RMM matching and every existing reader keep working without change.
- **Accessories, consumables and components are inventory products** at client-owned stock locations, not new catalogues. Inventory already has stock levels, movements, locking and reorder points. The only missing piece is that a stock location can belong to a client.
- **Extract a generic acceptance engine** instead of copying quote acceptance. Quotes are the second consumer and can move onto it in a follow-up (non-goal here). Evidence: two subjects with the same shape (signed link, agreement hash, signer, ip/UA, receipt stamp).
- **Overdue uses the date-trigger framework,** not a new cron.
- **Requests go through service requests** (new field type and destination), not a bespoke request queue.
- **Emails default off for existing tenants** to avoid surprise mail to end users.

- **Open questions settled with Robert, 2026-11-09:**
  - Loaners become checkouts, and a new holder kind `client` exists for company-level loans.
  - `client_id` stays required; MSP-owned items use the tenant's own client record (`tenant_companies.is_default`) with holder rules that depend on ownership.
  - Location-held assets are visible in the portal to client-scope users only for now.
  - The Snipe-IT connector stays in this plan as two slices, with part 1 right after the engine.
  - One flag, `asset-checkout`.
- The `asset-checkout` flag is defined in the board catalog; the PostHog flag itself must exist before flagged slices ship (missing flag evaluates off).

## Follow-ups (not in this plan)

- Portal visibility of location-held assets for contacts at that location, once contact locations land.

- Move quote acceptance onto the acceptance engine.
- Drop `asset_assignments` once nothing reads it.
- Drop `stock_units.loan_due_at` once nothing reads the mirror.

## Commands

- Validate the plan: `python3 ~/.claude/skills/alga-plan/scripts/validate_plan.py ee/docs/plans/2026-11-09-asset-checkout-parity`

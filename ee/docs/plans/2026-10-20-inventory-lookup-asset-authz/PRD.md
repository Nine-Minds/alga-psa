# PRD: Inventory scan lookup must authorize asset results (B2)

- PSA ticket: alga-2026-0002683
- Parent plan: `ee/docs/plans/2026-10-20-physical-work-tags/PLAN.md` (card B2), `ANALYSIS.md` ("Bugs found", B2)
- Note: no Design Session plan existed for this card; it was implemented from the work order and card dossier decisions.

## Problem
`GET /api/v1/inventory/lookup` checks only `inventory:read`. A caller with that permission alone can find assets by
`serial_number` or `asset_tag`, from the mobile scanner or via MCP `call_api_endpoint`.

## Goal
A caller sees an asset in lookup results only if they have `asset:read` AND pass the asset record-level authorization.
Product and unit results are unchanged.

## Binding decisions
1. **Deny by default.** `InventoryService.lookup(code, context, authorizeAssets?)` takes an explicit asset-visibility
   function. Omitted => no assets are ever returned.
2. **Filter inside the service**, before `domains` is computed and before shaping. Never post-filter the response union
   (`multi` requires >= 2 matches). Removing an asset collapses `multi` -> single type, and `asset` -> `none`
   (including the normal `none` candidate search, which never contains assets).
3. **Authorization**: `hasPermission(user, 'asset', 'read')` short-circuits; otherwise `authorizeApiResourceRead({resource:'asset', recordContext})`
   per row, with `recordContext` from `resolveAssetAuthorizationRecords`. No SQL `RelationshipSqlAdapter` in this card.
   The controller builds the authorizer from the request (user, tenant, apiKeyId).
4. **Silent denial.** No reason/suppressed field, no 403, no header. An unreadable asset looks exactly like no match.
5. **Shared helper moved** to `packages/assets/src/lib/assetRecordAuthorization.ts` (exposed through the existing
   `@alga-psa/assets/lib/*` export); `assetActions.ts` imports it. Kernel construction and `assertAssetReadAllowed` stay.
6. **No mobile production changes** (card C3 owns scan routing). Mobile deliverable: `ScanResultCard` tests for an
   asset-less `multi` and a `none`.

## Non-goals
Batch authorization API, SQL relationship adapter for assets, mobile routing changes.

## Risks / notes
- Per-row kernel calls: cost is bounded (serial/tag matches are a handful of rows) but is N kernel calls; marked `LEVERAGE`.
- Record-level narrowing for internal users only exists in the enterprise kernel (bundles); the CE kernel is allow-all
  for internal users, so in CE `asset:read` is the effective gate.
- API-key subjects: `authorizeApiResourceRead` receives `apiKeyId`, so API-key-targeted bundle rules apply.

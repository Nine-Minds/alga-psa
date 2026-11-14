# Action-aware asset record authorization

PSA ticket: `alga-2026-0002940`

## Problem

`updateAsset` checks the coarse `hasPermission(user, 'asset', 'update')`, then authorizes the record via
`createAuthorizedAssetReadContextForUser` (`packages/assets/src/actions/assetActions.ts` ~612). That goes
through `assertAssetReadAllowed` -> `authorizeAssetReadDecision` (~552), which hard-codes
`resource.action: 'read'`.

The bundle provider only applies rules whose `resource` and `action` exactly match the request
(`packages/authorization/src/kernel/providers/bundleProvider.ts:73-77`). The `restricted-asset-operator`
starter bundle (`packages/authorization/src/bundles/starterBundles.ts:43-49`) sets read = `selected_clients`
and update = `same_team`. A subject who can read an asset but is outside its team therefore passes the
record check on every mutation, because only the read rule is ever evaluated.

The same read-only helper guards all asset mutations (update, delete, relationships, schedules,
occurrences, maintenance history, associations). The document attach/detach actions
(`assetDocumentActions.ts`) make no record-level decision at all.

## Design

- New primitive in `packages/authorization/src/assetReadAuthorization.ts`:
  `isAssetActionAllowed(trx, tenant, context, asset, action: 'read' | 'update' | 'delete')`. The kernel
  request carries the caller's action. `isAssetReadAllowed` stays as a thin wrapper that passes `'read'`.
  The batch `filterReadableAssets` stays read-only (no mutation path uses it).
- Re-exported through `packages/assets/src/lib/assetReadAuthorization.ts` (already `export *`).
- `assetActions.ts` private helpers become action-aware: `authorizeAssetDecision(..., action)`,
  `assertAssetActionAllowed`, `assertAssetActionAllowedById`,
  `createAuthorizedAssetContextForUser(trx, tenant, user, asset_id, action)`. Read-path helpers keep their
  names as read wrappers. Errors name the action (`Permission denied: Cannot update assets`).
- The coarse `hasPermission` pre-filters stay. Each record decision runs inside the write transaction,
  before the write.
- File rename to `assetAuthorization.ts`: not done. It would touch the package `exports` map and every
  import for no behavioural gain; the filename is kept.

## Missing bundle rules

`BundleAuthorizationKernelProvider.evaluateNarrowing` filters rules by exact resource+action. With zero
matching rules it returns `ALLOW_ALL_SCOPE` with no reasons (no narrowing). So a bundle with no
`asset:delete` rule does not deny deletes; the builtin provider and the coarse permission still apply. No
bundle rules are added by this change.

## Caller classification

| Caller (assetActions.ts unless noted) | Action |
|---|---|
| getAsset, getAssetDetailBundle, getAvailableAssetFacts | read |
| getAssetRelationships | read |
| getAssetMaintenanceSchedules, getAssetMaintenanceReport, getAssetHistory, getAssetLinkedTickets, getAssetSummaryMetrics | read |
| listAssets / entity lists / maintenance summaries / aggregates (batch decisions) | read |
| updateAsset (and bulkUpdateAssets via updateAsset) | update |
| deleteAsset (and bulkDeleteAssets via deleteAsset) | delete |
| createAssetRelationship, deleteAssetRelationship (both assets) | update |
| createMaintenanceSchedule, updateMaintenanceSchedule | update |
| deleteMaintenanceSchedule | delete |
| getOccurrenceForMutation (createOccurrenceTicket, completeOccurrence, skipOccurrence) | update |
| setSchedulePaused, setOccurrenceTicketAssignee, recordMaintenanceHistory | update |
| createAssetAssociation, removeAssetAssociation | update (detach edits the asset) |
| assetDocumentActions: associateDocumentWithAsset, removeDocumentFromAsset | update (new record decision in the transaction) |

## Test plan

- Unit: `isAssetActionAllowed(..., 'update')` sends `action: 'update'` to `authorizeResource`; the read
  wrapper sends `'read'`. Fails against the old code (no such export; hard-coded read).
- Regression: `updateAsset` for a subject whose read is allowed but update is denied returns permission
  denied and the row is not written; an allowed subject succeeds.
- Contract test (`assetAuthorization.contract.test.ts`) updated to assert the action-aware helpers and the
  `'update'` / `'delete'` arguments.
- Typecheck authorization, assets, inventory, server.

# SCRATCHPAD: equipment custody (C4)

## Adaptations from design (main moved on)
- C2 merged (main 484bfecb8f). `origin/main` merged into branch. Label seam = `PrintLabelsDeps.getLinkedAssetParts` (server/src/lib/labels/printLabels.ts) backed by `packages/assets/src/lib/ticketLinkedAssetLabels.ts`; extend it to also carry `custodyLocation`/`nextAction`; no second path.
- Authorization extraction done on main: `packages/assets/src/lib/assetReadAuthorization.ts` (`createAssetReadContext`, `isAssetReadAllowed`, `resolveAssetAuthorizationRecords`). Reuse; no `assetAuthorization.ts`.
- ANALYSIS.md/PLAN.md were already on main (identical to the staged copies), so they arrive via the merge.
- Print work tag button: TicketDetails.tsx header (~3830); Receive equipment sits beside it via `renderReceiveEquipment` prop (pattern of `renderQuickInvoice`, TicketDetails.tsx ~264).

## RMM finding
RMM resync never overwrites `assets.status` on existing assets (FR-B6): `shared/rmm/sharedAssetIngestionService.ts` writes status on create only. Only the tombstone path sets `status='retired'` (sharedAssetIngestionService.ts:163, NinjaOne syncEngine `markAssetAsDeleted`). Intake assets are not RMM-synced. Queue/open-episode checks key off the open custody row.

## Log
(append as work proceeds)

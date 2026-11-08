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

## Implementation log (final pass)

- Label seam: `custodyLocation` / `nextAction` added to `LabelViewModel`, bindings, `buildTicketWorkTag`, `ticketLinkedAssetLabels` and `printLabels` merge. Custody lines replace the work-reason line at render time (`buildLabelModel`, ticket-work-tag only). Several held items -> "<n> items held", no next action. Designer sample data keeps custody empty so preview == print.
- Line budget: verified arithmetically in `buildLabelModel.test.ts` (text column worst case incl. 3-line identifier <= 44 mm). The Puppeteer containment test has a new worst-case entry but its suite (`labelBatch.e2e`) cannot run in this checkout (missing `jsqr`, `@zxing/library`, `bwip-js` packages), so the rendered check is not executed.
- REST: `ApiAssetCustodyController`; OpenAPI routes registered in `openapi/routes/assets.ts`. Generated artefacts (`sdk/docs/openapi/*.json`, `registry.generated.ts`) NOT regenerated: the generator needs built workspace dists that are absent here.
- Tests: unit (state machine, label format, schemas via integration), integration (invariant, refusals, Dell scenario, record-level filtering, migration idempotence/ownership default), API controller, static import guards, label tests.
- Browser walkthrough not done (left to a later step).

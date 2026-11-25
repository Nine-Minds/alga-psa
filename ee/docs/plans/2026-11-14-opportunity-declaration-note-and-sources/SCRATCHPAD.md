# Scratchpad — opportunity declaration note and sources

Ticket: `alga-2026-0002932`. Follows PR #4018 and `docs/plans/2026-10-29-opportunity-evidence-citation.md`.

## Decisions

- **Several sources per declaration, in a child table.** The workflow that prompted the work has an
  interaction and a document behind one stage. A child table keeps "one live declaration per
  checkpoint" from #4018 and lets the ladder resolve labels with joins. A jsonb array on the
  evidence row was rejected: no join for label resolution, and no way to ask what cites a record.
- **`ref_type` / `ref_id` on the evidence row are system-only again.** They are the de-dupe key in
  `recordEvidence` and name the record that produced the evidence. User citations are supporting
  material, a different thing, so they get their own home and the #4018 rows are backfilled.
- **Amend supersedes, it does not update in place.** The ledger never deletes; a correction trail is
  how it records change. The replacement inherits `recorded_at` / `recorded_by` so stage timing is
  stable.
- **Patch semantics on content** (`undefined` keeps, `null` / `[]` clears). This is what lets a
  board move, an API stage call with no body, and a step completion pass nothing and lose nothing.
- **Board move stays promptless.** With amend available, the deal page is where a declaration gets
  its note and sources.
- **No placeholder note.** `Stage manually set to <stage>` was written into `detail` and would show
  up as the user's note in the edit dialog. Store `NULL`, clear the existing exact matches.
- **Amending a system-evidenced stage creates a user declaration** that then holds the stage on its
  own. Intended; called out in the PRD so a reviewer can object.

## Discoveries

- Current stage is not clickable: `OpportunityStepTimeline.tsx`, `canSetStage`.
- `OpportunityDetailHost.submitDeclaration` passes `detail` `undefined`; the board
  (`OpportunitiesHub.handleDeclareStage`) passes neither note nor source.
- Step completion declares with the step title: `opportunityStepActions.ts`, `completeOpportunityStep`.
  That is where most existing `user_declared` notes come from.
- `recorded_at` readers: `workQueueActions.ts` (min per checkpoint) and `workQueueBuckets.ts`
  (`daysSinceVerbal`), `ee/server/src/lib/opportunities/forecast.ts`, `drafting.ts`,
  `packages/reporting/.../opportunities/assessment-conversion.ts`, `lessons.ts`.
- `getDocumentsByEntity` defaults to page 1, limit 15, newest first.
  `getDocument(documentId)` in `packages/documents/src/actions/documentActions.ts` is the authorised
  single fetch; it is not yet on `DocumentsCrossFeatureCallbacks`
  (`packages/core/src/context/DocumentsCrossFeatureContext.ts`, provider in
  `packages/msp-composition/src/documents/MspDocumentsCrossFeatureProvider.tsx`).
- REST: `[id]/evidence` (GET list, POST declare), `[id]/evidence/[evidenceId]/correct`, `[id]/stage`.
  A `[checkpoint]` segment under `evidence/` would collide with `[evidenceId]`, hence
  `[id]/declarations/[checkpoint]`.
- Opportunity tables are distributed by `distributeOpportunityTables` in
  `server/migrations/20260712100000_create_opportunities_tables.cjs` (`colocate_with => 'tenants'`).
- Places that list `opportunity_evidence` by name: `packages/db/src/lib/tenantTableManifest.ts`,
  `tenantTableMetadata.ts`, `tenantTableForeignKeys.ts`,
  `ee/temporal-workflows/src/activities/tenant-deletion-activities.ts`.
- Opportunities has no feature flag. `/msp/opportunities` is allowed for product `psa` in
  `server/src/lib/productSurfaceRegistry.ts`.
- No generic multi-select in `packages/ui`; the sources field is a chosen list plus
  `SearchableSelect` (it supports `group`).

## Gotchas

- Migration lint: ADD CONSTRAINT on an existing table must be NOT VALID with VALIDATE in a separate
  transaction-free file (see the two `20261031120*` migrations). Declaring constraints at table
  creation avoids it for the new table.
- `create_distributed_table` cannot run inside a transaction. Read the `citus-migration-gotchas`
  skill before writing the migration; stale local heap rows can break unique indexes after
  distribution.
- Citus rejects `now()` inside CASE / COALESCE; bind timestamps in the backfill.
- Generated files to refresh: `sdk/docs/openapi/*`, `server/src/lib/mcp/registry.generated.ts`,
  `ee/server/src/chat/registry/apiRegistry.generated.ts`.
- Existing tests that assert the #4018 shape and will change: `packages/opportunities/tests/`
  `stageEngineCitation.test.ts`, `declareStageDialog.test.tsx`, `opportunityEvidenceCitation.test.tsx`,
  `opportunityDetail.test.ts`.

## Production facts (identifiers withheld)

- Live image contains #4018; both `20261031120*` migrations applied 2026-11-13.
- `opportunity_evidence_ref_type_check` is validated and admits `'document'`.
- In the tenant checked, no evidence row carries a citation yet, so the backfill is close to empty
  there. Check the fleet-wide count before relying on that.

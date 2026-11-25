# PRD — Stage declarations carry a note and their sources, and can be edited without moving the deal

- Slug: `opportunity-declaration-note-and-sources`
- Date: `2026-11-14`
- Status: Draft
- Ticket: `alga-2026-0002932`
- Follows: PR #4018 (`docs/plans/2026-10-29-opportunity-evidence-citation.md`)

## Summary

PR #4018 let a stage declaration cite one interaction or document. It can only be done at the moment
a deal moves to a new stage, it drops the written note when it is used, and it holds one source.
This plan makes the declaration behind a stage a thing a user can read and edit on its own: a note
plus any number of sources, editable on any stage the deal has reached, without moving the deal.

## Problem

Verified on main at `6fd7bf2e85`:

1. **The current stage cannot be cited.** `StageSegment` in `OpportunityStepTimeline.tsx` computes
   `canSetStage = Boolean(onStageSelect) && !isCurrentStage`, and the rung circle is the only way
   into the declare dialog. A deal that is already at a stage can only get a source by being moved
   back a stage and forward again. That corrects the existing evidence and publishes two
   `OPPORTUNITY_STAGE_CHANGED` events.
2. **Note and source are mutually exclusive in the UI.** `DeclareStageDialog` has only the source
   picker. `OpportunityDetailHost.submitDeclaration` passes `detail` as `undefined`, so
   `buildStageDeclarationPlan` writes the placeholder `Stage manually set to <stage>`. Because a new
   declaration supersedes the live one for that checkpoint, adding a source replaces a written note
   with the placeholder.
3. **One source per stage.** `opportunity_evidence` holds a single `ref_type` / `ref_id`. The
   natural shape of the workflow is a call logged as an interaction plus its transcript filed as a
   document, both behind the same stage.
4. **A step completion can overwrite a declaration.** `completeOpportunityStep` calls
   `declareStage(..., result.completed.title)` with no source. Under the #4018 supersede rule that
   replaces a live cited declaration at the same checkpoint with the step title.
5. **A cited document does not always open.** `OpportunityCitationDocument` looks the document up in
   `getDocumentsByEntity(opportunityId, 'opportunity')`, which returns the first page (15, newest
   first). On a deal with more documents, the link for an older cited document renders and does
   nothing.

Production check (identifiers withheld): the constraint migrations from #4018 are applied and the
feature is live. At the time of writing no evidence row in the reporting tenant carries a citation,
and one open deal sits at a stage declared before #4018 with a written note. So the first real use
of the feature hits problems 1 and 2 together.

## Goals

- A user can add, change and remove the note and the sources on the declaration for any reached
  stage, including the current one, without changing the deal's stage.
- Declaring a stage takes a note and sources together.
- A declaration can cite several sources, each one a link that opens the interaction or document.
- Nothing but an explicit user edit rewrites a declaration's note or sources.
- A cited document opens regardless of how many documents the deal has.

## Non-goals

- Citations do not move a stage. `deriveOpportunityStage` still reads checkpoints only.
- No prompt when a deal is moved on the board. A board move stays one gesture; the declaration can
  be given its note and sources afterwards on the deal, which this plan makes possible.
- No citing of quotes, contracts, projects or schedule entries by a user. Those stay system refs.
- No attaching a document from inside the dialog. A document is attached to the deal first in the
  Documents tile.
- No editing of system evidence rows, and no editing of the `won` checkpoint.
- No carry-forward of a declaration across a backward move. Moving a deal back corrects the
  evidence above, as today; moving forward again starts a fresh, empty declaration.
- No feature flag, metrics or audit surface beyond the evidence ledger's own correction trail.

## Users and primary flows

MSP staff with the opportunity `update` permission, working a deal on the opportunity page or in
the opportunity drawer on a client's page.

1. **Add sources to a stage the deal is already in.** Open the deal, choose Edit evidence on the
   current stage, pick the call interaction and the transcript document, save. The stage is
   unchanged; the rung shows the existing note and two source links.
2. **Declare a stage with a note and sources.** Click a later stage's circle, write the note, pick
   sources, Declare. The deal moves; the rung shows the note and the links.
3. **Review a deal.** Read the note on a stage and click a source to open the interaction or the
   document.
4. **Edit or clear.** Open Edit evidence on a reached stage, change the note, remove a source, save.

## Design

### 1. A declaration is the live `user_declared` row for a checkpoint

Unchanged from #4018: at most one active (`corrected_at IS NULL`) `user_declared` row per
opportunity and checkpoint. This plan gives that row two pieces of content:

- **note**: `opportunity_evidence.detail`. `NULL` when the user wrote nothing. The engine stops
  writing the `Stage manually set to <stage>` placeholder; readers supply their own fallback.
- **sources**: rows in a new child table, `opportunity_evidence_citations`.

`ref_type` / `ref_id` on `opportunity_evidence` go back to one meaning: the domain record that
produced a system evidence row, and the key `recordEvidence` de-duplicates on. User citations no
longer live there.

### 2. Data model

New tenant table `opportunity_evidence_citations`:

| column | type | notes |
| --- | --- | --- |
| `tenant` | uuid, not null | distribution column |
| `citation_id` | uuid, default `gen_random_uuid()` | PK `(tenant, citation_id)` |
| `evidence_id` | uuid, not null | FK `(tenant, evidence_id)` to `opportunity_evidence` |
| `ref_type` | text, not null | CHECK `IN ('interaction', 'document')` |
| `ref_id` | uuid, not null | polymorphic, no FK (matches `opportunity_evidence.ref_id`) |
| `position` | integer, not null | order the user picked them in |
| `created_at` | timestamptz, default `now()` | |

Unique `(tenant, evidence_id, ref_type, ref_id)`. Index `(tenant, evidence_id)`.

The table is distributed on `tenant` and colocated with `tenants`, the same way
`20260712100000_create_opportunities_tables.cjs` distributes the other opportunity tables, and
before the foreign key is added. Constraints are declared at creation, so the NOT VALID lint rule
for existing tables does not apply. An undistributed tenant table is not acceptable: it forces Citus
self-connections on every join to a distributed table.

Data migrations, each idempotent:

- **Backfill citations.** For every `user_declared` evidence row (active or corrected) with
  `ref_type IN ('interaction', 'document')` and a `ref_id`, insert one citation at position 0, then
  set that row's `ref_type` and `ref_id` to `NULL`.
- **Clear placeholder notes.** Set `detail = NULL` where `source = 'user_declared'` and `detail`
  equals `'Stage manually set to ' || checkpoint` exactly.

The `opportunity_evidence_ref_type_check` constraint from #4018 is left as it is. It still admits
`'document'`; nothing writes it after this plan, and narrowing it buys nothing.

The new table is registered wherever `opportunity_evidence` is: `packages/db/src/lib/tenantTableManifest.ts`,
`tenantTableMetadata.ts`, `tenantTableForeignKeys.ts`, and
`ee/temporal-workflows/src/activities/tenant-deletion-activities.ts` (deleted before
`opportunity_evidence`).

### 3. Engine (`packages/opportunities/src/lib/stageEngine.ts`)

One content type and one writer:

```ts
export interface DeclarationContent {
  /** undefined keeps the live declaration's note; null or '' clears it. */
  note?: string | null;
  /** undefined keeps the live declaration's sources; [] clears them. */
  citations?: DeclarationRef[];
}
```

- `writeDeclaration` (internal) is the only code that inserts or supersedes a `user_declared` row
  for the open checkpoints. It resolves the content against the live declaration (patch semantics
  above), runs `assertRefBelongsToOpportunity` on every citation, and:
  - resolved content equals the live declaration's content: no write;
  - otherwise corrects the live row (`correction_note = 'Superseded by a new declaration'`,
    `corrected_by`, `corrected_at`) and inserts the replacement with its citation rows.
  - The replacement **inherits `recorded_at` and `recorded_by`** from the row it supersedes.
    `recorded_at` is when the stage was evidenced, and it is read by the work queue
    (`daysSinceVerbal`), the forecast and reports. Who edited, and when, is the superseded row's
    `corrected_by` / `corrected_at`.
- `declareStage(trx, tenant, opportunityId, stage, recordedBy, content?)` keeps its job: correct
  evidence above the target stage, write the declaration, derive the stage. Its `detail` and `ref`
  parameters become `content`. Declaring a stage that already has a live declaration with no
  content supplied leaves that declaration untouched.
- `amendDeclaration(trx, tenant, opportunityId, checkpoint, recordedBy, content)` is new. It
  requires the checkpoint to be reached (at least one active evidence row at that checkpoint) and
  refuses otherwise with a typed error; reaching a stage is `declareStage`'s job. It never corrects
  evidence at other checkpoints, and it publishes no `OPPORTUNITY_STAGE_CHANGED` event. It is
  allowed on open and closed opportunities, for `qualified`, `assessment`, `proposed` and `verbal`.
  - If the checkpoint is reached only by system evidence, amending inserts the first
    `user_declared` row beside it (`recorded_at` now, `recorded_by` the editor). That row is a
    declaration like any other: if the system evidence is later corrected, the user's declaration
    still holds the stage. This is intended; a person has stated the evidence.
- `assertRefBelongsToOpportunity` is unchanged and stays the single guard.
- A declaration holds at most 25 citations, and each `(type, id)` once.

**Step completion** (`opportunityStepActions.ts`, `completeOpportunityStep`): when the checkpoint
has a live declaration, the step completion leaves it alone. When it has none, it seeds one with the
step title as the note, as today. A step never rewrites what a user wrote or cited.

### 4. Read side (`packages/opportunities/src/lib/opportunityDetail.ts`, types)

`IOpportunityEvidenceLadderStep` gains:

```ts
declaration?: {
  evidence_id: string;
  note: string | null;
  recorded_at: ISO8601String;
  citations: Array<{
    citation_id: string;
    type: 'interaction' | 'document';
    id: string;
    /** Interaction title or document name; null when the target is gone. */
    label: string | null;
    /** True when the interaction is deleted or moved, or the document is no longer on this deal. */
    missing: boolean;
  }>;
} | null;
```

`evidence` stays the rung's first active evidence row, and loses `ref_label` / `ref_missing`.
Citations are resolved with tenant-constrained LEFT JOINs from the citations table, as
`loadActiveEvidenceWithCitations` does today, ordered by `position`. A missing target never errors.

`IOpportunityEvidence` (the REST list) gains `citations: Array<{ type, id }>`.

### 5. UI (`packages/opportunities/src/components`)

Standard components only: `Dialog`, `TextArea`, `SearchableSelect`, `Button`, `Badge`.

- **One dialog, two entry points.** `DeclareStageDialog` becomes the declaration dialog, opened to
  declare (title "Move to {stage}", submit "Declare") or to edit (title "Evidence for {stage}",
  submit "Save", fields prefilled from the rung's declaration). Fields:
  - Note: optional text area.
  - Supporting sources: the chosen sources as a list, each with a remove button, and a
    `SearchableSelect` that adds one, grouped Interactions / Documents, already-chosen entries
    left out. Labels are the interaction title or document name plus the date; never an id.
  - A chosen source whose target is gone shows as "Source removed" and can be removed.
  - A failed source lookup leaves the note and the submit button usable.
- **Rung.** Every reached rung from Qualified to Verbal shows, under the stage badge:
  - the note, when the declaration has one;
  - each source as a link (`Source:` then the links), opening the interaction drawer or the document
    viewer; a missing source is the muted "Source removed" badge;
  - an "Edit evidence" control (or "Add evidence" when the rung has no declaration), shown when the
    host provides the handler. It is shown on the current stage and on closed deals.
  - The rung circle still moves the deal, and still is not a control on the current stage.
- **Cited document.** `OpportunityCitationDocument` fetches the one cited document through the
  documents cross-feature context (add `getDocument` to `DocumentsCrossFeatureCallbacks`, backed by
  the existing authorised `getDocument` action) and opens the viewer with it. It no longer depends
  on a page of the deal's document list.
- **Both hosts.** The full page (`OpportunityDetailWithDrafting`) and the client-page drawer
  (`useOpportunityDetailsDrawer`) get the same behaviour through `OpportunityDetailHost`.
- **Locales.** New strings in every `server/public/locales/*/msp/opportunities.json`, including the
  pseudo-locales.

### 6. Server actions and REST

Actions (`opportunityActions.ts`), both behind opportunity `update`:

- `declareOpportunityStage(opportunityId, stage, content?)`.
- `amendOpportunityDeclaration(opportunityId, checkpoint, content)`.
- `listCitableSourcesForOpportunity` is unchanged.

REST (`OpportunityService`, `ApiOpportunityController`, `server/src/lib/api/schemas/opportunitySchemas.ts`,
`server/src/lib/api/openapi/routes/opportunitiesV1.ts`):

- `POST /api/v1/opportunities/{id}/evidence` and `POST /api/v1/opportunities/{id}/stage` accept
  `citations: [{ type, id }]` beside `detail`. `refType` / `refId` stay accepted as shorthand for a
  single citation; sending them together with `citations` is a 400.
- New `PUT /api/v1/opportunities/{id}/declarations/{checkpoint}` with `{ detail?, citations? }`,
  patch semantics as in the engine, returning the opportunity. An unreached checkpoint is a 409.
- `GET /api/v1/opportunities/{id}/evidence` returns `citations` on each row.
- Regenerate the OpenAPI documents under `sdk/docs/openapi/` and the generated registries
  (`server/src/lib/mcp/registry.generated.ts`, `ee/server/src/chat/registry/apiRegistry.generated.ts`).

Other readers of `detail`: `ee/server/src/lib/opportunities/drafting.ts` prints
`- {checkpoint}: {detail}` into the follow-up prompt and must print a fallback for a `NULL` note.

## Invariants

1. A citation never moves a stage, and an amendment never publishes a stage-changed event.
2. One live `user_declared` row per opportunity and checkpoint.
3. Only an explicit user declaration or amendment changes a declaration's note or sources.
4. Every citation is checked against the opportunity and tenant in the engine, whatever the caller.
5. A deleted or detached source degrades to "Source removed"; the ladder never breaks.
6. Editing a declaration does not change when its stage was recorded as reached.

## Risks

- **`recorded_at` drift.** If the replacement row takes a new timestamp, days-in-stage, forecast
  facts and reports shift. Covered by invariant 6 and a DB-backed test.
- **Citus.** New distributed table, a foreign key between colocated tables, and INSERT ... SELECT
  backfill. Follow the `citus-migration-gotchas` notes; `create_distributed_table` cannot run in a
  transaction.
- **Deploy order.** The old server reads `ref_type` / `ref_id` on `user_declared` rows. After the
  backfill it shows those citations as absent until the new server is live. Acceptable: the window
  is one deploy, and very few rows exist.
- **API compatibility.** `refType` / `refId` were published on 2026-11-13. They keep working.

## Acceptance criteria

- On a deal at Verbal with a written note, a user adds an interaction and a document through Edit
  evidence. The deal is still at Verbal, the note is intact, both sources are links that open, and
  no stage-changed event was published. The row's `recorded_at` is unchanged.
- Declaring a later stage with a note and two sources shows all three on the rung.
- Completing a step tied to a checkpoint that already has a declaration leaves its note and sources.
- A cited document opens on a deal with more than 15 documents.
- An amendment citing an interaction from another opportunity, or a document not attached to the
  deal, is refused with "That source is not attached to this opportunity".
- Rows cited under #4018 show the same source after the migration.
- All of the above behaves the same in the client-page opportunity drawer.

## Open questions

- None blocking. If product wants the board to prompt for a note and sources on a move, that is a
  separate change on top of this dialog.

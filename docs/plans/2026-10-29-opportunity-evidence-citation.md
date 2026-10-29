# Design — Let declared stage evidence cite the interaction or document behind it

Card: `94df4215` — Opportunity stage evidence can cite an interaction or document (Joymode).
Customer ask (2026-09-18): a deal's stage should point at the material that supports it, not just free text.

## What already exists (verified on main `d33b8a849a`)

- `opportunity_evidence` already has `ref_type` / `ref_id` (`server/migrations/20260712100000_create_opportunities_tables.cjs:123`).
- `RecordEvidenceInput` already carries `refType` / `refId`, and `recordEvidence` already persists and
  de-duplicates on `(checkpoint, ref_type, ref_id)` (`packages/opportunities/src/lib/stageEngine.ts:50-84`).
- `OpportunityEvidenceRefType` includes `'interaction'` but not `'document'`
  (`packages/types/src/interfaces/opportunity.interfaces.ts:30`).
- The table has a **CHECK constraint** naming the allowed ref types — it must be extended, not bypassed:
  `CHECK (ref_type IS NULL OR ref_type IN ('quote','contract','project','schedule_entry','interaction'))`
  (`server/migrations/20260712100000_create_opportunities_tables.cjs:145-147`).
- `declareStage(trx, tenant, opportunityId, stage, recordedBy, detail?)` records a `user_declared`
  evidence row through `buildStageDeclarationPlan` (`stageEngine.ts:89`), called from
  `opportunityActions.ts:119,133` and — system path — `opportunityStepActions.ts:352`.
- Declaring a stage is currently a bare click on a ladder rung: `onStageSelect` fires
  `declareOpportunityStage(id, stage)` with no dialog (`OpportunityDetailHost.tsx:201-209`).

So this is a **plumbing job on an existing mechanism**, not a new subsystem. The ref columns are
already there and unused; what is missing is (a) a way to put a ref on a *declaration*, (b) proof the
ref belongs to this opportunity in this tenant, (c) a picker, and (d) a link in the ladder.

## Decisions

### 1. The ref rides the declaration, not the checkpoint

`declareStage` gains an optional ref:

```ts
declareStage(trx, tenant, opportunityId, stage, recordedBy, detail?, ref?: {
  type: Extract<OpportunityEvidenceRefType, 'interaction' | 'document'>;
  id: string;
} | null)
```

Only `interaction` and `document` are accepted **for user declarations**. `quote`, `contract`,
`project` and `schedule_entry` exist for system evidence and stay system-only: a user asserting
"this contract is the evidence" is a different feature with different trust, and the picker will not
offer them. The server rejects them rather than trusting the client — the guard is not the UI.

### 2. A declaration supersedes, it does not stack

`recordEvidence` de-dupes identical refs, but two *different* citations for the same checkpoint would
leave two active `user_declared` rows, and the ladder would have to pick one — an ambiguity we would
be inventing. So `declareStage` follows the correction path it already has for backward moves: if an
active `user_declared` row exists for the same checkpoint, correct it
(`correction_note = 'Superseded by a new declaration'`, `corrected_by`, `corrected_at`) and insert the
new declaration with its ref. One live declaration per checkpoint, always; history preserved.

Re-declaring with the *same* ref is a no-op (the existing de-dupe already returns the row).

### 3. Validation is one guard, in the engine

```ts
async function assertRefBelongsToOpportunity(db, tenant, opportunityId, ref): Promise<void>
```

- `interaction` → the interaction row exists, same tenant, and `opportunity_id === opportunityId`.
- `document` → a document association exists for this document with `entity_type = 'opportunity'`
  and `entity_id = opportunityId` (the association introduced by PR #3512), same tenant.
- Anything else → reject (unsupported ref type for a declaration).
- Missing / foreign / cross-tenant → a typed error the action maps to a user-facing refusal
  ("That source is not attached to this opportunity").

It lives in the engine, next to `recordEvidence`, so the EE adapter and any future caller get the same
check. Not in the action: a second caller would silently skip it.

### 4. Type + migration

- Add `'document'` to `OpportunityEvidenceRefType`.
- New migration (never edit the template migration) that drops and re-adds
  `opportunity_evidence_ref_type_check` with the extended list. Small table, plain constraint swap.

### 5. UI

- **Declare-stage dialog.** Rung click opens a small dialog (standard Dialog + the standard
  combobox/select components, no new widget): stage name, an optional "Supporting source" picker
  limited to *this deal's* interactions and documents, and Declare. "No source" is the default and
  the dialog can be dismissed for the old one-click behaviour — the new step must never become a
  gate on declaring a stage.
- **Ladder rung.** Renders the citation as a link: interaction opens the interaction, document opens
  the document. The ladder query resolves refs with a LEFT JOIN and exposes `refMissing`; a deleted
  source renders as a muted "source removed" chip and the rung still renders normally. **The ladder
  must never break because a citation's target was deleted.**
- `correctEvidence` is untouched: correcting a cited declaration corrects it like any other row.

### 6. EE adapter

`packages/ee/src/lib/opportunities` declare-stage schema/handler accepts the optional `ref` and
passes it through; both fields optional so existing callers and API consumers are unaffected.

## Invariants this must keep

1. **A citation never moves the stage.** Only a declaration or system evidence does; the row's
   `source` stays `user_declared` and `deriveOpportunityStage` is not extended to read refs.
2. **System declarations carry no ref.** `opportunityStepActions.ts:352` keeps its signature.
3. **Tenant and record-level checks after any client input** — the picker is a convenience, the guard
   is the control.
4. **Deleting a cited source degrades, never breaks.**

## Tests

- Guard: interaction from another opportunity → refused; interaction from another tenant → refused;
  unattached document → refused; attached document → accepted; `refType='quote'` on a declaration →
  refused.
- Supersede: declare A with doc1, then with doc2 → one active row for the checkpoint, doc1 corrected
  with the supersede note; same ref twice → single row.
- Migration: `'document'` inserts; an unknown value still violates the CHECK.
- Ladder: cited rung links; deleted target → `refMissing`, rung renders.
- System path: step-action declaration unchanged (no ref, `source` unchanged).
- Dialog: picker lists only this deal's interactions/documents; skipping the picker declares as today.

## Not doing

- No attach-in-place from the dialog (attach the document to the deal first; that surface already
  exists in `OpportunityDocumentsTile`).
- No new evidence `source` value, no new checkpoint, no change to the ladder's ordering.
- No ref support for quotes/contracts/projects from the UI — system-only by decision above.
- No change to PR #3512 / #3457 surfaces beyond adding links in the rung.

## Order of work

1. Types + migration (constraint) — smallest, unblocks everything.
2. Engine: ref on `declareStage`, supersede path, `assertRefBelongsToOpportunity`.
3. Actions + zod schemas (`declareOpportunityStage`), typed refusal mapping.
4. Dialog + host wiring; picker query scoped to the deal.
5. Ladder resolution + links + `refMissing`.
6. EE adapter passthrough; tests alongside each step.

## Risks

- **Constraint swap** on a live table: keep it a single `ALTER … DROP/ADD CONSTRAINT` in one
  migration, no table rewrite.
- **Two active declarations** if the supersede rule is missed — this is the one design decision that
  is easy to get subtly wrong; test it explicitly.
- **Cross-tenant association leak**: the document guard must constrain tenant on the association,
  not only on the document row.

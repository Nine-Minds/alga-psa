# Contract recurring-period bounds & draft status — implementation plan

**Branch:** `fix/contract-user-reported-error`
**Date:** 2026-07-16
**Status:** Approved design, ready for implementation

## User report

A premise user (docker/appliance, also reproduced on cloud) reported:

> "I populate a contract with sample data, but I am unable to create it
> successfully. I can save it as a draft, but then I can never restore it."

Server logs show a bulk insert into `recurring_service_periods` failing with
check constraint `recurring_service_periods_activity_window_check`
(code 23514). The failing row has `activity_window_start = 2026-10-01`,
`activity_window_end = 2026-09-16` — end before start — for a service period
`2026-10-01 → 2026-11-01` on a contract that ends `2026-09-16`. In the UI the
user sees the opaque production RSC error ("An error occurred in the Server
Components render… digest…"), and their draft contract displays a
**Terminated** badge whose only recovery affordance is **Restore**, which
fails with the same error.

Reproduced end-to-end in this worktree's dev stack (contract Jul 18 → Sep 16
2026, monthly client cadence, one fixed-fee line): saving a draft produces a
row presenting as Terminated; clicking Restore throws the exact constraint
violation from the report.

## Root cause — one report, three defects

### Defect 1 — client-cadence regeneration materializes periods past the contract end

`computeClientCadenceRegeneration`
(`shared/billingClients/clientCadenceScheduleRegeneration.ts`) calls
`materializeClientCadenceServicePeriods` with only `asOf`; the materializer
generates candidate periods out to a coverage horizon (~6–7 months) with no
knowledge of the obligation's end date. The only end-awareness is
`clipRecordActivityWindowToObligationBounds`
(`clientCadenceScheduleRegeneration.ts:391`), which clips each candidate's
activity window to `[obligationStart, obligationEnd)`. For a period **wholly
after** the contract end this produces
`activityWindow = { start: period.start, end: obligationEnd }` with
`end < start`, which the DB check constraint
(`server/migrations/20260318120000_create_recurring_service_periods.cjs`,
requires `activity_window_start < activity_window_end` strictly) correctly
rejects. The whole transaction rolls back.

This fires on **every** path that syncs periods for a client-cadence line on
an end-dated contract whose horizon extends past the end:

- Wizard finalize → `createClientContractFromWizard` →
  `syncRecurringServicePeriodsForContract`
  (`packages/billing/src/actions/contractWizardActions.ts:1476`) — "unable to
  create it successfully".
- Restore / Set to Active / any assignment update →
  `updateClientContractForBilling`
  (`packages/billing/src/actions/billingClientsActions.ts:263`) → same sync —
  "can never restore it".
- `applyClientCadenceChange` callers (billing schedule/cycle/anchor actions),
  `previewClientCadenceScheduleChange`,
  `repairAllClientCadenceServicePeriodsForTenant` — all funnel through the
  same `computeClientCadenceRegeneration`.

The sibling **contract-cadence** path already has the missing guard:
`packages/billing/src/actions/contractCadenceServicePeriodMaterialization.ts:466`
filters out candidates with `servicePeriod.start >= assignmentEnd` before
backfilling. It has the mirror-image gap, though: it **never clips** activity
windows, so a contract-cadence line ending mid-period keeps a full final
period with no activity window — the invoice engine derives coverage and
proration from the persisted activity window (see the clip function's
docstring and `shared/billingClients/recurringTiming.ts`), so the final
partial period bills as a full period.

No data repair is needed: the check constraint rolled back every affected
transaction, so no tenant has inverted rows persisted.

### Defect 2 — draft assignments present as "Terminated"

`deriveClientContractStatus` (`shared/billingClients/clientContractStatus.ts`)
normalizes dates with a string-only `normalizeDateOnly`; knex hydrates `date`
columns as JS `Date` objects, which normalize to `null`. The future-start →
`'draft'` branch therefore never fires and every inactive assignment derives
`'terminated'`. List surfaces (`Contracts.tsx`, `ClientContractsTab.tsx`) and
the contract detail badges all read this derivation, so a fresh draft shows
**Terminated** and offers **Restore** (activate assignment, bypassing wizard
finalize) instead of **Resume** (reopen wizard) — steering users directly
into defect 1.

Additionally, the derivation never consults the contract header's
`status = 'draft'`, so even with the `Date` bug fixed, a draft with a
today-or-past start date would still derive `terminated`.

**Settled ruling:** an assignment belonging to a `draft` contract always
presents as **Draft** — Resume / Set to Active affordances, never Restore.
"Terminated" is reserved for contracts that were once active.

### Defect 3 — known validation failures surface as raw 500s

`createClientContractFromWizard` throws raw `Error`s for known validation
failures — e.g. the currency-pricing check
(`packages/billing/src/actions/contractWizardActions.ts:1136`, "Cannot create
contract in USD. The following services do not have USD pricing…") — which
`contractWizardActionErrorFrom` (`contractWizardActions.ts:50`) does not
convert, so they escape as HTTP 500s. In production Next.js masks the message
into the digest error the user screenshotted. This fires even on **draft**
save. The typed-error plumbing (allowlist converter + `isActionMessageError`
handling in `ContractWizard.tsx`) already exists on both sides; the message
is just missing from the allowlist.

Deliberate non-change: DB constraint violations (23514) stay **unmapped** and
loud — they indicate bugs, not user errors, and must not be dressed up as
friendly validation messages.

## Design

### 1. Shared obligation-bounds helper (Option A — approved)

New pure function in `shared/billingClients/` (new file
`clipRecurringCandidatesToObligationBounds.ts`, exported from the package
barrel alongside the other billing clients):

```ts
export function clipRecurringCandidatesToObligationBounds(
  records: IRecurringServicePeriodRecord[],
  obligationStart: ISO8601String,
  obligationEnd: ISO8601String | null,
): IRecurringServicePeriodRecord[]
```

Semantics (all comparisons date-only, half-open ranges):

- **Drop** a candidate when `obligationEnd != null && servicePeriod.start >= obligationEnd`
  (wholly after — the reported bug; also covers `start == obligationEnd`).
- **Drop** a candidate when `servicePeriod.end <= obligationStart`
  (wholly before — symmetry/defensive).
- **Clip** a straddling candidate:
  `clipStart = obligationStart > period.start ? obligationStart : null`;
  `clipEnd = obligationEnd && obligationEnd < period.end ? obligationEnd : null`;
  if either is set, `activityWindow = { start: clipStart ?? period.start,
  end: clipEnd ?? period.end, semantics: period.semantics }`, else return the
  record unchanged (`activityWindow` stays `null` — preserves the existing
  "window only when it differs" convention).
- Invariant: never emits `activityWindow.start >= activityWindow.end`
  (guaranteed by the drop rules). Both materializers emit records with no
  activity window, so no intersect logic is needed.

Call-site changes:

- **Client cadence** — `clientCadenceScheduleRegeneration.ts`
  `computeClientCadenceRegeneration` (~line 494): replace the
  `materialized.records.map(clipRecordActivityWindowToObligationBounds(...))`
  with the helper (passing `obligationStart`, `obligationEnd`). Delete
  `clipRecordActivityWindowToObligationBounds`; move its docstring rationale
  onto the helper. `candidateCoverageEnd` stays
  `materialized.generationRangeEnd` (the unbounded horizon) so regeneration
  still supersedes stale rows beyond a shrunk end date.
- **Contract cadence** —
  `contractCadenceServicePeriodMaterialization.ts:466`: replace the inline
  `.filter(...)` with the helper (passing `assignmentStart`,
  `assignmentEnd`). This is a deliberate behavior change: the final
  straddling period now persists a clipped activity window, so mid-period
  contract ends prorate instead of billing the full period. (Start-clip is a
  no-op on this path since periods anchor at `assignmentStart`.)

### 2. Status derivation

`shared/billingClients/clientContractStatus.ts`:

- `normalizeDateOnly` accepts `Date` (`value.toISOString().slice(0, 10)`) in
  addition to strings; widen the param types to
  `string | Date | null | undefined`.
- Add optional `contractStatus?: string` to the params. When
  `contractStatus === 'draft'`, return `'draft'` immediately — before any
  date/is_active logic.

Call sites — pass the contract header status wherever the contract row is in
scope (add the select/join where it is cheap; leave call sites that only ever
see active contracts unchanged):

- `packages/billing/src/models/contract.ts:291` (`getAllWithClients`) — pass
  `row.contract_header_status` (already selected). This feeds both list
  tables.
- `packages/billing/src/actions/contractActions.ts:908` — pass the contract's
  status (the surrounding query joins `contracts`; select `co.status` if not
  already).
- `packages/billing/src/actions/contractActions.ts:786` (active-assignment
  count for a known `contractId`) — the contract row is available in the
  enclosing function; pass its status.
- `packages/billing/src/actions/contractReportActions.ts:259,370` — audit; if
  the queries join `contracts`, pass status; drafts should not report as
  terminated in reports either.
- `packages/clients/src/models/clientContract.ts:286` (row normalizer) — pass
  the contract status if present on the row; audit callers and add the select
  where the query joins `contracts`.
- Leave unchanged: `shared/billingClients/clientContracts.ts:84` (queries
  filter `c.is_active = true`, drafts excluded) and
  `packages/clients/src/lib/clientContractWorkflowEvents.ts:22` (already
  string-normalizes; no header status in scope; not a display surface).

No UI changes required: with the derivation fixed, `Contracts.tsx` and
`ClientContractsTab.tsx` row menus already render Resume + Set to Active for
`draft` and reserve Restore for `terminated`.

### 3. Error allowlist

`contractWizardActionErrorFrom` (`contractWizardActions.ts:50`): add
`error.message.startsWith('Cannot create contract in')` to the
`actionError` allowlist. Audit the other raw `throw new Error(...)` sites in
`createClientContractFromWizard` for user-actionable validation messages and
add any equivalents (the catalog-item messages are already covered by the
`'Catalog item "'` prefix). The draft-save currency validation itself is
retained as-is — only its error shape changes (500 → friendly toast).

## Implementation steps

1. **Shared helper + client-cadence adoption.**
   Add `shared/billingClients/clipRecurringCandidatesToObligationBounds.ts`
   (+ barrel export). Rewire `computeClientCadenceRegeneration`, delete
   `clipRecordActivityWindowToObligationBounds`.
   Domain test `server/src/test/unit/billing/clipRecurringCandidatesToObligationBounds.domain.test.ts`
   covering: wholly-after dropped (the bug); `start == obligationEnd`
   dropped; wholly-before dropped; straddling end clipped; straddling start
   clipped; both clipped; no `obligationEnd` → only start rules apply;
   untouched records keep `activityWindow: null`; invariant `start < end` on
   every emitted window.

2. **Contract-cadence adoption.**
   Replace the inline filter at
   `contractCadenceServicePeriodMaterialization.ts:466` with the helper.
   Extend the relevant wiring/domain coverage
   (`packages/billing/tests/cadenceResyncWiring.test.ts` or a new domain
   test) to assert the final straddling period now carries a clipped
   activity window and that periods at/after the assignment end are still
   excluded.

3. **Status derivation.**
   Update `clientContractStatus.ts` (Date support + `contractStatus`
   short-circuit). Update call sites per the design list. Extend
   `packages/billing/tests/clientContractStatus.shared.test.ts`: `Date`
   inputs for start/end/now paths; `contractStatus: 'draft'` wins over
   inactive + past dates; non-draft `contractStatus` changes nothing.

4. **Error allowlist.**
   Update `contractWizardActionErrorFrom` + a focused unit test (the file's
   existing test conventions) asserting the currency message converts to an
   `actionError` and unknown errors still rethrow.

5. **Integration verification.**
   Add or extend an integration test (per `integration-testing` skill
   conventions) that: creates a client-cadence contract with an end date
   inside the generation horizon, activates it, and asserts (a) the insert
   succeeds, (b) no persisted period starts at/after the contract end,
   (c) the straddling period's activity window ends at the contract end.

6. **Manual smoke in the dev stack** (mirrors the user's repro):
   - Create contract (client billing schedule, monthly, start Jul 18 2026,
     end Sep 16 2026, one fixed-fee service with base rate) → **Create**
     succeeds; `recurring_service_periods` rows bounded by Sep 16.
   - Save an equivalent contract as **draft** → list shows **Draft** badge
     with **Resume** and **Set to Active**; Resume reopens the wizard;
     Set to Active succeeds.
   - Terminate an active contract → **Restore** succeeds.
   - Draft-save with a service lacking USD pricing → friendly toast, no 500.

## Out of scope (noted, not addressed)

- `contractCadenceServicePeriodMaterialization.ts` duplicates
  `clientCadenceScheduleRegeneration.ts` wholesale (row type, normalizers,
  serializer, persist helper). Drop a
  `// LEVERAGE: pattern recurring-period-row-mapping` marker at both sites
  during implementation; extraction is a separate effort.
- "Set to Active" on a draft activates without wizard finalize validation
  (currency checks). Existing affordance; unchanged.
- Whether draft saves should run finalize-grade validation at all — kept
  as-is (only the error shape changes).

## Verification commands

- Unit/domain: `npx vitest run` scoped to the touched test files in
  `server/` and `packages/billing/`.
- Type check: `npx tsc --noEmit` in the affected packages (or the repo's
  standard `nx` targets).
- Manual smoke: dev stack on port 3646, flow above.

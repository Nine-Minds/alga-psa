# Billing Contract Simulator — Implementation Plan

**Date:** 2026-07-30
**Branch:** `feature/billing-contract-simulator`
**Status:** Approved design, ready for implementation
**Edition:** Enterprise (EE) feature; the engine refactor it rides on is CE

## Context

Users cannot easily see how invoices will come out of the contract system before billing actually runs. They believe a contract is configured correctly, then weeks later the first real invoice reveals subtle problems — by which point real time entries and materials exist and fixing the contract mid-stream is a complex, risky repair.

The fix is a **contract simulator**: a dry-run tool that prices a contract — including an *unsaved draft* of a contract — through the real billing engine and shows the resulting invoices over a multi-period horizon, plus a what-if workspace for iterating on the configuration before committing it.

## Settled design decisions

- **Hypothetical inputs are the heart** (level 2): the user supplies assumed activity ("20 hrs/mo of remote support") and the simulator prices it through real engine logic. **Historical replay** (level 3) is the troubleshooting companion.
- **Draft-state simulation is required.** The simulator prices a contract configuration that is not (or not yet) saved. Since today's contract editing is save-as-you-go, drafts are delivered via a **scenario workspace**: opening the simulator snapshots the contract's full config into an in-memory *scenario* the user can mutate freely without touching the live contract.
- **Output is a timeline, not a single invoice.** A simulation run = contract scenario + assumptions + horizon (default 6 periods) → ordered simulated invoices, each expandable to full line detail. Multi-period is what exposes proration, mixed cadences landing together, bucket rollover, one-time charges, and end-date effects.
- **Assumptions are flat per service with optional per-period overrides.** The assumption form is derived from the scenario's lines (hourly → assumed hours, usage → assumed quantity, bucket → assumed consumption; fixed lines need no input). Pre-filled from the client's recent averages when history exists.
- **Historical replay is a population strategy for the assumption grid, not a second engine path.** Pick a past window → actual time/usage aggregates fill the per-period assumption values (still editable) → simulate as normal. Where a real invoice exists for a replayed period, show it beside the simulated one with a line-level diff.
- **Architecture: the billing engine is refactored into load phase + pure compute phase, and both production generation and the simulator run the same pure compute code.** Write-and-rollback simulation was investigated and rejected (see below). Fidelity by construction is non-negotiable: a simulator that drifts from real invoicing recreates the exact trust problem it exists to solve.
- **EE gating:** simulator UI and orchestration are EE; the pure compute layer is part of the CE engine. CE builds render an upgrade stub.
- **Entry points:** Simulator tab on contract detail (primary), a Simulate step in the ContractWizard (catch misconfiguration at birth), and Simulate on contract templates (vet a template before rollout).

### Why write-and-rollback was rejected

Investigation of the engine (`packages/billing/src/lib/billing/billingEngine.ts`, ~5,700 lines) found:

- The engine **writes during "calculation"**: reconciles `time_entries`/`usage_tracking` contract-line links (`billingEngine.ts:1769`, `:1940`), inserts default `client_billing_cycles` (`:2214`), and `taxService.ensureDefaultTaxSettings()` provisions real tax settings in its own transaction.
- **Invoice numbers are allocated outside every transaction** (`invoiceGeneration.ts:2697` → `numberingService.ts:42-56` on the pooled connection) — a rolled-back run still burns sequence numbers.
- Generation spans **three-plus independent top-level transactions** plus post-commit event-bus/PostHog emissions that no rollback can cover.
- The recurring path **throws when `recurring_service_periods` aren't materialized** (`invoiceGeneration.ts:695-699`) — an unsaved contract has none, so the existing pipeline is unusable for drafts as-is.

## Architecture overview

```
                    ┌────────────────────────────────────────────┐
                    │  Pure compute layer (CE, new)              │
                    │  packages/billing/src/lib/billing/compute/ │
                    │  BillingComputeInputs → IBillingCharge[]   │
                    │            + ChargeExplanation[]           │
                    └────────▲──────────────────────▲────────────┘
                             │                      │
      ┌──────────────────────┴─────┐   ┌────────────┴───────────────────┐
      │ Production generation (CE) │   │ Simulation orchestration (EE)  │
      │ BillingEngine: load from   │   │ scenario → hypothetical periods│
      │ DB → compute → persist     │   │ (pure cadence layer) → synth   │
      │ (unchanged behavior)       │   │ activity from assumptions →    │
      └────────────────────────────┘   │ compute → invoice view models  │
                                       │ (read-only DB, zero writes)    │
                                       └────────────────────────────────┘
```

Existing assets this leans on:

- **Pure cadence/timing layer already exists:** 41 of ~55 modules under `shared/billingClients/` are DB-free (`recurringTiming.ts`, `contractCadenceServicePeriods.ts`, `materialize*ServicePeriods.ts`, `recurringAuthoringPolicy.ts`, …). `recurringAuthoringPreview.ts` (`packages/billing/src/components/billing-dashboard/contracts/`) already generates hypothetical service periods in memory — dates only, no money. The simulator extends exactly this shape to pricing.
- **Preview shaping exists:** `buildPreviewInvoiceForSelectionInputs` / `adaptToWasmViewModel` (`packages/billing/src/actions/invoiceGeneration.ts:1668` / `:1589`) shape engine output into `WasmInvoiceViewModel` for the existing invoice preview renderer.
- **Engine methods that are already pure** and unit-tested (`resolveRecurringChargeTiming` `billingEngine.ts:3250`, `applyFixedChargeCoverageSettlement` `:5271`, etc.) establish the extraction pattern; `projectBillingService.ts` (`computeEntryAmounts`, `computeCapWriteDown`) is the precedent for pure pricing modules.

---

## Workstream A — Pure compute layer extraction (CE engine refactor)

The bulk of the implementation cost, and a durable win independent of the simulator (stateless unit testing of pricing arithmetic).

### A1. Input snapshot types

New types (in `packages/types/src/interfaces/` alongside existing billing interfaces, or a dedicated `billingCompute.interfaces.ts`):

- `BillingComputeInputs` — everything the pricing math needs, fully loaded:
  - client context (billing settings, tax region, currency — the fields the engine currently re-fetches from `clients` 17×)
  - contract header + `IContractLine[]` + per-service configuration (`IContractLineServiceConfiguration` and the Fixed/Hourly/Usage/Bucket configs + `IContractLineServiceRateTier[]`)
  - pricing schedules (`IContractPricingSchedule[]`)
  - billing period / service periods under evaluation (real `IRecurringServicePeriodRecord`s in production; hypothetical ones in simulation)
  - **activity inputs**: time entries (with the rate-resolution context: user type rates, overrides), usage records, bucket usage state
  - discounts + evaluation windows
  - **tax context** (see A4)
- `ChargeExplanation` — structured "why": proration factor and day counts, tier boundary hits, bucket base/rollover/overage arithmetic, minimums applied, pricing-schedule row selected, cadence/settlement decisions. Emitted alongside each computed charge; production callers may ignore it, the simulator surfaces it. First-class deliverable, not an afterthought — it is only cheap because the compute layer is pure.

### A2. Extract compute functions, one charge type at a time

New directory `packages/billing/src/lib/billing/compute/` with one module per charge family, extracted from the corresponding `BillingEngine` method bodies:

| Compute module | Extracted from (`billingEngine.ts`) |
|---|---|
| `computeFixedCharges` | `calculateFixedPriceCharges` `:2403` |
| `computeTimeBasedCharges` | `calculateTimeBasedCharges` `:3722` |
| `computeUsageBasedCharges` | `calculateUsageBasedCharges` `:4141` |
| `computeBucketCharges` | `calculateBucketPlanCharges` `:4950` |
| `computeProductCharges` / `computeLicenseCharges` | `:4727` / `:4746` |
| `applyDiscountsAndAdjustments` (pure form) | `:5375` (its helpers `:5484`, `:5551` are already pure) |

Rules for the extraction:

- Signature: `(inputs: BillingComputeInputs, period) → { charges: IBillingCharge[], explanations: ChargeExplanation[] }`. **Synchronous, no I/O, no `this`.** The already-pure sync methods (`:3234-3610`, `:5271-5375`) move into or get called from these modules unchanged.
- Each `BillingEngine.calculate*Charges` method becomes: **load → delegate**. A new `loadBillingComputeInputs(db, tenant, selection)` (or per-family loaders, converging on one) absorbs every knex query currently interleaved with the math, including the per-line re-queries downstream of `getClientContractLinesForBillingPeriod` (`:2034-2143`).
- **The three in-calculation writes do not move into compute.** Time-entry reconciliation (`:1769`), usage reconciliation (`:1940`), and default-billing-cycle insertion (`:2214`) relocate to the load/orchestration phase of the *production* path only, preserving current production behavior. The simulator path never invokes them.
- `BillingEngine`'s instance caches (`clientDefaultTaxRegionCodeCache` etc., `:195-202`) must not leak into the compute layer — statelessness is the point.
- Production behavior must be **byte-identical**. See Testing.

### A3. Refactor sequencing (incremental, verifiable steps)

Extract and re-verify one family at a time, in dependency-light order: **fixed → hourly → usage → bucket → products/licenses → discounts**. Each step: extract pure function + loader, rewire the engine method, run the billing unit + integration suites, commit. No big-bang rewrite of the 5,700-line file.

### A4. Tax

Tax is calculated internally (`TaxService`, `packages/billing/src/services/taxService.ts` — reads `tax_rates`, `tax_components`, `tax_holidays`, `client_tax_settings`; no external service in the generation path).

- Preferred: extract the tax math into a pure `computeTax(taxContext, charge)` where `TaxContext` (pre-resolved rates/components/holidays/client settings for the regions in play) is assembled in the load phase.
- Fallback if `TaxService` proves too entangled for clean extraction in this pass: define a `TaxCalculator` port injected into the orchestration (not compute) layer; production and simulator both use the read-only `TaxService` adapter. Either way the simulator gets real tax figures with zero writes. The implementer chooses after inspecting `TaxService.calculateTax` (`taxService.ts:54`); prefer the pure extraction. Note: `ensureDefaultTaxSettings` (a write) stays strictly on the production path.

---

## Workstream B — Scenario model and simulation service

### B1. Scenario model

`ContractScenario` (types in `packages/types`): a self-contained, serializable draft of everything billing-relevant:

- contract header fields (billing frequency, start/end, proration flags, cadence ownership)
- lines: each with `contract_line_type`, cadence/billing-timing fields, per-service config (discriminated Fixed/Hourly/Usage/Bucket union mirroring the persisted config tables), rate tiers, custom rates
- pricing schedules
- client binding: `clientId` for a real client (tax settings, currency, history) **or** a hypothetical client profile `{ taxRegion, currency }` for template simulation
- `assumptions`: per activity-driven line/service — flat per-period value + sparse per-period overrides (`{ flat: number, overrides?: Record<periodIndex, number> }`)
- `horizon`: `{ startDate, periodCount }` (default: today, 6 periods)

`snapshotContractToScenario(contractId)` — server action that loads the live config into scenario shape. Scenario keys reference live rows (`contract_line_id` etc.) where they originated, so compare/diff can align lines; scenario-added lines get synthetic ids.

### B2. Simulation service (EE, `ee/server/src/lib/billing/simulator/`)

`simulateContractScenario(scenario): SimulationResult` — the orchestrator. Strictly **read-only** against the DB:

1. **Periods:** generate the horizon's billing periods and per-line service periods in memory via the pure cadence layer (`shared/billingClients/*`), parameterized by real as-of dates — the generalization of what `recurringAuthoringPreview.ts:66-113` does with hardcoded dates. No `recurring_service_periods` rows are read or written for the hypothetical timeline.
2. **Synthetic activity:** expand assumptions into activity inputs — per service per period, one synthetic aggregate time entry at assumed hours (rates resolved from scenario config exactly as the compute layer expects), synthetic usage records at assumed quantities, bucket consumption values. Per-period overrides win over flat values.
3. **Context loads (read-only):** client row, tax context, service catalog / `service_prices` for anything the scenario references by catalog id rather than overriding.
4. **Compute:** assemble `BillingComputeInputs` per period → run the pure compute functions → collect charges + explanations per period. Bucket rollover state threads from period N to N+1 in memory.
5. **Shape:** adapt each period's charges into the preview invoice view model (reuse/lightly generalize `adaptToWasmViewModel` / the `buildPreviewInvoiceForSelectionInputs` shaping so the existing invoice preview renderer draws simulated invoices; ids prefixed `sim-`).

`SimulationResult`: ordered periods, each `{ periodWindow, invoiceViewModel, charges, explanations, totals }`, plus scenario echo and any diagnostics (e.g., "line X never bills within horizon — quarterly cadence starts after end date").

**Write-free is enforced, not hoped:** the simulator module must not import `BillingEngine`, `createInvoiceFromBillingResult`, or the numbering service; an integration test asserts zero row-count change across all billing tables after a simulation run (see Testing).

### B3. Compare

`compareSimulations(a: SimulationResult, b: SimulationResult)`: pure diff. Align periods by index/window; align lines by origin id (live `contract_line_id` where present, else service + description); classify added / removed / amount-changed with per-line deltas and per-period total deltas. Used for scenario-vs-live and scenario-vs-scenario. (Scenario-vs-live = simulate the untouched snapshot alongside the edited one — same code path, no special case.)

---

## Workstream C — Simulator workspace UI (EE)

### C1. Placement and gating

- New **Simulator** tab on contract detail: add to the `Tabs` in `ContractDetail.tsx` (`packages/billing/src/components/billing-dashboard/contracts/ContractDetail.tsx:1336ff`), URL state `contractView=simulator` (existing param plumbing at `:160`, `:436-438`).
- The tab body resolves through the `@product/billing/entry` build-time swap (pattern: `packages/product-billing/{oss,ee}/entry.tsx`, aliased in `server/next.config.mjs:721-722`): EE exports the real workspace from `ee/server/src/components/billing/simulator/`; OSS exports the standard "Enterprise Feature" upgrade card.
- Server actions follow the `paymentActions.ts:1-60` pattern: `packages/billing/src/actions/contractSimulationActions.ts` with `isEnterpriseBuild()` guard + `await import('@enterprise/lib/billing/simulator')`; CE returns a structured feature-unavailable result.
- Optional PostHog flag `contract-simulator` (via `useFeatureFlag`) for rollout control on top of edition gating.

### C2. Workspace layout

**Design grounding:** the chosen direction is the *workbench* mockup layout combined with the *ledger grid* mockup's explanation side panel. Interactive HTML mockups are committed alongside this plan in `docs/plans/2026-07-30-billing-contract-simulator-mockups/` — `workbench.html` (overall layout: scenario panel + assumptions left, timeline right) and `ledger-grid.html` (the click-an-amount explanation side panel, right slide-in, showing inputs and arithmetic). They are throwaway HTML, not code to reuse — match their structure and feel using the product's real component library.

Single workspace component, three regions:

- **Scenario panel** (left): the snapshot's lines, editable in memory — add/remove line, change rate/config-type parameters, tiers, cadence, proration, pricing-schedule rows. Purpose-built lightweight editors bound to the scenario object; reuse existing field-level components (`BucketOverlayFields`, rate inputs, `ServicePicker`) where they can operate on in-memory state via props, but do **not** bend the save-as-you-go dialogs (`ContractLineEditDialog` etc.) into draft mode. A "modified" badge marks lines that differ from the live snapshot; "reset line"/"reset all" reverts.
- **Assumptions panel**: auto-derived rows from activity-driven lines. Flat value input per row; an expander opens the per-period override grid (periods × inputs, sparse). Prefill actions: "Use recent averages" (per-client aggregate server action) and the replay loader (Workstream D). Neutral defaults otherwise.
- **Timeline** (main): one card per simulated period — invoice total, delta vs. previous period, badges for notable events (proration, bucket overage, one-time charge, cadence coincidence). Expanding a card renders the full simulated invoice through the existing preview renderer (`InvoicePreviewPanel` / `TemplateRenderer` on the `WasmInvoiceViewModel`).
- **Explanation side panel** (from the ledger-grid mockup): clicking any simulated line amount slides in a right panel (~340px) rendering that charge's `ChargeExplanation` — the inputs used (rate, quantity/hours, included hours, proration day math) and the arithmetic step by step down to the amount (e.g. "12 hrs − 10 included = 2 hrs × $180.00 = $360.00"). One panel instance for the workspace; clicking another amount repopulates it.
- **Compare mode** toggle: second timeline row (baseline = live config, or a second saved scenario) with the `compareSimulations` diff — changed lines highlighted, per-period deltas summarized.

Simulation runs are triggered explicitly ("Simulate" button) and are stateless server calls; re-simulate after edits. Debounced auto-rerun can come later.

### C3. Scenario persistence (v1: minimal)

Scenarios live in component state for v1; a "copy scenario as JSON"/session persistence is optional polish. **Deferred, explicitly out of v1:** saving named scenarios server-side, and "apply scenario to contract" write-back. Both are natural follow-ups once the workspace proves out.

---

## Workstream D — Historical replay

- `loadReplayAssumptions(contractId, window)` (EE server action, read-only): aggregate actual `time_entries` and `usage_tracking` for the client/contract over the chosen past window (e.g., last 1–3 billing periods) into per-service, per-period assumption values, and set the scenario horizon to match the replayed windows. Values land in the standard assumption grid, still editable ("replay last month, then bump hours 20%").
- Known v1 fidelity limit (accepted in design): aggregation collapses per-entry nuance (e.g., per-technician rate overrides average out). The pure layer leaves room to feed raw entries later for exact replay.
- **Actual-vs-simulated diff:** for replayed windows, fetch the real issued invoices; render beside the simulated ones using the same diff mechanics as compare mode ("here's what you got billed; here's what this fixed config would have billed; these lines differ").

---

## Workstream E — Additional entry points

- **ContractWizard** (`packages/billing/src/components/billing-dashboard/contracts/ContractWizard.tsx`): a Simulate step/panel near review. The wizard already holds the full draft in memory — map wizard state → `ContractScenario`, embed the timeline (read-only workspace: assumptions + timeline, no scenario panel). This is where "misconfigured at birth" gets caught before first save.
- **Contract templates** (`ContractTemplateDetail.tsx`): Simulate action building a scenario from the template plus a hypothetical client profile (choose an existing client for realistic tax/currency, or default profile). Vets a template before rolling it out to clients.
- Both are thin: scenario construction + the same workspace component. EE-gated identically.

---

## Testing strategy

**Equivalence (the refactor's safety net):**

- The full existing billing test suites (`server/src/test/unit/billing`, `server/src/test/integration/billing`, engine timing tests) must pass unchanged after each extraction step.
- Before the refactor starts: add a **golden harness** capturing engine charge output (`IBillingCharge[]`, ordered, full precision) for a representative set of seeded contracts — fixed with proration on/off, hourly with rate overrides, usage with tiers, buckets with rollover and overage, mixed cadences, discounts, pricing-schedule transitions. Each extraction step must reproduce the goldens byte-identically.

**Pure compute unit tests (the new capability):**

- Table-driven tests per compute module, no DB: proration across partial first/last periods, tier boundaries (at/below/above), bucket base + rollover + overage chains across periods, minimums, cadence coincidence (monthly + quarterly landing together), discount windows, pricing-schedule row selection, per-period override precedence. Explanations asserted alongside amounts.

**Simulation service tests (EE integration):**

- Seeded contract → snapshot → simulate → assert timeline totals and line composition.
- Scenario edit (e.g., fixed → bucket) → assert diff output.
- Replay: seeded time entries → `loadReplayAssumptions` → simulate → diff vs. seeded actual invoice.
- **Zero-write assertion:** snapshot row counts (or use a write-intercepting knex spy) across billing tables before/after a simulation run; any delta fails.

**UI:** Playwright smoke on the EE build — open Simulator tab, edit an assumption, simulate, expand a period, toggle compare. CE build: tab renders upgrade stub.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Regression in the 5,700-line engine during extraction | One charge family at a time; goldens + full suite green per step; no behavior changes ride along with the refactor |
| Compute layer silently depends on engine instance state | Stateless module functions; no `this`; caches stay in the engine shell |
| The three in-calculation writes sneak into shared code | Explicitly relocated to production orchestration; simulator import boundaries + zero-write test |
| Tax logic too entangled to extract cleanly | Port-based fallback (read-only `TaxService` adapter) keeps the simulator correct while deferring pure extraction |
| Hypothetical periods drift from production period materialization | Both derive from the same pure `shared/billingClients` cadence modules — the same guarantee-by-shared-code as pricing |
| Scenario editor scope creep toward a full contract editor | v1 edits billing-relevant knobs only; the live editor remains the authoring surface; write-back deferred |

## Suggested implementation order

1. **A (pre):** golden harness over existing engine output.
2. **A1–A4:** compute layer extraction, family by family; tax context; explanations. Production refactor complete and equivalence-verified. *(Largest chunk; everything else depends on it.)*
3. **B:** scenario types, snapshot action, hypothetical-period generation, assumption synthesis, simulation service, compare. Service-level tests.
4. **C:** EE gating scaffolding (`@product/billing/entry` export, actions guard, tab), then the workspace UI: timeline first (with assumptions), then scenario editing, then compare mode.
5. **D:** replay population + actual-vs-simulated diff.
6. **E:** wizard step and template entry points.
7. Playwright smoke, CE-stub verification, PostHog flag wiring.

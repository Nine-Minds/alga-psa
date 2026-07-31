# Project Fixup Round 3 — Implementation Plan

**Date:** 2026-07-30
**Branch:** `fix/project-fixup-round-3`
**Status:** Approved design — ready for implementation
**Predecessor:** `docs/plans/2026-07-29-project-fixup-round-2-plan.md`

## Context

Field testing after round 2 produced a third handwritten page of project-billing and project-UI issues. This round is a batch of targeted fixes: input and dialog polish, dark-mode and warning-text presentation, invoice line-amount display, accounting-integration gating, per-view phase-list controls, an overdue-phase signal, closing the standalone-approve dead-end, and making the `project-billing-ui` feature flag deterministic.

Design-session research established root causes for every item; each workstream below cites its anchors. Two workstreams (A and B) already have substantial uncommitted WIP in this worktree from a prior session; for those the task is to verify, finish, and test rather than build from scratch.

**Pre-existing worktree changes.** `package.json`'s `dev` script was modified by environment wire-up to read `PORT` from the git-ignored `server/.env.local` (fallback 3000). The board-owned dev service depends on it; commit it as a standalone `chore:` commit, separate from the fix commits.

## Goals

1. Standalone-mode schedule entries can never be approved into an uninvoiceable state, and any already-approved backlog has an invoice path.
2. The `project-billing-ui` flag renders deterministically — no flicker, no intermittently missing Billing view — across all seven consuming components.
3. Invoice line amounts read as net, summing visibly to the Subtotal row, with tax only in the totals section.
4. QuickBooks sync affordances appear only when an accounting integration is actually connected.
5. Project billing status pills, dialogs, number inputs, and warning text look and behave correctly (dark mode, spacing, wheel-scroll, emphasis).
6. The phase list adapts its controls to the active view, and past-dated phases with pending billing surface an overdue signal instead of sitting silent.

## Non-goals

- Auto-advancing billing status from phase dates (decided against: Mark Complete remains the sole trigger for phase-triggered entries).
- App-wide wheel-scroll behavior changes on number inputs (scoped to the two Total price fields).
- Removing the ~20 hand-rolled dialog-footer wrappers made redundant by the Dialog engine fix (no churn; they remain valid).
- Any change to `generateProjectInvoice`, the schedule-entry lifecycle, or approval semantics for recurring mode.
- Unifying the vestigial `project_phases.status` column with `completed_at` (edit UI never exposes it; out of scope).
- The `evaluatePhaseReadiness` / `markPhaseComplete` duplicated-invariant cleanup (mark with `// LEVERAGE: friction` only).

## Workstream A — Standalone approve dead-end (WIP exists: verify & finish)

**Decision:** hide plain Approve for standalone-mode rows everywhere it's offered, and give standalone fixed-price projects the "Generate project invoice" button so already-approved entries have an exit. Recurring-mode Approve is correct and unchanged. No server changes: `generateProjectInvoice(projectId)` with no `entryIds` already bills the approved backlog (`packages/billing/src/actions/invoiceGeneration.ts:2113`).

Already implemented in the uncommitted WIP:

- `ProjectBillingReviewTab.tsx` — per-row plain Approve now renders only when `invoice_mode === 'recurring'`; "Approve & invoice now" remains the standalone path; bulk "Approve selected" renders only when every selected row is recurring (`canBulkApproveSelection`), and `handleBulkApprove` filters to recurring ids.
- `ProjectBillingView.tsx` — the "Generate project invoice" button (`id="billing-generate-project-invoice"`) is hoisted out of the T&M-only branch and renders for any `invoice_mode === 'standalone' && canManage` config, fixed-price included.
- New source-contract test `packages/billing/tests/projectBillingStandaloneUi.contract.test.ts` pins both behaviors.

Remaining work:

1. **A1.** Review the WIP diff for correctness and idiom; run the new contract test and the existing project-billing suites.
2. **A2.** The moved button reuses `billing.tm.generateInvoice` / `billing.tm.generatingInvoice` i18n keys. Rename to mode-neutral keys (e.g. `billing.generateProjectInvoice`, `billing.generatingProjectInvoice`) across all locale files, keeping i18n-parity tests green — the `tm.` namespace is now wrong for a button that also serves fixed-price.
3. **A3.** Manual smoke (dev server on port 3511): standalone fixed-price project — verify plain Approve is absent in the review tab, "Approve & invoice now" works, and a deliberately pre-approved entry is billed by "Generate project invoice". Recurring project — verify plain Approve and bulk approve still work.

## Workstream B — Deterministic feature flag (WIP exists: verify & finish)

**Root cause:** `useFeatureFlag` (`packages/ui/src/hooks/useFeatureFlag.tsx`) did a one-shot read 200 ms after mount with no `onFeatureFlags` subscription, racing the identify-then-reload in `PostHogUserIdentifier`; `PostHogProvider` bootstrapped `featureFlags: {}` so every flag read disabled until the network responded.

**Decision:** both layers — server-evaluated bootstrap plus client subscription.

Already implemented in the uncommitted WIP:

- `useFeatureFlag.tsx` — subscribes to `posthog.onFeatureFlags()` and re-checks on every flag delivery; unsubscribes on cleanup.
- `server/src/app/layout.tsx` — root layout evaluates `project-billing-ui` via the cached `checkFeatureFlag` helper (`server/src/lib/feature-flags/serverFeatureFlags.tsx:10`, first production use) and passes it to the provider. Root-layout placement covers all routes, including `InvoicingHub` and the client portal.
- `PostHogProvider.tsx` — accepts `initialFeatureFlags` and seeds `bootstrap.featureFlags` with it.
- `packages/billing/tests/projectBillingUiFeatureFlag.contract.test.ts` — updated for the new source shapes.

Remaining work:

1. **B1.** Review the WIP; run the flag contract test and typecheck. Verify the `initialFeatureFlags` object identity doesn't re-trigger the init effect each render (it's in the effect dep array; the layout passes a fresh object literal — confirm the `isInitialized` guard makes this benign, otherwise stabilize).
2. **B2.** Fix the dead "not ready" guard at `useFeatureFlag.tsx:111-115`: it checks `posthog.isFeatureEnabled === undefined`, which is always false on the posthog-js singleton. With the subscription in place the guard is vestigial — either remove it or check `posthog.__loaded` (the signal `PostHogUserIdentifier.tsx:23` uses).
3. **B3.** Server-side evaluation sends `groups: { tenant }` (`packages/core/src/lib/featureFlagRuntime.ts:131-133`) while the client identify sets tenant only as a person property (existing `// LEVERAGE: friction` at `PostHogUserIdentifier.tsx:91`). Confirm the PostHog flag definition for `project-billing-ui` matches at least one of the two paths; document in the PR which targeting the flag uses. No code change unless verification shows the bootstrap path evaluating false for a tenant that should be on.
4. **B4.** Manual smoke on 3511: hard-reload the project detail page repeatedly (cold cache) — Billing view option must be present on first paint every time when the flag is on; toggle the flag off in PostHog and confirm it disappears without a stale-true flicker.

## Workstream C — Invoice lines show net amounts (per-line tax)

**Root cause:** every generated `invoice_charges` row stores `total_price = net + tax` (`invoiceGeneration.ts:440`, `invoiceService.ts:794/916/1063`), and the view-model adapter maps each line's displayed `total` from `total_price` (`packages/billing/src/lib/adapters/invoiceAdapters.ts:371`). Lines therefore show tax-inclusive amounts while the Subtotal row is net and tax has its own totals row — lines visibly don't sum to the subtotal. Most conspicuous on project invoices, where every milestone line carries tax.

Changes:

1. **C1.** In `invoiceAdapters.ts`, map line `total` (and the grouped-subtotal accumulation at `:245` / `:322` if it feeds displayed group sums) from `net_amount` instead of `total_price`. Verify the fallback totals math at `:388-418` — with net lines, `computedSubtotal + tax` is the correct grand total; today the fallback double-counts tax.
2. **C2.** Audit the other line renderers for the same semantic: client portal `InvoiceDetailsDialog.tsx:276-308` (`renderChargeRow`) and the automatic-invoice preview `AutomaticInvoices.tsx:3037-3090` — wherever a per-line amount is sourced from `total_price`, switch to `net_amount`. Column headers already read "Amount"/"Total" — no label change needed; the Tax totals/breakdown rows stay as-is.
3. **C3.** Do **not** touch accounting-export adapters (`quickBooksOnlineAdapter.ts`, `xeroAdapter.ts`) — they intentionally consume per-line tax.
4. **C4.** Tests: unit-test the adapter mapping (line total = net; invoice total = subtotal + tax); regression-check an invoice with a discount line (`net_amount === total_price` there) and a zero-tax invoice (display unchanged).

## Workstream D — Gate QuickBooks sync UI on a connected integration

**Root cause:** `useInvoiceSyncStatuses` (`packages/billing/src/components/invoices/useInvoiceSyncStatuses.ts:24`) hides sync UI only when `getInvoiceSyncStatuses` returns an empty map (CE, missing permission). In EE with `billing:read` and **no** QBO connection, invoices still get `not_synced` statuses, so "Sync to QuickBooks" renders for tenants who never connected QuickBooks.

Changes:

1. **D1.** Expose connection state to the UI: extend `getInvoiceSyncStatuses` (`packages/billing/src/actions/accountingSyncActions.ts`) to short-circuit to an empty result when no accounting integration is connected (reusing the resolution logic behind `getAccountingSyncHealth`, `:328`), or have the hook consult `connected` explicitly. Prefer the action-side short-circuit: `syncHidden` then does the right thing at all three consuming sites with no component changes.
2. **D2.** Verify all sync affordances disappear when unconnected: sync button + drift controls + "View in QuickBooks" (`InvoicePreviewPanel.tsx:458-546`), and the QuickBooks columns in `FinalizedTab.tsx:399-406` and `DraftsTab.tsx:487-494`.
3. **D3.** Ensure the connected-tenant path is unchanged (statuses, drift, sync action). Add a unit/contract test for the unconnected short-circuit.

## Workstream E — Dark-mode status pills

**Root cause:** the pill classes in `packages/core/src/lib/projectBillingStatus.ts:26-57` already include `dark:` variants, but `server/tailwind.config.ts` content globs scan only `.jsx/.tsx/.mdx` in a package list that excludes `packages/core` — the dark utilities are never compiled. Light classes work only because other scanned files happen to emit them.

Changes:

1. **E1.** Add `../packages/core/src/lib/projectBillingStatus.ts` to the explicit `.ts` content entries in `server/tailwind.config.ts` (the existing convention at lines 17-19).
2. **E2.** While there, bump the `canceled` dark pairing (`dark:bg-gray-500/10` + `dark:text-gray-500`) to readable contrast (e.g. `dark:text-gray-400`).
3. **E3.** Visual check on 3511 in dark mode: billing tab status chips (Pending/Ready/Approved/Invoiced/Held/Canceled) and the phase-badge money icon, which shares `phaseBadgeClasses` (`projectBillingStatus.ts:110-112`).

## Workstream F — Total price wheel-scroll

Scope decision: just the Total price field (it appears in two dialogs), not app-wide.

1. **F1.** Add `onWheel={(e) => (e.target as HTMLInputElement).blur()}` — the repo's existing idiom (`DesignerSchemaInspector.tsx:395`) — to the two fields: `BillingSetupWizard.tsx:184-192` (`billing-setup-total`) and `ProjectBillingView.tsx:301-308` (`billing-terms-total`). The shared `Input` spreads props to the native input, so no component change is needed.
2. **F2.** Drop a `// LEVERAGE: pattern number-input-wheel-guard` marker at one site noting the same hazard exists on `billing-setup-cap`, `CapPanel.tsx:96`, `ScheduleEntryDialog.tsx:246/:278`, and `PhaseRateOverridesEditor.tsx:224` — candidates for an `Input`-level fix later, deliberately not taken now.

## Workstream G — Dialog footer spacing (engine fix)

**Root cause:** the shared `Dialog` footer container (`packages/ui/src/components/Dialog.tsx:431-435` and the duplicate branch at `:560-564`) is a padded div with no flex/gap; callers passing bare fragments get touching buttons. Two offenders: the "Enable project billing" wizard footer (`BillingSetupWizard.tsx:154-163` — the reported Cancel abutment) and the Hold dialog (`ScheduleTable.tsx:537-545`).

Per the layering rule, fix the engine, not the call sites:

1. **G1.** Give both footer container branches `flex justify-end gap-2` (preserving existing padding). Callers that already wrap their buttons in their own flex div render that div as the single flex child — layout unchanged.
2. **G2.** Visually verify the two offenders plus a sample of already-wrapped dialogs (`ScheduleEntryDialog`, `ProjectDetailsEdit`, `PhaseTaskImportDialog`, `DuplicateTaskDialog`) in both themes to confirm no regressions from the new default.

## Workstream H — Payment warning emphasis

Both payment-warning surfaces already bold their title; the task is to bold the key clause of the body.

1. **H1.** `ProjectPaymentWarningBanner.tsx` (`packages/billing/src/components/project-billing/`): bold the leading imperative of each message variant — "Payment is required …" through the first sentence boundary — and the interpolated invoice number. Since the strings are i18n keys, split each message into emphasized/rest keys (or wrap with `<Trans>`-style component interpolation per repo i18n idiom) across all locales; keep i18n-parity tests green. Variants: `billing.paymentWarning.generic/preparation/replacement/outstanding` (`:46-71`).
2. **H2.** Apply the same emphasis to the duplicated banner in `TimeEntryDialog.tsx:326-345` (`workItemPicker.paymentWarningTitle/paymentWarning`). Drop a `// LEVERAGE: pattern payment-warning-banner` marker there — it hand-copies the billing banner instead of reusing it (cross-package reuse blocked today; candidate for extraction).

## Workstream I — Phase list controls per view

**Decision:** billing view = money icon, read-only phases; kanban = editable phases, no money icon. (The phases panel never renders in list view — `ProjectDetail.tsx:4218` gates it to kanban/billing.)

1. **I1.** Thread the existing `viewMode` (`ProjectDetail.tsx:256` type, live value at `:280`, already in scope at the `<ProjectPhases>` call site `:4237`) as a prop through `ProjectPhases.tsx:12-54` into `PhaseListItem.tsx:18-54`.
2. **I2.** In `PhaseListItem`, when `viewMode === 'billing'`: keep the money icon (`:398-407`); hide the hover action buttons — reopen/mark-complete/edit/delete (`:446-487`), the drag handle (`:389-392`, and don't set `draggable` at `:264`), and the status-settings button (`:339`). When `viewMode === 'kanban'`: hide the money icon; keep all editing controls (current behavior otherwise).
3. **I3.** In `ProjectPhases`, hide the header add-phase / import controls (header block ending ~`:195-200`) in billing view.
4. **I4.** Keep phase *selection* (clicking to filter the schedule) working in both views. Update `phaseAwareProjectDetail.contract.test.ts` if it pins the old markup.

## Workstream J — Overdue-phase signal

**Decision:** no auto-advance; surface staleness. A phase is *overdue for billing* when `end_date < today` **and** it has at least one phase-triggered schedule entry still `pending`.

1. **J1.** Data: ensure the billing tab's entry list exposes the linked phase's `end_date` (extend the list query/model join in `packages/billing/src/models/projectBillingScheduleEntry.ts` if absent) and that `PhaseListItem`'s `billingBadge` derivation (`derivePhaseBillingBadges`, `packages/core/src/lib/projectBillingStatus.ts` ~`:85`) can carry an `overdue` flag — computed where phase dates are in scope.
2. **J2.** `ScheduleTable` row: for such entries, render a warning affordance next to the status chip (`:435`) — amber clock/alert icon with tooltip "Phase end date has passed — mark the phase complete to make this entry ready" (i18n'd, all locales).
3. **J3.** `PhaseListItem` badge (`:398-407`): overdue accent (amber ring or icon) with equivalent tooltip.
4. **J4.** Timezone rule: compare dates in the tenant/user timezone per repo convention (match how phase due-ness is displayed elsewhere); treat `end_date` null as never overdue. Unit-test the predicate (past/today/future/null end dates × pending/ready/invoiced entries).

## Testing & verification

- **Contract tests:** run/extend `projectBillingStandaloneUi.contract.test.ts`, `projectBillingUiFeatureFlag.contract.test.ts`, `phaseAwareProjectDetail.contract.test.ts`; new contract or unit tests per C4, D3, J4.
- **i18n parity:** A2, H1, H2, J2 add or rename keys — every locale file must be updated (parity test enforces).
- **Manual smoke on the wired dev server (port 3511):** the per-workstream checks A3, B4, E3, G2, plus: wheel-scroll over both Total price fields no longer changes values; project invoice preview lines sum to Subtotal with tax only in totals; unconnected-QBO tenant sees no sync affordances; billing vs kanban phase-list controls; overdue badge appears for a back-dated pending phase.
- **Suggested commit shape:** the `chore:` dev-script commit first; then one commit per workstream (A and B absorb the existing WIP into properly-messaged commits).

## Out of scope / follow-ups noted

- `Input`-level wheel guard for all number inputs (LEVERAGE marker, F2).
- Extracting a shared payment-warning banner across packages (LEVERAGE marker, H2).
- `evaluatePhaseReadiness` dead code / duplicated readiness invariant across `billing` and `projects` packages (existing friction; add `// LEVERAGE: friction phase-readiness-invariant` at `projectActions.ts` markPhaseComplete if not already present).
- Tenant group-vs-person-property flag targeting mismatch (tracked by existing LEVERAGE marker; B3 only verifies and documents).

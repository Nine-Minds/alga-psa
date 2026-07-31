# Wave 4a — Project screen billing UI — lane report

**Status:** Complete. `packages/projects` typechecks with **zero** errors; `packages/billing`
shows only the single documented pre-existing error (`quoteActions.ts(32) TS2307`).

## Summary

Implemented project billing as the third project view (option 3) plus the ambient
signals, exactly against `option-3-view.html`. A new `packages/projects/src/components/billing/`
directory holds the self-contained billing UI; `ProjectDetail`, `ProjectInfo`,
`ProjectPhases`/`PhaseListItem`, and `TaskListView` were extended for the view switcher,
chips, phase badges, and phase-completion affordances. All billing data comes from the
locked `@alga-psa/billing` project-billing actions; currency is always formatted through
`@alga-psa/core`'s `formatCurrencyFromMinorUnits` (never hand-divided). Every interactive
element carries an `id`; purple is reserved for action/selection (status colors are
green/amber/blue/gray).

## Features delivered

F113, F114, F115, F116, F117, F118, F119, F120, F121, F122, F123, F124, F125, F126, F127,
F128, F135, F136, F137, F138, F139 (and the UI half of F115 RBAC). `IProjectPhase.completed_at`
(F019) was already present from Wave 1; `ProjectViewMode` gained `'billing'` here.

## Files changed

New (all under `packages/projects/src/components/billing/`):
- `ProjectBillingView.tsx` — orchestrator: loading → setup wizard → fixed-price (schedule +
  terms editor) or T&M (cap + overrides), plus the two cards. Contains the F127 fixed-price
  terms editor (`TermsDialog`).
- `BillingSetupWizard.tsx` — F116 empty state + compact enable-billing dialog (model, price
  or cap+thresholds+behavior, invoice mode, optional contract link fetched from the client's
  contracts).
- `ScheduleTable.tsx` — F117/F118/F120/F121/F126/F128: schedule table, sum-to-total allocation
  footer, per-row lifecycle actions (approve / approve&invoice / hold-with-reason / mark ready /
  edit / delete / cancel), deposit rows distinguished with treatment note, deleted-phase entries
  flagged as manual fallback. Surfaces the non-blocking allocation warning from `approveScheduleEntry`.
- `ScheduleEntryDialog.tsx` — F119: amount XOR percentage, entry type, trigger picker (live
  phase / date / manual).
- `CapPanel.tsx` — F122: cap amount, thresholds, notify/hard-cap toggle.
- `PhaseRateOverridesEditor.tsx` — F123: per-phase service filter, rate, service re-map.
- `BudgetVsActualCard.tsx` — F124: fixed-price invoiced/approved/ready/remaining segments;
  T&M billed-vs-cap bar with threshold markers and write-down line.
- `DeliveryEconomicsCard.tsx` — F125: hours logged, labor+materials cost, projected margin.
- `ProjectBilledBar.tsx` — F135 presentational segmented "Billed: $X of $Y" bar + tooltip.
- `StatusChip.tsx`, `billingViewHelpers.ts` — shared status palette, phase-badge derivation,
  cents formatter.

Modified:
- `packages/projects/src/components/ProjectDetail.tsx` — `ProjectViewMode` → `'kanban' | 'list' | 'billing'`;
  RBAC fetch (`checkCurrentUserPermissions`); billing-overview load + refresh; phase badge and
  "all tasks closed" derivation; billing header branch (Billing heading + model/ready chips, no
  search/filters); billing content branch; phases panel now renders in billing view; mark-complete/
  reopen handlers with the F139 deep-link toast.
- `packages/projects/src/components/ProjectInfo.tsx` — F135 billed bar, fetched in parallel with
  the existing metrics load (`Promise.allSettled`).
- `packages/projects/src/components/ProjectPhases.tsx` + `PhaseListItem.tsx` — F136 $ badges,
  F137 mark-complete/reopen hover actions, F138 nudge chip, completed indicator.
- `packages/projects/src/components/TaskListView.tsx` — F136/F137/F138 on list-view phase headers.
- `server/public/locales/en/features/projects.json` — `billingView`, the `billing.*` tree, and new
  `phases.*` keys.

## Mockup mapping (`option-3-view.html`)

- **ViewSwitcher Kanban | List | Billing** → `viewSwitcherOptions` memo used by both toolbars;
  Billing (receipt icon) appears only with `billing:read` (F113/F115).
- **Toolbar "Billing" + `Fixed price · $24,000` + `1 ready to bill` chips** → `renderHeader` billing
  branch; search/filters hidden (F114).
- **Phases panel stays with `$` badges** → panel renders for `kanban || billing`; badges from
  `derivePhaseBillingBadges` colored by most-progressed linked entry status (F136).
- **Schedule table (Milestone/Trigger/%/Amount/Status/Invoice/actions)**, **allocation tfoot**,
  **hot "Ready" row with Approve & invoice / Hold**, **deposit "applied as credit" sub-line**,
  **"Mark ready" on manual pending** → `ScheduleTable` (F117/F118/F120/F121/F126).
- **Budget vs actual segmented bar + legend** → `BudgetVsActualCard` (F124).
- **Delivery economics (hours / cost / margin)** → `DeliveryEconomicsCard` (F125).
- **Metadata-row billed bar (option 1 carry-over)** → `ProjectBilledBar` in `ProjectInfo` (F135).

## Deliberate deviations / decisions

1. **Cross-package imports use deep paths, not the `@alga-psa/billing/actions` barrel.**
   The brief said to import from the barrel "as other cross-package components do", but the barrel
   re-exports `quoteActions.ts`, which carries billing's documented pre-existing `TS2307`. Importing
   the barrel from `packages/projects` pulls that file into the projects program and fails the
   zero-error requirement (verified empirically). Importing the two specific action files
   (`@alga-psa/billing/actions/projectBillingConfigActions`, `.../projectBillingScheduleActions`,
   plus `contractActions`) keeps the projects typecheck clean.
2. **No `@alga-psa/billing` dependency was added to `packages/projects/package.json`.**
   `billing → opportunities → projects` already exists, so a `projects → billing` dependency would
   create a package cycle (this is exactly why `markPhaseComplete` inlines its readiness SQL). The
   imports resolve for typecheck via the root `tsconfig.base.json` `paths` and at runtime via the
   `@alga-psa/billing/` webpack alias in `server/next.config.mjs` (both packages are already in
   `transpilePackages`). This matches the codebase's established cross-feature composition pattern
   (e.g. billing components import `@alga-psa/integrations/actions/qboActions` the same way).
3. **F135 fetch is parallel, not a second waterfall.** `ProjectInfo` fetches the billing overview
   alongside its existing `calculateProjectCompletion` via `Promise.allSettled`; the overview action
   enforces `billing:read` and throws for users without it, which simply leaves the bar hidden.
4. **RBAC gating uses `checkCurrentUserPermissions` (`@alga-psa/auth/actions`).** `billing:read`
   gates the view + signals; `invoice:create || invoice:generate` gates mutations; `project:update`
   gates phase completion (F154). Server actions still enforce independently.
5. **i18n: English source keys only.** Every string passes a `defaultValue`, so all 8 non-English
   locales render correct English until the downstream translation pipeline runs (the same way the
   materials feature landed before translation). No other-locale files were touched.
6. **Phase-completion lives in two places.** Kanban/billing use the phases panel (`PhaseListItem`);
   list view uses the `TaskListView` phase-group header — both get mark-complete/reopen + the F138
   nudge so F137 holds "in kanban AND list".

## Verification

- `cd packages/projects && npx tsc --noEmit -p .` → **exit 0, zero errors** (baseline was clean).
- `cd packages/billing && npx tsc --noEmit -p .` → only `src/actions/quoteActions.ts(32,46): TS2307`
  (the single documented pre-existing error; billing source was not touched by this lane).

## Not completed / caveats

- **No live app smoke test.** This ran as a background job without a running stack; correctness is
  established by the two typechecks and code review, not by driving the screens. A manual click-through
  of the three views, the setup wizard, and the approve/hold/mark-ready flows is still advisable.
- **Non-English locale strings** are English fallbacks pending the translation pipeline (see deviation 5).
- Did **not** touch `features.json`, `SCRATCHPAD.md`, the billing engine/actions, `InvoicingHub`, or
  client-portal (owned by other lanes).

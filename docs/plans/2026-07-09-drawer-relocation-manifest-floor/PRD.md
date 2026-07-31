# PRD: Scope the cross-feature "workspace" out of non-work routes (RSC manifest floor)

- **Status:** Draft (ready for implementation loop)
- **Date:** 2026-07-09
- **Owner:** Natallia Bukhtsik
- **Branch:** `fix/eliminate_node_crashes` (base commit `991e3ada8a` = Phase A+B barrel-narrowing)

## Problem statement & user value

The Next.js 16 dev server OOMs (`FATAL ERROR: Zone Allocation failed`) during MSP browsing: a single `JSON.stringify` of `server/.next/dev/server/server-reference-manifest.json` exceeds V8's ~512 MB single-string cap. Manifest size ~ `O(reachable 'use server' modules × routes)`.

Phase A+B (already landed) narrowed barrel imports, taking the projects route partial 21.7 MB → 9.8 MB (−55%), ESLint-guarded. A **~137-module floor remains on every route** — including routes that have nothing to do with tickets/projects/scheduling (billing, settings, inventory, extensions, reports).

**User (alga-psa developer) value:** a dev server that survives a full working session without OOM restarts — especially browsing the *non-work* areas (inventory, billing, settings) where the floor is pure dead weight.

## Root cause & the hard constraint

The floor is the cost of a **deliberate dependency inversion made always-on, feeding a single shell-level drawer**. Feature packages stay mutually isolated (scheduling never imports tickets) via `packages/msp-composition/src/**`: each `Msp<X>CrossFeatureProvider` statically imports the heavy cross-feature view and injects it as a `render*` callback. All of these are mounted in the always-on `server/src/components/layout/DefaultLayout.tsx` (lines 461–587) because the **single MSP `DrawerOutlet` they feed lives there** (line 575).

**Hard constraint discovered during design — cross-feature drawer navigation is a first-class feature.** The drawer is a real navigation *stack* (`packages/ui/src/context/DrawerContext.tsx`: `history[]`, `currentIndex`, `goBack`, `canGoForward`, branch-truncation, `drawer.historyBack` shortcut). Views chain across features: `TicketDetails.tsx:1441` `replaceDrawer(...)` → a client view; `InteractionDetails.tsx:181,202,341` opens client drawers and renders a back button. You can open a ticket → jump to its client → to an interaction → go back/forward, in one panel, from many routes. **This only works because the single `DrawerOutlet` is wrapped by the *full* cross-feature provider stack** — any drawer content can render and navigate to any other feature's content. The manifest floor is the price of that capability.

Two prior directions are **closed**:
- **Split god modules** — empirically dead (a loop attempted 5 splits, measured net-zero, reverted all).
- **Dynamic imports** — rejected (runtime edges that statically-enforced package isolation cannot govern).
- **Per-feature drawer outlets** (an earlier idea in this plan) — **rejected**: a segment-scoped outlet only has that segment's providers, so cross-feature drawer navigation would break (a ticket drawer couldn't `replaceDrawer(<ClientView/>)`). Under no-dynamic-imports, "navigate to anything from anywhere" ⇒ "statically import everything at the outlet." You cannot have per-feature outlets AND the drawer stack.

## The approach (Option A): a shared "workspace" layer over work routes only

Since cross-feature drawer navigation genuinely needs the full provider stack + one outlet, **keep them together and unchanged** — but stop mounting them on routes that don't participate. Split `/msp/*` into:

- **Work routes** — participate in the cross-feature drawer (trigger `openDrawer`, or are reachable as drawer content via navigation): tickets, projects, clients, contacts, assets, scheduling, time-entry, technician-dispatch, time-sheet-approvals, user-activities (and any other route that opens a drawer, e.g. billing contracts — determined empirically).
- **Non-work routes** — zero cross-feature drawer usage: inventory, settings, extensions, reports, automation-hub, document-templates, surveys, service-requests, profile, account, jobs, workflow-editor, etc.

Extract the full cross-feature provider stack + `DrawerOutlet` from `DefaultLayout` into a **`WorkspaceProviders`** boundary, and mount it (via a `(work)` route group layout, or per-work-feature layouts sharing the component) so it wraps **only work routes**. Remove it from the always-on `DefaultLayout`. Cross-feature drawer navigation is byte-for-byte identical (same single outlet, same full stack) — it just isn't loaded on non-work routes, which shed the entire floor.

**Prerequisite (Phase 1):** the header quick-create currently static-imports 6 heavy dialogs into `Header` (shell, on *every* route). Those must first move to intercepted routes (the ticket pattern already does this) — otherwise non-work routes still pull the quick-add graphs via the header and Option A's benefit is blunted.

## Goals

- G1. Non-work routes (inventory/settings/extensions/reports/…) shed the cross-feature floor entirely — static imports only.
- G2. Cross-feature drawer navigation is **preserved exactly** (single outlet + full stack on work routes).
- G3. Package isolation strengthened: the workspace dependency is visible in one boundary; non-work routes don't declare it.
- G4. No behavior change on any route; no dynamic imports; no god-module splitting.
- G5. Measurable: a non-work route (e.g. `/msp/inventory`, `/msp/settings`) pulls **zero** tickets/projects/scheduling/clients cross-feature modules; enough routes shed the floor that a normal session no longer OOMs.

## Non-goals

- N1. **No dynamic imports / `next/dynamic`** (breaks static isolation).
- N2. **No god-module splitting** (proven dead).
- N3. **No change to the drawer UX** — the in-panel cross-feature navigation stack stays. (The alternative of converting drawers to routed modals was explicitly declined.)
- N4. **No attempt to reduce the floor on *work* routes** — that floor is intrinsic to cross-feature drawer nav under these constraints and is accepted. The win is scoping, not shrinking the work stack.
- N5. No new runtime feature, DB migration, monitoring, or barrel-guard policy change.

## Seam map (which providers form the workspace stack)

All of these move together into `WorkspaceProviders` (they are the cross-feature stack + outlet), because cross-feature drawer nav needs them co-mounted:

| DefaultLayout line | Provider | Context | Heavy UI |
|---|---|---|---|
| 461 | SchedulingProviderWithCallbacks | ui SchedulingContext | AgentScheduleView |
| 462 | DrawerProvider (state) | — | (host only; see OQ1 for placement) |
| 463 | MspTicketIntegrationProvider | projects TicketIntegrationContext | TicketDetails, QuickAddTicket, CategoryPicker |
| 464 | MspClientIntegrationProvider | projects ClientIntegrationContext | ClientQuickView |
| 465 | ActivityDrawerProvider | ua ActivityDrawerContext | ActivityDetailViewerDrawer |
| 466 | MspClientDrawerProvider | ui ClientDrawerContext | ClientQuickView |
| 467 | MspClientCrossFeatureProvider | clients ClientCrossFeatureContext | ContractWizard, ContractDialog, ClientQuickView |
| 468 | MspAssetCrossFeatureProvider | assets AssetCrossFeatureContext | TicketDetails, asset dashboards |
| 469 | MspDocumentsCrossFeatureProvider | core DocumentsCrossFeatureContext | Documents, DocumentStorageCard |
| 470 | MspSchedulingCrossFeatureProvider | scheduling SchedulingCrossFeatureContext | TicketDetails, TaskEdit, InteractionDetails |
| 471 | MspActivityCrossFeatureProvider | ui ActivityCrossFeatureContext | TicketDetails, TaskEdit, EntryPopup, TimeEntryDialog, EE TaskForm |
| 472 | QuickAddClientProviderWithCallbacks | ui QuickAddClientContext | quick-add dialogs |
| 575 | **DrawerOutlet** | — | renders drawer content (the shared surface) |

**Stays in the always-on shell (verified lightweight):** command palette (no feature UI), chat right-sidebar (already `lazy`), header chrome. The header quick-create *trigger* stays; its 6 heavy dialogs move to intercepted routes (Phase 1).

## Technical approach

### Phase 1 — Intercept header quick-create (prerequisite + standalone)

Replicate the existing ticket intercepted-route pattern (`server/src/app/msp/create-ticket/page.tsx` + `@modal/(.)create-ticket/` + `buildCreateTicketHref`) for the other 6 dialogs (client, contact, asset, project, service, product): a real `/msp/create-<x>` route + an intercepting `@modal/(.)create-<x>` slot that statically imports that one dialog; `QuickCreateDialog` navigates via an href builder instead of static-importing the dialog. Removes those graphs from the header (and thus every route). Bankable on its own.

### Phase 2 (Option A) — Workspace layer over work routes

1. **Define the work set** — enumerate every `/msp/*` route that triggers `openDrawer` or renders a component reachable as drawer content (grep `useDrawer`/`openDrawer`/`replaceDrawer` + the cross-feature `use*` hooks up to their routes). Everything else is non-work. Record both lists; measure current floor on 3 non-work routes to size the win.
2. **Extract `WorkspaceProviders`** — a single component containing the exact provider stack (lines 461–472) + `DrawerOutlet` (575), moved verbatim from `DefaultLayout`. (This folds in the projects `TicketIntegration`/`ClientIntegration` relocation — they're part of the stack.)
3. **Mount it over work routes only** — via a `(work)` route-group layout (`server/src/app/msp/(work)/layout.tsx`) with the work feature folders moved under it, OR per-work-feature `layout.tsx` files each rendering `<WorkspaceProviders>`. A **spike** picks the mechanism (route groups interact with the existing `@modal` parallel slot + intercepting routes — validate before committing).
4. **Remove from `DefaultLayout`** — delete lines 461–472 + 575 from `DefaultLayout`; keep `DrawerProvider` *state* wherever chrome still needs it (OQ1). Non-work routes now render only shell chrome.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Route group `(work)` conflicts with the existing `@modal` parallel slot / intercepting create-routes at `app/msp/` | **Spike first.** Keep `@modal` + `create-<x>` at the `app/msp` level (shell-triggered); move only feature route folders into `(work)`. Fall back to per-work-feature `layout.tsx` sharing `WorkspaceProviders` (no folder moves) if the group misbehaves. |
| A route thought non-work actually opens a drawer → breaks at runtime (no outlet) | The work-set discovery (grep-based) is exhaustive; any route touching `useDrawer` is classified work. Runtime-smoke each non-work route for stray drawer triggers. |
| `DrawerProvider` state placement leaves a chrome trigger without context | Keep `DrawerProvider` state above `WorkspaceProviders` (in DefaultLayout) so chrome can trigger; only the outlet + cross-feature providers move. Decide in the spike (OQ1). |
| Win is small because most routes are "work" | Measure in step 1; the user's reported OOM triggers (inventory, billing, settings) are non-work → directly relieved. If the win is too small, that's the ceiling under N3/N4 and is reported honestly. |
| Re-introducing a barrel or dynamic import | ESLint barrel guard covers touched scopes; add a grep gate forbidding `import('@alga-psa/…')` in shell + layouts + msp-composition. |

## Rollout / migration

Dev-time refactor; no schema, no runtime toggle. Commit per `commitGroup`. Phase 1 ships and verifies independently; Phase 2 is spike-gated and revertible as a unit.

## Acceptance criteria / Definition of Done

- AC1. `cd server && NODE_OPTIONS="--max-old-space-size=16384" npm run typecheck` → exit 0 (after each phase).
- AC2. ESLint barrel guard → 0 violations; `rg "import\(['\"]@alga-psa/"` over `server/src/components/layout/**`, `server/src/app/msp/**/layout.tsx`, `packages/msp-composition/src/**` → empty.
- AC3. After Phase 1: the 6 quick-add dialog graphs (assets/clients/projects/billing) are gone from the header/shell chunk (canary trace).
- AC4. After Phase 2: a non-work route (`/msp/inventory` and `/msp/settings`) pulls **zero** tickets/projects/scheduling/clients/user-activities cross-feature modules; no dev OOM after compiling ≥ 15 routes spanning work + non-work.
- AC5. **Cross-feature drawer navigation is intact on work routes**: ticket→client→interaction chain with `goBack`/forward works exactly as before (runtime smoke).
- AC6. `packageDependencies.test.ts` + touched-package unit tests pass.
- AC7. `DefaultLayout` no longer renders the cross-feature provider stack or the `DrawerOutlet`; work routes render them via the workspace layer.

## Open questions

- OQ1. `DrawerProvider` state: keep global in `DefaultLayout` (chrome can trigger) with `WorkspaceProviders` holding only the cross-feature providers + outlet, or move state into `WorkspaceProviders` too (non-work routes have no drawer at all)? Resolve in the spike based on whether any surviving chrome trigger (notification bell? command palette?) opens a drawer.
- OQ2. Mechanism: `(work)` route group (single mount, needs folder moves + `@modal` validation) vs per-work-feature `layout.tsx` sharing `WorkspaceProviders` (no folder moves, N duplicate mounts, only one active). Spike decides.
- OQ3. Exact work/non-work boundary for ambiguous routes (billing renders contracts/documents drawers via self-wrap; is it work?). Resolved empirically in step 1.

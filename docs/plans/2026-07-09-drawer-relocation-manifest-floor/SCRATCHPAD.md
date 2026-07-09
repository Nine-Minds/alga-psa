# SCRATCHPAD — Relocate cross-feature composition out of the shell

## Links
- PRD (this folder). Branch `fix/eliminate_node_crashes`, base `991e3ada8a` (Phase A+B).
- Prior Phase A+B plan: `~/.claude/plans/recursive-rolling-kahn.md`.
- ESLint barrel guard: `eslint.config.js` → `ALGA_BARREL_RESTRICTED_PATHS`.
- Doc: `docs/architecture/package-build-system.md` → "Server-action barrels & the RSC manifest".

## Why (the OOM in one paragraph)
Dev OOM = one `JSON.stringify` of `server/.next/dev/server/server-reference-manifest.json` > V8's ~512MB string cap. Size ~ O(reachable 'use server' modules × routes). Phase A+B cut barrels (projects 21.7MB→9.8MB). Residual ~137-module/route floor = the always-on shell (`DefaultLayout` lines 461-587) statically composing every feature's cross-feature UI, fed by the single shell `DrawerOutlet` (line 575). This plan relocates that composition to route segments — static, isolation-preserving.

## DECISIVE FINDING (2026-07-09) — cross-feature drawer navigation is first-class
The drawer is a real navigation STACK (`packages/ui/src/context/DrawerContext.tsx`: `history[]`, `currentIndex`, `goBack`, `canGoForward`, branch-truncation, `drawer.historyBack` keyboard shortcut). Views chain ACROSS features:
- `TicketDetails.tsx:1032,1441` — ticket drawer `replaceDrawer(...)` → a client view.
- `InteractionDetails.tsx:92,181,202,341` — `openDrawer`, `clientDrawer.openClientDrawer(...)`, and a `goBack` button.
So you can open a ticket → jump to its client → to an interaction → go back/forward, one panel, from many routes. This ONLY works because the single `DrawerOutlet` is wrapped by the FULL cross-feature provider stack.

CONSEQUENCE: **per-feature drawer outlets are REJECTED.** A segment-scoped outlet only has that segment's providers → cross-feature `replaceDrawer(<ClientView/>)` would break. Under no-dynamic-imports, "navigate to anything from anywhere" ⇒ "statically import everything at the outlet" ⇒ the floor. Cannot have per-feature outlets AND the drawer stack.

DECISION: **Option A only** (user, 2026-07-09) — keep the single outlet + full stack together and UNCHANGED (drawer nav byte-for-byte identical), but mount them (`WorkspaceProviders`) over WORK routes only; non-work routes (inventory/settings/extensions/reports/…) shed the whole floor. The work-route floor is intrinsic to cross-feature drawer nav and is ACCEPTED (N4). Option B (routed modals) was declined (N3).

## DEAD ENDS (do not re-attempt — reset out on 2026-07-09)
- **Option 1 — split god modules:** a full loop attempted 5 splits (optimizedTicketActions, ticketActions, projectTaskActions, projectActions, documentActions), created lean `*Reads.ts` + `_internal/` files, measured each, and REVERTED all. Result: 137→137/139 modules — NO reduction. Reason: the shell imports heavy UI *components* (TicketDetails, TaskEdit, dashboards) that pull the action subsystems regardless of how actions are split. Net-zero code. Plan folder + 6 bookkeeping commits were `git reset --hard`'d off (recover: `git reset --hard 4b30d5515d`).
- **Option 2 — dynamic imports / next/dynamic:** REJECTED by architecture. `import('@alga-psa/…')` is a runtime edge the statically-enforced package isolation (declared deps, subpath exports, ESLint boundary rules, packageDependencies.test.ts) cannot see/govern. No dynamic imports anywhere in this work (N1).

## THE SEAM (3-agent trace, 2026-07-08)
Dependency-inversion: each feature package defines a context ("I need X integration"); `packages/msp-composition/src/**` supplies it by importing the OTHER feature's heavy UI and injecting `render*` callbacks. Correct feature-package isolation — but all mounted in always-on DefaultLayout because the single DrawerOutlet is there.

DECISIVE FACT: `DrawerOutlet` (DefaultLayout:575) is the ONLY MSP outlet; `openDrawer(content: ReactNode)` (packages/ui/src/context/DrawerContext.tsx) stores content in reducer state and renders it at the outlet → content is parented to the SHELL, reads context from the shell. So any heavy view opened via the global drawer pins its provider to the shell. (Verified: no DrawerOutlet exists outside DefaultLayout in the MSP tree.)

MANIFEST vs CONTEXT (keep these straight):
- MANIFEST/module-graph = who statically `import`s the heavy view = the PROVIDER that builds the render callback. Move the provider → move the import.
- CONTEXT/runtime = where the element RENDERS (the outlet position). Moving a provider out of the shell requires the drawer content to render under that provider → the outlet must be in the segment too. That's why Phase 2 = per-segment outlets.

NOTE: the per-provider P1/P2 verdicts below are SUPERSEDED by the Option-A decision — all cross-feature providers (461-472) + DrawerOutlet (575) move TOGETHER into `WorkspaceProviders` (cross-feature drawer nav needs them co-mounted). The table is kept only as the inventory of what's in the stack + who consumes each context.

Seam table (provider @ DefaultLayout line → context → heavy UI → consumers → in-stack):
| Provider (line) | context | heavy UI | consumed on | verdict |
|---|---|---|---|---|
| SchedulingProviderWithCallbacks (461) | ui SchedulingContext | AgentScheduleView | tickets/clients/projects via drawer | drawer-pinned → P2 |
| MspTicketIntegrationProvider (463) | projects TicketIntegrationContext | TicketDetails,QuickAddTicket,CategoryPicker | projects/**, tickets/[id]*, user-activities | SCOPED → P1 |
| MspClientIntegrationProvider (464) | projects ClientIntegrationContext | ClientQuickView | projects/** + shell(QuickCreate→ProjectQuickAdd) | P1 (unpin via intercept) |
| ActivityDrawerProvider (465) | ua ActivityDrawerContext | ActivityDetailViewerDrawer | user-activities only | P2 (drawer) |
| MspClientDrawerProvider (466) | ui ClientDrawerContext | ClientQuickView | clients/contacts/projects/assets via drawer | P2 |
| MspClientCrossFeatureProvider (467) | clients ClientCrossFeatureContext | ContractWizard,ContractDialog,ClientQuickView | clients/contacts/projects/scheduling | P2 |
| MspAssetCrossFeatureProvider (468) | assets AssetCrossFeatureContext | TicketDetails,asset dashboards | assets, clients/[id], tickets/[id] | P2 or accept (OQ2) |
| MspDocumentsCrossFeatureProvider (469) | core DocumentsCrossFeatureContext | Documents,DocumentStorageCard | 6 groups + drawer | P2 or accept (OQ2) |
| MspSchedulingCrossFeatureProvider (470) | scheduling SchedulingCrossFeatureContext | TicketDetails,TaskEdit,InteractionDetails | WorkItemDrawer (all via drawer) | P2 |
| MspActivityCrossFeatureProvider (471) | ui ActivityCrossFeatureContext | TicketDetails,TaskEdit,EntryPopup,TimeEntryDialog,EE TaskForm | user-activities components | P2 (heaviest) |
| QuickAddClientProviderWithCallbacks (472) | ui QuickAddClientContext | quick-add dialogs | header + many | GLOBAL — STAYS |

STAY-GLOBAL (verified lightweight): CommandPalette (no feature UI), chat RightSidebar (already `lazy`), generic DrawerProvider/DrawerOutlet host, header quick-create trigger.

REUSE THESE EXISTING PATTERNS:
- Ticket quick-create already intercepted: `server/src/app/msp/create-ticket/page.tsx` + `server/src/app/msp/@modal/(.)create-ticket/` + `buildCreateTicketHref` (`@alga-psa/tickets/lib/createTicketRoute`). Template for P1's other 6 dialogs.
- Self-wrap precedents: `MspProjectPageClient`, `MspTicketDetailsContainerClient` (L91), `MspBillingDashboardClient` (L17), `MspContactTickets` (L230) already re-provide contexts at feature entry. The shell copies are partly redundant already.

## RUNBOOK — manifest canary (ground truth; rerun after each group)
```bash
cd /Users/natalliabukhtsik/Desktop/projects/alga-psa
pkill -f "nx next:dev server"; rm -rf server/.next/dev
NX_LOAD_DOT_ENV_FILES=false NODE_ENV=development NX_TUI=false NX_DAEMON=false E2E_AUTH_BYPASS=true PORT=3000 \
  nohup npx nx next:dev server > /tmp/dr.log 2>&1 &   # wait for "Ready in"
for r in /msp/projects /msp/billing /msp/schedule /msp/tickets /msp/clients; do
  curl -s -o /dev/null -w "%{http_code} $r\n" --max-time 150 "http://localhost:3000$r"; done  # first may be 000, re-hit
ls -lh server/.next/dev/server/app/msp/projects/page/server-reference-manifest.json
grep -o 'ACTIONS_MODULE[0-9]*' server/.next/dev/server/app/msp/projects/page/server-reference-manifest.json | sort -u | wc -l
# KEY Phase-2 check: does a feature-agnostic route still pull cross-feature packages?
python3 -c "
import json,re,collections,sys
d=json.load(open(sys.argv[1])); k=next(iter(d['node']))
mid=next(iter(d['node'][k]['workers'].values()))['moduleId']
c=collections.Counter(re.findall(r'\[project\]/(packages/[a-z-]+|server/src)/',mid))
[print(f'{n:4d}  {p}') for p,n in c.most_common()]
" server/.next/dev/server/app/msp/billing/page/server-reference-manifest.json
```
Gotcha (from prior run): background `nohup … &` sometimes leaves an empty log in this shell — if so, run the dev server in the foreground and drive curls from another step. E2E_AUTH_BYPASS routes 307 (compile happens before the layout auth redirect → manifest populates). zsh does NOT word-split `$VAR` in `for` loops — use explicit lists.

## RUNBOOK — gates
```bash
cd server && NODE_OPTIONS="--max-old-space-size=16384" npm run typecheck        # exit 0
cd /Users/natalliabukhtsik/Desktop/projects/alga-psa
npx eslint "server/src/components/layout/**/*.{ts,tsx}" "server/src/app/msp/**/layout.tsx" \
  "packages/msp-composition/src/**/*.{ts,tsx}" "packages/*/src/actions/**/*.{ts,tsx}" --quiet 2>&1 | grep -c "no-restricted-imports"   # 0
# no dynamic imports rule (manual until an ESLint rule is added):
rg -n "import\(['\"]@alga-psa/" server/src/components/layout server/src/app/msp packages/msp-composition/src   # empty
cd packages/msp-composition && npx vitest run src/packageDependencies.test.ts   # note: root vitest include is ../packages/**, run package-relative
```

## GOTCHAS / DECISIONS
- Node v25.8.1; heap ~8.4GB irrelevant (per-string cap). `tsc` needs the 16GB flag.
- Phase 1 is standalone and bankable even if Phase 2 is deferred.
- Phase 2 gated on the SPIKE (F040-F042): confirm the "global drawer state + per-segment outlet, one active outlet at a time" model holds; else fall back to per-segment DrawerProvider (OQ1).
- Duplicating a provider across N segment layouts is fine (static, scoped) when a view is opened from a few segments; for genuinely-everywhere views (documents) weigh duplication vs the small win (OQ2). Measure before deciding.
- Feature-package isolation MUST be preserved: keep the render-callback injection (scheduling never imports tickets directly); only the MOUNT POINT moves.

## RESULTS (fill in)
Option A frees NON-WORK routes; work routes keep the floor (intrinsic to drawer nav — accepted).
| Milestone | non-work route (/msp/inventory) cross-feature modules | non-work partial size | work route (/msp/projects) — expected unchanged | notes |
|---|---|---|---|---|
| baseline (Phase A+B) | tickets 16522, clients 10514, scheduling 7510, projects 4506, user-activities 751 | 13.70 MB / 163 actions | 9.80 MB / 137 actions | measured 2026-07-09 via dev canary |
| after P1 (intercept quick-create) | ? (quick-add graphs gone) | ? | ~unchanged | — |
| after P2 (workspace layer) | target 0 tickets/projects/scheduling/clients/ua | target ≪ baseline | ~137 (accepted) | — |
| /msp/settings (non-work) | baseline tickets 30383, clients 31704, scheduling 14531, projects 15852, user-activities 1321 | 37.39 MB / 251 actions | — | measured 2026-07-09 |
| /msp/billing (ambiguous) | baseline tickets 24002, clients 15274, scheduling 10910, projects 6546, user-activities 1091 | 24.43 MB / 201 actions | — | classification deferred to p2 work-set grep |

## 2026-07-09 — p1-intercept-scaffold
- F001/T001 baseline canary captured with `NX_LOAD_DOT_ENV_FILES=false NODE_ENV=development NX_TUI=false NX_DAEMON=false E2E_AUTH_BYPASS=true PORT=3000 npx nx next:dev server`; route hits returned 307 after compiling, which is acceptable because manifest generation occurs before auth redirect.
- Baseline manifest readings:
  - `/msp/projects`: `server/.next/dev/server/app/msp/projects/page/server-reference-manifest.json`, 9.80 MB (`10280206` bytes), 137 `ACTIONS_MODULE*` entries.
  - `/msp/inventory`: 13.70 MB (`14367196` bytes), 163 actions; cross-feature counts tickets 16522, clients 10514, scheduling 7510, projects 4506, user-activities 751.
  - `/msp/settings`: 37.39 MB (`39208781` bytes), 251 actions; cross-feature counts clients 31704, tickets 30383, projects 15852, scheduling 14531, user-activities 1321.
  - `/msp/billing`: 24.43 MB (`25617939` bytes), 201 actions; cross-feature counts tickets 24002, clients 15274, scheduling 10910, projects 6546, user-activities 1091.
- F002 ticket intercepted quick-create pattern: `packages/tickets/src/lib/createTicketRoute.ts` owns `CREATE_TICKET_PATH`, `buildCreateTicketHref`, and `parseCreateTicketPrefill`; `server/src/app/msp/create-ticket/page.tsx` renders the full-page route with `closeMode="replace"`; `server/src/app/msp/@modal/(.)create-ticket/page.tsx` renders the intercepted modal with `closeMode="back"`; both delegate UI to `server/src/app/msp/_components/CreateTicketRouteClient.tsx`.
- F003 changed `server/src/components/layout/QuickCreateDialog.tsx` into a route-only dispatcher. It now imports only `buildCreateTicketHref` from feature packages and maps client/contact/asset/project/service/product to `/msp/create-<x>`, eliminating direct shell imports of `QuickAddClient`, `QuickAddContact`, `QuickAddAsset`, `ProjectQuickAdd`, `QuickAddService`, and `QuickAddProduct`.
- T002 verification: `rg` over `QuickCreateDialog.tsx` finds no heavy dialog/action/loading imports (only the component name itself); `cd server && NODE_OPTIONS="--max-old-space-size=16384" npm run typecheck` exited 0; `cd server && npx vitest run src/test/unit/layout/QuickCreateDialog.i18n.test.tsx` passed 2 tests. Attempting the older ticket integration test also hit an existing Vite resolver issue in `Header.tsx` for `@alga-psa/auth/actions/permission-actions`, so it is not used as the scaffold gate.

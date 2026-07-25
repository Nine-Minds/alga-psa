# Identity (Microsoft Entra + CIPP) experience overhaul — implementation plan

**Date:** 2026-07-25
**Branch:** `improve/cipp-ui`
**Status:** Draft, approved for implementation
**Design mockups:** [`2026-07-25-identity-cipp-ui-mockups/`](./2026-07-25-identity-cipp-ui-mockups/index.html) —
option 1 chosen. Open `index.html` in a browser; each option has a lifecycle state switcher
(not connected → connected → mapping → preflight → operating → failing), a dark-mode toggle, and working
dialogs, tabs, filters and expanders. Options 2 and 3 are kept as the rejected alternatives.

## Intent

Rebuild the Identity tab's Microsoft Entra surface so it tells the truth about what it does, refuses to
act before the operator has seen what will change, and remains usable at 200 tenants.

The predecessor branch (`docs/plans/2026-07-22-cipp-pro-migration-plan.md`) moved Entra + CIPP down to the
Pro tier and reinstated CIPP as a connection option. The packaging is done; the experience is not. Three
MSP-owner personas reviewed the live screen and independently reached the same verdict: the engine underneath
is careful, and the screen keeps that a secret while placing a trap where the primary action should be.

## Chosen design — option 1, "guided setup → console"

Entra gets its own route. Until the tenant has completed one real sync, a **setup wizard** owns the screen:
one decision at a time, disclosure before consent, and a contact preflight as the gate before any write.
After that the route becomes a **tabbed operations console** — Overview · Sync & schedule · Clients ·
Field rules · Review queue · History · Connection.

Rejected alternatives, for the record: a single urgency-ranked page (cheapest, but the first run is still a
scroll past inert boxes and the mapping table stays cramped) and a client-centric workbench (best at scale
and for piloting, but a list is a poor teacher on a cold tenant). Option 1's ops console adopts the
workbench's per-client drill-down inside the Clients tab, so that idea is not lost.

## Verified findings that motivate the work

Every item below was confirmed by reading the code during the design session, not inferred from the UI.

| # | Finding | Evidence |
|---|---|---|
| F1 | The `Reconnect` button renders whenever status ≠ `connected` — **including never-connected** — and its handler launches Direct OAuth with a full-page redirect to Microsoft. A CIPP shop clicking it is silently committed to the wrong connection type. | `ee/server/src/components/settings/integrations/EntraIntegrationSettings.tsx:559-563` |
| F2 | That same handler early-returns when `!isConnectStepCurrent`, so past step 1 the button is a **silent no-op**. One control, two failure modes, identical appearance. | same file `:386-389` |
| F3 | `connectEntraCipp` inserts the connection row with `status:'connected'`, `is_active:true`, `last_validated_at:null` and validates **afterwards**. A typo yields a persisted, lying `connected` row. | `packages/integrations/src/actions/integrations/entraActions.ts:528-543` |
| F4 | `handleDisconnect` fires immediately with **no confirmation** and no statement of consequences. | `EntraIntegrationSettings.tsx:411-419` |
| F5 | The status badge renders `status?.status` raw, so the UI shows `not_connected` — twice, in adjacent boxes. | `EntraIntegrationSettings.tsx:544` |
| F6 | **The recurring sync scheduler still gates on the Enterprise add-on.** The tier migration swapped the UI gate and the API route guard to Pro but never touched `ee/temporal-workflows` — its audit grep covered `ee/server/src`, `server/src` and `packages` only. A Pro tenant gets the full UI and manual sync, while its schedule is actively **deleted**. | `ee/temporal-workflows/src/schedules/setupSchedules.ts:448` |
| F7 | **`dryRun` is fully implemented and unreachable.** `executeEntraSync` guards every write path with it — ambiguous-queue insert, contact link, contact create — and the sole call site hardcodes `dryRun:false`. | `ee/server/src/lib/integrations/entra/sync/syncEngine.ts:33-70`; `ee/temporal-workflows/src/activities/entra-sync-activities.ts:139` |
| F8 | `markDisabledEntraUsersInactive` runs **outside** `executeEntraSync` and is **not** dry-run guarded. A naive preflight would still inactivate contacts. | `entra-sync-activities.ts:148-150` |
| F9 | `updated_count` is **structurally always 0** — the aggregator only increments `created`/`linked`/`ambiguous`. Field overwrites happen inside `linkExistingMatchedContact` but count as `linked`. The UI renders a number that can never be non-zero. | `syncEngine.ts:36-70`; `entra-sync-activities.ts:293`; `ee/server/src/lib/integrations/entra/entraWorkflowClient.ts:309` |
| F10 | `sync_enabled` defaults to `true` and `sync_interval_minutes` to `1440`, and the screen's only mention of the schedule is the read-only, unsettable line "Next Sync Interval". | `ee/server/migrations/20260220143000_create_entra_phase1_schema.cjs`; asserted in `server/src/test/unit/migrations/entraPhase1Migration.test.ts:48-49` |
| F11 | Field-sync controls and the ambiguous-match queue are complete but hidden behind default-off flags `entra-integration-field-sync` and `entra-integration-ambiguous-queue`. All three personas called the field-sync panel the most reassuring thing in the feature. | `EntraIntegrationSettings.tsx:139-140` |
| F12 | Sync run details identify tenants by **GUID**, not client name — on the screen whose whole purpose was mapping GUIDs to client names. | `entraWorkflowClient.ts` run detail mapping |

## Access gating as of this branch

The `entra-integration-ui` master flag is **being retired**. Work already in progress on this branch removes
the flag check from the route guard, renames `requireEntraUiFlagEnabled` → `requireEntraAccess`, propagates
the rename across all 16 Entra API routes plus `server/src/middleware.ts`, and drops the flag from
`ENTRA_PHASE1_FLAG_DEFINITIONS` in `ee/server/src/lib/platformFeatureFlags/posthogClient.ts`.

Access to the Entra surface is therefore, from here on:

```
EE edition  +  assertTierAccess(TIER_FEATURES.ENTRA_SYNC)  [Pro+]  +  RBAC system_settings read/update
```

Consequences for this plan:

- **Nothing in this overhaul may reintroduce a UI-level flag gate.** The new route and every component below
  it gate on tier and permission only.
- The 404-when-disabled branch is gone, so a tenant that fails the check gets the tier 403, not a "disabled"
  404. Error copy on the new surfaces should reflect that.
- Flags that **remain** after this branch: `entra-integration-cipp` (soft-launch control for the CIPP
  connection option, per the 2026-07-22 migration plan), `entra-integration-field-sync` and
  `entra-integration-ambiguous-queue` (both retired in PR5 below), and
  `entra-integration-client-sync-action`.
- Whether `entra-integration-cipp` is also retired is an **ops decision, not a code decision** — the soft
  launch sequence is flip-per-tenant, then global, then retire. This plan leaves it in place and assumes CIPP
  is on for the tenants exercising the new flow.
- Stale prose references to the flag survive in the historical phase-1 artifacts
  (`ee/docs/plans/2026-02-20-entra-integration-phase-1/{features.json,tests.json}`). They describe what was
  true then; leave them, or annotate rather than rewrite history.

## Scope decisions (settled 2026-07-25)

- **Full experience overhaul**, including surfaces outside the Identity screen.
- Serve all four persona priorities: disclosure before consent, preflight + single-client pilot,
  ops console with pause, and the trap fixes.
- **Surface both** hidden panels (field sync and ambiguous queue) — remove the flags.
- **Automatic sync defaults off for everyone**, and existing tenants are migrated to off.
- **Include contact-record surfacing and notifications.**

### Note on the migrate-to-off decision

Because of F6, the tenants actually running recurring sync today are only those with an active Enterprise
add-on **and** an active connection **and** `sync_enabled`. The feature was add-on-gated until 2026-07-22,
so this population is small and enumerable. Enumerate it before the migration ships and hand ops the list
for targeted notification rather than a broadcast:

```sql
SELECT s.tenant, t.name, s.sync_interval_minutes, c.connection_type
FROM entra_sync_settings s
JOIN tenants t ON t.tenant = s.tenant
JOIN entra_partner_connections c ON c.tenant = s.tenant AND c.is_active
JOIN tenant_addons a ON a.tenant = s.tenant AND a.addon_key = 'ENTERPRISE'
  AND (a.expires_at IS NULL OR a.expires_at > now())
WHERE s.sync_enabled AND t.suspended_at IS NULL;
```

## Architecture

### Route

New EE route `server/src/app/msp/settings/integrations/entra/page.tsx` (thin shell) rendering the EE component
tree. The Identity category in `packages/integrations/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
keeps its Entra card but the card becomes a summary + "Open" affordance rather than the full screen, so the
existing `?category=identity` deep link still lands somewhere sensible. Preserve the OAuth callback's
`?category=identity` redirect (`ee/server/src/app/api/auth/microsoft/entra/callback/route.ts:38,50`) — it must
land on the new route once connected.

### Mode selection

`mode = hasCompletedFirstSync ? 'console' : 'setup'`, where `hasCompletedFirstSync` is
"≥1 non-dry `entra_sync_run` with status `completed`". Derived server-side and returned by
`GET /api/integrations/entra`. Rules:

- The console never auto-reverts to setup, even if the connection later breaks — a broken connection is an
  Overview attention item, not a regression to onboarding.
- Setup remains reachable from the console via Connection → "Run setup again" for re-onboarding.
- Deep links carry `?tab=` in console mode.

### Component tree

```
EntraIntegrationPage                     (mode selection, shared status fetch)
├── EntraSetupWizard/                    (setup mode)
│   ├── StepLadder                       horizontal, 4 steps, real state
│   ├── Step1Connect
│   │   ├── PreConsentDisclosure         scopes + contact-effect contract
│   │   ├── ConnectionMethodChooser      real radio group, focusable, prerequisites per option
│   │   ├── EntraDirectConsentDialog     interstitial before the Microsoft redirect
│   │   └── EntraCippConnectDialog       (rewritten: test-before-save)
│   ├── Step2Discovery
│   ├── Step3Mapping                     shares TenantMappingTable with the console
│   └── Step4PreflightAndPilot
│       ├── ContactPreflightReport       buckets + expandable names
│       ├── FieldSyncRules               (shared)
│       └── PilotSyncControl             one client, then unlock the rest
└── EntraConsole/                        (console mode)
    ├── ConsoleHeader                    health chip, Sync now, Pause
    ├── OverviewTab                      AttentionList + last-run summary + side rail
    ├── SyncScheduleTab                  on/off, interval, pause, notification prefs
    ├── ClientsTab                       per-client rows expanding to per-client detail
    ├── FieldRulesTab                    (shared FieldSyncRules)
    ├── ReviewQueueTab                   ambiguous matches, with Ignore
    ├── HistoryTab                       filters, client names, trigger, actor, export
    └── ConnectionTab                    rotate, test, connection record, disconnect
```

Existing `EntraIntegrationSettings.tsx` (952 lines) is decomposed into the above and deleted. Its
sub-behaviours (discovery call, mapping preview/confirm, run list) move into the new components largely intact.

## Staged delivery

Each PR is independently shippable and independently valuable. PR1 is worth merging even if the rest slips.

---

### PR1 — Stop the traps, fix the lies

No new surfaces. Pure defect work against the current screen, so it can ship immediately.

**Changes**

1. **F1/F2 — kill the Reconnect trap.** `EntraIntegrationSettings.tsx`: in the not-connected state render no
   action in the status header (the connection chooser below is the action). Reserve a `Reconnect` control for
   the genuinely-was-connected-and-broke state, and have it re-run the *stored* connection type rather than
   assuming `direct`. Remove the silent `!isConnectStepCurrent` no-op path — a rendered button must always act.
2. **F3 — validate before persisting.** `connectEntraCipp`: validate the credential against CIPP first; only
   insert the connection row on success. On failure return the error and write nothing. Same treatment for the
   direct path's post-callback persistence. Keep `last_validated_at` set on the successful insert.
3. **F4 — confirm destructive actions.** Add a confirmation dialog to Disconnect stating what is kept
   (contacts, mappings, history) and what stops (schedule, stored credential). Add confirmation to
   "Import as new client" with a similar-client warning, and to unmap.
4. **F5 — plain-English status.** Map connection status to localized labels; render once. Remove the duplicate
   in the OVERVIEW block.
5. **F9 — make `updated` truthful.** `linkExistingMatchedContact` returns whether it actually changed any field;
   `executeEntraSync` increments `updated` when it did. `linked` continues to count links. Add a unit test
   asserting a field-overwrite run reports `updated > 0`.
6. **F6 — un-gate the scheduler.** `setupSchedules.ts:448`: replace `!config.hasEnterpriseAddOn` with the tier
   check that matches the API guard (Pro+). Drop `activeEnterpriseAddOn` from `loadEntraScheduleConfigs` if it
   becomes unused. **This is a live production bug** — Pro tenants currently get a deleted schedule.
7. Remove the unsettable "Next Sync Interval" line from the overview until PR4 gives it a real control.

**Tests**
- `ee/server/src/__tests__/unit/entraConnectValidation.test.ts` (new): failed validation persists no row.
- Guard test for the scheduler tier check, including a Pro tenant with no add-on getting a schedule.
- Update `server/src/test/unit/components/integrations/entraIntegrationSettingsGates.test.ts` for the header action.
- `syncEngine` counter test for `updated`.

---

### PR2 — The route, the wizard, and disclosure

**Changes**

0. **Build on the retired master flag.** The `requireEntraAccess` rename and flag removal land before or with
   this PR (see "Access gating" above). The new route gates on tier + RBAC only — do not add a flag check,
   and do not resurrect the 404-when-disabled response.
1. New route + page shell; Identity category card becomes a summary with an "Open" link; callback redirect updated.
2. `EntraSetupWizard` with the four-step ladder; each step **contains** its action. Delete the
   "Connection options appear below" pattern entirely.
3. `PreConsentDisclosure`: the read-only scope list with plain-English glosses, and the contact-effect contract
   ("matched by email within the mapped client; unmatched become new contacts; existing names/emails/phones/titles
   are not overwritten unless you turn that on; nothing is ever deleted"). Include a "copy for a change record" action.
4. `ConnectionMethodChooser`: a real `role="radiogroup"` of focusable controls with visible focus rings, a
   prerequisites checklist per option, and one recommendation line ("Most MSPs should choose Direct; choose CIPP
   only if you already run an instance"). Expand the CIPP acronym once.
5. `EntraDirectConsentDialog`: interstitial listing the exact scopes before the redirect, naming that a Global
   Admin must consent, and stating the connection runs as a service principal rather than the operator's login.
6. `EntraCippConnectDialog` rewritten: label the CIPP-API function app host distinctly from the CIPP frontend,
   name the credential in CIPP's own vocabulary with where-to-find-it guidance, add an explicit **Test connection**
   separate from Save, disable Save until the test passes, and state that the secret is encrypted at rest.

**Tests** — wizard step gating; chooser is keyboard-operable and exposes correct ARIA; disclosure renders the
scope list; CIPP dialog keeps Save disabled until a passing test.

---

### PR3 — Contact preflight and single-client pilot

The highest-value PR, and mostly plumbing thanks to F7.

**Changes**

1. **Expose `dryRun`.** Thread a `dryRun` flag from a new preflight entry point through
   `entra-sync-activities.ts` into `executeEntraSync` (which already honours it).
2. **F8 — guard inactivation.** Move `markDisabledEntraUsersInactive` behind the same flag, or compute the
   disabled-identity count without writing when `dryRun`. **A preflight that inactivates contacts is worse than
   no preflight**; this must be covered by an explicit test.
3. New endpoint `POST /api/integrations/entra/sync/preflight` taking a client/mapping scope and returning bucket
   counts plus sample identities per bucket.
4. Persist preflight runs as `entra_sync_run` rows with `is_dry_run = true` (new column) so a preview is audit
   evidence and can be shown as "preview run at 14:22". Exclude dry runs from health/attention aggregates and
   from `hasCompletedFirstSync`.
5. `ContactPreflightReport` component: buckets (link / create / needs decision / mark inactive / no change) with
   expandable identity lists, wired into wizard step 4 and reused in the console.
6. `PilotSyncControl`: sync one selected client; the "sync remaining N" action stays disabled until the first
   client's run completes.
7. Split the all-tenants sync so a run can be scoped to one mapping, and record run scope so history can say
   "Contoso only".

**Tests** — dry run writes nothing (contacts, ambiguous queue, **and** inactivation); preflight counts equal the
subsequent real run's counts on unchanged data; pilot control unlocks only after a completed run.

---

### PR4 — Ops console

**Changes**

1. `EntraConsole` shell with tabs and `?tab=` deep links; mode selection wired to `hasCompletedFirstSync`.
2. **Overview**: `AttentionList` (failing clients grouped by shared root cause, review-queue backlog, unmatched
   tenants), last-run summary, and a side rail for schedule/connection/field-rule state.
3. **Sync & schedule**: automatic sync on/off, interval, Pause, last/next run. Backed by real writes to
   `entra_sync_settings` and a schedule upsert/delete on change.
4. **Clients**: search, state filters, per-client rows expanding to last-run counters, mapping provenance,
   per-client preview and sync, and unlink. Absorbs the mapping table's management duties at scale.
5. **History**: date/actor/trigger/failures-only filters, pagination beyond 10 runs, CSV export, and
   **F12 — client name and primary domain instead of tenant GUIDs**, with a link to the client.
6. **Connection**: rotate credential in place (re-validate, keep mappings/history), test now, connection record
   export for audit, and the confirming Disconnect from PR1.
7. Record run trigger and actor (`schedule` vs a named user) on `entra_sync_run`.

**Tests** — schedule writes and schedule-object lifecycle; history filters; rotation preserves mappings;
run detail renders client names.

---

### PR5 — Field rules and review queue, unflagged

**Changes**

1. Remove `entra-integration-field-sync` and `entra-integration-ambiguous-queue` reads; render both permanently.
   Drop both from `ENTRA_PHASE1_FLAG_DEFINITIONS` in `posthogClient.ts`, matching how `entra-integration-ui`
   was retired earlier on this branch, and update
   `ee/server/src/__tests__/unit/entraIntegrationSettings.initialSyncCta.test.tsx`, which drives both flags
   through `applyFlags(...)` and will fail once the reads are gone.
   Leave `entra-integration-cipp` alone — its retirement is the ops soft-launch decision described above.
2. `FieldSyncRules` as a shared component used by wizard step 4 and the console tab, with defaults visibly off
   and an explicit "mark contacts inactive when the Microsoft account is disabled" toggle (today this behaviour
   is unconditional and unnamed in the UI).
3. "Preview effect of these rules" runs a preflight with the pending rules applied.
4. Review queue gains an **Ignore/dismiss** action (currently items can only accumulate) and a resolution
   audit trail.
5. Honour the inactivation toggle in the sync path — it must actually gate `markDisabledEntraUsersInactive`.

**Tests** — toggles persist and are honoured by the engine; inactivation toggle off means no inactivation;
dismissed queue items stay dismissed across runs.

---

### PR6 — Contact surfacing and notifications

Touches shared contact components used well beyond Entra — review blast radius carefully.

**Changes**

1. Entra-linked indicator on contact detail and contact list: source chip, last-synced time, UPN, linked client
   tenant. The data already exists on the contact record and is currently read by nothing.
2. Inactivation reason surfaced: "Inactive — Microsoft account disabled" rather than a bare "Inactive".
3. Inline warning when a technician edits a field that an enabled sync rule will overwrite.
4. Notifications: post-run digest (optional), repeated-failure alert (default on), and review-queue arrival
   notification, so the queue stops being a screen nobody is told to visit.
5. Fix the per-client "Sync Entra Now" control to be permission-gated in the UI to match the server, so
   technicians stop getting a "Forbidden" toast from a visible button.

**Tests** — contact rendering with and without Entra linkage; notification dispatch on repeated failure;
permission gating hides rather than errors.

---

### PR7 — Schedule default off

Kept separate because it is a behaviour change with an ops dependency.

**Changes**

1. New EE migration in `ee/server/migrations/`: `sync_enabled` default → `false`, and set existing rows to
   `false`. Keep `sync_interval_minutes` default at `1440` as the value used once enabled.
2. Update `server/src/test/unit/migrations/entraPhase1Migration.test.ts` — it asserts the old defaults and
   will fail.
3. Post-setup, the console prompts to enable automatic sync once the first pilot has succeeded.
4. Run the enumeration query above and hand ops the affected-tenant list **before** deploy.

**Tests** — new tenants start disabled; a schedule is only created after explicit enable.

## Cross-cutting

**i18n.** Every new string localized under `msp/integrations`. Ten locales exist
(`server/public/locales/{de,en,es,fr,it,nl,pl,pt,xx,yy}`); the repo has an i18n parity check — add keys to all,
and keep `xx`/`yy` pseudo-locales in sync. Sentence case throughout, per `docs/ui/design_guidelines.md`.

**Design language.** Follow `docs/ui/design_guidelines.md` and `docs/ui/theming.md`: tokens only
(`rgb(var(--color-*))`, no raw hex, no `text-gray-*`), the documented type scale, `min-w-0` + `truncate` on
every text-carrying flex row, loading/error/empty states on every panel, and both themes verified. Every
interactive element needs a stable automation id per `docs/ui/ui_automation_ids.md`.

**Docs.** Update `ee/docs/guides/entra-integration-phase-1.md` (its CIPP section is stale) and
`docs/tier-gating-guide.md` (note the scheduler tier check alongside the API guard, so F6 cannot recur).

## Verification

1. Unit and component suites green, including the updated migration and gate tests.
2. Typecheck EE and CE — CE must stay green; `@enterprise` resolves to `packages/ee` stubs there.
3. i18n parity check.
4. Manual smoke on the dev server (port 3216) with `NEXT_PUBLIC_FORCE_FEATURE_FLAGS=entra-integration-cipp:true`
   in `server/.env.local`, walking a Pro tenant through: disclosure → CIPP connect with a deliberately bad
   credential (must not persist) → good credential → discovery → mapping → preflight → pilot one client →
   console → enable schedule → rotate credential → disconnect.
   The `entra-integration-cipp` line stays in `server/.env.local` on this worktree — it is the only reason the
   CIPP option renders locally.
5. Confirm a Solo-tier tenant gets **403 from `assertTierAccess`** on the Entra routes and no UI. Note this is
   now the only rejection path — with `entra-integration-ui` retired there is no 404-when-disabled response
   left to test for, and any test still asserting one should be deleted rather than adapted.
6. Confirm a Pro tenant with no Enterprise add-on now gets a recurring schedule created (F6 regression guard).
7. Grep for stragglers after PR5: `grep -rn "entra-integration-ui\|entra-integration-field-sync\|entra-integration-ambiguous-queue" --include="*.ts" --include="*.tsx" . | grep -v node_modules`
   should return nothing outside the historical `ee/docs/plans/2026-02-20-entra-integration-phase-1/` artifacts.

## Risks

- **PR3 is the one that can hurt.** An incorrectly plumbed `dryRun` writes to customer contact data while
  claiming to be a preview. F8 is the specific landmine. Treat the "dry run writes nothing" test as a release gate.
- **PR6 touches shared contact components.** Scope creep risk into unrelated contact surfaces; keep changes additive.
- **PR7 changes behaviour for live tenants.** Gated on the ops notification list.
- Decomposing a 952-line component risks losing incidental behaviour. Inventory current behaviours before
  deleting the file; the run-list polling and discovery error handling are easy to drop by accident.
- A CIPP emulator (`test-harness/cipp-emulator/`, proposed in the 2026-07-22 plan) remains the right substrate
  for automated CIPP coverage and is still not built. PR2/PR3 CIPP paths will rely on unit-level doubles until
  it exists.

## Out of scope

Per-tenant metering and the dormant add-on machinery (`ADD_ONS.ENTERPRISE`, `assertAddOnAccess`, Stripe price
config) stay untouched — they are the substrate for the future metered product. Do not "clean them up".
Teams add-on changes, CE edition changes, and CIPP API modernization are also out of scope.

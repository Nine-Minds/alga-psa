# Opportunities UI Improvements — Implementation Plan

**Date:** 2026-07-28
**Branch:** `improve/opportunities-ui`
**Source:** Design session over a hand-written review of the opportunities module (28 items), triaged against a full code map of `packages/opportunities/`, host wiring in `server/src/`, and the billing quote flow.

## Prerequisite (not a work item)

"Cannot create clients" on this branch is a shared-DB migration collision: another branch dropped credit-related tables that this branch's code still references. **Rebase onto main once that branch lands** before validating client-creation flows. Nothing in this plan fixes or works around it.

## Out of scope (explicitly deferred)

- Per-client / per-industry action playbook sets, and tenant-configurable suggestion sets (v1 ships built-in stage-based suggestions only).
- Any redesign of the Board or Pipeline tabs beyond stage-declare and client-link touches described below.

---

## Workstream A — Queue tab polish

### A1. Time-aware greeting
`packages/opportunities/src/components/queue/QueueGreeting.tsx:49` always renders "Morning, {{name}}." Compute the day part client-side from the user's local time and select between three keys: `greetingMorning` / `greetingAfternoon` / `greetingEvening` (separate keys, not a variable inside one key — same reasoning as the SlaChip split in commit `36a4135555`).

### A2. Queue cards sized like Suggestions cards
The Queue rows (`queue/QueueActionRow.tsx`, capped by `max-w-2xl` in `WorkQueue.tsx:53`) look squished next to the Suggestions tab's `MoneyFoundCard` grid. Restyle the queue as a card grid with the same sizing/spacing rhythm as the Suggestions grid (`OpportunitiesHub.tsx:245-296`), preserving the queue's semantics: exactly one `is_screen_primary` row keeps visual primacy; overdue/quiet badges, why-sentence, and action buttons remain.

### A3. Cards / table view toggle on the Queue
Add a view switcher (cards ⇄ table) to the Queue tab. Table view uses the standard `DataTable` pattern already proven in `pipeline/PipelineList.tsx:30-134` (`ColumnDefinition[]`, `manualPagination` off — queue is already fully loaded). Columns: next action, deal title, client, value (`opportunityValueParts`), due/overdue, and a compact actions cell (complete / open / snooze). Persist the choice in `localStorage` keyed per user; default to cards.

### A4. Circle becomes a real complete control
The `aria-hidden` decorative ring at `QueueActionRow.tsx:46-51` reads as a dead radio button. Make it an interactive control: hover shows a checkmark, click triggers the same complete flow as "Done → set next" (`onComplete`), with a proper `aria-label` and `id` per coding standards. Keep the overdue color accent.

### A5. Pluralization grammar
Locate the "x thing(s) need input"-style string (queue/lesson strip area) and replace with proper i18n plural keys (`count`-based, CLDR categories per locale). Sweep the module for other `(s)` constructions while extracting strings (Workstream H).

---

## Workstream B — Navigation fixes

### B1. Hub reads URL params; tabs are deep-linkable
`OpportunitiesHub.tsx:64` initialises the tab from a constant and ignores `?tab=`/`?stage=`, so server-composed CTAs (`workQueueActions.ts:221,227` → `/msp/opportunities?tab=pipeline&stage=assessment`) silently land on Queue. Sync tab state with `useSearchParams` (read on mount + write on change via `router.replace`), and pass `stage` through to the Pipeline list as an initial filter. This also makes browser back/forward behave between tabs.

### B2. Back to list from the detail page
`server/src/app/msp/opportunities/[opportunityId]/page.tsx` / `OpportunityDetailHost.tsx` have no in-app path back to the hub. Add a back control ("Back to opportunities") at the top of the detail view navigating to `/msp/opportunities` (preserving the last tab via B1's URL state where available).

### B3. Clickable client names
Client names are inert text on every surface. Link them to `/msp/clients/{client_id}` in:
- `detail/OpportunityDetailView.tsx:101`
- `pipeline/PipelineList.tsx:38`
- `board/BoardCard.tsx:47`
- `OpportunityMeetingMode.tsx:123`
- `packages/user-activities/src/components/OpportunityActivityPanel.tsx:107` (the drawer — this is the "open client by clicking name in drawer" item)
Use a plain link styled per the app's link idiom (no drawer-in-drawer behavior).

### B4. Quote back-button label matches destination
`QuoteForm.tsx:1208-1218` hardcodes "Back to Quotes" while `QuotesTab.tsx:510-514` actually navigates to the opportunity when `opportunityId` is present. Thread the context into the label: "Back to opportunity" when returning to an opportunity, existing labels otherwise (all via `msp/quotes` i18n keys).

### B5. Stale title fixes
- `OpportunityDetailHost.tsx:87` — `winProjectName` is `useState(detail.title)` with no resync; add the resync `useEffect` keyed on `detail.opportunity_id` (pattern already correct in `EditOpportunityDialog.tsx:49-56`).
- `[opportunityId]/page.tsx:10-12` — static `<title>` "Opportunity"; generate metadata from the loaded opportunity title.

---

## Workstream C — Create/edit flow

### C1. Quick-add client inside the picker; remove "Add prospect"
`CreateOpportunityDialog.tsx:110-119` is the only `ClientPicker` consumer in the app that does not pass `onAddNew`, which is exactly the condition that hides the picker's built-in "Add new client" row (`packages/ui/src/components/ClientPicker.tsx:529-544`). Fix:
- Pass `onAddNew` opening `QuickAddClient` with `initialLifecycleStatus="prospect"` (defaulted, user can change it in the dialog) and `skipSuccessDialog`; on success, prepend + auto-select the new client (behavior currently in `OpportunitiesHubHost.tsx:36-40`).
- Delete the standalone `ProspectCreator` ghost button (`OpportunitiesHubHost.tsx:46-63`) and the `renderProspectCreator` slot in the dialog.
- `ClientOpportunitiesTab.tsx:67-72` uses `lockedClient`; no change needed there.

### C2. Required-field indicators
`CreateOpportunityDialog` gives no visual cue which fields are required. Mark required fields using the app's standard required-field treatment (asterisk + validation styling as used by other quick-add dialogs), in both create and edit dialogs.

### C3. Owner reassignment
`owner_id` is set once at creation (`actions/opportunityActions.ts:63`) and rendered read-only everywhere; the queue is owner-scoped (`workQueueActions.ts:134`), so deals are stuck in one person's queue. Add an owner picker (standard `UserPicker`) to the detail view (and `EditOpportunityDialog`); the update schema already accepts `owner_id` (`schemas/opportunitySchemas.ts:147`). Record a timeline entry ("Reassigned from X to Y") through the same mechanism as other timeline events.

---

## Workstream D — Hybrid stage movement

Stages stay evidence-derived (`lib/stageEngine.ts`), but every stage becomes reachable by hand. Design decision from the session: **manual + auto hybrid**.

### D1. Manual stage declare
Add a "Set stage" affordance on the detail view (make the evidence-ladder steps clickable): declaring a stage records an evidence row for that checkpoint with `source: 'user_declared'` via `recordEvidence`, letting `deriveOpportunityStage` do its normal job. `qualified` already has this shape (`declareQualified`, `opportunityActions.ts:113`) — generalize it to `assessment` / `proposed` / `verbal`. `won` / `lost` keep their existing dialogs (win dialog, loss-reason dialog). Moving **backward** uses the engine's existing correction concept: declaring a lower stage marks the higher un-corrected checkpoints corrected (with the actor recorded), so the derived stage drops. Emits `OPPORTUNITY_STAGE_CHANGED` as today.

### D2. Verify quote-sent ⇒ proposed actually fires
`onQuoteSent` (`lib/quoteLifecycleHooks.ts:109`) records `proposed`, and `updateQuote` calls it when status transitions to `sent` (`quoteActions.ts:594-603`). The reported experience says otherwise — verify the real send paths (email send at `quoteActions.ts:1430` sets `sent`; check whether the MSP UI offers a "mark as sent" transition at all, and whether quotes linger in `draft` in practice). Fix whatever gap prevents the hook from firing; if the only gap is UI, ensure the quote detail exposes the send/mark-sent transition.

### D3. Won auto-promotes prospect clients
When `winOpportunity` (`opportunityActions.ts:177-179`) completes and the client's `lifecycle_status` is `prospect`, flip it to `active` inside the same transaction path, firing the existing `CLIENT_STATUS_CHANGED` workflow event (reuse the logic in `packages/clients/src/actions/clientLifecycleActions.ts` — extract a transaction-scoped helper rather than calling the server action from a server action).

### D4. Evidence display stays
The "EVIDENCE" ladder (`OpportunityDetailView.tsx:129-146`) remains as the supporting display; D1 makes its steps interactive rather than replacing it.

---

## Workstream E — Quotes

### E1. Currency cascade
`QuoteForm.tsx` defaults to `'USD'` (:79) and only overrides from tenant settings if the value is still exactly `'USD'` (:136-138). Replace with the client → tenant → USD cascade already implemented in `packages/opportunities/src/actions/opportunityDefaults.ts:10-17` (`getClientDefaultCurrency`). Extract that cascade into a shared billing-level helper so both consumers use one implementation (this is a `LEVERAGE`-worthy fold, do it as part of the change). When the quote is launched from an opportunity (`OpportunityDetailHost.tsx:163-173`), pass the opportunity's currency explicitly so quote and opportunity always agree.

### E2. MSP accepts a quote on the client's behalf
New action on the MSP quote detail (`QuoteDetail.tsx`), available when status is `sent`: "Accept on client's behalf" opens a dialog with a **required comment**. On confirm, drive the existing `accepted` transition in `updateQuote` (which fires `onQuoteAccepted` → `verbal` evidence) and persist who accepted + the comment (new nullable columns on `quotes`: `accepted_on_behalf_by`, `accepted_on_behalf_comment` — migration required; Citus-safe per `citus-migration-gotchas`). Surface the on-behalf acceptance in the quote detail and the opportunity timeline.

---

## Workstream F — Timeline

### F1. Timeline starts at creation and renders correctly
`detail/OpportunityTimelinePanel.tsx` is read-only and reported "busted." Two fixes:
- Synthesize an "Opportunity created" entry at read time in `listOpportunityTimeline` from the opportunity's `created_at` (no backfill migration; oldest entry, rendered first).
- Investigate and fix the rendering/data defect observed in the session (reproduce on the dev stack; likely candidates: ordering, empty states, or the remount-refetch cycle keyed at `OpportunityDetailHost.tsx:143-148`). Acceptance: a fresh opportunity shows a coherent ascending timeline beginning with creation; stage changes, reassignments (C3), and on-behalf acceptance (E2) all appear.

---

## Workstream G — Stage-based suggested next actions

v1 of "guidance instead of pure free-form" (session decision: built-in defaults, no tenant config, no client/industry sets).

- Define a built-in map `stage → suggested actions` in `packages/opportunities/src/lib/` with i18n keys (e.g. identified: "Schedule discovery call"; qualified: "Book assessment"; assessment: "Prepare quote"; proposed: "Follow up on quote"; verbal: "Confirm start date / send contract"). Keep it small (2–4 per stage).
- Surface the suggestions as clickable chips above the free-text `next_action` input in `CompleteActionDialog.tsx` and `CreateOpportunityDialog.tsx` — clicking fills the input (user can edit); free-form entry remains unchanged. No schema change: suggestions are sugar over the existing single `next_action` field.

---

## Workstream H — Full i18n extraction

Follow the `clientCommandCenter` extraction pattern (commit `36a4135555`) exactly:

- Register `/msp/opportunities` in `ROUTE_NAMESPACES` (`packages/core/src/lib/i18n/config.ts:152-198`) → `msp/opportunities` namespace.
- Create `server/public/locales/{en,de,es,fr,it,nl,pl,pt}/msp/opportunities.json` + regenerate `xx`/`yy` pseudo-locales. `en` is source of truth; `defaultValue` stays as safety net. Plural forms per CLDR categories.
- Components switch to `useTranslation('msp/opportunities')`.
- Fix the outright-hardcoded strings: EE tab labels (`server/src/app/msp/opportunities/page.tsx:69-70`), the whole `OpportunitySnapshotCard`, `` `Quote for ${detail.title}` `` (`OpportunityDetailHost.tsx:169`). ("Add prospect" dies in C1.)
- **Consolidate stage labels**: four copies exist (`stageEngine.ts`, `EvidenceLadder.tsx:9-16`, `OpportunityBoard.tsx:8-17`, `OpportunitySnapshotCard.tsx:11-19`). Fold into one shared stage-label helper with i18n keys. (`// LEVERAGE: pattern` case — fix it here since H touches all four sites anyway.)
- **Server-composed English sent as data** (`workQueueActions.ts:220-228` action labels, `lib/whyComposer.ts` sentences, `lib/generators/*` suggestion titles): change these to return structured `{key, params}` payloads composed client-side through the namespace (rendering sites: `WhySentenceText.tsx`, `MoneyFoundCard.tsx:41-43`). This is the largest sub-item; type the payloads in `@alga-psa/types`.
- `OpportunityActivityPanel.tsx` keeps its `msp/user-activities` namespace but drops `humanize()` for enum values in favor of shared stage-label keys.

---

## Ordering

1. **B + C + A4/A5 + F** — small, independent bug fixes; land first (each individually testable).
2. **D** (stage engine additions) then **G** (suggestions keyed off stages) then **E** (quote-side changes touching the same hooks).
3. **A1–A3** (queue restyle + toggle) — visual layer, isolated.
4. **H** (i18n extraction) — last, since it touches every file the other workstreams edit; doing it earlier multiplies rebase pain inside the branch.

## Testing

Per repo standards (`docs/AI_coding_standards.md`), mirroring existing patterns in the module:

- **Unit**: stage-engine manual declare + backward correction (`stageEngine`), currency cascade helper, won→active promotion, timeline synthesis of the created entry, suggested-actions map integrity.
- **Wiring/contract**: `CreateOpportunityDialog` passes `onAddNew` (mirror the existing ClientPicker contract tests in projects/billing/assets); hub tab/URL sync; owner reassign sends `owner_id`; MSP on-behalf accept requires a comment and drives the `accepted` transition.
- **Component**: queue card/table toggle renders both views; complete-control accessibility (`aria-label`, keyboard).
- **Manual smoke** (dev stack on port 3770): create-opportunity flow with in-picker quick-add (post-rebase, per prerequisite), quote round-trip currency + back label, stage declare forward/backward, timeline from creation, deep links from queue CTAs.

## Acceptance summary (maps back to the notepad)

| # | Item | Resolution |
|---|---|---|
| 1 | "Morning" hardcoded | A1 |
| 2/6 | Currency defaults | E1 |
| 3/23 | Prospect creation via picker | C1 |
| 4 | Required fields unclear | C2 |
| 5 | Client name click in drawer | B3 |
| 7 | Quote back button | B4 |
| 8/9 | Timeline start + busted | F1 |
| 10 | Cannot reassign | C3 |
| 11/12 | Squished cards / list view | A2, A3 |
| 13 | Translations | H |
| 14 | "(s)" grammar | A5 |
| 15 | Radio-looking circle | A4 |
| 16/18 | States unreachable / evidence | D1, D4 |
| 17 | Cannot go back to list | B1, B2 |
| 19 | Accept on client's behalf | E2 |
| 20 | Quote sent ≠ proposal | D2 |
| 21 | Cannot create clients | Prerequisite (rebase) |
| 22 | Client Lifecycle field | D3 (won ⇒ active) |
| 24 | Stale title | B5 |
| 25–27 | Guidance by pipeline stage | G |
| 28 | Playbooks by client/industry | Deferred |

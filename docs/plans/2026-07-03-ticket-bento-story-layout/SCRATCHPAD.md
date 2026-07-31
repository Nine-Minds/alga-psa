# Scratchpad — Ticket Bento "Story" Layout (Option B)

- Plan slug: `2026-07-03-ticket-bento-story-layout`
- Created: 2026-07-03

## What This Is

Working memory for the bento-grid redesign of the MSP ticket detail screen, based on the
"Option B / Ticket Story" mockup (see `mockups/option-b-ticket-story.html` and the PNG
captures alongside it). Three candidate layouts were explored against the live dev app and
dev database on 2026-07-03; Option B (unified timeline spine + state tiles) was selected
for implementation planning.

## Decisions

- (2026-07-03) **Grid | Entry toggle** (product owner): both layouts coexist; a
  segmented control in the ticket header switches them, persisted per user
  (`user_preferences`: `ticket_detail_layout`, plus `ticket_timeline_order` for the
  timeline sort). Default Entry. The `ticket-bento-layout` PostHog flag only gates the
  toggle's visibility. All other PRD open questions resolved with the recommendations.
- (2026-07-03) Implementation split: backend data layer offloaded to codex
  (timeline interleave + `ticketBentoActions.ts` + `ticketLayoutPreference.ts` +
  contract/unit tests, all reviewed); UI built by hand.
- (2026-07-03) `TicketDetails.tsx` stays the state hub: the grid branch renders
  `bento/TicketBentoLayout` from the same state/handlers; the entry branch is
  byte-identical to before. The full `TicketInfo` form is reused inside an
  "All fields" drawer in grid mode, so every form capability (tags, ITIL, category,
  description edit, batch save, live-collab props) survives without re-implementation.
- (2026-07-03) Hero selects use the immediate-save path (`handleSelectChange`), same
  semantics as the current sidebar selects — not the TicketInfo batch pipeline. Batch
  editing remains available via the All fields drawer. (F103 intentionally deviates;
  revisit if operators find mixed semantics confusing.)
- (2026-07-03) Sections that ship their own ContentCard chrome (checklist, documents,
  materials, watch list, survey card, assets node) render bare in the rails instead of
  being double-wrapped in BentoTile.
- (2026-07-03) In-drawer ticket views keep the Entry layout (no toggle) in v1.
- (2026-07-03) Grid v1 gaps, deliberately deferred (features left false): bundle-master
  management panel (switch to Entry to manage bundles), comment reactions/edit/delete on
  timeline nodes, composer attachments, per-day effort chart + hours headline,
  "Waiting on us/client" response-state copy (reuses existing ResponseStateBadge),
  priority color dots / assignee avatars in hero selects, agent schedule drawer from the
  team tile, billing-permission gating of the Billing tile, mid-breakpoint (~1024–1279px)
  re-flow, contact phone/location lines.
- (2026-07-03) Local dev flag override: `NEXT_PUBLIC_FORCE_FEATURE_FLAGS=ticket-bento-layout:true`
  appended to `server/.env.local` (dev-only file) to show the toggle without PostHog.

- (2026-07-03) Plan targets the MSP ticket detail screen only. The client-portal ticket
  view is out of scope and must not change.
- (2026-07-03) Copy follows the house voice (operator-to-operator, sentence case, plain
  MSP language). SaaS-flavored tile names from the mockup are renamed for implementation;
  see the copy table in `PRD.md`. Notable renames: "Ticket Story" → "Timeline",
  "Path to Done" → "Checklist", "Effort" → "Time logged", "Billing Impact" → "Billing",
  "Touchpoints" → "Calls and emails", "Reporter" → "Contact", "The Ask" → "Request".
- (2026-07-03) Timeline day-break labels are plain dates ("Jun 9", "Today"), not editorial
  captions. The mockup's "the search" caption was demo flavor, not product copy.

## Discoveries / Constraints

### Code map (verified in repo 2026-07-03; paths repo-relative)

- Route: `server/src/app/msp/tickets/[id]/page.tsx` (server component) →
  `packages/msp-composition/src/tickets/MspTicketDetailsContainerClient.tsx` (injects
  cross-slice render props: contact/client views, interval management, survey card) →
  `packages/tickets/src/components/ticket/TicketDetailsContainer.tsx` (save handlers) →
  **`packages/tickets/src/components/ticket/TicketDetails.tsx` — 3,281-line monolith that
  owns all screen state.** The bento work centers on this file.
- Data: one consolidated fetch, `getConsolidatedTicketData` in
  `packages/tickets/src/actions/optimizedTicketActions.ts` (~9 parallel queries in one
  transaction, returns ticket incl. all `sla_*` columns). Some cards self-fetch
  (materials, checklist, assets, survey, time entries).
- **The unified timeline already exists end-to-end** (this branch's groundwork):
  `shared/lib/ticketActivity/` (`buildUnifiedTicketTimeline` interleaves audit rows +
  comments; `curatedTicketDiff.ts` summarizes changes) →
  `packages/tickets/src/actions/ticketActivityActions.ts` (`getTicketTimelineEntries`,
  withAuth, ticket:read, hard-blocks client users) →
  `packages/tickets/src/components/ticket/TicketActivityTimeline.tsx` (697 lines,
  currently rendered only in a slide-out drawer). Plan = promote inline + interleave
  time entries and RMM alerts, not rebuild.
- SLA UI exists: `slaStatus` memo inside `TicketInfo.tsx` (L1045–1112) +
  `packages/sla/src/components/SlaStatusBadge.tsx`; services in `packages/sla/src/`.
  Countdown logic should be extracted/shared, not duplicated (hero slab + SLA tile).
- Timer: `useTicketTimeTracking` (packages/ui hooks) + interval widgets in
  `packages/scheduling/src/components/time-management/interval-tracking/`; play/pause
  handlers live in TicketDetails and are passed down — keep that ownership.
- Feature flags: `useFeatureFlag` hook (`packages/ui/src/hooks/useFeatureFlag.tsx`),
  server helpers in `server/src/lib/feature-flags/`; honors
  `NEXT_PUBLIC_FORCE_FEATURE_FLAGS` for local testing.
- Grid infra: none reusable for drag/resize (dnd-kit is a dep but only used by the
  invoice designer's free canvas). `packages/assets/src/components/AssetDashboardGrid.tsx`
  is the house pattern for a static Tailwind bento — follow it.
- AlgaDesk mode passes `hideSlaStatus/hideTimeEntry/hideMaterials` through
  `MspTicketDetailsContainerClient` — the bento must honor all three.
- Client portal is a fully separate tree (`packages/client-portal/**`) — safe.

### Re-layout risk register (from code map)

1. `TicketDetails.tsx` owns all state; either keep it as the state hub and swap its
   JSX for grid cells, or extract state first. Features assume "state hub stays,
   layout swaps" (F107) — revisit if extraction proves cleaner.
2. Dirty-field batch save spans `TicketInfo` + `TicketProperties` via two arrays merged
   in `handleBatchSaveChanges` (TicketDetails L2182). Splitting fields across hero +
   drawer must preserve this merge (F103).
3. Live-collab props (`liveFieldConflicts`, `liveEditingUsers`,
   `liveHighlightedFields`) must keep flowing to every editable field (F105).
4. `router.refresh()` after each save re-runs the consolidated fetch — acceptable per
   PRD; do not redesign in v1.
5. Injected render-prop pattern (contact/client/interval/survey/assets) keeps
   `@alga-psa/tickets` decoupled from other slices — bento tiles must consume the same
   injected nodes, not import across slices.

### Data model (verified against dev DB `licval_postgres` / db `server`)

All tiles can be fed from existing tables; no new tables required for v1:

- `tickets` already carries the SLA machinery: `sla_policy_id`, `sla_started_at`,
  `sla_response_due_at/_at/_met`, `sla_resolution_due_at/_at/_met`, `sla_paused_at`,
  `sla_total_pause_minutes`, plus `response_state` (enum incl. `awaiting_internal`),
  `escalated/escalation_level`, `source`, `ticket_origin`, `master_ticket_id`.
- `ticket_audit_logs` (tenant, ticket_id, event_type, entity_type, actor_type,
  actor_user_id, actor_contact_id, actor_display_name, source, occurred_at, changes,
  details) — ready-made feed for the unified timeline's "system" lane.
- `comments` — `is_internal`, `is_resolution`, `is_system_generated`, `author_type`,
  `contact_id`, thread fields. Maps to timeline client/internal lanes.
- `time_entries` — link via `work_item_id` + `work_item_type`; has `billable_duration`,
  `notes`, `work_date`. Feeds timeline time lane + "Time logged" tile.
- `schedule_entries` — link via `work_item_id` + `work_item_type`. Feeds "Next visit".
- `interactions` — has `ticket_id` directly (also `contact_name_id`, `client_id`,
  `duration`, `type_id`). Feeds "Calls and emails".
- `rmm_alerts` — has `ticket_id`, `severity`, `message`, `device_name`,
  `occurrence_count`, `asset_id`. Feeds timeline alert lane.
- `ticket_checklist_items` — item_name, completed, assigned_to, is_required, order.
- `sla_policies` + `sla_policy_targets` (per-priority response/resolution minutes,
  escalation thresholds, `is_24x7`).
- KB: `kb_articles` carries `view_count`, `helpful_count`; article body lives in the
  documents system (`document_id` FK).
- Billing money math (unbilled $ amount) needs rate resolution through contract lines —
  treat as stretch; hours + contract name are cheap and safe.

### Dev-data quirks (worth knowing when eyeballing screens)

- Demo seed dates are incoherent (time entries predate ticket creation); don't chase
  "bugs" that are just seed data.
- Demo ticket TIC1001 ("Missing White Rabbit", client Cool Cars, contact Alice in
  Wonderland) is the richest fixture: 3 comments (client/internal mix), 4 time entries
  (11h), checklist 1/3, 2 linked assets. Good manual-QA target.
- The dev SLA policy is named "Demo SLA (temp)" and demo tickets have NULL `sla_*`
  timestamps — SLA tile empty states will show by default in dev.

### House standards that shape the implementation

- UI: Radix + shared components from `packages/ui/src/components` (Button, Card,
  CustomTabs, CustomSelect, Switch, ...). Every interactive element needs a unique `id`
  (reflection UI system).
- Theming: CSS variable tokens only (`rgb(var(--color-card))` etc.), `dark:` variants
  required; no raw `bg-white`/hex. Test both themes.
- Fail fast; no silent fallbacks.
- Billing naming: use `contracts` / `contract lines` terminology (not plan/bundle).

### Worktree state note (2026-07-03)

- The worktree had a merge from `origin/main` in progress with **3 unresolved conflict
  hunks in `package-lock.json`** (version strings + one added `@alga-psa/formatting`
  dep). The running dev server tolerated it via nx's cached project graph, but any nx
  restart failed with "Expected double-quoted property name in JSON". Resolved the three
  hunks taking the `origin/main` side (lockfile is generated; both sides were stale vs
  the working tree's actual 1.2.14 package versions). Consider `npm install
  --package-lock-only` before committing the merge to true the lockfile up.

### Live verification (2026-07-03, dev app, ticket TIC1001)

Verified end-to-end in the running dev stack (host server on :3700, flag forced via
`NEXT_PUBLIC_FORCE_FEATURE_FLAGS`):

- Toggle renders in the header; Grid ⇄ Entry switches without reload; choice survives a
  full page reload (user_preferences round-trip). Entry renders the unchanged legacy
  screen; Grid unmounts cleanly on switch-back.
- Timeline interleaves real data: 4 time entries with durations + notes, client reply
  bubble, internal note (amber + INTERNAL badge), system events, day-break separators
  (Jun 1/2/3/5/9), lane filter counts live-update.
- Composer: posted an internal note from the timeline composer → appeared in the stream,
  persisted to `comments` with `is_internal=true`, and its audit event showed in the
  System lane after refresh.
- Billing tile: real rollup ("11h · 11h billable", "11h not invoiced yet",
  "System-managed default contract").
- Next visit (Looking Glass Expedition) and Calls and emails (3 interactions) tiles
  render live rows. SLA clocks show honest demo-data state (response overdue 13d,
  resolution "No target").
- Dark theme verified across all tiles; fixed one dark-mode contrast bug on the active
  timeline filter pill (now primary purple + white in both themes).
- Only console noise is the pre-existing hocuspocus websocket port mismatch
  (env points at 1234; this compose project exposes 1274) — unrelated to this work.

### Slice 2 (2026-07-03): timeline comment affordances + effort chart

- Timeline reply nodes now render the existing `CommentItem` (instead of the custom
  bubble), which carries reactions, inline edit with internal/resolution toggles,
  delete, response-source badges, and metadata debug — all fed by the same handlers
  TicketDetails already passes to the conversation view. Reactions use the same
  `getCommentsReactionsBatch`/`toggleCommentReaction` pattern as TicketConversation.
- Gotcha: `currentUser` prop is only set for drawer usage; standalone pages rely on
  `session.user`. The timeline wiring mirrors TicketConversation's fallback, otherwise
  `canEdit` is false everywhere.
- Gotcha: `CommentItem` ignores the `id` prop when the comment has an id — DOM ids are
  the raw comment UUIDs (`edit-comment-<uuid>-button` etc.), same as conversation view.
- New `bento/TimeLoggedSummary.tsx`: headline ("11 hrs across 4 entries") + per-day
  bars, fed by the same `fetchTimeEntriesForTicket` scheduling callback the entries
  list uses, so the numbers can't disagree.
- Verified live: reaction added via emoji picker (persisted to `comment_reactions`),
  own-comment inline edit saved and re-rendered, effort chart bars proportional to
  the 2h/2h/4h/3h entry days. Emoji picker is an `em-emoji-picker` web component
  (shadow DOM) — automation must query `picker.shadowRoot`.

### Slice 3 (2026-07-03): feature completion sweep

- Hero completed: priority color dots (options carry `color`; filter out the synthetic
  'all' entry), assignee initials avatars, DatePicker for due date (preserves the
  existing time-of-day), "Reply status" select with house copy (Waiting on us /
  Waiting on client / No reply needed → response_state enum incl. null), TagManager
  row, injected Create/Link task actions, and basic live-collab treatment (frozen
  fields disable, remote edits ring) via liveHighlightedFields/liveFrozenFields.
- All fields drawer gained Contact + Location pickers (these lived only in the
  TicketProperties sidebar card, which Grid doesn't mount) wired to the existing
  handleContactChange/handleLocationChange.
- Composer attachments: compose-scoped useTicketRichTextUploadSession with
  trackDraftUploads, uploadFile passed to TextEditor, resetDraftTracking on send.
- Left rail polish: Request tile edit pencil (opens All fields) + Show more/less
  clamp; Contact tile phone + resolved ticket-location line; Next visit empty state
  links to /msp/technician-dispatch; Calls and emails "View all" links to the
  contact activity page.
- Right rail: SLA policy-name chip (new tiny `getTicketSlaPolicyName` action in
  ticketBentoActions.ts, same guard pattern); Billing tile gated by the existing
  `billing-enabled` flag (hidden in dev unless forced — the local force env now sets
  `ticket-bento-layout:true,billing-enabled:true`); "Covered by contract" line;
  clicking a team agent opens the AgentScheduleDrawer (global drawer, mounts
  regardless of layout); checklist progress bar added inside TicketChecklistSection
  (benefits both layouts, aria progressbar).
- Responsive tiers done: <1024 single column ordered timeline → state tiles → who/what
  tiles; 1024–1279 left 4 / timeline 8 with the right rail flowing below as a 3-up
  grid; ≥1280 the full 3/6/3 bento.
- Deferred with rationale (features.json `deferred: true`): F020/F103/F104 (hero
  immediate-save design supersedes batch-save semantics) and F100 (KB tile, stretch).

### Slice 4 (2026-07-03): test coverage + final feature closeout

- All 118 features now accounted for: 114 implemented, 4 deferred with rationale
  (F020/F103/F104 superseded by the immediate-save hero design; F100 KB tile is a
  resolved-defer stretch item).
- F062/F113/F114 verified live: timeline controls are native buttons (keyboard-
  operable); copy audit found 0 banned SaaS terms and all 10 house-voice strings
  present; minimal ticket (TIC1006, no contact/entries) renders every designed empty
  state ("No contact on this ticket", "Nothing scheduled / Schedule a visit", "No calls
  or emails logged", "No time logged yet", time summary hidden).
- Unit tests written and passing (24 tests, jsdom tickets vitest config):
  - `bento/slaClocks.test.ts` (10) — computeSlaClocks state machine across
    none/met/missed/running/overdue/paused + Date-vs-ISO inputs + formatDurationShort.
    → tests.json T010.
  - `bento/timelineHelpers.test.ts` (14) — lane classification, chronological sort with
    sortId tie-breaks (mirrors the shared builder), lane counts/filter, dayLabel
    (Today/same-year/other-year/unparseable), withDayBreaks grouping. → T011, T012.
  - Refactor for testability: extracted the timeline's inline lane/sort/day logic into
    `bento/timelineHelpers.ts`; BentoTimelineTile now imports it (behavior identical,
    typecheck clean, full bento suite 30/30 green including codex's 6 contract tests).
- DB-backed integration tests (T001–T009) offloaded to codex against the `TestContext`
  real-transaction harness (server/src/test/infrastructure/tickets/). Review its diff +
  run result before marking those implemented.
- E2E flows (T018–T030): all driven and confirmed live in the dev app during slices 1–3
  (layout toggle + persistence, timeline data + day breaks, hero edit + save, composer
  client/internal replies, checklist toggle/add, timer + add-entry, capability sweep,
  reactions, inline edit, dark theme, no horizontal scroll). Marked `manualQaVerified`
  in tests.json; automated Playwright versions remain a future slice.

### Test status summary (end of slice 4)

- **tests.json: 13/30 written/automated, +11 more verified via manual QA** in the live
  dev app (24 uncovered-by-automation → 6, all low-value component render tests).
  - Unit (passing, jsdom): T010 SLA clock state machine (10 cases), T011/T012 timeline
    lane classification + sort tie-breaks + day-break grouping (14 cases).
  - DB integration (written + CI-ready): T001–T009 in
    `server/src/test/infrastructure/tickets/ticketBentoDataLayer.test.ts` (TestContext,
    real query paths, `describeWithDb` guard). Skips cleanly without a provisioned test
    DB — same behavior as every existing `requireDb`-guarded integration test in the repo
    (verified against reactivationLedger.integration.test.ts: identical "N skipped, file
    failed on pg auth" in this env). Runs for real in CI.
  - T028 client-portal-unaffected: verified statically (client portal imports zero bento
    modules, uses its own TicketDetails).
  - E2E (T018–T027, T029, T030): all driven live during slices 1–3, marked
    `manualQaVerified`. Automated Playwright versions are a future slice.
  - Still uncovered: T013–T017 (component render tests) + T023 (all-fields drawer batch
    E2E). Low ROI — their logic is already unit-tested (T010–T012) or manually verified
    (empty states, copy audit), and the working tree is mid-refactor (see below), which
    makes broad jsdom component testing noisy. Left as a follow-up.

### PRE-EXISTING test failures in the working tree (NOT from this work)

The branch's working tree is mid-refactor (barrel→relative import migration +
tenant-scoping migration + an in-progress origin/main merge). Running the full
`packages/tickets` vitest suite shows **22 failures across 7 files**, ALL proven
independent of the bento work:
- None of the 7 files reference any bento module (grep-verified).
- Every source they exercise is a pre-existing working-tree M/A change, none edited this
  session (git-status-verified).
- Spot-proof: `QuickAddCategory.test.tsx` passes 8/8 when its source+test are restored to
  HEAD, fails in the working tree — i.e. the working-tree refactor broke it, not us.
- The 7 files: clipboardImageDraftActions.contract, optimizedTicketActions.contactAuthor.contract,
  ticketActions.authorizationNarrowing, ticketPeripheralTenantScoped.contract,
  QuickAddCategory, BoardsSettings.copyStatuses, ticketOriginCreatePath.
- Root cause where checked: the same barrel→relative import migration that broke the two
  tests this work DID touch — those two were fixed by completing the refactor's test-side
  update (mock the relative `board-actions/boardActions` path; sync the TicketInfo
  rich-text contract's expected `string | object | undefined`). The other 7 are left
  untouched: not this feature's code, and "fixing" them could conflict with wherever the
  refactor author is taking them.

All bento-owned tests pass: `bento/` (24) + new-action contract (6) + the 2 component
tests that render this work (liveTimerPolicy, TicketInfo.richText.contract) = **38/38**.
Full-package `npm run typecheck` is clean.

### Commands: run the bento unit tests

    cd packages/tickets && npx vitest run --config vitest.config.ts src/components/ticket/bento/

### Commands: run the DB integration suite (needs a provisioned+migrated test DB)

    npx vitest run --root server --config server/vitest.config.ts \
      src/test/infrastructure/tickets/ticketBentoDataLayer.test.ts --coverage.enabled=false

### Slice 5 (2026-07-03): consistent styling for ContentCard-based panels

- Problem: the Assets and Checklist panels (and Materials, Watch List, Customer
  Feedback, Documents) render their own `ContentCard`, whose `.card` (24px radius +
  shadow, `p-6`) and 24px `.panel-header` made them visibly larger/bolder than the
  `p-4`/13px-header `BentoTile`s around them.
- Fix (context-driven, no prop threading — important because the Assets node is
  *injected* from the page and can't take a prop from the layout):
  - `packages/ui/src/components/ContentCard.tsx`: added a `ContentCardVariant`
    ('default' | 'bento') context + `ContentCardVariantProvider` +
    `useContentCardVariant()` hook, and a `variant` prop. In 'bento' it renders the
    BentoTile shell (`rounded-lg border border-[rgb(var(--color-border-200))]
    bg-[rgb(var(--color-card))] p-4`) and a `text-sm font-semibold` header with a
    primary-colored icon; default path is byte-identical to before (existing consumers
    unaffected).
  - `TicketBentoLayout` wraps its whole subtree in `<ContentCardVariantProvider
    variant="bento">`, so every ContentCard inside (incl. the injected AssociatedAssets)
    auto-adopts the tile look.
  - `TicketDocumentsSection` hand-rolls its own card (not ContentCard); made it consume
    `useContentCardVariant()` and switch shell/header to match.
- Verified live: Assets, Checklist, Materials, Watch List, Customer Feedback, Documents
  all now match the bento tiles (collapsed + expanded). Entry layout unchanged (context
  only applies in the bento subtree). Dark mode handled via theme tokens + `dark:`
  variants on the chevron/count badge.
- Safe for the shared component: 29 bento/liveTimerPolicy tests pass; ui package 176
  tests pass (the 19 ui file-failures are the pre-existing `@alga-psa/core/i18n/config`
  import-resolution error in unrelated files, not ContentCard). Typecheck clean.

### Slice 6 (2026-07-03): timeline spine + lane pins + lane tinting (mockup parity R1+R3)

- Compared the live timeline to the Option B mockup; the mockup read as a "story"
  because of a continuous spine, lane-colored pins, and tinted comment bubbles that the
  live version lost when comments moved to the full `CommentItem`. Implemented the two
  low-risk, high-payoff recommendations (R1 spine+pins, R3 lane tint); deferred R2
  (compact comments) since it touches the shared `CommentItem`.
- `BentoTimelineTile`:
  - Added a continuous vertical spine (single absolute line at `left-3`, the centre of
    a `w-6` pin gutter) behind per-entry pins.
  - `laneVisual(node)` returns a ringed circular pin (colour + icon) and a comment
    left-border accent per lane: client=cyan (`--color-secondary`), internal=amber+lock,
    resolution=green+check, time=primary+clock, alert=red, system=gray+activity. Every
    colour has a `dark:` variant; theme-token colours are theme-aware.
  - Each row is now `gutter(pin) + content`; day-break pills sit right of the gutter.
  - `TimelineNodeView` (time/system/alert rows) dropped its own leading icon — the pin
    carries it now — so those rows are tighter single lines.
  - Comment cards are wrapped with the lane accent (`border-l-[3px] rounded-lg
    overflow-hidden`), color-coding them to match the pins without touching CommentItem.
- Verified live (light; dark by construction): spine connects all pins; time entries get
  purple clock pins + compact rows; client/internal/resolution comments get cyan/amber/
  green pins and matching left borders. 24 bento unit tests pass; typecheck clean.
- Not done (deferred, would be R2): comments are still full-height `CommentItem` cards
  (3-line header + reserved body height). Making them compact needs a dense variant on
  the shared `CommentItem` — its own slice.

### Slice 7 (2026-07-03): compact comments in the timeline (mockup parity R2)

- Added an opt-in `variant?: 'default' | 'compact'` to the shared `CommentItem`; the
  timeline passes `variant="compact"`, everything else (the Entry conversation view)
  keeps `'default'` byte-for-byte. Verified Entry comments unchanged (full avatar, email
  line, full timestamp, original spacing).
- Compact treatment (all `isCompact`-gated):
  - One-line header: drop the email line, inline a short timestamp
    ("Jun 9, 7:43 PM (Edited)") next to the name, shrink the avatar to `size="sm"`.
  - Card: `p-2.5`, no shadow/mb (the timeline + lane accent supply the frame).
  - Body: `prose-sm`, tighter leading.
  - Killed two BlockNote read-only-viewer artifacts that were eating ~half the height:
    the `.bn-editor` 54px side-menu horizontal padding (`[&_.bn-editor]:!px-0`, so text
    left-aligns), and BlockNote's always-appended trailing empty block — it survives a
    parse-time strip (the viewer re-adds it), so hide it via CSS by its ProseMirror
    trailing break: `[&_.bn-block-outer:last-child:has(br.ProseMirror-trailingBreak)]:hidden`
    (only empty blocks carry that break, so real last lines are never hidden).
  - Drop the empty reaction add-row in compact (`reactions.length > 0` gate); reactions
    still render when present, and the add affordance remains in the Entry view.
- Result: comment cards ~92px (were ~178px) — a ~48% cut — so the timeline now reads at
  the mockup's density. Spine/pins/tint (slice 6) intact. 157 ticket component tests
  pass; typecheck clean; Entry view unaffected.
- Note: `:has()` is used for the trailing-block hide (modern-browser only; fine for this
  app). Compact changes are structural/spacing only — no new colours — so dark mode is
  unaffected.

## Commands / Runbooks

- Dev DB spot checks (schema + fixtures):
  `docker exec licval_postgres sh -c 'PGPASSWORD=$(cat $POSTGRES_PASSWORD_FILE) psql -U postgres -d server -c "<sql>"'`
- Dev app for this worktree: `http://localhost:3700` (host-run `npm run dev` wired into
  the `alga-psa-local-test` compose project).
- Richest manual-QA ticket: `TIC1001` (also `TKT-001008..12` for RMM alert tickets).

## Links / References

- Mockup (selected): `mockups/option-b-ticket-story.html` (+ `bento-b*.png` captures)
- Sibling explorations (not selected): `/tmp/ticket-bento-a-command-center.html`,
  `/tmp/ticket-bento-c-modular-glass.html`
- Coding standards: `docs/AI_coding_standards.md`
- Feature flags doc: `docs/features/feature-flags.md`

## Open Questions

- See PRD "Open Questions" — kept there so they stay visible during review.

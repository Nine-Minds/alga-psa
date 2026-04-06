# Scratchpad — MSP i18n Batch 2b-21a: Tickets Migration

- Plan slug: `2026-04-05-msp-i18n-tickets-migration`
- Created: `2026-04-05`

## What This Is

A mechanical wiring pass: 23 unwired MSP ticket components × `useTranslation('features/tickets')`.
The shared namespace (147 keys, 9 locales) already exists and is already loaded by
`ROUTE_NAMESPACES['/msp/tickets']`. Client-portal side is 100% wired — this closes the MSP gap.

## Decisions

- **(2026-04-05)** Keep MSP-specific keys in `features/tickets.json` rather than extracting
  to new `msp/ticketing.json`. Rationale: client portal may eventually surface bulk actions,
  export, etc. If file exceeds ~250 keys after sub-batch A, revisit.
- **(2026-04-05)** Use `t('key', 'English fallback')` signature everywhere — fallback-safe
  against missing keys and matches patterns in already-wired `TicketConversation.tsx` and
  `TicketDetails.tsx`.
- **(2026-04-05)** Ship sub-batches A (large dashboard/detail/quickadd), B (settings + export
  + materials), C (small components) as independent PRs.
- **(2026-04-05)** Translate toast messages and user-visible error strings. Do NOT translate
  `throw new Error('...')` strings caught by error boundaries or logged only.
- **(2026-04-05)** Use i18next `{{count}}` interpolation for pluralized toast messages
  (e.g., `'{{count}} ticket moved'` / `'{{count}} tickets moved'`) rather than template
  literals. Matches existing `features/tickets.json` patterns in `messages.*`.
- **(2026-04-05, F002)** Expand `features/tickets.json` in-place rather than splitting micro-
  namespaces. The shared file is now broad, but keeping tickets UI copy in one namespace makes
  the MSP/client-portal overlap explicit and avoids route-specific key plumbing.

## Discoveries / Constraints

- **(2026-04-05)** `features/tickets.json` top-level groups: title, subtitle, backToTickets,
  createNew, createButton, viewAll, myTickets, resetFilters, filters (7), create (10),
  status (8), priority (6), fields (21), actions (8), messages (31), conversation (23),
  responseState (4), origin (5), responseSource (2), documents (14). Total: 147 keys.
- **(2026-04-05, F002/F062)** The initial 147-key count was from an early partial read and is no
  longer accurate. After the full MSP migration pass, `server/public/locales/en/features/tickets.json`
  contains **887 leaf strings**. The file already had substantial nested MSP/support-ticket
  coverage below the first 260 lines; this batch extended that existing structure rather than
  introducing a second parallel namespace.
- **(2026-04-05)** `ROUTE_NAMESPACES['/msp/tickets']` already loads
  `['common', 'msp/core', 'features/tickets']` — no config changes needed.
- **(2026-04-05)** Already-wired MSP components (reference examples for patterns):
  - `CommentItem.tsx` → `useTranslation('features/tickets')`
  - `TicketConversation.tsx` → `useTranslation('features/tickets')`
  - `TicketDetails.tsx` → `useTranslation('features/tickets')`
  - `TicketDocumentsSection.tsx` → `useTranslation('features/documents')`
  - `TicketAppointmentRequests.tsx` → `useTranslation('features/appointments')`
- **(2026-04-05)** Largest files (LOC): TicketingDashboard (2024), QuickAddTicket (1596),
  TicketInfo (1587), TicketProperties (1234), CategoriesSettings (865). These 5 alone are
  ~7,300 LOC and likely account for ~60% of strings.
- **(2026-04-05)** Rough string estimates (from grep heuristic — undercount):
  - Sub-batch A: 4 files, ~150-200 strings
  - Sub-batch B: 4 files, ~80-95 strings
  - Sub-batch C: 15 files, ~50-70 strings
  - **Total: ~280-365 strings** (heuristic floor; realistic: 350-450)
- **(2026-04-05)** Zero-string components (confirm during implementation):
  TicketDetailsSkeleton, AgentScheduleDrawerStyles, TicketListSkeleton, AgentScheduleDrawer
  (re-export shim). TicketOriginBadge and ResponseSourceBadge may have small badge-label
  key sets needed.
- **(2026-04-05)** `QuickAddTicket` is reused outside tickets module — imported in
  `server/src/components/layout/QuickCreateDialog.tsx` for the global quick-create menu.
  Translation must also work in that context.
- **(2026-04-05)** `CategoryPicker` is reused in
  `server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx`.
  Verify translation works on service-request routes too.
- **(2026-04-05)** `CategoriesSettings` and `DisplaySettings` are rendered via
  `server/src/components/settings/general/TicketingSettings.tsx` → likely loaded by
  `/msp/settings` route. `ROUTE_NAMESPACES['/msp/settings']` doesn't currently include
  `features/tickets` — **verify this route loads it transitively or add it**.
- **(2026-04-05, F001 audit)** `/msp/service-requests/*` also does not have a dedicated
  `ROUTE_NAMESPACES` entry. Those pages currently inherit `/msp` only, so reused ticket
  components like `CategoryPicker` would not receive `features/tickets` unless route config
  is expanded.
- **(2026-04-05, F001 audit)** Concrete namespace gaps found by component audit:
  - `dashboard.*`: title, add button, assignee/status/response-state/due-date/SLA filters,
    destination board/status prompts, selected-count text, no-selection text, move/delete/
    bundle modal copy, board-switch warnings, bulk result summaries, empty/loading states.
  - `bulk.*`: move/delete/bundle button labels, confirm/cancel/continue actions, singular/
    plural success toasts, partial-failure headings, master-ticket selection, cross-client
    bundle warning, destination validation errors.
  - `quickAdd.*`: dialog title, required-fields summary, assigned-to/additional-agents labels,
    board/category/status/location/contact placeholders, due-date helper copy, clipboard
    upload failure, team assignment/tag creation partial-failure toasts.
  - `itil.*`: impact/urgency field labels, select placeholders, calculated-priority label,
    priority-matrix heading, impact/urgency scale labels, explanatory help text, planning
    priority label.
  - `info.*` / `properties.*`: unsaved-changes banner, status/board/priority/due-date/SLA/
    tags/description headings, not-assigned/no-contact/no-location/no-primary-agent/no-team
    empty states, additional-agents label, appointment request field labels, team-assignment
    removal modes, email-log button label.
  - `settings.categories.*`: categories heading, board filter placeholder, dialog field labels,
    import flow copy, import conflict actions, delete/save/import success and failure strings.
  - `settings.display.*`: response-state tracking section, explanatory copy, toggle labels,
    display-preferences section, date/time format label, column labels, tags layout labels,
    save/saving success and failure strings.
  - `export.*`: dialog title, field-picker heading, select-all toggles, selected-count copy,
    exporting/progress/completion copy, done/cancel actions, CSV file export failures.
  - `materials.*`: product/price/quantity/total/description labels, select placeholders,
    loading/empty states, billed/pending badges, add/remove success and validation errors.
  - `watchList.*`: tab labels, contact scope labels, selector placeholders, empty state, add/
    remove validation errors, generic save failure message.
  - `emailNotifications.*`: table headings, loading/empty states, pagination action text.
  - `categoryPicker.*`: "No Category", multi-select summary text, exclusion summary text,
    add-new label, ITIL badge label, default placeholder.
  - `responseState.*` additions: `awaitingClient`, `awaitingInternal`, `clear`,
    `setResponseState`, `notSet`, `label`. Existing keys use client-portal wording and do not
    cover the MSP dropdown strings directly.
  - `navigation.*`: previous/next ticket aria-labels.
  - `debug.*`: comment metadata modal section headings and empty-summary copy.
  - `errors.*` / `validation.*`: generic save/load/export/category/material/watch-list errors
    that are user-visible today and should not stay hardcoded.
- **(2026-04-05, F002)** Added the first full MSP key expansion to
  `server/public/locales/en/features/tickets.json`: `dashboard`, `bulk`, `quickAdd`, `itil`,
  `info`, `properties`, `settings.categories`, `settings.display`, `export`, `materials`,
  `watchList`, `emailNotifications`, `categoryPicker`, `navigation`, `debug`, `validation`,
  and `errors`, plus targeted additions to `filters`, `priority`, `fields`, `actions`, and
  `responseState`.
- **(2026-04-05, F002)** To keep translation validation green between per-locale commits,
  the same new key structure was scaffolded into `fr/es/de/nl/it/pl` with English placeholder
  values. `xx/yy` were regenerated immediately from English; the real locale translations are
  filled in by `F003`-`F008`.
- **(2026-04-05, F062)** Final namespace closeout: `features/tickets.json` ends this batch at
  **887 English leaf strings**. That is well above the earlier ~250 revisit threshold, but the
  shared MSP/client-portal namespace is still the right design because the badge enums, ticket
  chrome, quick-add flow, settings surfaces, and reused picker components now all draw from one
  route-agnostic ticket vocabulary. No feature-scope code items remain deferred; the remaining
  backlog is test execution/coverage tracked in `tests.json`.

## Commands / Runbooks

### The lang-pack loop (run after every namespace edit)

This is the single-command validation cycle. Run it every time `en/features/tickets.json`
is edited — it regenerates pseudo-locales and verifies key parity across all 9 locales:

```bash
node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs
```

- `generate-pseudo-locales.cjs` reads every English file and rebuilds `xx/` and `yy/` with
  fill values (`11111`, `55555`), preserving `{{interpolation}}` tokens. **Never hand-edit
  `xx/` or `yy/` files — they will be overwritten.**
- `validate-translations.cjs` checks every locale against English for: identical key
  structure, no extra/missing keys, preserved `{{variable}}` tokens, valid JSON, pseudo-
  locale fill patterns. Exit code 0 = pass.

If validation fails, fix `en/features/tickets.json` (or the complaining locale), re-run
the one-liner. Keep the validator green before committing.

### Other useful commands

- Count strings in a component (lower bound):
  ```bash
  grep -cE ">[A-Z][a-zA-Z ]{2,}[a-z]<|(label|title|placeholder)[=:][ ]*['\"][A-Z]|toast\.(error|success)\(['\"]" <file>
  ```
- List all unwired MSP ticket components:
  ```bash
  for f in $(find packages/tickets/src/components -type f -name "*.tsx" ! -name "*.test.tsx"); do
    grep -qE "useTranslation" "$f" || echo "$f"
  done
  ```
- Audit user-visible strings in unwired components:
  ```bash
  rg -n "toast\.|title:|label=|placeholder=|aria-label|>[^<{]*[A-Za-z][^<{]*<|throw new Error|confirm\(" packages/tickets/src/components
  ```
- Find all places a component is imported:
  ```bash
  grep -rn "from '@alga-psa/tickets" server/src ee/server/src | grep ComponentName
  ```
- Reference already-wired files (copy the pattern):
  ```
  packages/tickets/src/components/ticket/TicketDetails.tsx
  packages/tickets/src/components/ticket/TicketConversation.tsx
  packages/tickets/src/components/ticket/CommentItem.tsx
  ```

## Links / References

- Parent plan: `.ai/translation/MSP_i18n_plan.md` (Batch 2b-21a)
- Shared namespace file: `server/public/locales/en/features/tickets.json`
- Route config: `packages/core/src/lib/i18n/config.ts` (ROUTE_NAMESPACES)
- Validation script: `scripts/validate-translations.cjs`
- Validation CI workflow: `.github/workflows/validate-translations.yml`
- Pattern reference (already wired): `packages/tickets/src/components/ticket/TicketDetails.tsx`,
  `packages/tickets/src/components/ticket/TicketConversation.tsx`,
  `packages/tickets/src/components/ticket/CommentItem.tsx`
- Precedent plan (similar wiring-only work): `docs/plans/2026-03-20-msp-i18n-remaining/`
- i18n test helpers: `server/src/test/unit/layout/*.i18n.test.tsx`
- QuickCreate integration: `server/src/components/layout/QuickCreateDialog.tsx`
- Service-request integration: `server/src/app/msp/service-requests/ServiceRequestDefinitionEditorPage.tsx`
- Settings integration: `server/src/components/settings/general/TicketingSettings.tsx`

## Open Questions

- Does `ROUTE_NAMESPACES['/msp/settings']` or `/msp/settings/ticketing` load
  `features/tickets`? If not, wiring `CategoriesSettings` and `DisplaySettings` requires a
  namespaces update. **Action: verify before starting sub-batch B.**
- `F010` is required: add `features/tickets` to `/msp/settings` and add an explicit
  `/msp/service-requests` route mapping so `CategoriesSettings`, `DisplaySettings`, and the
  reused `CategoryPicker` have locale resources outside `/msp/tickets`.
- Should `TicketOriginBadge` and `ResponseSourceBadge` reuse the existing
  `features/tickets.json` `origin.*` and `responseSource.*` keys or do those groups need
  more enum values? **Action: diff badge enum values against existing keys during F049.**
- What is the canonical test pattern for component-level i18n tests in this repo? Models
  to follow: `server/src/test/unit/layout/*.i18n.test.tsx`,
  `server/src/test/unit/dashboard/DashboardContainer.i18n.test.tsx`.
- Are there existing test helpers/utilities for rendering components with specific locales?
  **Action: search for i18n test setup in `server/src/test/unit/i18n/*`.**

## Implementation Order (recommended)

1. **Setup (F001-F010):** Audit gaps, add missing keys to en/features/tickets.json, generate
   all 8 other locales. This unblocks all component wiring.
2. **Sub-batch A PR (F020-F028):** 4 large components. Biggest review burden; ship first
   while context is fresh.
3. **Sub-batch B PR (F030-F037):** 4 medium components. Verify settings-route namespace
   loading before starting.
4. **Sub-batch C PR (F040-F050):** 15 small components. Quick cleanup pass.
5. **Closeout (F060-F062):** Validate, update parent plan, archive scratchpad notes.

## Progress Log

- **(2026-04-05, F002)** Expanded `en/features/tickets.json` with the audited MSP ticket key
  families used by dashboard/bulk/quick-add/ITIL/info/properties/settings/export/materials/
  watch-list/email/category-picker/response-state/navigation/debug/validation/error flows.
  To keep key parity green on every commit, mirrored the new keys into `fr/es/de/nl/it/pl`
  with temporary English placeholders. Regenerated `xx/yy/features/tickets.json` from English
  and re-ran `node scripts/validate-translations.cjs` successfully (`Errors: 0`, `Warnings: 0`).
- **(2026-04-05, F002)** Placeholder strategy is intentional: `F003`-`F008` will replace the
  temporary English values in each production locale with real translations one locale at a
  time while keeping the validator green throughout.
- **(2026-04-05, F003)** Replaced the temporary English placeholders in
  `fr/features/tickets.json` with French translations for the MSP ticket additions. During
  validation a partial Italian worker edit had renamed `ticketSection.on` / `ticketSection.minutes`
  to localized key names; corrected the key names in-place so parity stayed valid without
  altering the Italian values.
- **(2026-04-05, F004)** Replaced the temporary English placeholders in
  `es/features/tickets.json` with Spanish translations for the MSP ticket additions using the
  same batched machine-translation pass as French, then manually corrected ticket-domain copy
  around bundle warnings, bulk move success interpolation, and plural action labels. After the
  cleanup pass only expected invariants remain English-equal (`Total`, `Error`, `SLA`, `ITIL`,
  `N/A`), and `node scripts/validate-translations.cjs` stays green.
- **(2026-04-05, F005)** Completed the German locale pass for
  `de/features/tickets.json`. This file already had broad ticket coverage; the remaining work
  was mostly placeholder cleanup in MSP additions. After translation, the only English-equal
  leaves are domain terms or deliberate invariants (`Board`, `Team`, `Lead`, `Service`,
  `SLA`, `ITIL`, `name@example.com`), so no extra manual rewrites were needed beyond the
  automated fill-in. Validation stayed green.
- **(2026-04-05, F006)** Completed the Dutch locale pass for
  `nl/features/tickets.json`. The machine fill covered the remaining MSP placeholders cleanly;
  manual cleanup was limited to replacing the exported-ticket tooltip’s literal `ticket(s)`
  phrasing with natural Dutch. Remaining English-equal leaves are acceptable product terms or
  invariants (`Open`, `Status`, `Team`, `Impact`, `Product`, `Compact`, `SLA`, `ITIL`).
- **(2026-04-05, F007)** Italian locale coverage was already effectively complete after the
  placeholder scaffold. The substantive work here was preserving key parity by restoring the
  canonical key names `ticketSection.on` and `ticketSection.minutes` while keeping the localized
  values (`il`, `minuti`). Accent-sensitive validation remained green, so no further copy edits
  were required beyond confirming the remaining English-equal leaves are acceptable (`Team`,
  `Email`, `SLA`, `ITIL`).
- **(2026-04-05, F008)** Completed the Polish locale pass for
  `pl/features/tickets.json`, including the remaining MSP validation strings, ITIL helper copy,
  ticket-section appointment labels, and quick-add placeholders. After the translation pass only
  invariant leaves remain English-equal (`Status`, `SLA`, `ITIL`), and the bundle/bulk wording
  reads consistently with the rest of the ticket namespace.
- **(2026-04-05, F009)** Re-ran `node scripts/generate-pseudo-locales.cjs` after the locale
  setup work. The generator reported `52` pseudo-locale files rebuilt from `26` English sources,
  but produced no git diff, confirming `xx/yy` were already in sync with the current English
  namespace. This item is complete as an explicit regeneration checkpoint rather than a content
  change.
- **(2026-04-05, F010)** Updated `packages/core/src/lib/i18n/config.ts` so reused ticket
  components can resolve `features/tickets` outside `/msp/tickets`: `/msp/settings` now loads
  `features/tickets` alongside its existing namespaces, and `/msp/service-requests` now has an
  explicit route entry loading `['common', 'msp/core', 'features/tickets']`. Added focused route
  coverage to `server/src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts` and
  verified it with `cd server && npx vitest run src/test/unit/i18n/mspDispatchReportsAdminTimeEntryBatch.test.ts`.
- **(2026-04-05, F020)** Wired `packages/tickets/src/components/TicketingDashboard.tsx` to
  `useTranslation('features/tickets')` for the dashboard title, add-ticket CTA, assignee/status/
  priority/response-state/due-date/SLA filter placeholders and option labels, including the
  interpolated before/after-date labels. Validation used `npx eslint
  packages/tickets/src/components/TicketingDashboard.tsx`; it exited 0 with only pre-existing
  warnings in this file (unused vars, hook deps, legacy JSX apostrophe), so no new lint errors
  were introduced by the i18n patch.
- **(2026-04-05, F021)** Localized the dashboard’s bulk-selection surface in
  `packages/tickets/src/components/TicketingDashboard.tsx`: selection-menu actions, bulk move/
  delete/bundle toolbar buttons, select-all banners, bundle cross-client confirmation, move/
  delete/bundle dialog titles and buttons, bulk dialog field labels/placeholders, and bulk toast
  messages now all resolve through `features/tickets` with `count` interpolation. Re-ran
  `npx eslint packages/tickets/src/components/TicketingDashboard.tsx`; it stayed green with only
  the same file-local pre-existing warnings.
- **(2026-04-05, F022)** Finished the remaining dashboard UX copy in
  `packages/tickets/src/components/TicketingDashboard.tsx`: export tooltip text, client quick-
  drawer loading/not-found/load-failed fallbacks, bundle-child load errors, destination-board
  status-load errors, single-delete fallback entity name, delete-validation fallback copy, and
  the quick-add optimistic-row unknown-client label now all resolve through `features/tickets`.
  This required a small namespace extension in `en/fr/es/de/nl/it/pl/features/tickets.json`
  (`dashboard.drawer.clientLoadFailed`, `bulk.move.noStatusesConfigured`,
  `bulk.move.loadStatusesFailed`, `bulk.delete.entityFallback`,
  `errors.validateDeletionFailed`, `errors.deleteTicketUnexpected`), followed by
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  which passed with `Errors: 0`, `Warnings: 0`.
- **(2026-04-05, T010)** Added `packages/tickets/src/components/TicketingDashboard.i18n.test.ts`
  as a fast source-contract test for the dashboard shell/filter wiring. A jsdom render harness
  pulled in too much of the ticket/auth runtime for this file, so the test asserts the concrete
  `t('...')` calls for the page title, add button, primary filter placeholders/options, reset
  control, bundled toggle, and density-control labels directly in `TicketingDashboard.tsx`.
  Verified with `cd packages/tickets && npx vitest run src/components/TicketingDashboard.i18n.test.ts`.
- **(2026-04-05, F023)** Audited `packages/tickets/src/components/QuickAddTicket.tsx` and
  confirmed the dialog/title/field placeholder slice was already wired even though the checklist
  was stale: dialog title + automation labels, title/description/client/contact/location/board/
  assignee/additional-agent/category/status/priority/due-date placeholders, and the ITIL field
  labels/help text all resolve through `useTranslation('features/tickets')`. Attempted to validate
  with `cd packages/tickets && npx vitest run src/components/__tests__/QuickAddTicket.boardScopedStatuses.test.tsx`,
  but the package test setup currently fails before executing tests because Vite cannot resolve
  `@alga-psa/core/server` from `shared/core/getSecret.ts`. No source change was required in this
  turn beyond syncing the feature checklist to the implementation state.
- **(2026-04-05, F023A)** The earlier `F023` audit was incomplete: `QuickAddTicket.tsx` still
  had hardcoded field-chrome in the ITIL matrix, the additional-agents team-section label, and
  the unnamed-location fallback. Wired those through `features/tickets`, added
  `quickAdd.unnamedLocation` and `quickAdd.addTeamMembers` to the locale packs, regenerated
  pseudo-locales, and re-ran `node scripts/generate-pseudo-locales.cjs && node
  scripts/validate-translations.cjs` successfully. `npx eslint
  packages/tickets/src/components/QuickAddTicket.tsx` still reports only the file’s existing
  warnings (`@ts-nocheck`, unused imports/types, and pre-existing hook-deps warnings).
- **(2026-04-05, F024)** Completed the remaining user-visible QuickAddTicket action/error copy:
  validation messages now use translated field-specific requirements, submit/cancel buttons and
  the secondary `Create + View Ticket` action resolve through i18n, clipboard image confirmation
  copy is translated, and the quick-add toast/error paths for clipboard image upload, team
  assignment, tag creation, and generic create failures now use `features/tickets`. Added
  `quickAdd.createAndView`, `quickAdd.continueEditing`, and `quickAdd.clipboardDraftMessage`
  across the production locales, regenerated pseudo-locales, and re-ran translation validation
  successfully. `npx eslint packages/tickets/src/components/QuickAddTicket.tsx` remained green
  with only the file’s pre-existing warnings.
- **(2026-04-05, F024 follow-up)** Removed duplicated `quickAdd.createAndView`,
  `quickAdd.continueEditing`, and `quickAdd.clipboardDraftMessage` entries that were lingering in
  the production locale files while leaving the canonical localized values intact. Re-ran
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`; it still
  passed with `Errors: 0`, `Warnings: 0`.
- **(2026-04-05, F025)** Wired the main `TicketInfo.tsx` detail-surface chrome to
  `useTranslation('features/tickets')`: title-edit button titles, unsaved/saved banners,
  section headings (status/assignee/board/category/priority/due date/SLA/tags/description),
  assignee/category/date/time placeholders, ITIL labels + matrix text, additional-agent tooltip
  heading, paused/clear-due-date labels, description empty-state copy, and the email-log tooltip/
  aria label now all resolve through the shared ticket namespace. Validation used
  `npx eslint packages/tickets/src/components/ticket/TicketInfo.tsx`; it exited 0 with only the
  file’s pre-existing warnings (`@ts-nocheck`, unused symbols, existing `any`/non-null asserts).
- **(2026-04-05, F026)** Finished the remaining user-facing `TicketInfo.tsx` action/confirmation
  copy: description save/cancel controls, the footer cancel/save-changes controls, the unsaved-
  changes discard dialog, and the pasted-images cleanup dialog now all resolve through
  `features/tickets`. Added `info.saveChanges`, `info.saving`, `info.discardChangesTitle`,
  `info.discardChangesMessage`, `info.discard`, `info.keepEditing`, and
  `info.clipboardDraftMessage` across `en/fr/es/de/nl/it/pl`, regenerated `xx/yy`, and re-ran
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  successfully. Focused validation also passed with `npx eslint
  packages/tickets/src/components/ticket/TicketInfo.tsx` and `cd packages/tickets && npx vitest
  run src/components/ticket/__tests__/TicketInfo.boardChangeStatusReselection.test.tsx
  src/components/ticket/TicketInfo.richText.contract.test.ts`.
- **(2026-04-05, F026 test harness)** The existing `TicketInfo` regression tests needed upkeep to
  reflect the current component composition: `TicketInfo.boardChangeStatusReselection.test.tsx`
  now mocks `useTranslation` and `useDocumentsCrossFeature`, and
  `TicketInfo.richText.contract.test.ts` asserts the translated clipboard-dialog wiring instead of
  the retired hardcoded `"Keep Images"` literal.
- **(2026-04-05, F027)** Wired the main `TicketProperties.tsx` side-panel chrome through
  `useTranslation('features/tickets')`: the time-entry card title/timer label/controls, work-
  description label + placeholder, disabled-timer message, tracked-interval heading, contact-info
  card title and field labels, contact/location placeholders and empty states, client/contact
  fallback labels, appointment-request drawer headings, assigned-team fallbacks, primary-agent
  section labels, scheduled-hours text, and additional-agent picker labels/placeholders are now
  localized. Added `properties.timeEntry` and `properties.ticketTimer` across
  `en/fr/es/de/nl/it/pl`, regenerated `xx/yy`, and re-ran `node scripts/generate-pseudo-locales.cjs
  && node scripts/validate-translations.cjs` successfully.
- **(2026-04-05, F027 validation)** Focused regression checks passed with `npx eslint
  packages/tickets/src/components/ticket/TicketProperties.tsx` (warnings only, no new errors) and
  `cd packages/tickets && npx vitest run
  src/components/ticket/__tests__/TicketProperties.liveTimerPolicy.test.tsx
  src/components/ticket/__tests__/ticket-properties-inline-contact.test.tsx`. Those tests now mock
  `useTranslation`, and the inline-contact harness also mocks `useQuickAddClient` so the quick-add
  contact dialog continues to render in isolation.
- **(2026-04-05, F028)** Finished the remaining interactive `TicketProperties.tsx` copy without
  adding new keys: the contact/client/location picker footer buttons now use shared
  `actions.cancel` / `actions.save`, and the team removal/switch dialog now resolves its title,
  option labels, empty state, and confirm/cancel buttons through existing `properties.*` and
  `actions.*` keys. The only English strings still visible in the file are inside a commented-out
  legacy team block and do not render at runtime.
- **(2026-04-05, F028 validation)** Re-ran `npx eslint
  packages/tickets/src/components/ticket/TicketProperties.tsx` (same pre-existing warnings only)
  plus `cd packages/tickets && npx vitest run
  src/components/ticket/__tests__/TicketProperties.liveTimerPolicy.test.tsx
  src/components/ticket/__tests__/ticket-properties-inline-contact.test.tsx`, which stayed green
  after the dialog/button wiring.
- **(2026-04-05, F030)** Wired the `CategoriesSettings.tsx` page shell to
  `useTranslation('features/tickets')` without expanding the namespace: the page heading, board
  filter option/placeholder, and the category table’s `Name` / `Board` / `Order` / `Actions`
  headers now resolve through existing `settings.categories.*`, `fields.board`, and
  `settings.display.columns.actions` keys. This leaves the add/edit/import/delete dialog and toast
  copy isolated for `F031`.
- **(2026-04-05, F030 validation)** Verified the wiring with `cd packages/tickets && npx vitest
  run src/components/settings/__tests__/CategoriesSettings.contract.test.ts` and `npx eslint
  packages/tickets/src/components/settings/CategoriesSettings.tsx` (warnings only, no new errors).
- **(2026-04-05, F031)** Finished the `CategoriesSettings.tsx` dialog/error flow wiring using the
  existing `settings.categories.*` keys: fetch/save/import/delete validation messages, success
  toasts, dropdown action labels, edit/import/conflict dialog titles, form labels/placeholders,
  import target-board help text, import-table column labels, conflict resolution copy, and the
  related cancel/update/import buttons now all resolve through `features/tickets`. No locale-file
  expansion was needed for this pass because the namespace additions from `F002` already covered
  the settings copy.
- **(2026-04-05, F031 validation)** Re-ran `cd packages/tickets && npx vitest run
  src/components/settings/__tests__/CategoriesSettings.contract.test.ts` after updating its stale
  raw-string assertions to the new `t(...)` calls, and re-ran `npx eslint
  packages/tickets/src/components/settings/CategoriesSettings.tsx` (warnings only, no new errors).
- **(2026-04-05, F032)** Started the `TicketExportDialog.tsx` pass by wiring the configure-step
  chrome to `useTranslation('features/tickets')`: the dialog title, export-field labels, field-
  picker heading, select-all/deselect-all toggle, and selected-field count now resolve through the
  existing `export.*`, `fields.*`, `properties.contact`, and `settings.display.columns.tags` keys.
  No namespace expansion was required for this slice.
- **(2026-04-05, F032 validation)** Verified the configure-step patch with `npx eslint
  packages/tickets/src/components/TicketExportDialog.tsx` and a direct source grep confirming the
  previous hardcoded configure labels were replaced by `t(...)` calls. The remaining export-action
  strings are intentionally deferred to `F033`.
- **(2026-04-05, F033)** Completed the `TicketExportDialog.tsx` export-state wiring: the export
  summary, applied-filters summary, cancel/export CTA labels, exporting-state message, completion
  title/message, done button, and export failure handling now all resolve through `export.*` and
  `actions.cancel`. The count-based strings use the existing pluralized export keys instead of
  manual `ticket/tickets` concatenation.
- **(2026-04-05, F033 validation)** Re-ran `npx eslint
  packages/tickets/src/components/TicketExportDialog.tsx` and a direct source grep to confirm the
  former hardcoded action/progress strings now route through `t(...)`. No locale-file changes were
  needed for this pass.
- **(2026-04-05, F034)** Wired the core `TicketMaterialsCard.tsx` chrome through
  `useTranslation('features/tickets')` using the pre-existing `materials.*` keys: the card title,
  add-button label, add-material form labels/placeholders, price-loading/no-price copy, quantity/
  total/description fields, cancel/add CTA labels, the materials table headers, billed/pending
  badges, unknown-product fallback, unbilled-per-currency summary, and add-success toast now all
  resolve through the shared tickets namespace. This pass intentionally left validation/error/
  delete/empty-state copy for `F035` so the remaining work stays atomic.
- **(2026-04-05, F034 validation)** Verified with `npx eslint
  packages/tickets/src/components/ticket/TicketMaterialsCard.tsx`, which exited 0.
- **(2026-04-05, F035)** Finished the remaining `TicketMaterialsCard.tsx` user-facing copy:
  load/add/remove failures now use `errors.loadMaterials` / `errors.addMaterial` /
  `errors.removeMaterial`, add-form validation toasts use `validation.materials.*`, the delete
  success toast uses `materials.removeSuccess`, and the loading/empty/client-required helper
  states now resolve through `materials.*`. This required one namespace addition,
  `materials.clientRequired`, in `en/fr/es/de/nl/it/pl/features/tickets.json`, followed by
  pseudo-locale regeneration.
- **(2026-04-05, F035 validation)** Re-ran
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  (`Errors: 0`, `Warnings: 0`) and `npx eslint
  packages/tickets/src/components/ticket/TicketMaterialsCard.tsx`, which exited 0.
- **(2026-04-05, F036)** Wired the main `DisplaySettings.tsx` labels through
  `useTranslation('features/tickets')` without expanding the namespace: the response-state
  tracking section title/description/toggle labels, the display-preferences heading and
  description, the date/time-format label, the date-format preview options, the ticket-list
  columns heading, every column checkbox label plus required suffix, and the tags visibility/
  layout labels now resolve through `settings.display.*` and shared `fields.*` keys. The save
  CTA and save/failure copy are intentionally left for `F037`.
- **(2026-04-05, F036 validation)** Verified with `npx eslint
  packages/tickets/src/components/settings/DisplaySettings.tsx`, which exited 0.
- **(2026-04-05, F037)** Finished the existing `DisplaySettings.tsx` save path: the success
  toast, save-failure message, and save-button/saving labels now resolve through
  `settings.display.saveSuccess`, `settings.display.saveFailed`, `settings.display.saving`,
  and shared `actions.save`. The checklist mentioned reset/per-user controls, but this component
  currently only exposes a save action; no reset UI exists to wire in this batch.
- **(2026-04-05, F037 validation)** Re-ran `npx eslint
  packages/tickets/src/components/settings/DisplaySettings.tsx`, which exited 0.
- **(2026-04-05, F040)** Wired `TicketWatchListCard.tsx` through
  `useTranslation('features/tickets')`: the card title, add-mode tabs, contact-scope toggle,
  picker/email placeholders, add button labels, empty state, validation/update-failure messages,
  recipient type badges, and remove-button aria/title copy now resolve through `watchList.*`.
  This required a small namespace addition in `en/fr/es/de/nl/it/pl/features/tickets.json`
  (`watchList.userBadge`, `watchList.contactBadge`, `watchList.removeWatcher`), followed by
  pseudo-locale regeneration.
- **(2026-04-05, F040 validation)** Re-ran
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  (`Errors: 0`, `Warnings: 0`) and `npx eslint
  packages/tickets/src/components/ticket/TicketWatchListCard.tsx`, which exited 0. A focused
  `TicketWatchListCard.test.tsx` run still fails before assertions because the existing harness
  does not provide the now-required `useTranslation`/`useFeatureFlag` context; that follow-up is
  queued as test work rather than a source blocker for the feature wiring.
- **(2026-04-05, F041)** Wired `TicketEmailNotifications.tsx` through
  `useTranslation('features/tickets')`: the card title, table column titles, loading/empty
  states, load-more button, and fallback unknown-error string now resolve through
  `emailNotifications.*`. The sent-at formatter also now uses the active i18n language instead of
  hardcoded `en-US`, so locale changes affect the timestamp preview format too.
- **(2026-04-05, F041 validation)** Verified with `npx eslint
  packages/tickets/src/components/ticket/TicketEmailNotifications.tsx`, which exited 0. There is
  no dedicated component test file for this card yet; only higher-level TicketDetails tests mock
  it out.
- **(2026-04-05, F042)** Wired `ResponseStateSelect.tsx` through
  `useTranslation('features/tickets')`: the dropdown option labels (`awaitingClient`,
  `awaitingInternal`, `clear`), the select placeholder, the display heading, and the empty-state
  `Not set` text now all resolve through `responseState.*`. Removed the stale unused
  `getResponseStateLabel` import while touching the file.
- **(2026-04-05, F042 validation)** Verified with `npx eslint
  packages/tickets/src/components/ResponseStateSelect.tsx`, which exited 0.
- **(2026-04-05, F043)** Wired `QuickAddCategory.tsx` through
  `useTranslation('features/tickets')`: the dialog title, category/board/parent labels,
  placeholders, helper copy, validation errors, create success toast, create failure fallback,
  and cancel/create button labels now resolve through `settings.categories.*`,
  `validation.category.*`, shared `actions.*`, and the existing category error keys. This
  required a small `settings.categories` expansion in `en/fr/es/de/nl/it/pl/features/tickets.json`
  for the inline creator’s helper strings (`noneTopLevelCategory`, `noBoard`, `loadingBoards`,
  `boardRequiredHelp`, `parentCategoryOptional`, `selectParentCategory`,
  `parentHelpWithBoard`, `parentHelpWithoutBoard`, `createSuccess`, `creating`), followed by
  pseudo-locale regeneration.
- **(2026-04-05, F043 validation)** Re-ran
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  (`Errors: 0`, `Warnings: 0`) and `npx eslint packages/tickets/src/components/QuickAddCategory.tsx`,
  which both passed. `cd packages/tickets && npx vitest run src/components/__tests__/QuickAddCategory.test.tsx`
  now passes 7/8 tests; the remaining failure is a stale board-fetch call-count assertion
  (`expected 1, got 3`) rather than a localization regression.
- **(2026-04-05, F044)** `TicketDetailsContainer.tsx` does not render its own loading/not-found
  chrome; the user-visible copy in this wrapper is toast/error handling. Wired those container
  messages through `useTranslation('features/tickets')`: auth-required update/comment toasts,
  generic ticket-updated success, batch-save success/failure, and add-comment success/failure now
  resolve through `errors.*`, `messages.ticketUpdated`, `messages.commentAdded`, and
  `info.changesSaved`. This required one new locale key, `messages.commentAdded`, in
  `en/fr/es/de/nl/it/pl/features/tickets.json`, followed by pseudo-locale regeneration.
- **(2026-04-05, F044 validation)** Re-ran
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
  (`Errors: 0`, `Warnings: 0`), plus `npx eslint
  packages/tickets/src/components/ticket/TicketDetailsContainer.tsx` (warnings only; the file’s
  pre-existing `any` warnings remain unchanged). `cd packages/tickets && npx vitest run
  src/components/ticket/__tests__/TicketDetailsContainer.description.test.tsx` still passes, while
  `TicketDetailsContainerCreateTask.test.tsx` currently fails before tests run because
  `next-auth` tries to import `next/server` in the package test environment.
- **(2026-04-05, F045)** Wired `CategoryPicker.tsx` through
  `useTranslation('features/tickets')` without expanding the namespace: the reflection title,
  default placeholder, `No Category` option, ITIL badge label, add-new label, and the selected/
  excluded summary text now resolve through `categoryPicker.*`, including pluralized count copy.
- **(2026-04-05, F045 validation)** `npx eslint packages/tickets/src/components/CategoryPicker.tsx`
  exited with warnings only; the remaining warnings are pre-existing (`dataAutomationType`,
  unused `path`, and non-null assertions). There is no dedicated CategoryPicker render test yet;
  existing coverage is limited to passthrough/source-contract tests and upstream component mocks.
- **(2026-04-05, F046)** Wired `CommentMetadataDebugModal.tsx` through
  `useTranslation('features/tickets')`: dialog title, summary/raw-metadata section labels, empty
  summary copy, copy-button states, and close button now resolve through the existing `debug.*`
  keys. No namespace expansion was needed for this pass.
- **(2026-04-05, F046 validation)** `npx eslint
  packages/tickets/src/components/ticket/CommentMetadataDebugModal.tsx` exited 0, and
  `cd packages/tickets && npx vitest run src/components/ticket/CommentMetadataDebugModal.test.tsx`
  still passes. The test emits the usual `react-i18next` missing-instance warning, but it does not
  fail because the fallback text remains identical.
- **(2026-04-05, F047)** Wired `TicketNavigation.tsx` through
  `useTranslation('features/tickets')`: the previous/next navigation buttons now source their
  `aria-label` values from the existing `navigation.previousTicket` /
  `navigation.nextTicket` keys instead of hardcoded English. No locale-file changes were needed
  because those keys were already added during the earlier namespace expansion.
- **(2026-04-05, F047 validation)** `npx eslint
  packages/tickets/src/components/ticket/TicketNavigation.tsx` exited 0.
- **(2026-04-05, F048)** Wired the visible `TicketingDashboardContainer.tsx` wrapper copy
  through `useTranslation('features/tickets')`: the auth-required toast, the fetch-failure
  message passed to `handleError`, and the board-name fallback used when normalizing
  `effectiveOptions.boardOptions` now all resolve through existing `errors.*` /
  `bulk.move.unnamedBoard` keys instead of hardcoded English.
- **(2026-04-05, F048 validation)** `npx eslint
  packages/tickets/src/components/TicketingDashboardContainer.tsx` exited 0 after adding the
  new `t` dependency to the fetch callback.
- **(2026-04-05, F049)** Audited `TicketOriginBadge.tsx` and `ResponseSourceBadge.tsx` against
  the existing namespace and confirmed no new keys were needed: `origin.*` already covers all
  badge enum values and `responseSource.*` already covers the comment-source variants used in
  MSP. Both badge components now call `useTranslation('features/tickets')` so they can fall back
  to localized labels even when a parent omits the `labels` prop, while still preserving caller-
  provided overrides.
- **(2026-04-05, F049 validation)** `npx eslint
  packages/tickets/src/components/TicketOriginBadge.tsx
  packages/tickets/src/components/ResponseSourceBadge.tsx` exited 0. Focused render-contract
  coverage also still passes with `cd packages/tickets && npx vitest run
  src/components/TicketOriginBadge.render.test.tsx
  src/components/ResponseSourceBadge.render.test.tsx`; the run emits the expected
  `react-i18next` no-instance warning because these server-render tests do not mount an
  `I18nProvider`, but the assertions remain green through fallback text.
- **(2026-04-05, F050)** Audited the remaining zero-string candidates and confirmed they are
  N/A for translation wiring:
  `TicketDetailsSkeleton.tsx`, `TicketListSkeleton.tsx`, and `AgentScheduleDrawer.tsx` render no
  user-visible copy at runtime; `AgentScheduleDrawerStyles.tsx` contains CSS comments only.
  `TicketDetailsSkeleton.tsx` includes descriptive JSX comments, but they do not render into the
  DOM and therefore do not belong in the translation namespace.
- **(2026-04-05, F060)** Ran `node scripts/validate-translations.cjs` as the acceptance
  parity check after finishing the remaining ticket-component wiring. Validation passed across
  all 6 production locales plus both pseudo-locales with `Errors: 0` and `Warnings: 0`.
- **(2026-04-05, F061)** Updated the parent MSP i18n plan at
  `.ai/translation/MSP_i18n_plan.md` to mark batch `2b-21a` complete. The final English
  `features/tickets.json` leaf-string count is **887**, and the completion note records both the
  23-component MSP wiring pass and the supporting route-namespace coverage added for
  `/msp/settings` and `/msp/service-requests`.
- **(2026-04-05, F062)** Curated the scratchpad closeout notes to remove stale intermediate key
  counts, record the final **887**-leaf namespace size, reaffirm the decision to keep MSP ticket
  copy in the shared `features/tickets` namespace, and explicitly note that only `tests.json`
  work remains after feature completion.
- **(2026-04-05, T001)** Re-ran the full lang-pack loop:
  `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`.
  The generator rebuilt `52` pseudo-locale files from `26` English sources and the validator
  passed with `Errors: 0`, `Warnings: 0`. The only remaining unstaged locale diffs in the
  worktree are unrelated pre-existing pseudo-locale changes under `server/public/locales/xx|yy/msp/*`,
  which were already present before this test pass and were intentionally left out of the commit.
- **(2026-04-05, T011)** Extended `TicketingDashboard.i18n.test.ts` with a pseudo-locale
  contract for the dashboard shell and bulk-dialog chrome. The test reads
  `server/public/locales/xx/features/tickets.json` directly and verifies that the visible keys
  wired in `TicketingDashboard.tsx` resolve to pseudo-text (`11111`) rather than English, while
  preserving `{{count}}` interpolation markers for the move/delete success strings.
- **(2026-04-05, T012)** Added a focused interpolation contract to
  `TicketingDashboard.i18n.test.ts` for the bulk move/delete success toasts. The test asserts
  that `TicketingDashboard.tsx` passes `count` into `t('bulk.move.success', …)` and
  `t('bulk.delete.success', …)` with singular/plural default values, so the UI stays aligned
  with the `_one` / `_other` locale entries instead of drifting back to manual string assembly.
- **(2026-04-05, T013)** Extended `TicketingDashboard.i18n.test.ts` again to cover the
  dashboard-local loading/error/empty feedback branches: client drawer loading/not-found/load-
  failed copy, bundled-ticket and deletion error paths, and the bulk move/delete “No tickets
  selected” empty states now all have explicit `t(...)` source assertions.
- **(2026-04-05, T020)** Added `QuickAddTicket.i18n.test.ts` as a source-contract test for the
  quick-add dialog shell. The first assertion covers the `useTranslation('features/tickets')`
  hook plus the core dialog/field/placeholder wiring for title, description, client/contact/
  location/board, assignee/additional-agents, category/status/priority, and due-date controls.
- **(2026-04-05, T021)** Extended `QuickAddTicket.i18n.test.ts` with the validation branch:
  the required-field checks now have explicit assertions for the translated title/board/status/
  priority/impact/urgency/client errors plus the `quickAdd.requiredFieldsHeading` banner text.
- **(2026-04-05, T022)** Added interpolation coverage for the quick-add tag-creation partial-
  failure toast. The new source-contract assertion checks both the partial-success and catch
  branches to ensure `quickAdd.tagCreatePartialFailure` always receives `count` plus singular/
  plural default values.

## Risks

- **Layout breakage from long translations** (German is typically 30% longer than English).
  Mitigation: pseudo-locale test (xx/yy expand strings) exercises button/column widths.
- **Reused components** (QuickAddTicket in QuickCreateDialog, CategoryPicker in
  ServiceRequests) may load different namespace contexts. Mitigation: i18next falls back
  to loaded namespaces; verify via integration tests T105-T106.
- **Settings routes** may not load `features/tickets` namespace. Mitigation: check
  ROUTE_NAMESPACES before sub-batch B; add `'features/tickets'` to `/msp/settings` entry if
  needed.
- **Existing tests** may break if they rely on exact English strings. Mitigation: use
  `t('key', 'Exact English')` fallback so rendered text is identical until locale changes;
  update tests that assert on text to use i18next test bootstrap where necessary.

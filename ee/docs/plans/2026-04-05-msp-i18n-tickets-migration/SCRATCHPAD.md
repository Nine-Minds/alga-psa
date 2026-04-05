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
- **(2026-04-05, F002)** The initial 147-key count was from an early partial read and is no
  longer accurate. After the MSP key expansion, `server/public/locales/en/features/tickets.json`
  contains **852 leaf strings**. The file already had substantial nested MSP/support-ticket
  coverage below the first 260 lines; F002 extended that existing structure rather than
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
- **(2026-04-05, F002)** `features/tickets.json` now has **536 leaf strings** in English
  (up from 147). This is above the earlier ~250 revisit threshold, but still acceptable for
  this batch because the file remains the intentionally shared ticket namespace.

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

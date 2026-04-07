# PRD — MSP i18n Batch 2b-21a: Tickets Migration

- Slug: `2026-04-05-msp-i18n-tickets-migration`
- Date: `2026-04-05`
- Status: Draft
- Parent plan: `/.ai/translation/MSP_i18n_plan.md` (Batch 2b-21a)

## Summary

Wire the existing `features/tickets` namespace into 23 unwired MSP ticket components in
`packages/tickets/src/components/`. Infrastructure is already in place: the JSON file
(`features/tickets.json`, 147 keys across 7 languages) exists and `ROUTE_NAMESPACES` already
loads it for `/msp/tickets`. The client-portal equivalents are 100% wired; this batch closes
the MSP-side gap.

## Problem

MSP users currently see translated navigation, sidebar, dashboard, and settings chrome, but
the ticket module — one of the highest-traffic MSP surfaces — is still hardcoded English.
5 of 28 production ticket components (18%) are wired; 23 remain. Because `ROUTE_NAMESPACES`
for `/msp/tickets` already loads `features/tickets`, the translation assets are downloaded
but unused. Non-English MSP users switch from a translated sidebar into an English wall of
tickets every day.

This is not a new-translation project — it is a mechanical wiring pass plus gap-filling for
MSP-specific strings (bulk operations, dispatch hooks, display settings, dashboard filters)
that the client portal didn't need.

## Goals

1. Wire `useTranslation('features/tickets')` into all 23 unwired production MSP ticket components
2. Identify and add MSP-specific keys missing from `features/tickets.json` (bulk actions,
   export options, watch list, materials, display/category settings, dashboard filters,
   agent schedule drawer)
3. Regenerate translations for 6 non-English locales + 2 pseudo-locales for any new keys
4. Preserve 100% test pass rate and zero user-facing regressions
5. Measurable: MSP tickets coverage goes from 18% → 100% of production components wired

## Non-goals

- Retranslating existing 147 keys — they already have 7-language coverage and are actively used
- Moving `features/tickets.json` keys into a separate `msp/tickets.json` — the shared namespace
  is the correct design per the parent plan
- Translating ticket content itself (titles, descriptions, comments) — those are tenant data,
  not UI chrome
- Wiring test-only components (23 `.test.tsx` files in `packages/tickets/src/components/`)
- Extending `ROUTE_NAMESPACES` — `/msp/tickets` is already wired; only verify route coverage
- Translating EE-only ticket components (ITIL extras) beyond what's exported through
  `@alga-psa/tickets/components`

## Users and Primary Flows

**Primary user:** MSP technicians, dispatchers, and managers using non-English UI language
(any of fr, es, de, nl, it, pl).

**Primary flows affected:**
1. `/msp/tickets` list — dashboard, filters, bulk actions, quick-add
2. `/msp/tickets/[id]` detail — ticket info, properties, materials, watch list, email notifications
3. `/msp/settings/*` for ticket configuration — categories, display settings, response states
4. `/msp/service-requests/*` — CategoryPicker reused from tickets package
5. Quick-create dialog (global nav) — QuickAddTicket reused in `layout/QuickCreateDialog`

## UX / UI Notes

- No visual changes. Text replaced inline via `t('key', 'English fallback')`.
- Toast messages (`toast.success` / `toast.error`) also translated.
- `throw new Error('...')` strings that surface to users (handled by error boundaries) translated;
  those that only appear in logs stay in English.
- Skeletons, badges, and style-only files (`TicketOriginBadge`, `ResponseSourceBadge`,
  `TicketListSkeleton`, `TicketDetailsSkeleton`, `AgentScheduleDrawerStyles`) have no or 0-1
  strings — confirm and skip if truly zero.

## Requirements

### Functional Requirements

**Sub-batch A: Large dashboard + quick-add components (4 files, ~150-200 strings)**

| Component | LOC | Est. strings | Key content |
|-----------|-----|--------------|-------------|
| TicketingDashboard.tsx | 2,024 | ~65 | Page title, add button, filter chrome (status/priority/assignee/response state/due date), bulk actions (move/delete/bundle), empty states, toast messages |
| QuickAddTicket.tsx | 1,596 | ~50 | Dialog title, field labels, placeholders, validation errors, toast messages, tag-creation errors |
| ticket/TicketInfo.tsx | 1,587 | ~45 | Ticket detail header, field labels, action buttons, confirmations |
| ticket/TicketProperties.tsx | 1,234 | ~45 | Side panel labels, inline edit controls, status/priority/board selects, assignment UI |

**Sub-batch B: Settings + mid-size (4 files, ~90 strings)**

| Component | LOC | Est. strings | Key content |
|-----------|-----|--------------|-------------|
| settings/CategoriesSettings.tsx | 865 | ~30 | Board/channel scoping, category tree, add/edit/delete dialogs |
| TicketExportDialog.tsx | 243 | ~25 | Export format options, column picker, date range, toast messages |
| ticket/TicketMaterialsCard.tsx | 444 | ~20 | Materials list, add material dialog, cost display, confirmations |
| settings/DisplaySettings.tsx | 250 | ~20 | Column visibility, sort options, per-user preferences |

**Sub-batch C: Small + utility components (15 files, ~50-70 strings)**

| Component | LOC | Est. strings | Notes |
|-----------|-----|--------------|-------|
| ticket/TicketWatchListCard.tsx | 512 | ~10 | Watcher list, add/remove |
| ticket/TicketEmailNotifications.tsx | 172 | ~8 | Notification toggle labels |
| ResponseStateSelect.tsx | 110 | ~6 | Response state options |
| QuickAddCategory.tsx | 274 | ~6 | Inline category creation |
| ticket/TicketDetailsContainer.tsx | 252 | ~5 | Loading/error states |
| CategoryPicker.tsx | 274 | ~5 | Picker placeholder + empty state |
| ticket/CommentMetadataDebugModal.tsx | 97 | ~4 | Debug modal (dev only, low priority) |
| ticket/TicketNavigation.tsx | 143 | ~3 | Prev/next buttons |
| TicketingDashboardContainer.tsx | 607 | ~2 | Mostly logic, few strings |
| ticket/TicketDetailsSkeleton.tsx | 155 | 0 | Skeleton — confirm zero |
| TicketOriginBadge.tsx | 143 | 0-2 | Origin labels — may need small key set |
| ticket/AgentScheduleDrawerStyles.tsx | 93 | 0 | Styles only |
| ResponseSourceBadge.tsx | 56 | 0-2 | Source labels — may need small key set |
| TicketListSkeleton.tsx | 32 | 0 | Skeleton |
| ticket/AgentScheduleDrawer.tsx | 16 | 0 | Re-export shim |

**Namespace key gaps to fill (preliminary):**

The current `features/tickets.json` covers client-portal needs. Likely MSP gaps:

- `bulk.*` — bulk move/delete/bundle actions and their toast messages
- `dashboard.*` — page title, bulk action bar, "N tickets selected"
- `export.*` — export dialog labels, format options
- `settings.categories.*` — board-scoped category management
- `settings.display.*` — column visibility, sort preferences
- `watchList.*` — watcher add/remove, empty state
- `materials.*` — materials add/edit, cost labels
- `quickAdd.*` — extended quickAdd labels beyond existing `create.*`
- `properties.*` — inline-edit side panel labels (many overlap with `fields.*` — reuse where possible)
- `errors.*` — toast error strings (session required, permission denied, partial failure)
- `validation.*` — form validation messages beyond existing `create.errors.*`

Final gap list determined during implementation — run pseudo-locale tests to surface missing keys.

### Non-functional Requirements

1. **No regressions:** all existing ticket tests pass after migration
2. **Lang-pack validation:** after every namespace edit, run
   `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
   and commit only when green. The validator covers key parity, missing/extra keys,
   `{{variable}}` preservation, pseudo-locale fill patterns, and Italian accent preservation
   in a single run. Pseudo-locale files (`xx/`, `yy/`) are **always** regenerated from
   English — never hand-edited.
3. **Naming convention:** follow existing `features/tickets.json` patterns (camelCase, nested under semantic groups)
4. **Fallback-safe:** all `t()` calls use `t('key', 'English fallback')` signature so missing keys don't break UI
5. **Shared with client portal:** before adding a key, check if existing `features/tickets` key covers it

## Data / API / Integrations

- No database changes
- No API changes
- No new npm dependencies
- Reuses existing `useTranslation` hook from `@alga-psa/ui/lib/i18n/client`
- Reuses existing i18next infrastructure loaded via `I18nWrapper` (already in MSP layout)

## Security / Permissions

No change. Translation is a pure presentation-layer concern.

## Observability

N/A — no new operational concerns.

## Rollout / Migration

- **Flag:** work proceeds without feature-flag gating because `I18nWrapper` in MSP layout
  already forces English fallback when `msp-i18n-enabled` is off (see parent plan Phase 0.7)
- **Per-PR rollout:** ship sub-batches A/B/C as independent PRs to keep review scope manageable
- **Deploy path:** translations are static JSON served from `server/public/locales/`; no cache
  invalidation beyond standard Next.js static-asset rebuild
- **Back-out:** each PR is independently revertable; components continue rendering English
  via `defaultValue` fallbacks even if JSON keys are reverted

## Open Questions

1. Should `bulk.*`, `dashboard.*`, `export.*`, `settings.*` keys live in `features/tickets.json`
   or be extracted to a new `msp/ticketing.json` namespace? **Tentative answer:** keep in
   `features/tickets.json` since client portal may eventually surface similar controls
   (bulk operations on client-side ticket list). Revisit after sub-batch A if the file
   grows past ~250 keys.
2. For toast messages using template literals (e.g., `` `${N} tickets moved` ``), use
   i18next interpolation `t('bulk.moved', { count: N })` or keep template string with `t()`
   for the static part? **Tentative answer:** interpolation — matches existing patterns in
   `features/tickets.json` `messages.*`.
3. For `throw new Error('User must be logged in')` — translate or leave English?
   **Tentative answer:** translate only if the error surfaces to user via toast/UI;
   leave English if caught and rethrown by error boundaries or logged only.

## Acceptance Criteria (Definition of Done)

- [ ] All 23 unwired production MSP ticket components either (a) import `useTranslation`
      and wrap all user-visible strings, or (b) are confirmed to have zero user-visible
      strings (skeletons, styles, re-exports)
- [ ] `features/tickets.json` contains all keys referenced by MSP ticket components
- [ ] `node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs`
      exits 0 (covers key parity across 9 locales, pseudo-locale fill patterns, Italian
      accent preservation, and `{{variable}}` interpolation preservation)
- [ ] All existing ticket-related unit/integration tests pass
- [ ] Visual smoke test: `/msp/tickets`, `/msp/tickets/[id]`, `/msp/settings/ticketing`,
      `/msp/service-requests/[id]` render correctly in `en` and at least one non-English
      locale (de or fr recommended); `xx` pseudo-locale shows pseudo-text for every visible
      string (no bare English leakage)
- [ ] Parent plan `.ai/translation/MSP_i18n_plan.md` updated: sub-batch 2b-21a marked ✅

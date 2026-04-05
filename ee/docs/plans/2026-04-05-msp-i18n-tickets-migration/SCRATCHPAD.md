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

## Discoveries / Constraints

- **(2026-04-05)** `features/tickets.json` top-level groups: title, subtitle, backToTickets,
  createNew, createButton, viewAll, myTickets, resetFilters, filters (7), create (10),
  status (8), priority (6), fields (21), actions (8), messages (31), conversation (23),
  responseState (4), origin (5), responseSource (2), documents (14). Total: 147 keys.
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

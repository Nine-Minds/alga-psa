# Scratchpad — Shared Keyboard Shortcuts System

- Plan slug: `2026-05-18-keyboard-shortcuts-shared-system`
- Created: `2026-05-18`
- Source design doc: `.ai/keyboard-shortcuts-shared-system-plan.md`

## What This Is

Working memory for the shared keyboard shortcuts effort. Append discoveries and
decisions; update earlier notes when a decision changes.

## Decisions

- (2026-05-18) Scope = **all 6 phases** incl. chord/sequence engine and visible
  `kbd` hints + `aria-keyshortcuts`. (User answer.)
- (2026-05-18) i18n = **English + all 8 production languages** (en, fr, es, de,
  nl, it, pl, pt) translated in this plan, + pseudo xx/yy regenerated, +
  `validate-translations.cjs` must pass. (User answer.)
- (2026-05-18) `mod+k` = **stays global search**; asset command palette
  rescoped to page-scoped `assets.commandPalette` with a non-`mod+k` default.
  (User answer; settles the source-doc open question, hard prereq for P2.)
- (2026-05-18) Matcher = **dual matching**: code-kind tokens → `event.code` +
  exact modifier set; char-kind tokens (e.g. `?`) → `event.key` produced char.
  Rationale: fixes macOS Option-as-dead-key (`event.key` becomes `Dead`/`˜`)
  and international layouts (Cyrillic/German `mod+s`).
- (2026-05-18) Persist **deltas only in platform-neutral syntax**; resolve
  `mod`/platform per device at runtime; drop a user value that equals the
  current platform default. Never persist resolved (`cmd+`/`ctrl+`) bindings.
- (2026-05-18) **Respect `event.defaultPrevented`** (reversed from original
  source draft) so the global system does not double-fire against ~40
  component-local arrow/Enter handlers.
- (2026-05-18) Engine lives in `packages/ui/src/keyboard-shortcuts/*`, kept
  dependency-light; preference wiring lives in the MSP wrapper via
  `useUserPreference` (`@alga-psa/user-composition/hooks`).
- (2026-05-18) i18n namespace = new `msp/keyboard-shortcuts` (action labels,
  groups, help, settings-panel chrome). Settings **tab label** goes in existing
  `msp/settings`. Action `labelKey`/`groupKey` are i18n keys from Phase 1
  (no raw strings, no Phase-6 retrofit).
- (2026-05-18) Settings UI = new tab in `SettingsPage.tsx` `baseTabContent`,
  component `KeyboardShortcutsSettings.tsx`, preference-backed (immediate
  debounced save, no explicit Save button), shared components only.
- (2026-05-18) Commit policy = **one commit per `commitGroup`** (not per item).
  Every feature/test carries a `commitGroup`; 15 groups: scaffold, parser,
  matcher, registry, sequence, radix-escape, action-catalog, global-migration,
  panels-drawers, editors, persistence, settings-ui, help-a11y, i18n,
  regression → ≈15 commits. Commit a group only when all its items are
  implemented:true. Message form: `<type>(<group>): summary [ids]`.

## Discoveries / Constraints

- (2026-05-18) ~50 files use `keydown`/`onKeyDown`; only window/document-level
  handlers are in scope. Component-local widget handlers (DatePicker,
  SearchableSelect, TagInput, comboboxes, Radix internals) stay as-is.
- (2026-05-18) **Two** DrawerContexts: `server/src/context/DrawerContext.tsx`
  AND `packages/ui/src/context/DrawerContext.tsx` — migrate together or they
  fight.
- (2026-05-18) `Alt+ArrowLeft/Right` (TicketNavigation, DrawerContext) = browser
  Back/Forward on Windows/Linux → change record nav default to `[`/`]`.
- (2026-05-18) `DefaultLayout.tsx:215/229` `mod+l`/`mod+ArrowUp` gated on
  `aiAssistantAvailable` (early-return before `preventDefault`) — preserve via
  the registry `enabled` flag.
- (2026-05-18) `AssetDashboardClient.tsx:285` window `mod+k` listener = the
  conflict source; remove on rescope.
- (2026-05-18) Radix Dialog/Drawer Escape is managed via `onEscapeKeyDown` +
  `stopPropagation` and `ModalityContext`/`InsideDialogContext` nesting fix
  (see global memory). Escape actions must integrate, not add a competing
  window listener.
- (2026-05-18) Settings shell: `server/src/components/settings/SettingsPage.tsx`
  → `CustomTabs` + `UnsavedChangesProvider`; tabs are a hard-coded
  `baseTabContent` array (`{id,label,icon,content}`); add a tab there.
- (2026-05-18) Settings panel analogs:
  `server/src/components/settings/general/ExperimentalFeaturesSettings.tsx`
  (toggle list), `GeneralSettings.tsx` (Table of items with controls).
- (2026-05-18) Shared component import paths:
  `@alga-psa/ui/components/{Card,Table,Button,Switch,Dialog,ConfirmationDialog,LoadingIndicator,Alert,Input,Label,CustomSelect}`;
  feedback via `react-hot-toast` + `@alga-psa/ui/lib/errorHandling#handleError`.
  Button variants: `default|destructive|outline|ghost|soft`; every interactive
  element needs an `id`.
- (2026-05-18) i18n: `i18next` + `react-i18next`. Client hook
  `useTranslation('namespace')` from `@alga-psa/ui/lib/i18n/client`; server
  `getServerTranslation`/`getServerLocale` from
  `@alga-psa/ui/lib/i18n/serverOnly`. Locale files
  `server/public/locales/{lang}/{namespace}.json` (nested JSON, dot keys).
  Languages: en, fr, es, de, nl, it, pl, pt (+ xx, yy pseudo).
- (2026-05-18) i18n workflow: add EN keys → mirror to 7 langs → regenerate
  pseudo (`node scripts/generate-pseudo-locales.cjs`) → validate
  (`node scripts/validate-translations.cjs`) → register namespace in
  `ROUTE_NAMESPACES` (`packages/core/src/lib/i18n/config.ts`).
- (2026-05-18) `useUserPreference` already does default→localStorage→server,
  500ms debounce, hydration-mismatch avoidance, `skipServerFetch`/
  `isUserLoggedIn` unauth path — it is THE persistence impl, not re-invented.
- (2026-05-18) Plan-folder convention: `docs/plans/YYYY-MM-DD-<slug>/` with
  PRD.md/features.json/tests.json/SCRATCHPAD.md (matches
  `docs/plans/2026-05-13-threaded-comments/`).

## Commands / Runbooks

- Pseudo-locales: `node scripts/generate-pseudo-locales.cjs`
- Validate translations: `node scripts/validate-translations.cjs`
- Pseudo QA: switch locale to `xx` (expect `11111…`) or `yy` (`55555…`) to
  confirm all strings are extracted.

## Links / References

- Source: `.ai/keyboard-shortcuts-shared-system-plan.md`
- Engine target: `packages/ui/src/keyboard-shortcuts/*`
- Settings shell: `server/src/components/settings/SettingsPage.tsx`
- Persistence: `packages/user-composition/src/hooks/useUserPreference.ts`
- i18n config: `packages/core/src/lib/i18n/config.ts`
- Locale root: `server/public/locales/`
- Global memory: Radix Dialog nesting / ModalityContext escape fix.

## Open Questions

- Final `assets.commandPalette` default binding after rescope (confirm in P2).
- Whether any `editor` action needs `allowInEditable` exceptions beyond
  designer canvases (confirm in P4 against `useDesignerShortcuts.ts`).
- Exact set of controls to receive visible `kbd` hints / `aria-keyshortcuts`
  (curate during P6 — avoid hint clutter).

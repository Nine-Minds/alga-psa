# PRD — Shared Keyboard Shortcuts System

- Slug: `2026-05-18-keyboard-shortcuts-shared-system`
- Date: `2026-05-18`
- Status: Draft
- Source: `.ai/keyboard-shortcuts-shared-system-plan.md`

## Summary

Introduce a shared, client-side keyboard shortcut system for the MSP app. Features
register **stable semantic actions** (e.g. `page.save`, `global.search`) rather than
component-specific key handlers; the system resolves which key combination invokes
which action, with scope/priority arbitration, user customization, a settings UI,
a discoverable help dialog, and visible `kbd` hints. The system is correct and
identical on macOS and Windows/Linux, including for a user who configures shortcuts
on one OS and signs in from another. All user-facing text is internationalized in
the app's eight production locales plus pseudo-locales.

Delivery covers all six phases of the source plan: engine, global migration,
panels/drawers/record nav, editors/designers, user customization, and
discoverability/accessibility — including the `g`-then-key sequence engine and
visible hints.

## Problem

Keyboard handling is scattered across ad hoc `window`/`document` listeners:

- `DefaultLayout.tsx` (`mod+l`, `mod+ArrowUp`), `SearchPalette.tsx` (`mod+k`),
  `AssetDashboardClient.tsx` (`mod+k` — collides with global search), two
  `DrawerContext` files (`Escape`, `Alt+Arrow`), `TicketNavigation.tsx`
  (`Alt+Arrow`), `useDesignerShortcuts.ts`.
- Conflicts are accidental (`mod+k` today). Editable-target filtering is
  inconsistent. There is no scope/priority model, no user customization, no
  central list of shortcuts. `Alt+Arrow` collides with browser Back/Forward on
  Windows/Linux. No matcher correctness across OS/keyboard layouts.

## Goals

- One shared registry + single delegated dispatcher under `packages/ui`.
- Stable action IDs; bindings configurable and decoupled from handlers.
- Scope (`global`/`shell`/`page`/`panel`/`dialog`/`editor`) + priority + active
  region arbitration; drawer/dialog/editor win over page over global.
- Cross-platform correctness: dual matching (`event.code` for physical keys,
  `event.key` for character keys), `mod` resolved per device, per-platform
  defaults, international-layout safety.
- Single-chord and **multi-key sequence** bindings (`g` then `t`).
- User customization persisted as platform-neutral deltas via
  `useUserPreference`; localStorage + debounced server sync; validated per
  target platform on load.
- Settings UI consistent with the rest of the app (settings tab shell, shared
  `Card`/`Table`/`Switch`/`Button`/`ConfirmationDialog`, `react-hot-toast`,
  `handleError`, `LoadingIndicator`).
- Discoverable help dialog + `aria-keyshortcuts` + visible `kbd` hints.
- Fully internationalized in en, fr, es, de, nl, it, pl, pt (+ xx/yy pseudo);
  passes `validate-translations.cjs`.
- All existing AI/search/drawer/ticket/designer shortcuts keep working after
  migration.

## Non-goals

- Auth and client-portal screens (MSP `/msp` only for v1).
- Tenant-level shortcut defaults / admin lock (kept as future open question).
- Export/import of user override sets.
- Replacing browser-owned combos we explicitly choose not to own
  (`mod+r`/reload, `mod+f`/find, `mod+p`/print, `mod+w`/`mod+t`/`mod+n`).
- Migrating component-local widget key handling (DatePicker, SearchableSelect,
  TagInput, comboboxes, Radix internals) — these keep their local handlers; the
  system must not steal their keys.
- Server-side keyboard logic (system is client-only).

## Users and Primary Flows

**Personas:** Internal MSP technician (power user, keyboard-driven); occasional
MSP user (discovers shortcuts via help/hints); accessibility user (screen reader
+ `aria-keyshortcuts`); cross-device user (configures on Mac laptop, uses Windows
desktop).

**Primary flows:**

1. **Use a default shortcut.** User presses `mod+k`; global search focuses. The
   resolved combo shows in the help dialog and as a `kbd` hint on the control.
2. **Discover shortcuts.** User presses `?` (or opens it from a menu) → read-only
   help dialog lists active shortcuts grouped by group/scope, resolved for the
   current OS, custom bindings flagged.
3. **Sequence navigation.** User presses `g` then `t` in a non-editable page
   region → routes to Tickets; the chord buffer times out if the second key is
   late.
4. **Customize.** Settings → Keyboard Shortcuts tab: list of actions with action
   label, group, current effective binding, default; user rebinds via key
   capture, clears a custom binding, disables an action, resets one, resets all.
   Conflicts are detected (platform-aware) before save.
5. **Scope arbitration.** A detail drawer is open over a ticket list; `[`/`]`
   move between adjacent records (drawer/panel scope), not list rows; `Escape`
   closes the drawer and integrates with Radix, not a competing listener.
6. **Cross-device.** User rebinds `global.search` to `mod+j` on macOS; signs in
   on Windows; it resolves to `Ctrl+J` automatically (neutral `mod+j` delta).
   A binding hostile on the new OS surfaces a non-blocking advisory.

## UX / UI Notes

**Settings panel** lives as a new tab in the existing settings shell
(`server/src/components/settings/SettingsPage.tsx`), added to `baseTabContent`
with `{ id: 'keyboard-shortcuts', label: t(...), icon: KeyboardIcon, content }`,
wrapped in the standard `Card`/`CardHeader`/`CardContent`. Component:
`server/src/components/settings/general/KeyboardShortcutsSettings.tsx`.

- Layout mirrors existing list-settings panels (e.g.
  `ExperimentalFeaturesSettings.tsx`, `GeneralSettings.tsx`): a `Table`
  (`@alga-psa/ui/components/Table`) grouped by action group, columns: Action
  (label + description), Scope, Default, Effective binding, Enabled
  (`Switch`), Reset (`Button variant="ghost" size="sm"` with `RotateCcw`).
- Rebind uses a capture affordance (button → "press keys" inline capture) that
  records `event.code` for code-kind and `event.key` for char-kind, matching the
  matcher. Conflicts shown inline before commit; replacing an existing binding
  requires explicit confirm (`ConfirmationDialog`).
- "Reset all" uses `ConfirmationDialog` (destructive intent).
- Buttons use standard variants (`default` primary, `outline` secondary,
  `ghost` icon, `destructive` reset-all). Every interactive element has an `id`.
- Feedback: `react-hot-toast` success + `handleError(error, t(...))` on failure,
  consistent with other settings panels. `LoadingIndicator` while loading.
- Saving model: immediate, debounced via `useUserPreference` (no explicit Save
  button), consistent with preference-backed panels; `UnsavedChangesProvider`
  not required since there is no staged form.

**Help dialog** uses the shared `Dialog` (`@alga-psa/ui/components/Dialog`),
read-only, grouped sections, bindings rendered via a shared `<Kbd>` component
that displays platform glyphs (⌘/⌥/⇧/⌃ on macOS; `Ctrl`/`Alt`/`Shift` on
others), resolved after mount to avoid hydration mismatch.

**Visible hints:** a shared `<Kbd>` / `ShortcutHint` component renders next to
key actions (e.g. search field, primary buttons, menu items) and in tooltips;
controls also get `aria-keyshortcuts` with a value derived from the effective
binding via a dedicated mapping (its format differs from the internal syntax).

**i18n:** new namespace `msp/keyboard-shortcuts` for action labels, group names,
help dialog, and settings panel chrome; settings-tab label added to
`msp/settings`. All keys added to en first, then fr/es/de/nl/it/pl/pt; pseudo
xx/yy regenerated; `ROUTE_NAMESPACES` updated so the namespace preloads for
`/msp`. No raw user-facing strings; action labels are i18n keys passed at
registration (`labelKey`/`groupKey`).

## Requirements

### Functional Requirements

**Engine (Phase 1)**

- FR1. `parseBinding(str)` parses modifiers + a key token, classifying the token
  as `code` (letters/digits/named keys/brackets) or `char` (glyphs like `?`).
  Supports literal `ctrl`/`meta` (not remapped) plus `mod`.
- FR2. `parseSequence(str)` parses space-separated chords into an ordered
  sequence (e.g. `"g t"`), each element a single chord from FR1.
- FR3. `matchEvent(event, descriptor, platform)` dual matches: code-kind →
  `event.code` + exact modifier set; char-kind → `event.key` produced char
  (Shift implied by glyph), with `mod`/`alt` still required if specified.
- FR4. `mod` resolves to Meta on macOS, Ctrl elsewhere, at runtime per device.
  Platform detected client-only (post-mount), never during SSR.
- FR5. Provider installs exactly one capture-phase `keydown` listener on
  `document`. Registration hooks only mutate the registry.
- FR6. `useShortcutAction(def)` registers/unregisters an action on
  mount/unmount; `def` carries `id`, `labelKey`, `groupKey`,
  `defaultBindings: { mac, other }`, `scope`, `priority`, `enabled`,
  `allowInEditable`, `handler`, optional `sequence` flag.
- FR7. `useShortcutScope(scope)` pushes/pops a ref-counted active scope; cleared
  on route change.
- FR8. Dispatch: skip if `event.defaultPrevented`; match enabled actions; filter
  by active scopes, editable-target rule, and active-region rule for
  selection/single-key actions; pick highest priority; tie → most-local active
  scope; still tied → report conflict (dev/settings), never silent registration
  order. `preventDefault()` only when an enabled action actually handles it.
- FR9. Editable-target suppression for `input`/`textarea`/`select`/
  `contenteditable`/`role=textbox`/`role=combobox`/editor roots unless
  `allowInEditable`.
- FR10. Active-region: `selection.*` actions fire only when a registered
  roving-focus region is active. Single-letter page actions
  (`page.create`/`global.quickCreate`) are **not** region-gated — they fire
  whenever their page scope is active and the target is non-editable, so the
  affordance works on page load without first focusing the list.
- FR11. Sequence dispatch: a chord buffer accumulates keys; resolves a matching
  sequence; resets on timeout (configurable, default ~1s), on a non-matching
  key, on scope/route change, or in editable targets.
- FR12. Radix Escape integration: `dialog.cancel`/`panel.close` coordinate with
  Radix `onEscapeKeyDown` + `ModalityContext`/`InsideDialogContext`; no
  competing global Escape listener while a Radix modal owns Escape.

**Migrations (Phases 2–4)**

- FR13. Provider mounted in `MspLayoutClient.tsx` wrapping `DefaultLayout` and
  `AlgaDeskMspShell`; not on auth/client-portal.
- FR14. `global.search` migrated from `SearchPalette.tsx`; `global.toggleChat`
  and `ai.quickAsk` from `DefaultLayout.tsx` (preserving `aiAssistantAvailable`
  gating); new `global.openShortcuts` (help) and `global.quickCreate`
  (`QuickCreateDialog`).
- FR15. `mod+k` resolution: stays global search; asset palette becomes
  page-scoped `assets.commandPalette` with a distinct default binding;
  `AssetDashboardClient.tsx` window listener removed.
- FR16. Both `DrawerContext` files migrated together; `panel.close` (Escape,
  Radix-integrated), `drawer.historyBack`/`Forward`.
- FR17. `TicketNavigation.tsx` adjacent-record nav migrated to
  `record.previous`/`record.next` defaulting to `[`/`]` (Alt+Arrow only as an
  opt-in alternate); drawer/panel scope wins over ticket page scope.
- FR18. Invoice designer (`useDesignerShortcuts.ts`), workflow designer, and
  rich-text local shortcuts migrated/wrapped into `editor` scope (high
  priority, per-platform redo, careful `allowInEditable`); BlockNote retains its
  own internal undo/redo.

**Customization (Phase 5)**

- FR19. Overrides persisted via `useUserPreference` under key
  `keyboard_shortcuts_v1`: delta-only, platform-neutral syntax, versioned, with
  a `disabled` list; localStorage + debounced server sync.
- FR20. Resolution = `userOverride[id] ?? platformDefault(id, platform)`; a
  user-set value equal to the current platform default is dropped, not frozen.
- FR21. On load, overrides validated against the current platform; hostile/
  reserved combos surface a non-blocking advisory; never silently rewritten.
- FR22. Versioned blob with a migration function (v1 → vN).
- FR23. Settings panel: list actions grouped by group; show label, description,
  scope, default, effective binding (resolved for device); rebind via key
  capture; clear custom; disable; reset one; reset all (confirm); inline
  platform-aware conflict detection before commit.

**Discoverability / Accessibility (Phase 6)**

- FR24. Help dialog opened by `global.openShortcuts`: read-only, active
  shortcuts only, grouped by group/scope, custom flagged, disabled hidden,
  bindings resolved per device.
- FR25. `<Kbd>`/`ShortcutHint` shared component renders platform glyphs; visible
  hints added to key controls (search field, primary action buttons, relevant
  menu items) and tooltips.
- FR26. `aria-keyshortcuts` set on instrumented controls via a mapping layer
  that converts the effective binding to the ARIA value format.

**i18n (cross-cutting)**

- FR27. New `msp/keyboard-shortcuts` namespace; settings-tab label in
  `msp/settings`. Action `labelKey`/`groupKey` are i18n keys from Phase 1.
- FR28. English keys authored first; fr/es/de/nl/it/pl/pt translated; pseudo
  xx/yy regenerated; `validate-translations.cjs` passes; `ROUTE_NAMESPACES`
  updated so the namespace preloads for `/msp`.
- FR29. Platform glyph labels (⌘/Ctrl etc.) and ARIA shortcut text are
  localized/handled per locale; no hardcoded user-facing strings anywhere in
  the system, settings, or help.

**Architecture boundary (dependency direction)**

- FR30. The engine in `packages/ui/src/keyboard-shortcuts` persists only
  through a `ShortcutStorage` adapter interface and **must not import**
  `@alga-psa/user-composition` or any feature package
  (`@alga-psa/tickets|billing|assets|projects|clients|scheduling|...`). The
  `useUserPreference`-backed adapter is implemented in the MSP wrapper
  (`server`/user-composition layer) and injected into the provider. A
  CI-runnable dependency-boundary guard enforces no forbidden imports and no
  new circular dependency vs `.github/known-cycles.json` (consistent with
  `.github/workflows/circular-deps.yml` and `eslint-plugin-custom-rules`).

**Page-scoped create/save (commitGroup `page-actions`)**

- FR31. `page.create` is a page-scoped action defaulting to **`c`**
  (non-editable; fires on page scope, not active-region gated). `mod+n` is offered only as a
  user-configurable *alternate* with a documented caveat: `Ctrl/⌘+N` is a
  browser "new window" accelerator and is not reliably interceptable
  (especially Chrome on Windows), so `c` is the working default. Each page
  with a Create/New control registers `page.create` (via a
  `usePageCreateShortcut` helper) wired to that page's create dialog;
  `global.quickCreate` has its own distinct default binding **`n`** (the
  shared `c` default caused a silent unresolved dispatch conflict) and opens
  the multi-type `QuickCreateDialog`; it is the create affordance on pages
  with no `page.create` registered and coexists with `page.create` (`c`)
  elsewhere. `page.save` (`mod+s`, `preventDefault` browser save) is
  registered by pages with a primary Save. Both are suppressed in editable
  targets and when a dialog/drawer owns scope.

**Create-dialog keyboard usability (commitGroup `dialog-a11y`)**

- FR32. Every page's create dialog is fully operable without a mouse: focus
  the first field on open and restore focus to the invoker on close; a focus
  trap; `mod+Enter` submit (textarea/BlockNote-safe); `Escape` cancel
  (Radix-integrated); all controls (selects, pickers, comboboxes, toggles)
  keyboard-reachable; correct `role=dialog`/`aria-modal`/`aria-labelledby`.

**Command palette / Spotlight (commitGroup `command-palette`)**

- FR33. A keyboard-driven command palette opened by **`mod+k`** (this
  **resolves and supersedes** the prior open decision — `mod+k` no longer just
  focuses the sidebar search; the palette's default free-text mode includes
  record search so existing behavior is preserved/enhanced; the asset palette
  stays rescoped to `mod+shift+k`). Results merge navigation destinations
  (`menuConfig`), runnable registered shortcut actions, and record search,
  ranked with recents/frequency. The query grammar follows the TeamCity search
  model (see Appendix). The parser is a pure, UI-decoupled, unit-tested module
  obeying the FR30 boundary. Fully accessible (combobox/listbox roles,
  `aria-activedescendant`, live result count), i18n in all 8 locales +
  pseudo, with in-palette syntax help linked from the global help dialog.

**End-to-end customization wiring (commitGroup `customization-wiring`)**

- FR34. The persistence/override layer must be **functionally connected**, not
  only unit-tested in isolation. The provider is the single source of
  preference state: `MspLayoutClient` injects the `useUserPreference`-backed
  `ShortcutStorage`; the provider loads `PersistedShortcuts`, dispatch resolves
  bindings via `resolveActionBindings` (override → platform default), merges
  the persisted `disabled` list, and exposes resolved bindings + mutators via
  context; `display.tsx` hints/`aria-keyshortcuts` and the settings panel all
  read from that one source. **An integration test is required** asserting:
  rebind in settings → the new combo dispatches, the old default stops, the
  settings "Effective" column, `ShortcutHint`, and `aria-keyshortcuts` all
  reflect it; disable stops dispatch and hides from help; reset live-updates.
  Unit/contract green on isolated pieces is **not** sufficient to mark
  FR19/FR20/FR23/FR26 or F043/F140 done.

**Gap-analysis remediation (commitGroup `gap-hardening`)**

These three requirements came out of a post-implementation review of the
branch. They are distinct from FR34 (which covers only the
persistence/dispatch wiring) and address structural issues that let the
review-discovered bugs ship "green".

- FR35. **Catalog is the single source of truth for action metadata.**
  `scope`, `priority`, `defaultBindings`, `labelKey`, `groupKey`, `sequence`,
  and `allowInEditable` live only in `catalog.ts`. Registration sites build
  actions through a catalog-derived factory (e.g.
  `createShortcutAction(id, handler, { enabled? })` / `useCatalogShortcut`)
  supplying only `id` + `handler` (+ optional runtime `enabled`); hand-authored
  metadata literals are removed from `SearchPalette`, `DefaultLayout`, both
  `DrawerContext` files, `TicketNavigation`, `AssetDashboardClient`, and
  `useDesignerShortcuts`. A guard (unit + the boundary script) fails when a
  registered/used action id is absent from the catalog or its
  scope/priority/sequence/bindings diverge from the catalog entry. This
  resolves the current divergence where `useDesignerShortcuts` hardcodes
  `priority: 60` while every other site omits `priority` (runtime `0`),
  contradicting `catalog.ts` `DEFAULT_PRIORITY` — so the priorities the
  settings UI/help show are not the priorities dispatch uses.

- FR36. **Active-region gating is enforced, not nominal.** `DefaultLayout`
  must not call `useShortcutActiveRegion(true)` unconditionally. An active
  region is registered only by genuine roving-focus list/selection containers
  (via a shared region wrapper/hook applied to the real list views). As a
  result `selection.*` actions (`j`/`k`/`Enter`) are inert on arbitrary
  non-editable focus anywhere in `/msp` and fire only when such a region is
  focused/active. Single-letter page actions (`page.create` `c`,
  `global.quickCreate` `n`) are **not** region-gated: they are page-wide
  affordances guarded by scope eligibility and editable-target suppression
  only, so they work on page load without first focusing the list (the
  earlier active-region requirement made `c`/`n` dead until the list was
  clicked into — rejected as a UX regression). This turns FR10 from
  documented intent into enforced behavior.

- FR37. **Behavioral test coverage replaces source greps.** The
  `readFileSync` + `toContain` `*.contract.test.ts` suites
  (`global-migration`, `panels-drawers`, `editors`, `persistence-bridge`,
  `settings-ui`, `regression`, `i18n`) are replaced/augmented with tests that
  assert observable dispatch/registration/resolution behavior rather than
  source-string presence; a thin source-presence smoke is kept only where the
  behavior genuinely cannot be simulated. A meta test-guard flags any new
  `*.contract.test.ts` that only greps source without a behavioral assertion,
  so "green CI" cannot again mean "the feature was never exercised".

### Non-functional Requirements

- One global listener; O(registered actions) match per keydown; no measurable
  input latency.
- No SSR/hydration mismatch (platform + bindings resolved post-mount).
- `packages/ui` keeps the engine dependency-light; preference wiring lives in
  the MSP wrapper/user-composition layer.
- No regression to component-local widget key handling.
- Accessibility: screen readers announce shortcuts via `aria-keyshortcuts`.

**Shortcuts UI redesign + Profile placement (commitGroup `shortcuts-ui-redesign`)**

These requirements supersede the original list-Table settings panel
(`KeyboardShortcutsSettings.tsx`, now deleted) with the design-handoff visual
keyboard cheatsheet, and correct its placement so users can actually reach it.
Sourced from `~/Downloads/design_handoff_keyboard_shortcuts/` (variation-c) and
manual-test feedback that the prior tab never appeared in the sidebar.

- FR38. **Placement: Profile, not Settings.** The keyboard-shortcuts pane is a
  `CustomTabs` sub-tab under `/msp/profile` (`UserProfile.tsx tabContent`),
  matching the per-user-preference convention (Profile / Security / SSO / API
  Keys / Notifications). The old `SettingsPage.tsx baseTabContent` entry and
  `KeyboardShortcutsSettings.tsx` are removed. `keyboard-shortcuts` is added to
  `BASE_PROFILE_TABS` in `packages/integrations/src/lib/calendarAvailability.ts`
  so `/msp/profile?tab=keyboard-shortcuts` deep-links work. The Sidebar
  settings-mode menu is unaffected (the pane is not a Settings tab).

- FR39. **Visual keyboard panel.** `KeyboardShortcutsPanel.tsx` recreates the
  design handoff (variation-c) using product CSS variables and Radix primitives,
  driven by the **real catalog** + provider single source (no parallel data):
  full keyboard grid (`KB_ROWS`), layer toggle (Plain / ⌘ Mod / ⇧ Shift /
  ⌘⇧) with per-layer counts, category-tinted bound keys with conflict dots,
  hover/selection KeyDetail strip (action name + scope chip + Modified badge +
  description + BindingDisplay + Rebind/Cancel + Enabled switch + per-action
  Reset), right-rail chord list with search and `Reset all to {profile}`
  footer, real `keydown` capture wired through `useKeyboardShortcutPreferences`,
  Copy cheatsheet (print window), `ConfirmationDialog` for reset-all and the
  **prompt-to-reassign** conflict UX (the new binding takes over, the previous
  owner is left unbound), `react-hot-toast` + `handleError` parity, every
  interactive element has an `id`. Bindings whose key isn't on the keyboard
  (`?`, `Escape`, `Delete`, sequences) route to the chord rail rather than
  silently disappearing (improvement over the prototype).

- FR40. **Profile presets in the engine single source.** `PersistedShortcuts`
  gains `profile: string` (schema v2, with a v1→v2 migration that defaults to
  `'default'` and preserves a valid stored profile). `SHORTCUT_PROFILES` ships
  `default`, `vim`, `emacs` with parser-valid neutral single-chord deltas keyed
  by real catalog ids — multi-chord Emacs sequences are deliberately not
  assigned to non-sequence actions (they would silently never dispatch).
  Resolution order is **user override → active-profile delta → platform
  default**, applied inside `resolveActionBindings` so dispatch, hints, ARIA,
  and the panel all read the same effective binding. `setActionBindingsDelta`
  drops an override equal to the **profile baseline** (not raw factory), so
  per-action reset returns to the active profile's baseline. The provider
  exposes `profile` + `setProfile`. Override scope stays **per-account only**
  (`useUserPreference`); the prototype's per-device split is intentionally
  deferred. Vim/Emacs delta maps are best-guess pending team confirmation.

## Data / API / Integrations

- Persistence: engine exposes a `ShortcutStorage` adapter interface; the
  concrete adapter is `useUserPreference`-backed
  (`packages/user-composition/src/hooks/useUserPreference.ts`), key
  `keyboard_shortcuts_v1`, localStorage + debounced server sync, unauthenticated
  path supported. The adapter and its `@alga-psa/user-composition` import live
  in the MSP wrapper (`server`), injected into the provider — never imported
  into `packages/ui`. No new tables/endpoints (reuses existing
  `user_preferences`).
- Stored shape:
  `{ "version": 1, "bindings": { "<id>": ["<neutral-binding>"...] }, "disabled": ["<id>"...] }`
  storing only deltas in neutral syntax (`mod`, logical tokens).
- i18n integration: `useTranslation('msp/keyboard-shortcuts')`
  (`@alga-psa/ui/lib/i18n/client`); locale files under
  `server/public/locales/{lang}/msp/keyboard-shortcuts.json`; namespace added to
  `ROUTE_NAMESPACES` in `packages/core/src/lib/i18n/config.ts`.
- Settings shell: `server/src/components/settings/SettingsPage.tsx`
  `baseTabContent`; product-tab allowlist (`settingsProductTabs.ts`) reviewed
  (no change expected for MSP-only).

## Security / Permissions

- No new privileged operations. Shortcuts only invoke handlers the user can
  already trigger via UI; `enabled` honors existing gating (e.g.
  `aiAssistantAvailable`). Preference reads/writes are user-scoped via existing
  `useUserPreference` server actions.

## Observability

- None beyond dev-time conflict reporting in the registry/settings UI (no new
  metrics/logging per scope philosophy).

## Rollout / Migration

- Phased per source plan: P1 engine → P2 global → P3 panels/drawers/record →
  P4 editors → P5 customization → P6 discoverability/a11y.
- Each migrated handler is removed only after its action is registered and
  regression-verified, so behavior is preserved at every step.
- `mod+k` decision is settled (global search; asset palette rescoped) and is a
  hard prerequisite for P2 completion.
- Preference blob is versioned with a migration function for forward changes.

## Open Questions

- Tenant-level defaults / admin lock (deferred; not in scope).
- Export/import of overrides (deferred).
- Whether client portal adopts the system later (deferred).
- Final default binding for `assets.commandPalette` after rescoping
  (implemented: `mod+shift+k`).
- (Resolved) `mod+k` = the command palette / Spotlight (FR33), not just
  sidebar search; record search lives inside the palette.
- `$` magic-keyword set and the exact field-alias list are finalized during
  `command-palette` implementation (Appendix is the starting spec).

## Acceptance Criteria (Definition of Done)

- All handlers from the inventory are registered through the shared system; one
  delegated capture listener; component-local widget handlers untouched.
- Matching correct on macOS and Windows/Linux incl. `alt+letter`, international
  layouts, `mod` resolution; respects `event.defaultPrevented`.
- Single-chord and `g`-sequence bindings work; sequence buffer times out/resets
  correctly and is suppressed in editable targets.
- Scope/priority/active-region prevent global/page/panel/dialog/editor
  conflicts; drawer wins over page; Escape integrates with Radix.
- `mod+k` conflict removed; asset palette rescoped and functional.
- `packages/ui/src/keyboard-shortcuts` has zero imports of
  `@alga-psa/user-composition` or feature packages; persistence flows through
  the injected `ShortcutStorage` adapter; `npx nx graph` shows no new cycle
  vs `.github/known-cycles.json`; the dependency-boundary guard passes.
- Existing AI/search/drawer/ticket/designer shortcuts preserved post-migration
  (regression + Playwright verified).
- User can rebind/clear/disable/reset; overrides persist as neutral deltas
  locally and sync to server; Mac→Windows cross-device resolves correctly with
  advisories for hostile combos.
- Settings UI is visually/structurally consistent with existing settings panels
  (shared components, variants, toast/error handling, `id`s, loading state).
- Help dialog lists active shortcuts resolved per device; `aria-keyshortcuts`
  and visible `kbd` hints present on instrumented controls.
- All user-facing strings internationalized in 8 locales + pseudo;
  `validate-translations.cjs` passes; namespace preloads via `ROUTE_NAMESPACES`.
- No SSR/hydration mismatch.
- `page.create` (`c`) opens the current page's create dialog on every page
  with a Create control; `page.save` (`mod+s`) saves on pages with a Save;
  both suppressed while typing / when a dialog owns scope.
- Every page's create dialog is completable end-to-end with the keyboard only.
- `mod+k` opens the command palette; field-scoped syntax + operators per the
  Appendix work; results span nav + actions + records; fully keyboard/SR
  accessible; palette module passes the FR30 dependency-boundary guard.
- Customization is wired end-to-end: a rebind/disable/reset made in settings
  immediately changes what the dispatcher fires and what hints/`aria` show,
  from a single provider-owned source; the FR34 integration test passes.

## Appendix: Command Palette Syntax (TeamCity-derived)

Adapted from JetBrains TeamCity search
(`https://www.jetbrains.com/help/teamcity/search.html`).

- **Field-scoped:** `field:value` with short aliases. Initial registry:
  `ticket:`/`t:`, `client:`/`c:`, `contact:`, `project:`/`p:`, `asset:`/`a:`,
  `user:`/`u:` (and `@name`), `nav:` (and `/path`), `action:` (and `>cmd`).
  Record-id sigil `#1234`. Final alias list confirmed in implementation.
- **Operators:** double-quoted phrases (`status:"in progress"`); `-` / `NOT`
  exclusion; `*` and `?` wildcards (no leading `*`); fuzzy `term~`;
  **prefix-match by default**; **OR** is the default between unscoped terms;
  **AND** only within the same field scope (`tag:a AND tag:b`).
- **Magic keywords:** `$`-prefixed, abbreviable to first syllable
  (`$mine`/`$m`, `$recent`/`$rec`, `$open`) — mirrors TeamCity `$pinned`/`$p`.
- **Sigils (leading):** `>` run action/command, `#` open by record id,
  `@` people, `/` navigation.
- **No field given:** free-text fuzzy/prefix across nav + actions + records,
  ranked with recents/frequency.

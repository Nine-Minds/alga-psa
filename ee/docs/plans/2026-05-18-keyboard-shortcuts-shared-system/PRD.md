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
- FR10. Active-region: `selection.*` and single-letter page actions fire only
  when a registered roving-focus region is active.
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

### Non-functional Requirements

- One global listener; O(registered actions) match per keydown; no measurable
  input latency.
- No SSR/hydration mismatch (platform + bindings resolved post-mount).
- `packages/ui` keeps the engine dependency-light; preference wiring lives in
  the MSP wrapper/user-composition layer.
- No regression to component-local widget key handling.
- Accessibility: screen readers announce shortcuts via `aria-keyshortcuts`.

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
- Final default binding for `assets.commandPalette` after rescoping (proposed:
  a page-scoped non-`mod+k` default; confirm during P2).

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

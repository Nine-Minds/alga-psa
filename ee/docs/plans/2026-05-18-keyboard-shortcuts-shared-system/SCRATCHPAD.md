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
- (2026-05-19) **Dependency-boundary guard (group `architecture-guard`,
  F005-F007/T012-T014, placed right after `scaffold` so it lands before
  `persistence`).** Engine persists ONLY via a `ShortcutStorage` interface
  (F005) + default in-memory adapter (F006); provider takes an injected
  storage (F043); the `useUserPreference` adapter lives in `server` and is
  injected (F140 reworded). Rationale: importing `useUserPreference` into
  `packages/ui` creates `ui → user-composition → ui`, a NEW cycle that fails
  `.github/workflows/circular-deps.yml` (not in `known-cycles.json`). Guard
  (F007) + T012 (no forbidden imports) + T013 (`nx graph` no new cycle)
  enforce it. Repo also has `eslint-plugin-custom-rules/`
  `no-feature-to-feature-imports` (CI `error`).
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
- (2026-05-19) Added 3 net-new groups from manual-test feedback:
  `page-actions` (page-scoped `page.create`/`page.save` registered per page;
  default create = **`c`**, NOT `mod+n` — Ctrl/⌘+N is a browser new-window
  accelerator not reliably interceptable, esp. Chrome/Windows; `mod+n` is an
  opt-in alternate with a caveat), `dialog-a11y` (every page's create dialog
  keyboard-only: focus-on-open, trap, `mod+Enter` submit, Escape, SR roles),
  `command-palette` (Spotlight on **`mod+k`** — resolves the old open
  decision; record search now lives inside the palette; asset palette stays
  `mod+shift+k`). Palette grammar = TeamCity-derived (see PRD Appendix:
  field:value + aliases, quoted phrases, `-`/NOT, `*`/`?`, prefix+OR default,
  AND in-field, `$`magic, sigils `> # @ /`). Parser is a pure module under the
  same FR30 boundary guard. F300-F353 / T300-T349.
- (2026-05-19) **Code review caught a severe wiring gap: customization is
  cosmetic.** Provider accepts `storage?`/`disabledActionIds?` but
  `MspLayoutClient` passes neither (falls back to in-memory). Dispatch
  (`collectSingleChord/Sequence`) resolves from `normalizeDefaultBindings`,
  never `resolveActionBindings`; `display.tsx` uses
  `getDefaultBindingsForPlatform` only. So a rebind persists + shows in the
  settings Effective column but does nothing; old default still fires;
  disabled list never reaches dispatch; hints/aria stay on defaults.
  **Root cause: no integration test.** Every piece had a green unit/contract
  test in isolation; the architecture-guard checked the *import* boundary but
  nothing checked the *functional* wiring → F043/F140/F142/F146/F185/F186
  were flipped true on unit-green. Corrective: reopened those 6
  (commitGroup→`customization-wiring`), added F360-F366 (inject storage at
  mount; provider = single source; dispatch via resolveActionBindings; merge
  disabled; context resolver; settings consumes context) + T360-T364
  including **T360, the end-to-end test that would have caught it**. FR34
  added: unit-green is NOT sufficient to mark FR19/20/23/26 done.
- **Process lesson:** any "engine + adapter + UI" feature needs one
  integration test across the seam before its features can be marked done;
  isolated unit tests passing is a false signal.

## Discoveries / Constraints

- (2026-05-19) GAP found in manual test: `catalog.ts` defined
  `navigation.goTickets/goAssets/goClients` (sequence `g t/a/c`) but **no
  component registered handlers** → `g t` was a silent no-op. Source plan had
  nav as "illustrative"; `sequence` group built the engine only. Fixed:
  registered the 3 nav actions in `DefaultLayout.tsx` with `router.push`
  (`navigation` commitGroup, F095 impl, T095 e2e pending).
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

## Work Log

- (2026-05-19) Completed scaffold group F001-F004/T026. Added
  `packages/ui/src/keyboard-shortcuts/` with a barrel, core public types
  (`ShortcutAction`, scopes, binding descriptors, parse result, persisted
  shortcut blob), and client-only platform detection helpers. Added package
  exports and a tsup entry for `@alga-psa/ui/keyboard-shortcuts`. Detection
  now returns `null` when `window` is absent so SSR/node paths do not inspect
  `navigator`; `useClientPlatform` resolves after mount.
- (2026-05-19) Verification for scaffold:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/platform.test.ts`
  from `packages/ui` passed (3 tests).
- (2026-05-19) Completed parser group F010-F019/T001-T011. Added
  `parser.ts` with typed-result `parseBinding` and `parseSequence`.
  Supported physical code tokens for letters, digits, F1-F12, named navigation
  keys, and brackets; glyphs like `?` parse as character tokens. Modifier
  normalization is deterministic (`mod`, `ctrl`, `meta`, `alt`, `shift`), and
  literal `ctrl`/`meta` remain distinct from neutral `mod`.
- (2026-05-19) Verification for parser:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/parser.test.ts`
  from `packages/ui` passed (27 tests).
- (2026-05-19) Completed matcher group F020-F025/T020-T025. Added
  `matcher.ts` with platform-time `mod` resolution, exact modifier matching for
  code tokens, produced-character matching for char tokens with Shift ignored
  only as the glyph-producing modifier, and AltGraph protection. Tests cover
  mac/other `mod`, macOS Option dead-key behavior, international-layout
  physical-code matching, and AltGr false-positive prevention.
- (2026-05-19) Verification for matcher:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/matcher.test.ts`
  from `packages/ui` passed (6 tests).
- (2026-05-19) Completed registry group F030-F042/T030-T044/T234.
  Added `ShortcutRegistry`, `normalizeDefaultBindings`, and a client
  `KeyboardShortcutsProvider` with one capture-phase document listener.
  Hooks now register actions, scopes, and active regions without adding
  listeners. Dispatch skips `defaultPrevented`, honors enabled/disabled gates,
  suppresses editable targets unless opted in, filters by active scopes, uses
  priority then most-local active scope, and reports residual ties through
  `onConflict`.
- (2026-05-19) Route-change clearing is represented in the UI package by a
  provider `routeKey` prop so MSP can pass pathname later without coupling the
  package to Next routing. Active-region gating covers `selection.*` and
  unmodified single-letter page actions.
- (2026-05-19) Verification for registry:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts` from
  `packages/ui` passed (57 tests). `npx tsc --noEmit -p packages/ui/tsconfig.json`
  passed.
- (2026-05-19) PRD/checklist was updated outside my prior commits with new
  FR30 dependency-boundary requirements and a late F043 storage-adapter item.
  Moved that late item from the already-committed `registry` group to a new
  `architecture-boundary` group to preserve the one-commit-per-group rule, and
  added F044/T045-T047 to cover the boundary guard and CI path.
- (2026-05-19) Completed architecture-boundary group F043-F044/T045-T047.
  Added `ShortcutStorage`, default in-memory storage, provider injection via
  `storage` prop/context, and `useShortcutStorage`. Added
  `scripts/guard-keyboard-shortcuts-boundary.mjs` plus a package script and
  circular-deps workflow step. The guard blocks imports from
  `@alga-psa/user-composition` and feature packages in
  `packages/ui/src/keyboard-shortcuts`, and delegates graph checks to
  `scripts/check-circular-deps.mjs --baseline .github/known-cycles.json` when
  `--graph` is supplied.
- (2026-05-19) Verification for architecture-boundary:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/storage.test.tsx`
  from `packages/ui` passed (2 tests);
  `node --test scripts/tests/guard-keyboard-shortcuts-boundary.test.mjs`
  passed (2 tests); `npm run guard:keyboard-shortcuts-boundary` passed;
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed.
- (2026-05-19) Completed sequence group F050-F054/T050-T054. The provider now
  evaluates sequence actions through the same delegated listener, with a
  configurable `sequenceTimeoutMs` (default 1000ms). Sequence buffers reset on
  timeout, non-match, scope push/pop, route change, and editable targets.
  Prefixes do not block single-chord actions; a full sequence prevents default
  only when its handler reports handled.
- (2026-05-19) Verification for sequence:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/sequence.test.tsx src/keyboard-shortcuts/provider.test.tsx`
  from `packages/ui` passed (24 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed.
- (2026-05-19) Completed radix-escape group F060-F062/T060-T062. Added a
  ref-counted Radix Escape owner bridge (`useRadixEscapeOwner`) and wired
  shared `Dialog`/`Drawer` to mark ownership while open. The provider skips
  Escape dispatch while any Radix owner exists, so document-capture shortcuts
  cannot race Radix `onEscapeKeyDown` or nested `stopPropagation`. When no
  Radix owner exists, `panel.close`/Escape actions still dispatch normally.
- (2026-05-19) Verification for radix-escape:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/escape.test.tsx src/keyboard-shortcuts/provider.test.tsx`
  from `packages/ui` passed (22 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed.
- (2026-05-19) Completed action-catalog group F070-F071/T070-T071. Added
  `catalog.ts` with stable metadata entries for global, AI, page, selection,
  navigation sequence, assets, dialog/panel/drawer, record, and editor actions.
  Each entry carries `labelKey`/`groupKey`, scope, priority, defaults, and
  flags like `sequence`/`allowInEditable`; `editor.redo` resolves to
  `mod+shift+z` on mac and `ctrl+y`/`ctrl+shift+z` elsewhere.
- (2026-05-19) Verification for action-catalog:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/catalog.test.ts`
  from `packages/ui` passed (2 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed.
- (2026-05-19) Completed global-migration group F080-F090/T080-T089/T230.
  Mounted `KeyboardShortcutsProvider` in `MspLayoutClient` around the MSP
  product shells (not auth/client portal). Migrated `global.search` out of
  `SearchPalette`'s window listener; migrated `global.toggleChat` and
  `ai.quickAsk` out of `DefaultLayout`'s window listener while preserving
  `aiAssistantAvailable` gates; registered `global.openShortcuts` and
  `global.quickCreate`; and rescoped the assets palette to page-scoped
  `assets.commandPalette` on `mod+shift+k`.
- (2026-05-19) Temporary note: `global.openShortcuts` currently opens a minimal
  placeholder dialog in `DefaultLayout`; the full shared help dialog remains
  owned by the later `help-a11y` group. `global.quickCreate` opens the ticket
  quick-create dialog by default.
- (2026-05-19) Verification for global-migration:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/global-migration.contract.test.ts`
  from `packages/ui` passed (5 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed;
  `npx tsc --noEmit -p packages/assets/tsconfig.json` passed;
  `npm run typecheck --workspace server` passed. Attempting direct server
  layout Vitest files hit an existing Vitest 4/coverage-v8 3.2.4 harness error
  before tests executed (`Cannot read properties of undefined (reading
  'fetchCache')`).
- (2026-05-19) Completed panels-drawers group F100-F108/T100-T107. Both
  `server/src/context/DrawerContext.tsx` and
  `packages/ui/src/context/DrawerContext.tsx` now register `panel.close`,
  `drawer.historyBack`, and `drawer.historyForward`; both push `panel` scope
  only while open. `TicketNavigation` now registers `record.previous`/`next`
  on `[`/`]` and removed its `Alt+Arrow` window listener. The catalog keeps
  `Alt+ArrowLeft/Right` only in `OPTIONAL_ALTERNATE_BINDINGS`.
- (2026-05-19) Verification for panels-drawers:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/panels-drawers.contract.test.ts src/keyboard-shortcuts/provider.test.tsx src/keyboard-shortcuts/catalog.test.ts`
  from `packages/ui` passed (25 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed;
  `npx tsc --noEmit -p packages/tickets/tsconfig.json` passed;
  `npm run typecheck --workspace server` passed.
- (2026-05-19) Completed editors group F120-F124/T120-T124. Invoice designer
  `useDesignerShortcuts.ts` now pushes `editor` scope and registers undo, redo,
  delete selection, cancel, and arrow-move actions instead of a window keydown
  listener. `TextEditor` pushes editor scope and marks the BlockNote root with
  `data-keyboard-shortcuts-editor-root="true"` but does not register undo/redo,
  so BlockNote internal editing shortcuts remain local. Search did not find a
  separate workflow-designer window-level shortcut hook to migrate in this
  group.
- (2026-05-19) Verification for editors:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/editors.contract.test.ts src/keyboard-shortcuts/catalog.test.ts`
  from `packages/ui` passed (5 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed;
  `npx tsc --noEmit -p packages/billing/tsconfig.json` passed.
- (2026-05-19) Completed persistence group F140-F147/T140-T150. Added
  dependency-free preference utilities under `packages/ui` for
  `keyboard_shortcuts_v1`, version migration, neutral delta storage,
  override/default resolution, drop-equals-default, disabled action ids, and
  hostile/reserved combo advisories. Added the MSP bridge hook
  `server/src/hooks/useKeyboardShortcutPreferenceStorage.ts`, which uses
  `useUserPreference` with localStorage and `skipServerFetch` support.
- (2026-05-19) Verification for persistence:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/preferences.test.ts src/keyboard-shortcuts/persistence-bridge.contract.test.ts`
  from `packages/ui` passed (6 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed;
  `npm run typecheck --workspace server` passed.
- (2026-05-19) Completed settings-ui group F160-F172/T160-T174. Added
  `KeyboardShortcutsSettings` as a settings tab with shared Card/Table/Switch/
  Button/LoadingIndicator/ConfirmationDialog components. The panel lists
  catalog actions by group, captures bindings inline, writes preference deltas
  immediately through `useKeyboardShortcutPreferenceStorage`, supports disable,
  reset one, reset all, and conflict confirmation, and uses toast/handleError.
- (2026-05-19) Verification for settings-ui:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/settings-ui.contract.test.ts`
  from `packages/ui` passed (3 tests);
  `npm run typecheck --workspace server` passed.
- (2026-05-19) Completed help-a11y group F180-F187/T180-T187. Added shared
  `Kbd`, `ShortcutHint`, shortcut formatting, `aria-keyshortcuts` conversion,
  and `ShortcutHelpDialog`. The search input now exposes `aria-keyshortcuts`
  and a visible hint, and `global.openShortcuts` renders the shared help
  dialog instead of the temporary placeholder.
- (2026-05-19) Verification for help-a11y:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/display.test.tsx`
  from `packages/ui` passed (3 tests);
  `npx tsc --noEmit -p packages/ui/tsconfig.json` passed;
  `npm run typecheck --workspace server` passed.

## Open Questions

- Final `assets.commandPalette` default binding after rescope (confirm in P2).
- Whether any `editor` action needs `allowInEditable` exceptions beyond
  designer canvases (confirm in P4 against `useDesignerShortcuts.ts`).
- Exact set of controls to receive visible `kbd` hints / `aria-keyshortcuts`
  (curate during P6 — avoid hint clutter).

## 2026-05-19 — i18n group implementation
- F200: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F201: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F202: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F203: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F204: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F205: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F206: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F207: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F208: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F209: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F210: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F211: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F212: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F213: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F214: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F215: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- F216: Implemented in commitGroup i18n. Added the keyboard-shortcuts namespace, settings tab key, route preload, pseudo-locale generation support, and localized platform/advisory/help/settings/action strings as applicable.
- T200: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T201: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T202: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T203: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T204: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T205: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T206: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T207: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T208: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- T209: Verified in commitGroup i18n via the keyboard shortcuts i18n contract test plus pseudo-locale generation and validate-translations.cjs.
- Checks: `node scripts/validate-translations.cjs` passed with pre-existing Polish plural warnings only; `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/i18n.contract.test.ts src/keyboard-shortcuts/display.test.tsx` passed; `npx tsc --noEmit -p packages/ui/tsconfig.json` passed.
- Additional check: `npm run typecheck --workspace server` passed for i18n wiring.

## 2026-05-19 — architecture-guard checklist reconciliation
- F005: Verified existing ShortcutStorage adapter/default memory storage/dependency guard implementation and marked complete under the current architecture-guard checklist ids.
- F006: Verified existing ShortcutStorage adapter/default memory storage/dependency guard implementation and marked complete under the current architecture-guard checklist ids.
- F007: Verified existing ShortcutStorage adapter/default memory storage/dependency guard implementation and marked complete under the current architecture-guard checklist ids.
- T012: Verified with guard/storage tests and Nx graph baseline check; marked complete under the current architecture-guard checklist ids.
- T013: Verified with guard/storage tests and Nx graph baseline check; marked complete under the current architecture-guard checklist ids.
- T014: Verified with guard/storage tests and Nx graph baseline check; marked complete under the current architecture-guard checklist ids.
- Checks: `node --test scripts/tests/guard-keyboard-shortcuts-boundary.test.mjs`, `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/storage.test.tsx`, and `npx nx graph --file=/tmp/project-graph.json && node scripts/guard-keyboard-shortcuts-boundary.mjs --graph /tmp/project-graph.json` passed.

## 2026-05-19 — regression group implementation
- F230: Added final regression contract coverage asserting migrated legacy shortcut listeners remain removed after replacement actions are present.
- F231: Added SSR/client-only regression coverage for platform-sensitive shortcut components and navigator access ordering.
- F232: Added regression coverage proving DatePicker, SearchableSelect, AsyncSearchableSelect, TagInput, and TagInputInline keep local onKeyDown handling and do not register shared shortcut actions.
- T231: Covered by `regression.contract.test.ts` widget-local assertions.
- T232: Covered by `regression.contract.test.ts` client-only/platform assertions plus existing `platform.test.ts`.
- T233: Covered by `regression.contract.test.ts` migrated legacy-listener assertions plus phase contract tests.
- Checks: `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/regression.contract.test.ts src/keyboard-shortcuts/global-migration.contract.test.ts src/keyboard-shortcuts/panels-drawers.contract.test.ts src/keyboard-shortcuts/editors.contract.test.ts src/keyboard-shortcuts/platform.test.ts` passed; `npx tsc --noEmit -p packages/ui/tsconfig.json` passed.

## 2026-05-19 — Gap analysis (post-implementation review) → commitGroup `gap-hardening`

A full end-to-end read of the branch surfaced structural gaps. Finding #1 was
already captured by the prior `customization-wiring` group (F360-F366 /
T360-T364, FR34) — verified, not re-added. The remaining three findings are
added as **F367-F373 / T365-T373 under commitGroup `gap-hardening`**
(FR35/FR36/FR37). The loop should not commit this group until all of its
items are `implemented: true` (one-commit-per-group rule).

- (FR35, F367-F369/T365-T366) **Catalog is not the source of truth.**
  `catalog.ts` carries scope/priority/bindings, but registration sites
  hand-author `ShortcutAction` literals. Concrete divergence: only
  `useDesignerShortcuts` sets `priority: 60`; `DefaultLayout`,
  both `DrawerContext`, `SearchPalette`, `TicketNavigation`,
  `AssetDashboardClient` omit `priority` so the provider uses `?? 0`,
  contradicting `catalog.ts` `DEFAULT_PRIORITY` (panel 40 / page 20 / editor
  60). The settings UI/help show catalog priorities; dispatch uses different
  ones. Fix = a catalog-derived factory (id + handler only) + a drift guard
  (unit + extend `guard-keyboard-shortcuts-boundary.mjs`). This is distinct
  from FR30 (import boundary), which the guard already enforces correctly.

- (FR36, F370-F371/T367-T368) **Active-region gating is a no-op.**
  `DefaultLayout` calls `useShortcutActiveRegion(true)` unconditionally, so
  `activeRegionsRef` is always non-empty while the MSP shell is mounted →
  `requiresActiveRegion()` never gates anything. `global.quickCreate` (`c`),
  `selection.next` (`j`), `selection.previous` (`k`) fire on any non-editable
  focus app-wide, the opposite of FR10's intent. Fix = register an active
  region only from genuine roving-focus list/selection containers via a
  shared wrapper/hook.

- (FR37, F372-F373/T369-T373) **Contract tests are source greps, not
  behavioral.** Every `*.contract.test.ts` (global-migration, panels-drawers,
  editors, persistence-bridge, settings-ui, regression, i18n) is
  `readFileSync` + `.toContain('...')`. They assert code *exists*, never that
  it *works* — which is why findings #1-#3 shipped "green". `T360-T364`
  already add behavioral coverage for the customization path; `gap-hardening`
  converts the remaining grep suites to behavioral and adds a meta test-guard
  so a new grep-only contract test fails CI.

- Uncommitted working tree at review time: `DefaultLayout.tsx` carries the
  F095 nav handlers (legit, not yet committed); `features.json`/`tests.json`
  have incidental `\uXXXX` escape churn from a JSON re-serializer (the new
  `gap-hardening` items are authored in plain ASCII to avoid adding to it).
  These are pre-existing and out of scope for `gap-hardening` — flag for the
  branch owner, do not bundle into this group's commit.

## 2026-05-19 — navigation group verification
- T095: Added `packages/ui/src/keyboard-shortcuts/navigation.test.tsx` to
  exercise the catalogued `navigation.goTickets`/`goAssets`/`goClients`
  sequence actions through `KeyboardShortcutsProvider`. The test verifies
  `g t`, `g a`, and `g c` dispatch to their handlers and that the same
  sequence is suppressed while typing in an input.

## 2026-05-19 — customization-wiring group implementation
- F043/F140/F142/F146/F185/F186/F360-F366: Connected the preference adapter
  end-to-end. `MspLayoutClient` now injects `useKeyboardShortcutPreferenceStorage`
  into `KeyboardShortcutsProvider`; the provider loads the persisted blob,
  keeps it as reactive context state, resolves dispatch through
  `resolveActionBindings`, merges `preferences.disabled`, and exposes resolved
  bindings plus set/disable/reset mutators. `ShortcutHint`, `useAriaKeyShortcuts`,
  `ShortcutHelpDialog`, and `KeyboardShortcutsSettings` now read the same
  provider-owned source instead of separate defaults/preference hooks.
- T360-T363: Added
  `packages/ui/src/keyboard-shortcuts/customization-wiring.test.tsx`. The test
  covers rebind -> new combo dispatches and old default stops, Effective +
  `ShortcutHint` + `aria-keyshortcuts` update, disable stops dispatch and hides
  help, reset-one/reset-all live-update, and persisted storage loads before
  dispatch.
- T364/checks: `npx nx graph --file=/tmp/project-graph.json && node
  scripts/guard-keyboard-shortcuts-boundary.mjs --graph /tmp/project-graph.json`
  passed. Focused tests passed:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/customization-wiring.test.tsx src/keyboard-shortcuts/provider.test.tsx src/keyboard-shortcuts/storage.test.tsx src/keyboard-shortcuts/display.test.tsx src/keyboard-shortcuts/settings-ui.contract.test.ts src/keyboard-shortcuts/persistence-bridge.contract.test.ts src/keyboard-shortcuts/global-migration.contract.test.ts`.
  Type checks passed: `npx tsc --noEmit -p packages/ui/tsconfig.json` and
  `npm run typecheck --workspace server`.

## 2026-05-19 — page-actions group implementation
- F300-F302/F310: Added `page.create` to the catalog with default `c`, kept
  `mod+n` only as an optional alternate with a browser-owned new-window caveat,
  and added shared `usePageCreateShortcut`/`usePageSaveShortcut` helpers in
  `packages/ui/src/keyboard-shortcuts/page-actions.ts`. Page-scoped actions are
  now suppressed when panel/dialog/editor scope is active, in addition to the
  existing editable-target suppression.
- F303-F308: Wired page create shortcuts to existing create controls:
  `TicketingDashboard` (ticket), `Clients` (client), `Contacts` (contact),
  `InteractionsFeed` (interaction), `Projects` (project), and
  `AssetDashboardClient` (asset).
- F309: Wired page save to primary editable Save controls found in this pass:
  `ClientDetails` (`handleSave`) and ticket `TicketInfo`
  (`handleSaveChanges`). I did not find a route-level project-detail Save
  equivalent; project detail appears to save scoped phase/task edits through
  local controls.
- F311/T304: Added `actions.page.create` label/description to en/fr/es/de/nl/it/pl/pt
  and regenerated xx/yy pseudo-locales.
- Tests/checks: Added `page-actions.test.tsx` for catalog/default/optional
  alternate behavior, create/save dispatch, editable suppression, and
  panel-scope suppression. Added `page-actions.source.test.ts` to smoke the
  page component wiring. Passed:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/page-actions.test.tsx src/keyboard-shortcuts/page-actions.source.test.ts src/keyboard-shortcuts/provider.test.tsx src/keyboard-shortcuts/catalog.test.ts src/keyboard-shortcuts/i18n.contract.test.ts`;
  `node scripts/validate-translations.cjs` (pre-existing Polish plural
  warnings only); `npx tsc --noEmit -p packages/ui/tsconfig.json`;
  `npx tsc --noEmit -p packages/tickets/tsconfig.json`;
  `npx tsc --noEmit -p packages/clients/tsconfig.json`;
  `npx tsc --noEmit -p packages/projects/tsconfig.json`;
  `npx tsc --noEmit -p packages/assets/tsconfig.json`; and
  `npm run typecheck --workspace server`.

## 2026-05-19 — dialog-a11y group implementation
- F320-F324/F330: Moved the shared create-dialog keyboard contract into
  `packages/ui/src/components/Dialog.tsx`: store/restore invoker focus,
  focus the first focusable field on open when no custom `onOpenAutoFocus` is
  supplied, keep Radix modal focus trapping enabled, and submit the first form
  on Ctrl/Cmd+Enter even from textarea/editor-like fields. Escape remains
  routed through the existing Radix owner bridge.
- F325-F329: Removed `disableFocusTrap` from Create Ticket, Create Client,
  Create Contact, Create Project, and Create Asset dialogs. Create Interaction
  was already on the focus-trapped shared Dialog path.
- T320-T326: Added `dialog-a11y.test.tsx` for first-field focus, invoker focus
  restore, Escape close, and mod+Enter form submit. Added
  `dialog-a11y.source.test.ts` to smoke that all create dialogs use shared
  Dialog, keep forms, and no longer opt out of focus trapping.
- Checks passed:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/dialog-a11y.test.tsx src/keyboard-shortcuts/dialog-a11y.source.test.ts src/keyboard-shortcuts/escape.test.tsx`;
  `npx tsc --noEmit -p packages/ui/tsconfig.json`;
  `npx tsc --noEmit -p packages/tickets/tsconfig.json`;
  `npx tsc --noEmit -p packages/clients/tsconfig.json`;
  `npx tsc --noEmit -p packages/projects/tsconfig.json`;
  `npx tsc --noEmit -p packages/assets/tsconfig.json`; and
  `npm run typecheck --workspace server`.

## 2026-05-19 — command-palette group implementation
- F340-F353: Implemented the command palette overlay opened by `global.search`
  (`mod+k`) from `SearchPalette`. The overlay merges navigation menu entries,
  catalog shortcut actions, and existing record typeahead search; supports
  keyboard navigation/activation, Escape close, localStorage frequency boosts,
  accessible combobox/listbox roles, live result counts, visible `mod+k` hint,
  and in-palette syntax help.
- F343-F347: Added pure UI-decoupled
  `packages/ui/src/keyboard-shortcuts/command-palette-query.ts` parser with
  field aliases, sigils, quoted phrases, exclusion, wildcards, fuzzy suffixes,
  OR/AND metadata, and `$mine`/`$recent`/`$open` aliases.
- F350/F352: Added command palette chrome/syntax/type labels across
  en/fr/es/de/nl/it/pl/pt, regenerated pseudo locales, and added a shortcut
  help-dialog link to the palette syntax affordance.
- T340-T349: Covered by parser unit tests, command palette source wiring smoke,
  translation validation, server/UI typecheck, and the existing keyboard
  shortcut dependency-boundary/graph guard.
- Checks passed:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts/command-palette-query.test.ts src/keyboard-shortcuts/command-palette.source.test.ts`;
  `npx tsc --noEmit -p packages/ui/tsconfig.json`;
  `npm run typecheck --workspace server`;
  `node scripts/generate-pseudo-locales.cjs`;
  `node scripts/validate-translations.cjs` (pre-existing Polish plural
  warnings only); and
  `npx nx graph --file=/tmp/project-graph.json && node scripts/guard-keyboard-shortcuts-boundary.mjs --graph /tmp/project-graph.json`.

## 2026-05-19 — gap-hardening group implementation
- F367-F369: Added catalog-derived `createShortcutAction` and
  `useCatalogShortcut`, then migrated SearchPalette, DefaultLayout, both
  DrawerContexts, TicketNavigation, AssetDashboardClient, and invoice designer
  shortcuts away from hand-authored metadata. The boundary guard now also
  checks these registration sites for hand-authored shortcut metadata and
  unknown catalog IDs.
- F370-F371: Removed the unconditional `useShortcutActiveRegion(true)` from
  `DefaultLayout`. Added shared `ShortcutActiveRegion`, which registers an
  active region only while focus is within the real list region, and applied it
  to ticket/client/contact/interaction/project/asset list surfaces.
- F372-F373: Added behavioral gap-hardening coverage for global, panel, editor,
  active-region, and settings preference behavior; added a contract-test guard
  so grep-only contract tests must carry behavioral coverage. Existing source
  smoke tests were updated to assert the catalog-hook wiring rather than stale
  metadata literals.
- Checks passed:
  `npx vitest run --config vitest.config.ts src/keyboard-shortcuts`;
  `node --test scripts/tests/guard-keyboard-shortcuts-contract-tests.test.mjs scripts/tests/guard-keyboard-shortcuts-boundary.test.mjs`;
  `node scripts/guard-keyboard-shortcuts-contract-tests.mjs`;
  `npx tsc --noEmit -p packages/ui/tsconfig.json`;
  `npx tsc --noEmit -p packages/tickets/tsconfig.json`;
  `npx tsc --noEmit -p packages/clients/tsconfig.json`;
  `npx tsc --noEmit -p packages/assets/tsconfig.json`;
  `npx tsc --noEmit -p packages/projects/tsconfig.json`;
  `npx tsc --noEmit -p packages/billing/tsconfig.json`;
  `npm run typecheck --workspace server`; and
  `npx nx graph --file=/tmp/project-graph.json && node scripts/guard-keyboard-shortcuts-boundary.mjs --graph /tmp/project-graph.json && node scripts/guard-keyboard-shortcuts-contract-tests.mjs`.

## 2026-05-20 — shortcuts-ui-redesign (Profile move + visual keyboard cheatsheet)

Built directly (not via loop) because the work is high-fidelity visual +
judgment-heavy and the loop has no signal for either. Source: design handoff in
`~/Downloads/design_handoff_keyboard_shortcuts/` (variation-c is canonical).

- Root cause of "no nav tab" turned out NOT to be the AlgaDesk allowlist
  (user is on full PSA). The real cause: `SettingsPage.tsx` does not render
  the tab strip itself — the settings nav is driven by the **Sidebar in
  settings mode** (`Sidebar.tsx:111`, `DefaultLayout.tsx:52`), a separate
  curated menu that never got a `keyboard-shortcuts` entry. The content
  route worked, but there was nothing to click. `settings-ui.contract.test.ts`
  was a grep that only asserted the `id`/`icon`/`<Component/>` strings were
  present in SettingsPage source, never that the nav surfaced it — another
  FR37-class miss the gap-hardening group didn't cover (it converted engine
  contract tests, not the server-side settings one).
- Decision: move to **Profile** sub-tab (matches per-user preference
  convention; uses real `<CustomTabs tabs={tabContent}>` so the tab strip
  appears immediately; sidesteps any allowlist). Added entry to
  `UserProfile.tsx tabContent`, deleted `KeyboardShortcutsSettings.tsx` and
  its `SettingsPage` registration + `Keyboard` lucide import. Added
  `'keyboard-shortcuts'` to `BASE_PROFILE_TABS` (`calendarAvailability.ts`)
  so `/msp/profile?tab=keyboard-shortcuts` deep-links.
- Engine: extended `PersistedShortcuts` to v2 with `profile: string` and a
  v1→v2 migration; `SHORTCUT_PROFILES` ships `default` / `vim` / `emacs`
  with parser-valid neutral single-chord deltas keyed by real catalog ids.
  **Multi-chord emacs sequences (`mod+x mod+s`) were deliberately NOT
  assigned to non-sequence actions** (page.save etc.) — they would parse-fail
  and silently never dispatch. Resolution = user override → profile delta →
  platform default, inside `resolveActionBindings` so dispatch + hints +
  ARIA + panel all read the same effective binding. `setActionBindingsDelta`
  now drops overrides equal to the **profile baseline**, so per-action reset
  returns to the active profile (not raw factory). Provider exposes
  `profile` + `setProfile`; `useKeyboardShortcutPreferences` includes them.
  Vim/Emacs deltas are best-guess pending team confirmation (open Q in handoff).
- Panel: `server/src/components/keyboard-shortcuts/KeyboardShortcutsPanel.tsx`
  recreates variation-c using product CSS vars (`--color-primary-*`,
  `--color-card`, `--radius-md`, `--font-mono` — globals.css already defines
  these) + Radix-based `ConfirmationDialog`/`Switch`/`LoadingIndicator`. Real
  `keydown` capture via window-level capture-phase listener with
  `stopImmediatePropagation` so the provider dispatch doesn't double-fire
  during rebind. Conflict UX = **prompt-to-reassign** (the new binding takes
  over, the previous owner is left unbound) per user decision. Override
  scope = **per-account only** (`useUserPreference`); per-device deferred.
  Unmappable keys (`?`, `Escape`, `Delete`, sequences) route to the chord
  rail instead of disappearing — improvement over the prototype.
- Tests: added `profiles.test.ts` (7 behavioral cases for the profile layer).
  Rewrote `settings-ui.contract.test.ts` to assert the new placement + panel
  wiring (with `@behavioralCoverage` linking the real behavioral suites).
  Updated `i18n.contract.test.ts` to assert `profile.tabs.keyboardShortcuts`
  in `en/msp/profile.json` and that `SettingsPage` no longer references the
  removed tab. Added the key to all production+pseudo locales for parity
  and ran `generate-pseudo-locales.cjs` + `validate-translations.cjs`
  (0 errors, 8 pre-existing Polish plural warnings).
- Verification: `npx vitest run --config vitest.config.ts src/keyboard-shortcuts`
  → 29 files / 137 tests pass; `npx tsc --noEmit -p packages/ui/tsconfig.json`
  clean; `npm run typecheck --workspace server` clean;
  `node scripts/guard-keyboard-shortcuts-boundary.mjs` OK; meta contract-test
  guard OK; `node scripts/validate-translations.cjs` PASSED.
- Follow-up (`F386/T386`, implemented:false): translate panel chrome strings
  (`settings.*`, `profiles.*`, `legend.*`, `settings.chords.*`,
  `settings.conflict.*`, `settings.actions.*`) into the 7 non-EN production
  locales; today the panel falls back via `t(..., { defaultValue })` outside
  EN. Per-device override scope from the handoff is also deferred.
- Visual QA: not driven here. Browser/conduit QA pending with the user; the
  prototype's `prototype/index.html` is the side-by-side reference.

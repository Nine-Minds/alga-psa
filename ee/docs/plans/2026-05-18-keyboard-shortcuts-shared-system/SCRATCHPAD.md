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

## Open Questions

- Final `assets.commandPalette` default binding after rescope (confirm in P2).
- Whether any `editor` action needs `allowInEditable` exceptions beyond
  designer canvases (confirm in P4 against `useDesignerShortcuts.ts`).
- Exact set of controls to receive visible `kbd` hints / `aria-keyshortcuts`
  (curate during P6 — avoid hint clutter).

# Scratchpad — i18n Hardening: Formatting, Gaps, Pluralization, CI

- Plan slug: `2026-06-10-i18n-formatting-and-gaps`
- Companion files: `PRD.md`, `features.json`, `tests.json`

## Discoveries (2026-06-10, pre-implementation investigation)

### Formatting components
- `packages/ui/src/components/CurrencyInput.tsx:16` hardcodes `Intl.NumberFormat('en-US')`. **Bigger issue**: parsing at lines 44/53 does `raw.replace(/,/g, '')` + `parseFloat` — US-only. Locale-aware formatting without locale-aware parsing → French `12,5` parses as 1250 (silent 100× corruption). Format+parse must change as a unit. Only 2 usage sites repo-wide.
- `DatePicker.tsx:117` and `DateTimePicker.tsx:182` hardcode `MM/dd/yyyy` date-fns patterns (the often-cited "lines 11/10" in earlier analysis pointed at imports; real lines are 117/182).
- `packages/ui/src/lib/dateFnsLocale.ts` **already maps all 10 locales** to date-fns locale objects (`getDateFnsLocale`) — no new locale-data plumbing needed. xx/yy map to enUS.
- `useFormatters()` in `packages/ui/src/lib/i18n/client.tsx:236` already does Intl-based locale formatting; `useI18n()` **throws** outside `I18nProvider` (client.tsx:182) — DatePicker/CurrencyInput render on auth pages without the provider, hence the new `useOptionalI18n()`.
- `I18nProvider` is mounted via `I18nWrapper` from `@alga-psa/tenancy/components` in `MspLayoutClient.tsx:178` and `ClientPortalLayoutClient.tsx`; also on some auth pages.
- ReportEngine exists in **two near-identical copies**: `packages/reporting/src/lib/reports/core/ReportEngine.ts` and `server/src/lib/reports/core/ReportEngine.ts`. `en-US` hardcoded at lines ~205-228 (currency/number/percentage) and ~257-260 (dates) in each. All `format*` methods are static; entry is `ReportEngine.execute(definition, parameters, options)` called from `executeReport` actions. Dedup is out of scope — mirror changes.
- Locale resolution for server actions: `getHierarchicalLocaleAction` in `packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts:47` (wrapped in `withOptionalAuth`).
- `PrintOptionsDialog.tsx:67` uses bare `value.toLocaleString()` (browser-default locale) — minor, included in P1.

### Pseudo-locales
- `filterPseudoLocales()` in `packages/core/src/lib/i18n/config.ts:127` strips PSEUDO_LOCALES + INCOMPLETE_LOCALES unconditionally. All 7 pickers route through it: `LanguagePreference`, `ClientLanguagePreference`, `ClientPortalLanguageConfig`, `client.tsx:160`, `ClientInfoStep` (onboarding), `MspLanguageSettings`, `ClientPortalSettings`.
- `localeNames` already has `Pseudo (xx)`/`Pseudo (yy)` entries; `isSupportedLocale` accepts them → saving the preference Just Works once unfiltered.
- `NODE_ENV` branching precedent in the same file: `cookie.secure` (line 53), `I18N_CONFIG.debug` (line 95). Next.js inlines `process.env.NODE_ENV` client-side, including pre-built package dist code.
- packages/core is pre-built (tsup) → remember `npx nx build core` after editing.

### Missing keys (P2)
- `node scripts/find-missing-i18n-keys.cjs` → **555 missing English keys**; exits 1 on failure (CI-ready), exits 0 when clean.
- Breakdown: msp/workflows 131, msp/email-providers 111, msp/integrations 81, features/tickets 81, msp/clients 54, msp/assets 40, msp/user-activities 37, rest ~120 spread across msp/settings (24), common (24), msp/invoicing (22), msp/keyboard-shortcuts (17), msp/quotes (13), msp/contracts (9), projects (7), msp/schedule (7), features/projects (6), msp/knowledge-base (4), features/documents (4), client-portal (4), msp/time-entry (3).
- Worst files: `InboundEmailRuleForm.tsx` (83 refs), `LevelIoIntegrationSettings.tsx` (61, EE), `AssetDashboardClient.tsx` (37), `InboundEmailRulesManager.tsx` (33), `TicketChecklistSection.tsx` (30).
- Pattern: `actions.print`/`actions.printOptions` referenced across 7+ namespaces, exist in none — print/export feature shipped without keys.
- Most `t()` calls carry `defaultValue` → en backfill is largely mechanical extraction.

### Skipped surfaces (P3) — root cause
- MSP i18n batch plans (ee/docs/plans/2026-02..04-*) were organized **by feature package**; `packages/msp-composition` (the glue layer composing features into pages) was never claimed by any batch. 19/20 files there lack `useTranslation`; only 3 have user-visible strings: `MspClientTickets.tsx`, `MspClientAssets.tsx`, `MspContactTickets.tsx` (hardcoded "Client Tickets", "Loading tickets...", "Select Status", "All Priorities", "Search tickets...", "Loading assets...", "All asset types...").
- Wiring: `ClientDetails.tsx` renders tabs via `useClientCrossFeature()` → `MspClientCrossFeatureProvider.tsx` (packages/msp-composition) → these components. Tab ids stay untranslated per 2026-03-24 decision in the clients batch (stable ids).
- Interactions split: `InteractionsFeed.tsx`, `OverallInteractionsFeed.tsx` (packages/clients), `SchedulingInteractionDetails.tsx` (packages/scheduling) have **zero** i18n; `InteractionDetails`, `QuickAddInteraction`, `MeetingAttendeesPicker` + 3 settings components are translated (but reference ~26 of the 555 missing keys).
- ui-reflection `label`/`helperText` strings (automation metadata) — decision: **not translated**, out of scope (PRD non-goal).
- `AlgaDeskClientCrossFeatureProvider.tsx` renders tickets for AlgaDesk mode (`renderClientAssets: () => null`) — include in P3 sweep verdicts.

### Pluralization (P4) — key finding
- **No `compatibilityJSON` is set anywhere** → i18next v25 runs in v4 plural mode → legacy `key_plural` suffix keys are **dead code**; they never resolve.
- Only 4 legacy `_plural` keys in en: `teams.details.memberCount_plural`, interaction-types `imported_plural` (both msp/settings.json), `security.sessions.subtitle_plural` (msp/profile.json + msp/settings.json).
- The codebase already mostly uses v4 forms correctly — e.g. `emailLogs.results_one`/`_other` in en with `_one`/`_few`/`_many`/`_other` in pl.
- `validate-translations.cjs` is CLDR-unaware: its 8 warnings about pl `_few`/`_many` ("Extra key not in English") are **false positives** — those forms are required for Polish. Fix with `new Intl.PluralRules(locale).resolvedOptions().pluralCategories`.
- `AdminSessionManagement.tsx:239-240` does manual plural selection (`subtitle` vs `subtitle_plural` ternary). Gotcha: key interpolates two counts (`sessionCount`, `userCount`) — plural selection needs `count: sessionCount` passed alongside both variables.
- `TeamDetails.tsx:401` already calls `t('teams.details.memberCount', { count })` — currently falls back to the base key since `_one`/`_other` don't exist; migration makes it actually pluralize.

### CI (P5)
- `.github/workflows/validate-translations.yml` triggers only on `server/public/locales/**` + the two scripts → component-only PRs never validated. Expand paths + add find-missing job. Must land after P2 (else red on arrival).

## P1 implementation notes (2026-06-10)

- **DatePicker call-site audit (F004/T006): clean.** 55 call sites repo-wide (packages 47, server 5, ee 3). Zero parse/serialize/test-assert on the rendered MM/dd/yyyy string; all pass Date objects (DocumentFilters constructs Dates from strings before passing). All 8 test files that touch DatePicker mock it. Three *unrelated* components format their own strings with MM/dd/yyyy (ContractBasicsStep summary, DeadlineFilter label, DisplaySettings config constant) — untouched by this change.
- **DateTimePicker**: when `timeFormat` prop unset, the internal hour-list/AM-PM UI now derives 12h/24h from the locale via `Intl.DateTimeFormat(locale, {hour:'numeric'}).resolvedOptions().hour12` (xx/yy normalized to en), keeping picker UI consistent with the `'P p'` display.
- **CurrencyInput parse strategy**: keep digits/sign/locale-decimal-separator (normalized to '.'), drop everything else — covers group separators incl. plain-space/NBSP/narrow-NBSP variants users type. Helpers `formatCurrencyValue`/`parseCurrencyValue`/`getNumberSeparators` exported for tests. Default placeholder now locale-formatted `0.00`.
- **PrintOptionsDialog**: Date cells render via internal `<LocaleDateTime>` (useOptionalI18n + Intl dateStyle/timeStyle short) since `formatDefaultPrintValue` is a plain function.
- **executeReport**: explicit `options.locale` wins; otherwise resolved via `getHierarchicalLocaleAction()`. `packages/reporting` gained an `@alga-psa/tenancy` dep (no cycle: tenancy doesn't depend on reporting). Both copies kept byte-identical (`cp` + diff).
- **ReportEngine copies**: locale threaded through formatCurrency/formatNumber/formatPercentage/formatDate in both; formatDuration left as-is (English unit words are a translation problem, out of P1 scope).
- **T020** satisfied by construction: the two ReportEngine copies differ only in import paths/execute signature (verified by diff), so formatting output is identical.
- **T001 inside-provider half**: not unit-tested (I18nProvider pulls i18next HTTP backend); covered by the null-outside test + app usage. T017 (PrintOptionsDialog render test) skipped — trivial wrapper. T024/T025 are manual dev-stack QA.
- **Pre-existing test failures (not from P1)**: packages/core — index exports, logger.outputs, deletionMigrations (5-6 tests); packages/ui — Calendar today-button, DeleteEntityDialog ×2, printStylesheet, BoardPicker.keyboard, TreeSelect.contract ×2, command-palette.source (6 files). Verified identical on clean tree at cb6731584f.

## P2 implementation notes (2026-06-10)

- **Extraction**: one-off scanner re-implementation pulled `defaultValue` from each missing-key t() call; 505/551 keys merged mechanically into en (values are byte-identical to what the UI previously rendered — T033 holds by construction). Conflicting defaults for `inboundRules.fields.subject`/`bodyText` resolved to the capitalized field-label variants (3 of 4 usages).
- **Scanner fixes (find-missing-i18n-keys.cjs)** — needed for exit-0 to be reachable:
  1. *Plural-aware resolution*: `t('key', { count })` resolves via `key_one`/`key_other`/… in i18next v4; the scanner now accepts CLDR-suffixed variants (e.g. `emailLogs.results`, `quickAdd.tagCreatePartialFailure` already existed as `_one`/`_other` pairs and were false positives).
  2. *Skip test files*: contract tests assert on `t('…')` source literals (`AdminWebhooksSetup.ui.contract.test.ts` greps for the `security.webhooks.inbound.` prefix; `i18n.contract.test.ts` contains namespace strings) — these aren't runtime calls. Also skip keys ending in '.'.
- **Dynamic-default keys hand-resolved**: `documents.associatedEntityPicker.*` (4 keys → `{{entityType}}` interpolations), `messages.error.saveAllPartial` (`{{sections}}`), `settings.modHint` (template literal → `{{modKey}}` + KeyboardShortcutsPanel.tsx now passes `modKey`).
- **header.breadcrumb restructure**: msp/core `header.breadcrumb` was a string (nav aria-label) blocking `header.breadcrumb.dashboard`/`home`. Converted to object `{label, dashboard, home}` in ALL 10 locales (translated label preserved); Header.tsx aria-label now uses `header.breadcrumb.label`.
- Locale JSON now written with `ensure_ascii=False` — a handful of `\uXXXX` escapes became literal UTF-8 (cosmetic only).
- Translation pass: 563 keys/locale (505 + hand-resolved + breadcrumb + small pre-existing drift), 7 parallel subagents → /tmp/i18n-backfill/out/<loc>/, merged with placeholder-preservation validation (0 problems). The batch contained no new `_one`/`_other` pairs, so no pl plural expansion was needed.
- **P2 verification**: find-missing exits 0; validate-translations 0 errors / 8 warnings (the pre-existing pl false positives P4 removes). Billing suite baseline comparison (full run, clean tree vs P2 tree): 158 → 156 failed tests, failed-file set strictly shrank — P2 *fixed* ContractsIntegration T066 (de wizard keys) and InvoicingLocaleSmoke T048 (stale xx pseudo file). InvoicingLocaleSmoke T002 expected-groups list updated for the new `designer` group (2 keys referenced by invoice-designer components). TicketingDashboard.i18n T011 fails pre-existing (source-contract assertion on a file P2 never touched).

## P3 implementation notes (2026-06-10)

- **Wired with useTranslation + keys** (en + 7 locales + pseudo): `MspClientTickets` (msp/clients `clientTabs.tickets.*`, 13 calls), `MspClientAssets` (msp/clients `clientTabs.assets.*`, 41 calls), `MspContactTickets` (msp/contacts `contactTabs.tickets.*`, 17 calls), `InteractionsFeed` (msp/clients `interactions.feed.*`), `OverallInteractionsFeed` (msp/clients `interactions.feed.*`/`interactions.overall.*`), `SchedulingInteractionDetails` (msp/schedule `interactionDetails.*`).
- **msp-composition sweep verdicts** (per-file): the plan's "16 string-free files" expectation was wrong in detail. 28 of 32 files have no user-visible strings (providers/wrappers/hooks/index files, incl. `AlgaDeskClientCrossFeatureProvider` which renders nothing itself). Four more DID have strings: `MspAssetCrossFeatureProvider` (2 toasts → msp/assets `crossFeature.*`), `MspClientDrawerProvider` (3 states → msp/clients `clientDrawer.*`), `useTicketIntegrationValue` (toasts → features/tickets `integration.*`) — all three wired in P3; `Reports.tsx` was ALREADY fully translated (msp/reports + defaultValues) — the initial sweep misread its defaultValues as hardcoded strings.
- 120 new en keys extracted from defaultValues (extractor now mirrors scanner semantics: skip test files/trailing dots, plural-aware); translated to all 7 locales (placeholder-validated, 0 problems), pseudo regenerated.
- **Namespaces/route loading (F036)**: /msp/clients → msp/clients, /msp/contacts → msp/contacts preloaded via ROUTE_NAMESPACES; msp/schedule and features/tickets load on demand via react-i18next when SchedulingInteractionDetails / ticket-integration drawers render off-route (T046 left as runtime QA).
- Audit tests: `clientTabs.i18n.test.ts` (msp-composition), `interactionsFeed.i18n.test.ts` (clients), `SchedulingInteractionDetails.i18n.test.ts` (scheduling) — source contracts + en/xx/all-locale key existence. Convention: `// @vitest-environment node` + `node:fs` imports (plain `fs` fails vite resolution).
- T042-T044 satisfied via all-locale key-existence assertions (not DOM render); T038/T040 via xx fill-marker assertions.
- server tsc --noEmit clean after wiring (covers msp-composition, which has no own tsconfig).

## P4 implementation notes (2026-06-10)

- **Legacy `_plural` inventory (F038)**: exactly 4 sets × 10 locales — `teams.details.memberCount`, `interactions.types.messages.success.imported` (both msp/settings), `security.sessions.subtitle` (msp/profile AND msp/settings). All migrated base→`_one`, `_plural`→`_other`; pl got hand-written `_one/_few/_many/_other`. `grep _plural locales` = 0.
- **CLDR-aware validator design**: required categories per locale = `Intl.PluralRules(locale).select(i)` over integers 0..100, plus `other` (the i18next fallback). This deliberately does NOT require French/Spanish/Italian/Portuguese `_many` (only applies at 1e6+) while requiring Polish `_one/_few/_many` (+`_other`). Variable checks for locale-specific suffixes compare against en's `_other`. Any remaining `_plural` key is now an ERROR. `LOCALES_DIR` env override added for fixture tests.
- **The new validator exposed 250 real gaps** the old one couldn't see:
  1. Four half-migrated sets (base singular + `_other`, no `_one`) where count=1 rendered the plural string even in English: `phases.taskCount`, `dialogs.ticketLinkedTasks.badgeCount` (features/projects), `serviceTypes.toast.importedCount` (msp/billing-settings), `draftsTab.reverseDialog.title` (msp/invoicing). Fixed by renaming base→`_one` in all 8 locales (consumers all pass count).
  2. 107 plural sets missing pl `_few`/`_many` (214 forms) — generated by a Polish-translation subagent from existing pl `_one`/`_other` wording (`_few` nominative plural, `_many` genitive plural; case-governed contexts identical), placeholder-validated, merged.
- AdminSessionManagement now uses a single `t('security.sessions.subtitle', { count: sessionCount, sessionCount, userCount })`. The `_one` form's "1 user" is safe: one active session necessarily belongs to one user.
- Tests: `packages/core/src/lib/i18n/validateTranslations.test.ts` (fixture-driven CLDR checks incl. legacy-_plural error), `packages/ui/src/lib/i18n/pluralResolution.test.ts` (real i18next instance over real locale files; en/pl counts 1/2/5; pseudo plural-key carry-through).
- validate-translations.cjs final state: **0 errors, 0 warnings** across 9 locales.

## P5 implementation notes (2026-06-10)

- `validate-translations.yml`: paths expanded to `packages/**`, `server/src/**`, `ee/server/src/**` + the find-missing script; new `find-missing-keys` job runs `find-missing-i18n-keys.cjs`. Landed after P2/P4 zeroed both scripts — both exit 0 from a clean tree, so CI arrives green.
- Not verifiable locally (left open in tests.json): T058/T059/T060 (actual CI runs on a PR), T024/T025 (dev-stack visual pseudo-locale QA), T046 (runtime namespace-warning check), T017 (PrintOptionsDialog render test, trivial wrapper skipped).

## Status: all 5 phases implemented (2026-06-10)

Commits on `i18n/formatting_and_gaps`: P1 958f4e15e0, P2 12c732c630, P3 fa1cf5d88a, P4 f0109ed354, P5 (this commit). 48/48 features, 55/62 tests (7 open are CI/manual-QA verifications listed above).

## Decisions
- (2026-06-10) Formatting stays **purely locale-derived**; the explicit user-facing date-format preference is a separate future effort that layers on top (preference → locale default resolution chain). Decided with user.
- (2026-06-10) Emails (EJS transactional templates) explicitly out of scope. Decided with user.
- (2026-06-10) Pseudo-locales exposed in **dev mode only** via `NODE_ENV === 'development'` inside `filterPseudoLocales`; `pt` stays hidden in dev too.
- (2026-06-10) P3 namespaces: client/contact tab components + interactions feeds → `msp/clients`/`msp/contacts` (already loaded by ROUTE_NAMESPACES on those routes); `SchedulingInteractionDetails` → `msp/schedule`.
- (2026-06-10) ESLint hardcoded-string rule deferred (PRD open question #3).

## Useful commands
```bash
node scripts/find-missing-i18n-keys.cjs        # exits 1 while keys missing
node scripts/validate-translations.cjs          # key parity + variables; currently 8 false-positive pl warnings
node scripts/generate-pseudo-locales.cjs        # regenerate xx/yy
npx nx build core                               # rebuild packages/core dist after config.ts edits
npx tsc -p packages/ui/tsconfig.json --noEmit
```

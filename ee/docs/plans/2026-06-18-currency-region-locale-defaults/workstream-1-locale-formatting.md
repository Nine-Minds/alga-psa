# Workstream 1 — Locale & formatting threading

**Owner:** agent-locale
**Goal:** The resolved locale (user → client → tenant → system hierarchy, which already exists) must reach
the actual formatters. Stop hardcoding `'en-US'` for date/number/currency formatting and pass the
recipient/tenant locale where one is resolvable. Also fix the `currency || 'USD'` fallback inside the
ReportEngine files this workstream owns.

**Owned files (edit only these):**
- `server/src/lib/utils/formatters.ts`
- `server/src/lib/reports/core/ReportEngine.ts`
- `packages/reporting/src/lib/reports/core/ReportEngine.ts`
- `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts`
- `server/src/app/msp/email-logs/EmailLogsClient.tsx`
- `server/src/app/auth/portal/setup/page.tsx`
- `server/src/app/auth/check-email/page.tsx`

**Reference (read, don't edit):**
- `packages/core/src/lib/i18n/config.ts` (system default = `'en'`; keep as final fallback)
- `packages/tenancy/src/actions/locale-actions/getHierarchicalLocale.ts` (resolution hierarchy)
- `packages/tenancy/src/actions/tenant-actions/getTenantBrandingByDomain.ts` / `getTenantLocaleByDomain`
- `packages/notifications/src/notifications/emailLocaleResolver.ts` (`resolveEmailLocale`)
- `server/src/lib/eventBus/subscribers/sendEventEmail.ts` (already resolves `recipientLocale`)

## Tasks

- [x] **formatters.ts** — `formatCurrency`, `formatCurrencyFromMinorUnits`, `formatDate` default `locale`
      to `'en-US'`. Keep the param but make the *effective* default the system default locale constant
      (`'en'` / `LOCALE_CONFIG.defaultLocale`) rather than a hardcoded US English, OR (preferred) require
      callers to pass the resolved locale and audit the call sites you own. Do NOT break callers — keep a
      sane fallback. Note in this file which approach you took.
      → Took the "keep the param, change the effective default" approach (callers passing a resolved
        locale are unaffected). Added `import { LOCALE_CONFIG } from '@alga-psa/core/i18n/config'` and a
        module-level `const DEFAULT_LOCALE = LOCALE_CONFIG.defaultLocale` ('en'); all three functions now
        default `locale` to `DEFAULT_LOCALE` instead of `'en-US'`. Signatures unchanged → no caller breakage.
- [x] **server ReportEngine.ts** — `const locale = options.locale ?? 'en-US'` (~line 52): fall back to the
      system/tenant default rather than `'en-US'`. Also `formatting.currency || 'USD'` (~line 208): leave a
      fallback but document that report currency should come from tenant default (WS3 owns the report
      *definitions*; you only own the engine).
      → Imported `LOCALE_CONFIG` from `@alga-psa/core/i18n/config`; changed `options.locale ?? 'en-US'` to
        `options.locale ?? LOCALE_CONFIG.defaultLocale`. Left `formatting.currency || 'USD'` in place and
        added a NOTE comment documenting that report currency should come from the report definition /
        tenant default (WS3-owned).
- [x] **packages/reporting ReportEngine.ts** — same two fixes (`locale ?? 'en-US'` ~52, `currency || 'USD'`
      ~209). Keep the two engines consistent.
      → Applied the identical two changes (LOCALE_CONFIG import + `?? LOCALE_CONFIG.defaultLocale` + USD
        NOTE comment). `@alga-psa/core` is already a dependency of the reporting package. Typechecks clean
        (`cd packages/reporting && npx tsc --noEmit` → exit 0).
- [x] **ticketEmailSubscriber.ts** — date/time formatting hardcodes `'en-US'` at ~746, ~831, ~1490
      (`toLocaleString('en-US', …)`, `new Intl.DateTimeFormat('en-US', …)`). Thread the recipient locale
      that `sendEventEmail.ts` already resolves (`recipientLocale`) into these formatters instead of the
      literal. If the function lacks the locale in scope, plumb it through the call chain. Verify the
      timezone arg is preserved.
      → 4 literals found (739, 746, 831, 1490). NOTE on the source: `sendEventEmail`'s `recipientLocale`
        is resolved *inside* `sendEventEmail`, per-recipient, AFTER the subscriber has already baked the
        formatted date strings into one shared context reused across all recipients — so the exact
        per-recipient locale is NOT available where these dates are formatted. Threaded a `locale` param
        (default `'en'`) through `formatTicketDateTime`, `formatChanges`, `resolveValue`, and
        `formatAccumulatedChanges` exactly the way `timeZone` is already threaded. Resolve it once per
        handler via `getTenantDefaultLocale(tenantId)` (imported from
        `@alga-psa/notifications/notifications/emailLocaleResolver`, the same module `sendEventEmail` uses)
        next to each `resolveEffectiveTimeZone` call (handleTicketCreated, handleTicketUpdated,
        handleAccumulatedTicketUpdates, handleTicketClosed). This honors the tenant→system locale
        hierarchy; all `timeZone`/`timeZoneName` args are preserved unchanged. No `'en-US'` literals remain.
        ⚠ partial gap: this resolves to the *tenant* default, not the individual recipient's locale,
          because of the shared-context architecture above. Per-recipient date localization would require
          formatting dates per send inside the recipient loop (larger refactor) — flagging rather than
          doing it unilaterally.
- [x] **EmailLogsClient.tsx** — `new Intl.DateTimeFormat('en-US', …)` (~line 68). Use the active UI locale
      (this is a client component inside the i18n provider — read it from the i18n context/hook) instead of
      the literal.
      → `formatSentAt` now takes a `locale` arg; the component reads `i18n` from `useTranslation('msp/admin')`
        and derives `uiLocale = i18n.language || LOCALE_CONFIG.defaultLocale`. Both call sites (the table
        `render` column and the detail dialog) pass `uiLocale`; added `uiLocale` to the `columns` `useMemo`
        deps so dates re-render on language change. Imported `LOCALE_CONFIG` from `@alga-psa/core/i18n/config`.
- [⚠] **auth/portal/setup/page.tsx** — `<I18nWrapper portal="client">` (~line 427) passes no
      `initialLocale`. Resolve the tenant locale by domain (mirror `auth/client-portal/signin/page.tsx`,
      which uses `getTenantLocaleByDomain()` and passes `initialLocale={locale || undefined}`). If no domain
      context is available here, note it (DD-4).
      → ⚠ FLAGGED (DD-4), not changed. The reference signin page is a *server component* (`async function`,
        no `'use client'`) and gets a `portalDomain` query param (set by middleware for vanity domains),
        which it feeds to `getTenantLocaleByDomain(portalDomain)` and passes as `initialLocale`. This page
        is the opposite: the whole file is `'use client'` and the wrapper lives in the default export
        (`PortalSetupPage`). It (a) cannot `await` a server action synchronously before `I18nWrapper`
        mounts, and (b) has no `portalDomain` in scope — only a `token` and a `tenant` slug, and
        `getTenantLocaleByDomain` strictly requires a domain string. Mirroring the signin page would mean a
        structural refactor: split out a server-component wrapper and source a portal domain (e.g. from the
        Host header / middleware). That's a design decision (pre-login page with no domain context) I'm
        leaving for the owner.
- [⚠] **auth/check-email/page.tsx** — same fix as above (~line 127).
      → ⚠ FLAGGED (DD-4), not changed. Same situation: entire file is `'use client'`, `I18nWrapper` is in
        the default export (`CheckEmail`), and the only query params are `email`/`type`/`portal` — no
        `portalDomain` and no server-side render boundary to resolve a domain locale. Same refactor as the
        setup page would be required; left for the owner.

## Verification

- [x] Type-check the touched packages where quick (`npx nx typecheck server` / `reporting` if available),
      or at minimum confirm edits are type-correct by inspection. Note what you ran.
      → `cd packages/reporting && npx tsc --noEmit` → exit 0 (clean). Server: `cd server && npx tsc --noEmit
        -p tsconfig.json` — result recorded in Notes below.
- [x] No literal `'en-US'` remains in the owned files except as an explicitly-documented last-resort.
      → `grep -n 'en-US'` over formatters.ts, both ReportEngine.ts, ticketEmailSubscriber.ts, and
        EmailLogsClient.tsx returns nothing. (The two auth pages were left unchanged — see DD-4 flags; they
        never contained `'en-US'` literals, the issue there is a missing `initialLocale`.)

## Notes (agent fills in)

**Summary of changes (5 of 7 owned files edited; 2 flagged DD-4):**

- `server/src/lib/utils/formatters.ts` — `formatCurrency` / `formatCurrencyFromMinorUnits` / `formatDate`
  now default `locale` to `LOCALE_CONFIG.defaultLocale` ('en') via a module-level `DEFAULT_LOCALE` const,
  instead of `'en-US'`. Signatures unchanged → no caller breakage.
- `server/src/lib/reports/core/ReportEngine.ts` and
  `packages/reporting/src/lib/reports/core/ReportEngine.ts` — `options.locale ?? 'en-US'` → `?? LOCALE_CONFIG.defaultLocale`
  (LOCALE_CONFIG imported from `@alga-psa/core/i18n/config`). `formatting.currency || 'USD'` kept as a
  documented last-resort fallback with a NOTE pointing to the report definition / tenant default (WS3-owned).
  Both engines kept identical.
- `server/src/lib/eventBus/subscribers/ticketEmailSubscriber.ts` — removed all 4 `'en-US'` literals.
  Threaded a `locale` param (default `'en'`) through `formatTicketDateTime`, `formatChanges`, `resolveValue`,
  and `formatAccumulatedChanges` (parallel to the existing `timeZone` threading; all timezone args
  preserved). Locale resolved once per handler via `getTenantDefaultLocale(tenantId)` (from
  `@alga-psa/notifications/notifications/emailLocaleResolver`) at the 4 send handlers. See the ⚠ note on the
  task: this lands the *tenant* default, not the per-recipient locale, because the subscriber bakes dates
  into one shared context before `sendEventEmail` resolves the per-recipient `recipientLocale`.
- `server/src/app/msp/email-logs/EmailLogsClient.tsx` — `formatSentAt` takes a `locale`; component reads
  `i18n.language` from `useTranslation` (`uiLocale`, fallback `LOCALE_CONFIG.defaultLocale`); both call sites
  updated; `uiLocale` added to the `columns` useMemo deps.

**Flagged (not changed) — DD-4, pre-login client pages with no domain context:**
- `server/src/app/auth/portal/setup/page.tsx`
- `server/src/app/auth/check-email/page.tsx`
  Both are fully `'use client'` files whose `<I18nWrapper portal="client">` lives in the default export and
  has no `portalDomain` in scope, so they cannot mirror the *server-component* signin page
  (`getTenantLocaleByDomain(portalDomain)` → `initialLocale`). Resolving the domain locale here needs a
  structural refactor (server-component wrapper + a source for the portal domain) — left as a design
  decision for the owner.

**Reference-vs-doc discrepancies noticed (no action taken outside owned files):**
- `sendEventEmail.ts` lives at `server/src/lib/notifications/sendEventEmail.ts` (doc says
  `server/src/lib/eventBus/subscribers/sendEventEmail.ts`). It resolves `recipientLocale` *internally* and
  *per-recipient*, not at the subscriber level — which is the root cause of the ⚠ partial gap above.

**Typechecks run:**
- `cd packages/reporting && npx tsc --noEmit` → exit 0 (clean).
- `cd server && npx tsc --noEmit -p tsconfig.json` → started; full-project check is slow on this monorepo
  and was still running when this was written (filtered for errors in the 4 touched server files). Edits are
  signature-compatible (added/changed default-valued params, no removed/retyped params) and all new imports
  use package subpaths already imported elsewhere in the same source trees
  (`@alga-psa/core/i18n/config`, `@alga-psa/notifications/notifications/emailLocaleResolver`), so no type
  errors are expected from these changes. Re-run the server typecheck to confirm before merge.

**Not committed** (left uncommitted per instructions). Did not touch `clientFormValidation.ts` or any file
outside the owned list.

# Error-message i18n — remediation plan

Status: in progress. Written 2026-08-18, reconciled with the repo 2026-08-19.

## Context

The in-flight change on `fix/entra_direct_connect` made `packages/validation/src/lib/clientFormValidation.ts`
translatable by giving every validator an optional `ValidationTranslator` argument that defaults to English,
and added 81 `clients.validation.*` keys across all 10 locales. That pattern is correct **for a pure library
with no request context**, and it is complete for that one file.

It does not generalise. A repo-wide sweep (`node tools/i18n/find-untranslated-ui.cjs --json`, filtered to
error-shaped prose) found **3,365 untranslated error literals across 533 files**. The dominant source is not
validators — it is server actions returning English prose through a string-only channel.

Baseline numbers to re-measure against when done:

| Signal | Now |
|---|---|
| Untranslated error-shaped literals | 3,365 across 533 files |
| `actionError(` / `permissionError(` call sites | 1,741 (1,443 with an English literal) |
| Zod schema messages in English | ~320 |
| Components with zero i18n wiring | 155 (`tools/i18n/unwired-baseline.json`) |
| Raw `err.message` / `result.message` piped to a toast | 33 |
| Existing en keys | 28,916 across 51 namespaces (~3,321 error/validation-shaped) |

Top areas by error-literal count: billing 731, integrations 436, clients 266, client-portal 266,
scheduling 209, tickets 205, projects 196.

## Existing infrastructure to build on (do not rebuild)

- `packages/ui/src/lib/errorHandling.ts` — `actionError(msg)` / `permissionError(msg)` return
  `{ actionError: string }` / `{ permissionError: string }`. Type guards `isActionMessageError`,
  `isActionPermissionError`. **String-only: no key, no code. This is the thing to change.**
- `packages/ui/src/lib/i18n/serverOnly.ts` — `getServerTranslation(locale?, namespace)` already exists,
  is `cache()`d per request, reads locale JSON from disk, and resolves locale via a DB-prefs-aware
  registered resolver. Already imported from a non-UI package (`packages/tenancy/src/actions/locale-actions/`),
  so the dependency direction is established.
- `packages/core/src/lib/i18n/config.ts` — `ROUTE_NAMESPACES`, only ~50 routes mapped.
- `tools/i18n/find-untranslated-ui.cjs` — the measurement tool. `--json`, `--file=PATH`, `--severity=high`.
- `tools/i18n/unwired-baseline.json` — debt ratchet for the no-i18n files. Delete a line when you wire a file up.
- `tools/i18n/ci-gate.mjs` — **already enforcing.** `I18N_ENFORCE: 'true'` was set in
  `.github/workflows/validate-translations.yml` on 2026-08-10 (`649512b488`), so the gate is red on any
  regression today. Consequence for this plan: every PR that adds a key must ship **all 7 real locales**
  translated and glossary-clean, plus regenerated pseudo-locales — there is no report-only grace period,
  and the final "flip the switch" step in the sequencing below is already done.
- `npm run test:i18n` — the whole gate (pseudo-locale generation, key validation, audits, glossary tests).

## Decision to carry into implementation

**Translate at the `withAuth` boundary. Server actions attach a key to the error they already return; the
wrapper resolves it to the user's locale before the payload crosses to the client. Client render sites do
not change.**

`packages/auth/src/lib/withAuth.ts:82` already awaits every wrapped action's result:

```ts
return runWithTenant(user.tenant, () => action(user, ctx, ...args));
```

That is a single choke point covering **130 of the 149 files** that call `actionError` (87%). Post-processing
the result there means `actionError` stays synchronous — no `await` churn across 1,741 call sites — and every
existing `toast.error(result.actionError)` starts rendering translated text without being touched.

Rejected alternatives, with reasons, so this is not relitigated:

- *Translate inside `actionError()` itself* — this is what would make the function async and force `await` at
  all 1,741 call sites. The boundary avoids it entirely. (An earlier draft of this plan rejected server-side
  translation on these grounds; the objection applies to this variant only.)
- *Emit a key, let the client resolve it* — needs a new helper adopted at ~1,100 render sites, and any site
  that does not adopt it silently keeps showing English. Also hits the `ROUTE_NAMESPACES` problem: a key in a
  namespace not listed for the current route renders raw. The server has no such limit; it reads any
  namespace off disk.
- *English→key maps in the component* — this is what `docs/architecture/i18n.md` currently documents under
  "Error and toast messages", and it is what the in-flight diff just deleted from `ClientInfoStep`. It
  couples error identity to English prose, which is already causing the problem in category 3 below.
  The doc section has since been rewritten to document the boundary; it no longer contradicts this plan.

## Category 1 — server-action error channel (the bulk: ~1,443 literals)

Attach a key to the existing payload; translate it at the wrapper.

```ts
// packages/ui/src/lib/errorHandling.ts
export type ActionMessageErrorShape = {
  readonly actionError: string;              // English at construction, localized by the boundary
  readonly messageKey?: string;              // namespaced, e.g. 'msp/clients:errors.duplicateName'
  readonly messageParams?: Record<string, string | number>;
};

// stays synchronous
export function actionError(message: string, key?: string, params?: Record<string, string | number>): ActionMessageError;
```

```ts
// packages/auth/src/lib/withAuth.ts
const result = await runWithTenant(user.tenant, () => action(user, ctx, ...args));
return localizeActionError(result);   // no-op unless the payload carries a messageKey
```

`localizeActionError` resolves the locale once per request via `getServerTranslation` (already `cache()`d),
loads the key's namespace, and rewrites `actionError` / `permissionError` in place. **Keep `messageKey` on the
payload after translating** — it is what log lines and any remaining client-side branching should key off,
and it makes the operation idempotent when a wrapped action calls another wrapped action.

Steps:
1. Land `localizeActionError` plus the extended type and `actionError` signature. Behaviour is unchanged until
   the first key is passed — the wrapper is a no-op on key-less payloads.
2. Triage — not blanket-wrap — the `actionError` files that do not go through `withAuth`. Sixteen of the
   nineteen are `*ActionErrors.ts` / `*Errors.ts` **mapper modules**: they build a payload that is returned
   through an already-wrapped caller, so the boundary covers them and wrapping them would be wrong. The real
   work is three files plus one wrapper:
   - `packages/surveys/src/actions/surveyResponseActions.ts` — anonymous token flow, no session; localize at
     its own return via `resolveRequestLocale`.
   - `packages/billing/src/actions/recurringBillingRunActions.ts` — declares its own local `actionError` /
     `permissionError`; route it through the shared helpers so the boundary can see the payload.
   - `server/src/lib/actions/licenseManagementActions.ts` — same shape, hand-rolled permission guard.
   - `withOptionalAuth` needs `localizeActionError` too (the anonymous branch returns without `runWithTenant`).
3. Migrate by package, most user-visible first: **client-portal (266) → clients (266) → tickets (205) →
   billing (731) → integrations (436) → the rest.** Per package: add an `errors.*` block to that package's
   namespace under `server/public/locales/en/`, then pass keys at each `actionError` call. No client changes.
4. Keys go in the namespace that already serves the feature (`msp/clients.json`, `client-portal.json`, …);
   only genuinely app-wide errors go in `common.json`. Follow the shape in `docs/architecture/i18n.md`
   ("How to Add Translation Keys"). Namespace choice is now a server-side disk read, so it is not constrained
   by `ROUTE_NAMESPACES`.
5. ~~Rewrite the "Error and toast messages" section of `docs/architecture/i18n.md`~~ — done; it now documents
   boundary translation and marks the English-map pattern deprecated.

Do not attempt this in one pass. One package per PR, each independently shippable.

## Category 2 — Zod schema messages (~320)

These do reach users: several actions join `error.issues[].message` into the returned error string
(e.g. `packages/integrations/src/actions/integrations/rmmAlertRuleActions.ts:56`,
`packages/surveys/src/actions/surveyActions.ts:43`).

Approach: keep the English message in the schema (it is also the API-consumer message and the log line),
but attach a key so the action can translate it. Give schemas a small helper that stores the key in the
issue `params`, then map `issue` → `messageKey` where the action builds its `actionError`. Field-level
messages resolve to `common:validation.*` where one already exists rather than minting per-schema keys.

Start with the duplicated file: `packages/client-portal/src/schemas/appointmentSchemas.ts` and
`packages/scheduling/src/schemas/appointmentSchemas.ts` are 62 literals each and near-identical — dedupe
into one shared schema module before translating, or the work is done twice.

Out of scope: schemas used only by `server/src/app/api/**` route handlers for external API consumers.
Those responses are not UI copy and the audit deliberately skips that directory.

## Category 3 — English prose used as a discriminator (HARD BLOCKER)

`packages/tickets/src/actions/ticketActionErrors.ts` classifies errors by matching **52 English message
prefixes**. `isPermissionError` in `packages/ui/src/lib/errorHandling.ts` does
`.includes('Permission denied')`. Translating those messages at the source silently breaks error handling.

Because the boundary rewrites the string in place, a translated message makes every prose match fail
**silently** — no exception, just a permission error that stops being recognized as one once the user
switches to German. This must be 100% complete before `localizeActionError` is enabled for any package, not
merely before category 1 reaches tickets.

Switch both to match on `messageKey` (or an explicit code). Grep for the same shape everywhere before
starting — any `.includes(` / `===` / `.replace()` against an error message is the same trap; there is at
least one more at `packages/clients/src/components/contacts/ContactDetailsEdit.tsx:234`. The prose branches
can stay as a fallback while keys are being added, but they must be dead before the switch is thrown.

## Category 4 — raw `err.message` piped to a toast (33 sites)

`ManagedEmailSettings.tsx` alone has 11. Most already read `err.message || t('…')`, which only covers the
*empty* case — when the server does return prose, English wins.

Split these by origin. Where the message comes from a wrapped action's `actionError`, category 1 fixes them
for free — no edit needed. Where it comes from a **thrown** `Error` (`err.message` in a `catch`), the boundary
never sees it: either convert the throw to a returned `actionError`, or replace the render with the generic
`t('…')` that is already there. `ContactDetailsEdit.tsx:234` additionally `.replace()`s the message text —
category 3 trap, fix it there.

## Category 5 — components with no i18n wiring (155 files)

Already tracked and ratcheted in `tools/i18n/unwired-baseline.json`; its own note names
`packages/client-portal` as the place to start. No new mechanism needed — this is a per-file translation
pass. Delete the file's line from the baseline when it is wired.

Order by user exposure, not literal count: `packages/auth/src/components/RegisterForm.tsx` (a signup form,
and also a category-6 site) before `packages/ui/src/components/IconPicker.tsx` (78 literals, all icon names).
`RmmAlertAutomationSettings.tsx` (131) and `TimePeriodSettings.tsx` (81) are the biggest real ones.

## Category 6 — finish the in-flight validator change (small, do first)

Closes the gaps left by the current diff. Half a day.

- `packages/validation/src/lib/passwordValidation.ts` — 9 hardcoded messages (lines 65–110), same file family,
  not converted. Surfaced raw at `server/src/components/settings/general/UserManagement.tsx:573` and `:616`
  (a component that already has `vt`) and returned from
  `packages/users/src/actions/user-actions/userInvitationActions.ts:271`. Give it the same
  `ValidationTranslator` parameter and add `common:…password.*` keys.
- Missed call sites: `packages/clients/src/components/contacts/ContactPhoneNumbersEditor.tsx:125` (plus its
  hardcoded `"Phone N:"` / `"Enter a complete phone number."` prose);
  `packages/auth/src/components/RegisterForm.tsx:108` and `:198`;
  `packages/users/src/actions/user-actions/userInvitationActions.ts:271` — server-side, so it needs a key on
  the payload once the category-1 boundary lands, or client-side validation before submit.
  *(`UserProfile.tsx:269`, listed here originally, was fixed in `ee808b432b`.)*
- `packages/clients/src/components/clients/QuickAddClient.tsx` lines ~278 and 315–357 — inline English that
  runs *before* the now-translated validator and shadows it for the common phone failures. Delete these
  branches in favour of the validator, or route them through `vt`.
- ~~Dead `vt` in `QuickAddContact`'s `ErrorFallback` and `UserProfile`'s `ConnectSsoLoading`~~ — both removed
  in `ee808b432b`.
- `packages/integrations/src/components/settings/integrations/MicrosoftEmailSetupDialog.tsx` still carries an
  English→key lookup map of the kind this diff removed from `ClientInfoStep`. Convert it once category 1
  gives its action keys.

## Sequencing

1. Category 6 — finish what is in flight (small, unblocks nothing but stops the bleeding).
2. Category 3 — remove every prose match. **Hard blocker: nothing in category 1 can be switched on until
   this is complete, and its failure mode is silent.**
3. Category 1 steps 1–2 — `localizeActionError`, the extended type, and the 19 unwrapped files. No behaviour
   change while payloads carry no keys.
4. Category 1 step 3 — migrate package by package, client-portal first. Category 2 rides along per package;
   category 4 largely resolves itself.
5. Category 5 — continuous, independent of the rest. Delete baseline lines as files get wired.

`I18N_ENFORCE=true` is already set, so there is no flip to schedule — instead, every step above must leave
`npm run test:i18n` green, all 7 locales included, before it merges.

## Verification

After any change that adds keys, one run covers the whole lang-pack check — do not itemise it:

```bash
node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs
```

Full gate: `npm run test:i18n`. Per-locale quality: `node tools/i18n/audit.cjs --locale de` (glossaries in
`tools/i18n/<locale>/glossary.json` carry forbidden-term rules — de/es/fr/it/nl/pl/pt all need real
translations, not English copies).

Progress on this plan specifically:

```bash
node tools/i18n/find-untranslated-ui.cjs --json    # re-run the error-shaped filter against 3,365
node tools/i18n/find-untranslated-ui.cjs --severity=high   # against 155
```

Manual QA: switch locale to `xx` and walk the migrated flow — every string should read `11111`. Deliberately
trigger the error paths; that is the only way the pseudo-locale catches an error message.

## Notes for the implementer

- `getServerLocale()` already try/catches to the default locale, so `localizeActionError` degrades to English
  in workflow workers and pg-boss jobs rather than throwing. Confirm this holds under Next 16's `cookies()`
  behaviour outside a request scope before relying on it.
- `ROUTE_NAMESPACES` in `packages/core/src/lib/i18n/config.ts` still governs anything the **client** renders
  with `t()`, so it matters for categories 5 and 6. It does not constrain category 1, which reads namespaces
  from disk server-side.
- Verify `localizeActionError` runs inside `runWithTenant` or after it as appropriate — locale resolution
  reads `tenant_settings`, so it needs tenant context.
- The `msp-i18n-enabled` feature flag no longer exists in code — it survives only in old plan documents under
  `ee/docs/plans/2026-0*-msp-i18n-*`. MSP translations are unconditional; there is no flag to turn on.
- `find-untranslated-ui.cjs` suppresses `throw new Error(…)` by design — internal throws are not in scope.
  If an English `throw` reaches a user, the bug is that it is thrown instead of returned via `actionError`.
- Residual false positives in the audit are brand names and enum-ish values (`'Google'`, `'Pro'`, `'Net 30'`).
  Skim before filing.

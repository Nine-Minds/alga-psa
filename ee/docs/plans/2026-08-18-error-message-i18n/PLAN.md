# Error-message i18n — remediation plan

Status: in progress. Written 2026-08-18, reconciled with the repo 2026-08-19, and again
2026-08-20 after a browser walk found the category the first inventory missed.
Categories 1, 2, 3, 4 and 6 are done; category 5 is a 143-file ratchet; **category 7 — the
`{ success: false, error }` channel — is newly opened, mechanism landed, one path migrated.**
Rebased onto main 2026-08-20; see "Rebase reconciliation" below for what main changed underfoot.

## Context

The in-flight change on `fix/entra_direct_connect` made `packages/validation/src/lib/clientFormValidation.ts`
translatable, and added `clients.validation.*` keys across all 10 locales. That pattern is correct **for a
pure library with no request context**, and it is complete for that one file. (Main has since replaced the
`ValidationTranslator` argument with the three-layer `FieldValidation` result — see "Rebase reconciliation".)

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

## Progress (2026-08-19)

Landed on `i18n/error_messages`:

- **Reviewer follow-up — done.** Expected inbound-email-rule failures now carry
  `messageKey` / `messageParams` through their typed mapper, and their Zod issues
  retain stable validation metadata. The four known invoice-job fallback strings
  now carry keys too, including the two nested result shapes that do not pass
  through `withAuth`'s top-level payload rewrite. `ManagedEmailSettings` no longer
  lets a caught English `err.message` override its translated fallback, and the
  shared `isPermissionError` utilities now classify payload shape or an explicit
  code rather than English prose. The ticket
  Vitest tenant alias resolves to the real `packages/db/src/lib/tenant.ts`, with all
  508 ticket tests passing. The unrelated client-validation heuristic changes and
  `docs/DELETION_RULES.md` rewrite called out in review were reverted; the validator
  translation seam remains intact.

- **Category 6 — done.** `passwordValidation.ts` takes the translator (`common:auth.validation.password.*`,
  9 keys × 9 locales); wired at `UserManagement` ×2, the team-setup page, and `RegisterForm`.
  `completeUserInvitationSetup` returns the failing rule's key beside the English.
  `ContactPhoneNumbersEditor` returns translated messages with a numeric `rowIndex`, and
  `translateContactPhoneValidationErrors` is deleted. `QuickAddClient`'s inline phone branches are gone.
- **Category 3 — done for every payload-level match.** `isPermissionError` (both copies) is shape-based;
  `CodedError` / `errorCodeOf` / `isAuthorizationThrow` give thrown errors a code channel, adopted by 13
  `*ActionErrors` mappers; contact save errors parse `{ code, detail }` through one helper. `ticketActionErrors`
  classifies by `TicketErrorCode` first. The 52-prefix list survives as an explicitly deprecated fallback — the
  prose there is safe *because it is thrown*, and thrown messages never cross the boundary.
- **Category 1 steps 1–2 — done.** `messageKey` / `messageParams` on both payload shapes,
  `localizeActionError` in `packages/auth`, wired into `withAuth` and `withOptionalAuth`, with tests for the
  no-key, missing-namespace, idempotent and no-request-scope paths. surveys / recurring billing / license
  management localize at their own return.
- **Category 1 step 3 — DONE, every package.** client-portal: 47
  keys × 8 locales, all 9 files; `appointmentSchemas` deduped from three identical copies into
  `@alga-psa/scheduling`. clients: 91 call sites across 16 action files plus `billingHelpers`, 68 keys in
  `msp/clients` and 18 in `msp/contacts`. tickets: 53 call sites across 10 action files, 58 keys extending
  the `features/tickets` `errors.*` block the category-3 work started. billing: 480 call sites across 52
  action files, 305 keys spread over the namespaces that already serve each feature — `msp/invoicing`,
  `msp/quotes`, `msp/contracts`, `msp/contract-lines`, `msp/credits`, `msp/hour-blocks`,
  `msp/service-catalog`, `msp/billing-settings`, and `msp/billing` for what genuinely spans them (the four
  `Permission denied: billing … required` strings alone cover 104 sites, so they get one key each).
  integrations: 71 call sites across 11 action files, 103 keys in `msp/email-providers` and
  `msp/integrations`. scheduling: 44 sites, 46 keys in `msp/time-entry` and `msp/schedule`. projects: 44
  sites, 52 keys in `projects`. assets / teams / sla / reference-data: 78 sites, 85 keys in `msp/assets` and
  the `msp/settings` blocks that already serve those screens. documents: 96 sites, 30 keys (the bare
  `'Permission denied'` was twenty-two of them). surveys / users / tenancy / notifications / reporting: 72
  sites, 68 keys. tags / auth policy + sessions / user-composition / jobs: 44 sites, 36 keys.

  inventory: 208 sites across 23 action files and `kitActionErrors`, 209 keys in `features/inventory`.
  server/src: 39 sites — API keys, webhooks and inbound webhooks into `msp/profile` (the namespace their
  security screens already read), the ghost-usage AI guards reusing the inventory permission keys, licensing
  into a new `msp/licensing` `errors` block. ee/server/src: 11 sites, the portal-domain validator, into
  `msp/settings` beside the client-portal settings it serves.

  **Nothing is left.** The only plain-string-literal `actionError` / `permissionError` call site remaining
  anywhere in the repo is a fixture inside `localizeActionError.test.ts`, which exists to test the *keyless*
  path. Re-measure the whole repo at once — per-package greps are what let `contactActions.tsx` slip:

  ```bash
  # every call site, split into keyed / unkeyed, per package
  grep -rn "actionError(\|permissionError(" packages server ee/server --include="*.ts" --include="*.tsx"
  ```

  A call whose second argument is not a plain literal (`QBO_CATALOG_KEYS[catalog].notConnected`,
  `statusMessageKey(...)`, a template) still counts as keyed — check before assuming a hit is real.

  Eight conventions worth not re-deriving:

  1. Messages that forward a thrown error's own text stay keyless. A thrown string has no catalogue entry to
     point at, and `find-untranslated-ui.cjs` excludes throws by design.
  2. **An action that reports failure as a bare string has to localize it itself.** `withAuth` can only
     rewrite a payload it can still see; the moment the code does `String(candidate.actionError)` the key is
     gone. Grep `String(candidate\.\(actionError\|permissionError\)` before calling a package done — that is
     the whole inventory, and it is short. Every server-side one is now fixed: clients `createClient`,
     `clientActionMessageFrom`, `contactActionResultErrorFrom`; tickets `ticketBulkFailureMessage`,
     `ticketImportRowErrorMessage` and two inline returns; scheduling `timeSheetRemovalErrorMessage`;
     projects `regenerateOrderKeys`; assets `assetActionErrorMessage`; documents
     `documentActionErrorMessage`. What the grep still finds is **client components** flattening a payload
     the boundary already localized (teams via `BulkAssignTicketsDialog`, reference-data via the status
     dialogs, assets via `assetDrawerActions`) and one dead helper in sla — those are fine as they are.
     The browser walk is what found the first: every test passed while the German run came back in English,
     because the English fallback is still correct English.
  3. Concatenated messages have to become whole sentences, one per branch. Five missing-field strings and the
     singular/plural bundle-master prefix went that way; a prefix and a tail do not agree across languages.
     The same shape hides behind a helper that takes an English noun: `Cannot ${ACTION_DESCRIPTIONS[action]}`,
     `Connect QuickBooks before loading ${catalogName}`, `Failed to load ${label}`. Give the helper a typed id
     instead of the noun and a table of whole-sentence keys — 21 for the QuickBooks catalogues, 16 for Xero,
     7 for the ticket field-option loaders, 4 for accounting exports. Generate the locale strings from a frame
     plus a noun table if there are many; Polish needs the genitive after `przed wczytaniem`, which is exactly
     the agreement a shared prefix cannot deliver.
  4. **Inventory with `--include="*.ts" --include="*.tsx"`.** `contactActions.tsx` is an action module with a
     `.tsx` extension, and a `.ts`-only grep reported the clients package complete while 22 of its call sites
     were untouched.
  5. **A package may clone `actionError` locally.** `invoiceJobActions` and `categoryActions` each declared a
     one-argument copy, so a key passed at the call site would not have compiled (and, before the key, had
     nowhere to go). Route them through `@alga-psa/ui/lib/errorHandling` — the shared helpers return `never`,
     which is assignable to the module's own narrow union. Grep
     `function \(actionError\|permissionError\)(` per package before starting.
  6. **A caught payload that is re-wrapped drops the key unless it is carried.** `serviceActions` and
     `categoryActions` map a thrown payload back into a fresh one; both now pass `getActionErrorMessageKey` /
     `getActionErrorMessageParams` through. This is the same failure as convention 2 with a different shape,
     and it is equally silent — the English fallback is still correct English.
  7. **A value-per-branch table beats a param when the value is an enum.** `localizeActionError` translates the
     message, never the params, so an interpolated English noun survives translation untouched. inventory's
     three unit-status guards each got eight whole sentences (`errors.loaners.cannotLoanOutStatus.<status>`),
     generated from one frame plus a per-locale status-noun table. The helper that picks the key
     (`statusMessageKey`) returns `undefined` for a status outside the label table, so an unrecognised value
     degrades to the English sentence rather than naming a key that does not resolve — there is a unit test
     for exactly that.
  8. **A `??` fallback hides a keyable branch.** `actionError(firstIssue?.message ?? 'Check the …')` cannot
     take a key: the keyed sentence and the un-keyable Zod message share one expression. Split the ternary so
     the fallback carries its key and the Zod message stays keyless until category 2 lands
     (`inboundWebhookActions`, `webhookActions`).
- **Category 5 — 12 of 155 done** (`RegisterForm`, `TimePeriodSettings`, `TagEditForm`,
  `ConflictResolutionDialog`, `StatusDialog`, `ColorPicker`, `RmmAlertAutomationSettings`, and the auth-owned
  `Alert`, `SignOutDialog`, `TwoFA`, `PolicyManagement`, and `RoleManagement`), plus 3 stale baseline entries
  dropped. Ratchet is at **143**. `IconPicker` remains last. The three shared files wired in the earlier pass
  take their keys from `common`, because none belongs to one route's namespace — check
  `ROUTE_NAMESPACES` before reaching for a feature namespace, since `/msp/projects` does not load
  `msp/settings` and `StatusDialog` renders from both. Each hid a concatenation: `Conflict:` + a clause,
  `{editing ? 'Update' : 'Add'} Status`, and an English `"s"` appended to a raw `tagged_type`. The last is
  the client-side twin of convention 7, and it has an easier answer: a client component *has* a translator, so
  the noun can be translated before it is interpolated
  (`t('tags.entityTypes.' + tag.tagged_type)` into `{{entityType}}`). Import `useTranslation` from
  `@alga-psa/ui/lib/i18n/client`, not `react-i18next` — that is the repo's seam, and it saves declaring
  `react-i18next` in a package that does not have it. Leave letterform samples like `"Aa"` alone: a key whose
  value is identical in every locale fails `audit.cjs`.

Ratchet at time of writing: high-severity files **143** (from 155). Error-shaped literals **3,081 across 505
files** (from 3,365 across 533). Note the literal number moves slowly by design —
`actionError('English', 'key')` still contains the English, so a migrated call site keeps counting until the
fallback is dropped. Judge category 1 by packages migrated, not by this number.

`find-untranslated-ui.cjs --json` emits valid JSON again (the two-line JSX prop that used to break the
`detail` string is gone), so the ratchet can be read machine-readably:
`node -e` over `high[]` for the 143, and over `high[].findings[] ∪ partial[].findings[]` filtered on
error-shaped prose for the 3,081.

Two checks worth keeping, because neither the gate nor `tsc` covers them:

- **Every `<namespace>:errors.<key>` named in source resolves in all eight real locales.** A typo falls back
  to English and nothing complains. Collect the refs with a regex over `packages server ee/server`, then walk
  each `server/public/locales/<locale>/<namespace>.json`. As of this pass: **1,145 distinct keys referenced, 0
  unresolved** — the only misses are doc examples in `errorHandling.ts` / `localizeActionError.ts` and test
  fixtures (`msp/clients:errors.x`, `msp/tickets:errors.notFound`), which name namespaces that do not exist on
  purpose.
- **Two spellings of one message should share one key.** inventory had
  `Permission denied: inventory:read required` beside `Permission denied: inventory read required`; both now
  point at `errors.permissions.inventoryRead`, so the raw permission code stops leaking and the two screens
  read the same sentence in every locale.

Walked in a browser against a running app (2026-08-19), driving the real sign-in form and the real
language picker rather than a cookie:

- **Category 6, `validatePassword`.** Settings → Users → Create New MSP User with `abcdefgh`. The toast reads
  "Password must contain at least one uppercase letter" at `en`, "Das Passwort muss mindestens einen
  Großbuchstaben enthalten" at `de` (byte-identical to `de/common.json`), and `11111` at `xx`.
- **Category 1, the boundary.** `/client-portal/tickets/<unknown-uuid>` returns
  `actionError('Ticket not found or access denied', 'client-portal:errors.tickets.notFoundOrDenied')` from a
  `withAuth` action, and the page renders it as "Ticket not found or access denied" / "Ticket nicht gefunden
  oder Zugriff verweigert" / `11111` — with no render-site change. The German run was the portal user's own
  stored preference, not a cookie, which is the property that matters: `localizeActionError` resolves the
  *reader's* locale on the server, so the payload crosses the wire already translated.

- **The keyed packages, one path each.** Duplicate client name in Quick Add Client: "A client with the name
  "Emerald City" already exists…" / "Ein Kunde mit dem Namen „Emerald City" existiert bereits…" /
  `11111 Emerald City 11111` — note the interpolated name survives the pseudo-locale, which is the check that
  a `{{param}}` was not folded into the translated string. `/msp/tickets/<unknown-uuid>`: "Ticket not
  found." / "Ticket nicht gefunden.".

That covers both halves of the design and all three namespace shapes a key can take — `client-portal:`,
`msp/clients:` and `features/tickets:` — which is worth having checked, since the boundary resolves the
namespace by splitting the key at its last colon and reading that file from disk.

- **billing, after its pass.** Billing → Service Types → Add Custom Type with a name that collides:
  "A service or product with these values already exists." / "Ein Dienst oder Produkt mit diesen Werten
  existiert bereits." (byte-identical to `de/msp/service-catalog.json`) / `11111`, switching locale through
  the real Language Preference picker on `/msp/profile` each time. So a key resolves in a namespace nobody
  had put errors in before, which is the part of billing worth proving.

integrations has no browser walk yet: its reachable surfaces here are the QuickBooks/Xero catalogues (needs a
connected tenant) and the managed-email domain form, which is an EE component talking to an API that returns
`{ success, error }` rather than an action payload — a category-4 site, not the boundary. Its keys are covered
by unit assertions and the lang-pack gate instead.

- **inventory, after its pass.** Inventory → Vendors → Add Vendor with a name that collides:
  `A vendor named "target" already exists` / `Ein Lieferant mit dem Namen „target“ existiert bereits`
  (byte-identical to `de/features/inventory.json`) / `11111 target 11111`. That is the hand-written template
  branch — the `{{name}}` param survives the pseudo-locale, so it was not folded into the translated string.
- **ee/server, after its pass.** Settings → Client Portal → custom domain `nodothere` renders
  "Die Domain muss mindestens einen Punkt enthalten." at `de`, byte-identical to `de/msp/settings.json`. An EE
  action, an EE component, and a namespace that had no client-portal-domain errors before.

`msp/profile` and `msp/licensing` have no browser walk: the API-key and webhook failures need a non-admin
session or a missing record, and the licensing guard needs the permission removed. They are covered by the
key-resolution check above and the lang-pack gate, the same way integrations is.

Signing in locally: the seeded MSP users are `glinda@emeraldcity.oz` and friends on the Oz tenant. A QA
password is one `UPDATE users SET hashed_password` away — the format is `salt:hash` where
`hash = pbkdf2(password, NEXTAUTH_SECRET + salt, 10000, 64, sha512)` and the secret is the **file**
`secrets/nextauth_secret`, not the `NEXTAUTH_SECRET=dummy` in `server/.env` (`getSecret` prefers the file).
Switch locale through `#language-preference` on `/msp/profile` and press Save Changes; under `xx` every label
is `11111`, so drive the page by element id, not by text.

After the whole pass, a signed-in walk of `/msp/dashboard`, `/msp/tickets`, `/msp/clients`,
`/msp/billing?tab=service-types`, `/msp/projects`, `/msp/schedule`, `/msp/assets`, `/msp/documents` and
`/msp/settings` renders every screen with no 500 and no locale-file 404. The only failing requests are the
local SSO discovery probe and document previews for seeded rows whose files are not in local storage.

What a browser still cannot reach is category 2: a Zod message is still English inside an otherwise
translated payload, and no screen shows that until a schema attaches a key.

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
3. ~~Migrate by package, most user-visible first: **client-portal (266) → clients (266) → tickets (205) →
   billing (731) → integrations (436) → the rest.**~~ — done, every package. Per package: add an `errors.*`
   block to that package's namespace under `server/public/locales/en/`, then pass keys at each `actionError`
   call. No client changes.
4. Keys go in the namespace that already serves the feature (`msp/clients.json`, `client-portal.json`, …);
   only genuinely app-wide errors go in `common.json`. Follow the shape in `docs/architecture/i18n.md`
   ("How to Add Translation Keys"). Namespace choice is now a server-side disk read, so it is not constrained
   by `ROUTE_NAMESPACES`.
5. ~~Rewrite the "Error and toast messages" section of `docs/architecture/i18n.md`~~ — done; it now documents
   boundary translation and marks the English-map pattern deprecated.

Do not attempt this in one pass. One package per PR, each independently shippable.

## Category 2 — Zod schema messages (~320)

**Status: done for every user-visible server-action issue path.** `appointmentSchemas` remains deduped into
`@alga-psa/scheduling`, but is deliberately unkeyed because its action consumers collapse failures to generic
translated sentences and its only raw-message reader is the out-of-scope public API route.

**Convention 8 has been applied everywhere it applies**, so every site is now one edit away from done: the
keyed fallback and the raw Zod message are separate branches at `webhookActions`, `inboundWebhookActions`,
`surveyActions`, `surveyResponseActions` and client-portal's ticket create. Attaching a key in the schema is
the only piece missing.

These do reach users: several actions join `error.issues[].message` into the returned error string
(e.g. `packages/integrations/src/actions/integrations/rmmAlertRuleActions.ts:56`,
`packages/surveys/src/actions/surveyActions.ts:43`).

Approach: keep the English message in the schema (it is also the API-consumer message and the log line),
but attach a key so the action can translate it. Give schemas a small helper that stores the key in the
issue `params`, then map `issue` → `messageKey` where the action builds its `actionError`. Field-level
messages resolve to `common:validation.*` where one already exists rather than minting per-schema keys.

~~Start with the duplicated file: `appointmentSchemas.ts` is 62 literals~~ — **do not.** Measured 2026-08-19:
every action that consumes those schemas collapses the `ZodError` into one generic sentence of its own
(`portalAppointmentRequestErrorMessage`, `appointmentRequestActionErrorMessage`,
`availabilityActionErrorMessage`), so not one of the 62 messages reaches a user through a server action. Their
only live reader is `server/src/app/api/public/appointment-request/route.ts`, which the plan puts out of
scope. Keying them would translate nothing. The dedupe was still worth doing; the ordering advice was not.

**Where a Zod message actually reaches a user** (the real category-2 worklist, all verified 2026-08-19):

| Site | Shape |
|---|---|
| `integrations/rmmAlertRuleActions.ts:56` | joins every issue as `path: message` |
| `client-portal/client-tickets.ts:71` | first issue, prefixed with its path |
| `surveys/surveyActions.ts:44`, `surveyResponseActions.ts:110` | first issue |
| `server/lib/actions/{webhook,inboundWebhook}Actions.ts` | first issue |
| `projects/{projectActions,projectTaskActions,projectTemplateActions}.ts`, `tickets/{ticketActionErrors,optimizedTicketActions}.ts`, `assets/assetActionErrors.ts`, `billing/projectBillingActionErrors.ts` | issue list interpolated into a keyed frame |

The implementation is structural rather than prose-based:

- `actionErrorFromValidationIssue` in `packages/ui/src/lib/errorHandling.ts` maps Zod 3 built-in issues by
  stable `issue.code` into `common:errors.validation.*`; it never branches on `issue.message`.
- Custom `.refine` / `.superRefine` issues carry `params.messageKey` and optional
  `params.messageParams`. The webhook, inbound-webhook, RMM and project-billing schemas now attach them.
- The action mappers use the first actionable issue instead of joining translated and untranslated fragments.
  This covers client-portal ticket creation, surveys, outbound and inbound webhooks, project tasks, tickets,
  assets, project billing and RMM alert automation. Project and template mappers already returned a generic
  keyed sentence and needed no change.
- `rmmAlertRuleActions` no longer flattens failures into `{ success, error }`; it returns keyed
  `actionError` / `permissionError` payloads, and its component reads those shapes. This lets `withAuth`
  perform the same boundary translation as every other migrated action.

One design constraint to check first: Zod only carries `params` on `ZodIssueCode.custom`, so a
`.refine`/`.superRefine` message can hold a key but a built-in `too_small` / `invalid_type` cannot. Built-ins
have to be mapped from `issue.code` + `issue.path` to `common:validation.*` instead of carrying one.

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
`RmmAlertAutomationSettings.tsx` (131) and `TimePeriodSettings.tsx` (81), the two biggest real ones, are done.

## Category 6 — finish the in-flight validator change (small, do first)

Closes the gaps left by the current diff. Half a day.

- `packages/validation/src/lib/passwordValidation.ts` — 9 hardcoded messages (lines 65–110), same file family,
  not converted. Surfaced raw at `server/src/components/settings/general/UserManagement.tsx:573` and `:616`
  and returned from `packages/users/src/actions/user-actions/userInvitationActions.ts:271`. Give it a
  translator parameter and add `common:auth.validation.password.*` keys. *(Done: it now takes the
  `Translator` from `fieldValidation`, so a component's own `t` can be passed straight in.)*
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
- ~~`MicrosoftEmailSetupDialog.tsx` carries an English→key lookup map~~ — the map is gone; the file now reads
  `result.error || t('…')`, which is a category-4 site, not a category-3 one. The only `Record<string, string>`
  left nearby is `TeamsIntegrationSettings`'s wizard-step map, and that is keyed by step id, not by prose.

## Rebase reconciliation (2026-08-20)

Rebasing onto main replayed 46 commits over 162 and found that two of this branch's early commits had
already landed there — in an evolved form that supersedes them. The resolutions worth knowing:

- **`clientFormValidation.ts` belongs to main now.** Main's `feat(validation): split structural rules from
  plausibility` reorganised it into normalize → validate → advise behind a single Zod schema, with phone
  parsing on libphonenumber-js. Messages travel as a `ValidationMessage` (key + English default + params)
  inside a `FieldValidation`, resolved at the render site by `translateFieldValidation(result, tCommon)`.
  This branch's 81-key `ValidationTranslator` scheme is gone; main's ~24 keys under `common:clients.validation.*`
  are the live ones. Anything that still wants a one-string answer takes the i18next-shaped `Translator`.
- **`validatePassword` follows suit.** It takes `Translator` rather than the retired `ValidationTranslator`,
  so `UserManagement`, `RegisterForm` and the team-setup page pass their own `t` with no adapter.
  `userInvitationActions` still captures the key rather than the text, because it runs without a session.
- **The contact phone validator merged rather than picked a side.** Main's `existingRows` grandfathering (an
  unchanged stored number does not block every other edit) and this branch's structured
  `ContactPhoneValidationIssue` — which carries `rowIndex` as a number instead of re-parsing `"Phone 2: …"` —
  are both kept, behind one `{ existingRows?, t? }` options object. `translateContactPhoneValidationErrors`,
  which translated by matching English prose, is deleted.
- **One new key.** Main added a `Tax rate not found or already deleted.` branch to `taxRateActions`; it is
  keyed as `msp/billing-settings:errors.taxRate.notFoundOrAlreadyDeleted` and translated in all seven locales.

## Category 7 — the `{ success: false, error }` channel (~1,132 literals across 254 files)

**Found 2026-08-20 by a browser walk, not by the inventory.** On a German `/msp/profile`, submitting two
matching strong new passwords with the wrong current password rendered "Current password is incorrect" in
English while the weak-password check one line above it rendered
"Das Passwort erfüllt nicht alle Anforderungen". Both halves of the form were "done": category 6 had wired
the client-side validator, category 1 had wired the boundary. The error still came out English because
`changeOwnPassword` returns `{ success: false, error }`, and `localizeActionError` only knew the
`{ actionError }` and `{ permissionError }` shapes.

This is the plan's own blind spot, and it is worth naming precisely: **the first inventory counted
`actionError(` / `permissionError(` call sites, so the older channel was never in the 1,443.** Measured now:

| Signal | Count |
|---|---|
| `success: false` returns (non-test) | 2,007 |
| …of those, carrying an English error literal | 1,132 across 254 files |
| Top areas | ee 417, integrations 275, server 110, users 63, billing 50, client-portal 48, scheduling 40 |

**The mechanism is landed and needs no further design.** `localizeActionError` now rewrites a third payload
shape on exactly the same contract as the other two — no-op without a `messageKey`, key kept after
translating so a re-wrap translates once, `success` must be literally `false` so a partial-success payload
reporting a non-fatal `error` is not touched. `isActionResultError` in `packages/ui/src/lib/errorHandling.ts`
is the guard; `ActionResultMessageKey` is the mixin an action spreads into its declared result type, because
these returns are object literals carrying their own `code` / `errorCode` / `message` fields and a
constructor would fight them.

Migrated so far: the password-change family (`changeOwnPassword`, `adminChangeUserPassword`), six keys in
`common:errors.password`, verified in a browser at `de` and `xx`. The rest is per-package work in the same
shape as category 1 step 3, and the same conventions apply — especially convention 2 (an action that
flattens the payload to a bare string loses the key) and convention 8 (a `||` fallback hides a keyable
branch, as in `{ error: uploadResult.message || 'Failed to upload avatar.' }`).

Two traps specific to this channel:

1. **A pinned `toEqual` is not proof.** Every password test passed while the German run came back English,
   because the English fallback is still correct English. The contract test added with the fix
   (`passwordChangeLocalization.contract.test.ts`) instead asserts that the number of `messageKey:` lines in
   the action equals the number of `success: false` returns, and that every key it names resolves in all
   eight real packs. That shape is worth copying per package: it fails when a *new* failure branch is added
   without a key, which is the way this regresses.
2. **`handleError(err, fallback)` discards the localized message.** `packages/ui/src/lib/errorHandling.ts`
   does `toast.error(fallbackMessage || message)` — the caller's English fallback wins over the server's
   translated text, at **532 of 776 call sites**. So keying an action whose client renders through
   `handleError` with a fallback changes nothing on screen; `EntityImageUpload` (the profile avatar) is the
   reachable example. The permission branch above it uses `message`, so permission errors do get through.
   Fixing the precedence is a repo-wide behaviour change — it would start showing server prose where a
   deliberate generic sentence is shown today — so it is filed here rather than done in passing. Do it as its
   own step: prefer `message` when the payload carried a `messageKey`, keep the fallback otherwise.

## Sequencing

1. ~~Category 6 — finish what is in flight.~~ Done.
2. ~~Category 3 — remove every prose match.~~ Done for every payload-level match; the thrown-prose fallbacks
   are deliberate and documented above.
3. ~~Category 1 steps 1–2 — `localizeActionError`, the extended type, and the 19 unwrapped files.~~ Done.
4. ~~Category 1 step 3 — migrate package by package.~~ Done, every package. Category 4 largely resolved
   itself, as predicted: the `actionError`-origin toasts translate at the boundary with no edit.
5. ~~Category 2 — attach keys to user-visible Zod issues and map them structurally.~~ Done.
6. Category 5 — continuous, independent of the rest. Delete baseline lines as files get wired; 143 to go.
7. Category 7 — the `{ success: false, error }` channel. Mechanism landed and the password path migrated;
   the remaining ~1,132 literals are per-package work, ee and integrations first by volume, but ordered by
   user exposure the same way category 1 was. Check `handleError`'s fallback precedence before keying a
   package whose components render through it — otherwise the keys are correct and invisible.

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
trigger the error paths; that is the only way the pseudo-locale catches an error message. The dev app signs in
with a seeded user whose `hashed_password` column is PBKDF2 `salt:hash` over `NEXTAUTH_SECRET + salt`
(`shared/utils/encryption.ts`), so a local QA password is one `UPDATE users` away.

Two checks worth running before calling a package done, because neither the gate nor the type-checker covers
them:

```bash
# every key a call site names actually resolves in en (a typo silently falls back to English)
# collect '<namespace>:errors.<key>' from src, look each one up in server/public/locales/en/<namespace>.json

# every catalogued key landed in all eight real locales with the text that was written
# (the merge writes eight files per namespace; a second pass over the same key overwrites silently)
```

The per-package shape that worked: scan for `actionError(`/`permissionError(` call sites, write one catalogue
of `{ key: { en, de, es, fr, it, nl, pl, pt } }`, apply the keys with a codemod that only touches sites whose
sole argument is a plain literal, then merge the catalogue into the locale files and regenerate. Everything
that is not a plain literal — templates, helpers taking an English noun — is worth doing by hand, and is where
all the interesting decisions are.

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
- Tests that pin a payload with `toEqual` have to name the key beside the English, and they are not all in the
  package: `server/src/test/integration/accounting/mappingPermissions.integration.test.ts` and
  `…/billing/profitabilityReporting.integration.test.ts` are PR-gated DB tests that assert billing and
  integrations payloads. Tests using `expect(result.permissionError).toBe(…)` need no change, and the
  namespace-shape tests (`Object.keys(en)`) do — a new `errors` group is a new top-level key.
- Adding a key to a package can pull `@alga-psa/ui/lib/i18n/serverOnly` into its Vitest graph for the first
  time, which is how the tickets suite found that its config mapped every `@alga-psa/db/*` subpath to
  `db/src/$1` while the package's exports put `tenant`, `connection` and `workDate` under `db/src/lib`. Check
  the alias table before assuming a red suite means red code. It cost tickets and projects a config repair
  each, and the same wrong shape is still sitting in `authorization`, `core`, `email`, `event-bus`, `tenancy`
  and `users` — untouched because their suites do not reach the boundary yet.
- A package that flattens a payload needs `localizeActionError`, and importing it from the `@alga-psa/auth`
  root drags next-auth into the test graph. Import `@alga-psa/auth/localizeActionError` instead — the subpath
  exists for exactly this — and note that `@alga-psa/ui` publishes `./lib/*` from `dist`, so a package whose
  Vitest config does not alias ui to source will fail to resolve `serverOnly` even so.
- A package may also need `@alga-psa/auth` *declared*: scheduling, projects, assets and documents were all
  importing it already. Add it to `dependencies` and regenerate the lockfile in the same commit.
- A mapper's test may **mock away the key**. `loanerRestockErrors.test.ts` stubbed
  `actionError: (message) => ({ actionError: message })`, so 22 `toEqual` assertions stayed green while the
  second argument was silently dropped. Mirror the real signature in the mock and name the key in every
  expectation — otherwise the suite proves nothing about the migration it is supposed to cover.
- The audit is the only thing that reads the glossary, and it catches real drift late: Polish rejected
  `przepływu pracy` for *workflow* (loanword required) and, in an earlier pass, `dzierżawca` for *tenant*.
  Note the glossaries disagree with each other on purpose — Spanish wants `flujo de trabajo` where Polish
  wants `workflow`, Dutch calls a tag a `label`, French an `étiquette`. Run
  `node tools/i18n/audit.cjs --locale <l>` per locale before committing, not just `validate-translations`.

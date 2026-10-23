# Client portal error-message hygiene: implementation plan

Card: f7f5f376 · PSA ticket alga-2026-0002635 · branch `feature/security-hide-raw-sql-errors-on-client-portal-ti`
Base: main @ 7fafd528c8 (line numbers below are against this commit)

## Goal

Two outcomes for client portal users (contacts, external to the MSP):

1. A malformed id in a portal URL produces the ordinary not-found message.
2. An unexpected server error produces a generic, localized message. Its detail goes to the server logs and never to the HTML.

The rule this plan sets: **only messages that a server action has explicitly classified as user-safe may be shown to a portal user.** A user-safe message is a returned `actionError` / `permissionError` payload, or the new `UserFacingError`. Everything else renders a localized fallback.

## Findings that shape the design

- `getClientTicketDetails` (`packages/client-portal/src/actions/client-portal-actions/client-tickets.ts:301`) passes `ticketId` straight to the query. Postgres rejects a non-uuid with a driver error, and that error's message embeds the query text. `expectedOrThrow` (`:111`) logs the error and rethrows it.
- `server/src/app/client-portal/tickets/[ticketId]/page.tsx:103-121` is a server component. Its `catch` renders `error.message` into the destructive Alert through `messages.errorWithMessage`. Next's production redaction only covers errors that cross into a client error boundary, so it does not cover this path.
- **`server/src/app/client-portal/projects/[projectId]/page.tsx:77-95` has the same `catch`.** For a malformed `projectId` it happens to be safe today: `clientPortalActionErrorFrom` maps pg `22P02` to a generic action error. Any other unexpected error still renders raw.
- None of the other client-portal pages render a caught error message. The dynamic routes (appointments, extensions, quotes, invoices, my-requests) either do not catch, or they catch into fixed copy.
- Client components that call server actions are protected in production builds, because Next redacts the messages of thrown errors there. They still follow an unsafe pattern, though, and dev builds show the raw text:
  - `packages/client-portal/src/components/tickets/ClientAddTicket.tsx:205-211`: `mapCreateTicketError(error.message)`, which falls back to the raw message.
  - `packages/client-portal/src/components/documents/ClientDocumentsPage.tsx:302,307,314`: wraps an action error in `new Error(...)`, then renders `error.message`.
  - `packages/client-portal/src/components/billing/PaymentMethodsTab.tsx:38,39,51,56,60,67,68,71,81,84`: the same wrap-and-render pattern, rendered through `getErrorMessage(e)`.
- The other `error instanceof Error ? error.message` hits from the card description are either log-only (`appointmentRequestActions.ts:132,313`, `clientPortalLinkActions.ts:66`, `tenantRecoveryActions.ts:113`, `clientUserActions.ts:613,728`) or allowlist matchers that only pass through known strings (`clientUserActions.ts:87`, `appointmentRequestActions.ts:86`, `client-project-details.ts:25`). They are safe and need no change.
- The MSP ticket route already guards its segment with an inline uuid regex (`server/src/app/msp/tickets/[id]/page.tsx:51`). The same permissive regex is copied at least 7 more times across packages. `@alga-psa/validation`'s `isValidUUID` is stricter: it requires version nibble 1-5 and variant 8-b, so it would reject v7 or hand-made ids. It is the wrong guard for "can Postgres parse this as a uuid".
- Every in-product link to a portal ticket uses `ticket_id`, never the ticket number. Checked: TicketList, notifications, email subscribers, request-services, and the notification link resolver.

## Changes, in order

### 1. Shared uuid-shape guard: `packages/validation`

- `packages/validation/src/lib/utils.ts`: add next to `isValidUUID` (`:52`):
  ```ts
  /** True when `value` is a canonical 8-4-4-4-12 hex uuid string (any version/variant) — i.e. Postgres will parse it. */
  export function isUuidShaped(value: unknown): value is string
  ```
  Use the regex `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`. Put a `// LEVERAGE: pattern uuid-shape-guard` comment on it that lists the remaining inline copies: `msp/tickets/[id]/page.tsx`, `list-views/listViewActions.ts`, `tickets/lib/ticketStatusFilter.ts`, `tickets/lib/ticketFilterUtils.ts`, `scheduling/workItemActions.ts`, `billing/renewalsQueueActions.ts`, `jobs/processRenewalQueueHandler.ts`, `search/indexers/status.ts`, `shared/billingClients/defaultTaxRate.ts`. Do not migrate them in this change.
- `packages/validation/src/index.ts`: export it alongside `isValidUUID` (`:13`).
- Tests go in `packages/validation/src/lib/utils.test.ts`. Accept: v4, v7, and the nil-ish `00000000-0000-0000-0000-000000000001`. Reject: a ticket-number-shaped string (`T0001`), `''`, a non-string, a uuid with surrounding whitespace or braces, and a quote-injection string.

### 2. Shared user-safe message helper: `packages/ui/src/lib/errorHandling.ts`

Add these after `getErrorMessage` (~`:330`):

```ts
/** An error whose message was written for the end user and may be displayed verbatim. */
export class UserFacingError extends Error { name = 'UserFacingError'; }

/**
 * The message to show a user for `error`: a returned actionError/permissionError payload's text,
 * a UserFacingError's message, otherwise `fallback`. Never returns the message of an arbitrary
 * thrown error — those can carry driver/stack detail and belong in logs only.
 */
export function userFacingErrorMessage(error: unknown, fallback: string): string
```

- Do **not** change `getErrorMessage` or `handleError`. Both are used across the MSP app, and `getErrorMessage` is also used for log lines.
- Tests go in a new `packages/ui/src/lib/errorHandling.userFacing.test.ts`. Cover: an action error payload gives its text; a permission payload gives its text; `UserFacingError` gives its message; a plain `Error` with SQL-like text gives the fallback; a string, `null`, or `undefined` gives the fallback.

### 3. Validate `ticketId` in the ticket actions: `client-tickets.ts`

- Import `isUuidShaped` from `@alga-psa/validation` (the file already imports `validateData` from it).
- Add one local helper and use it at the existing not-found return (`:478`) as well:
  ```ts
  function ticketNotFoundError(): ClientTicketActionError {
    return actionError('Ticket not found or access denied', 'client-portal:errors.tickets.notFoundOrDenied');
  }
  ```
- Guard each action that takes a client-supplied `ticketId`. Put the guard **after** the permission check and **before** `withTransaction`. A permission failure still takes precedence, and a malformed id becomes exactly the same response as a ticket that exists but is hidden, so the response gives away nothing:
  - `getClientTicketDetails`: after `:319-322`
  - `addClientTicketComment`: after `:615-618`
  - `updateTicketStatus`: after `:905-908`
  - `getClientTicketDocuments`: after `:1188-1191`

  ```ts
  if (!isUuidShaped(ticketId)) {
    return ticketNotFoundError();
  }
  ```
- `addClientTicketComment` has an optional `parentCommentId`. If one is present and not uuid-shaped, return the same not-found error.
- `expectedOrThrow` stays as it is (log, then rethrow). See "Not doing" for why.
- **Fixture migration (required):** existing unit tests pass literal ids such as `'ticket-1'`, `'ticket-hidden'` and `'sibling'`. The new guard turns those into not-found responses, so the tests would fail. Replace them with uuid constants, e.g. `const TICKET_1 = '00000000-0000-4000-8000-000000000001'`, and update any mock that keys on the id. Known call sites:
  - `client-tickets.ticketOrigin.test.ts:199,218,237,256`
  - `client-tickets.visibility.test.ts:369,445,528,588,833-838`
  - `client-tickets.boardStatusValidation.test.ts:323,352,385,456,482` (`updateTicketStatus('ticket-1', …)`)
  - `client-tickets.responseSource.test.ts:205,312` (check the ticket id argument)
  - Also grep the `*.contract.test.ts` siblings (`contactAuthor`, `suppression`, `linkedAssets`, `assetLink`) for direct action calls.

  Integration tests already use real uuids.
- New test file `client-tickets.malformedId.test.ts`, reusing the mock scaffold from `client-tickets.visibility.test.ts`. For each of the four actions, and for ids `T0001`, `not-a-uuid`, `''` and `x' or '1'='1`:
  - the action resolves to `{ actionError: 'Ticket not found or access denied', messageKey: 'client-portal:errors.tickets.notFoundOrDenied' }`
  - `withTransaction` is never called
  - a client user without read permission still gets the permission error, not not-found

### 4. Server pages render only user-safe text

**`server/src/app/client-portal/tickets/[ticketId]/page.tsx`**
- `catch` (`:103-121`): keep the `logger.error` call, which already logs the message and stack. Render:
  ```tsx
  {userFacingErrorMessage(error, t('messages.loadError', { defaultValue: 'Failed to load ticket details' }))}
  ```
  Render it **without** the `errorWithMessage` "Error: …" wrapper. Keep `id="ticket-error-message"`.
- The two returned-action-error branches (`:57-70`, `:75-88`) are already safe by contract. Leave them alone, or switch them to `userFacingErrorMessage(ticketData, t('messages.loadError'))` for uniformity. Behavior is identical either way.
- `generateMetadata` (`:41-43`) only logs. No change.
- No page-level uuid guard and no `notFound()`. The action is the single authority, so a malformed id and a hidden ticket render the same message by construction.

**`server/src/app/client-portal/projects/[projectId]/page.tsx`**
- `catch` (`:77-95`): the same change, using `t('messages.loadError', { defaultValue: 'Failed to load project details' })`. Keep `id="project-error-message"`.

**Tests:** add `server/src/test/unit/app/client-portal/tickets/[ticketId]/page.errorRendering.test.tsx` and a sibling for projects. Follow the pattern in `server/src/test/unit/app/msp/tickets/[id]/page.productComposition.test.tsx`: `await Page({ params: Promise.resolve({ ... }) })`, then `renderToStaticMarkup`. Mock:
- `@alga-psa/client-portal/actions`
- `@alga-psa/client-portal/components`
- `@/lib/productAccess`
- `@alga-psa/core/logger`
- `@alga-psa/ui/lib/i18n/serverOnly`, with a `t` that returns the interpolated `defaultValue`

Cases:
- (a) The action throws `Error('select "t".* from "tickets" as "t" … - invalid input syntax for type uuid: "T-1"')`. The HTML contains `Failed to load ticket details` and does not contain `select`, `tickets`, `uuid` or `at ` (stack). `logger.error` was called with the raw message.
- (b) The action returns the not-found action error. The HTML contains `Ticket not found or access denied`.
- (c) The statuses action throws. Same assertions as (a).
- Projects: (a) and (b) equivalents.

Also check that the existing source-text contract tests still pass after the edit: `server/src/test/unit/app/pageTitles.metadata.test.ts` and `server/src/test/unit/client-portal/algadeskPortalTicketing.contract.test.ts`.

### 5. Client component sweep: `packages/client-portal/src/components`

Apply one rule everywhere. Where an action error is thrown to bail out, throw `new UserFacingError(getErrorMessage(result))`. Where the error is rendered, use `userFacingErrorMessage(e, <existing localized fallback>)`.

- `tickets/ClientAddTicket.tsx:205-211`: for thrown errors, render `t('create.errors.createFailed')` only. Drop `mapCreateTicketError(error.message)`; the returned-error branch at `:198` already maps action messages.
- `documents/ClientDocumentsPage.tsx`:
  - `:302`: if `isReturnedActionError(content)`, throw `UserFacingError(getErrorMessage(content))`. Otherwise (no content) throw a plain error, which lands on the fallback.
  - `:307`: change to `UserFacingError(t('portal.previewError', …))`.
  - `:314`: change to `userFacingErrorMessage(error, t('portal.previewError', 'Could not load this preview. Please try again.'))`.
- `billing/PaymentMethodsTab.tsx`:
  - Throws at `:38,39,60,67,81`: make them `UserFacingError(getErrorMessage(...))`. `:68`: make it `UserFacingError(text('methodUpdateError', …))`.
  - Catches: `:51,56` use `text('loadError', 'Failed to load billing data')`; `:60` uses `text('addPaymentError', …)`; `:71` uses `text('methodUpdateError', …)`; `:84` uses an autopay update key.
  - Use existing `account.billing.*` keys. If no autopay error key exists, add `account.billing.autopay.updateError` to every locale in `server/public/locales/*/client-portal.json`, regenerate the pseudo-locales (`scripts/generate-pseudo-locales.cjs`), and run `node scripts/validate-translations.cjs`.
  - Mark the repeated `if (isActionError(r)) throw new Error(getErrorMessage(r))` shape once with `// LEVERAGE: pattern throw-action-error`.
- Add focused unit tests where the components already have them. Otherwise, a source-level contract test asserting there is no `getErrorMessage(e|err|error)` and no `error.message` render under `packages/client-portal/src/components` is acceptable as a regression fence.

### 6. Verify

- `cd packages/validation && npx vitest run src/lib/utils.test.ts`
- `cd packages/ui && npx vitest run src/lib/errorHandling`
- `cd packages/client-portal && npx vitest run src/actions/client-portal-actions/client-tickets` (the whole family must pass)
- `cd server && npx vitest run src/test/unit/app/client-portal src/test/unit/app/pageTitles.metadata.test.ts src/test/unit/client-portal`
- Typecheck the touched packages.
- Live check on the dev server (port 3700, signed in as a client portal user):
  - open `/client-portal/tickets/<a ticket number>`, `/client-portal/tickets/garbage` and `/client-portal/projects/garbage`
  - view-source contains the friendly message and no query text, `uuid` or stack text
  - the server log shows the warn/error line with the detail

## Deliberately NOT doing

- **No ticket-number → id resolution.** No product link uses ticket numbers. It would add a second lookup surface to keep inside visibility scoping, for no user-facing gain.
- **`expectedOrThrow` keeps rethrowing.** Rethrowing unexpected errors is the package-wide convention, shared with `clientPortalActionErrorFrom` callers. Next redacts thrown messages at the client boundary, and the server-component sink is fixed in step 4. Turning every unexpected failure into a returned generic error would hide real faults from the error path, and it would diverge from the other client-portal actions.
- **No global change to `getErrorMessage` / `handleError`.** They are shared with the MSP app and used for logging. The new helper is opt-in, and the client portal adopts it.
- **No change to `server/src/app/error.tsx`**, which renders `error.message`. It is app-wide (MSP and portal), and production builds already redact server-component messages before they reach it. Flagged for a sibling or follow-up if the board wants defense in depth there.
- **The other inline uuid regex copies are not migrated.** They get a LEVERAGE marker only.
- **The substring heuristics in `clientPortalActionErrorFrom` are not reworked.** `message.includes('not found')` and similar promote raw `Error` messages to action errors; it is a latent pass-through and a separate change.
- **The `?error=` search-param echo on `request-services/[definitionId]/page.tsx:50` is left alone.** It reflects caller-supplied text, not server internals, so it is a different issue.

## Risks

- **Fixture churn.** About 20 unit-test call sites use non-uuid ids and must be migrated in the same commit, or the suite goes red. Mocks that branch on the id string need matching updates.
- **Hand-made ids.** Any caller that passes a non-uuid ticket id now gets not-found instead of reaching the DB. The repo audit found none outside tests. Real ids are Postgres uuids.
- **Lost specificity in the client components.** If a throw site is not converted to `UserFacingError`, its specific action message degrades to the generic fallback. That is safe, but it is a UX regression. Step 5 lists every throw site so they move together.
- **Pseudo-locale and validation scripts** must be re-run if a locale key is added.
- **Public branch.** Keep commit messages, PR title and branch name neutral: no advisory id, no reproduction recipe. This plan avoids advisory references, but it does describe the failure mode, because the implementer needs it. Before the PR is opened publicly, the XO/captain should decide whether this file ships in the PR or gets dropped from the branch.

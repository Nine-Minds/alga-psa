# Appointment-request approval link: plan

- PSA ticket: alga-2026-0002367
- Branch: `feature/appointment-request-email-review-approve-link-mi`
- Base: `origin/main` @ `dc89552709` (code read on 2026-10-06)

## Problem

When a client requests an appointment, MSP staff get a "New appointment request" email. Its "Review & Approve" button opens `/msp/schedule` without saying which request it is for, so the approver lands on the calendar and has to find the request themselves. This happens for every tenant that takes appointment requests, from both the client portal and the public booking form.

## What the code does today

The email link is hard-coded twice, with no request id:

| Site | Code |
|---|---|
| Portal submit: `packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts:715` | `` approvalLink: `${process.env.NEXT_PUBLIC_APP_URL}/msp/schedule` `` |
| Public submit: `server/src/app/api/public/appointment-request/route.ts:388` | same |

Other places already build the deep link correctly, each with its own copy of the route:

| Site | Code |
|---|---|
| `appointmentRequestActions.ts:752` (in-app "request created" for staff) | `` link: `/msp/schedule?requestId=${id}` `` |
| `appointmentRequestActions.ts:1478` (in-app "request cancelled" for staff) | same |
| `packages/scheduling/src/lib/teamsMeetingContent.ts:91` (Teams event body) | `` `${baseUrl}/msp/schedule?requestId=${encodeURIComponent(id)}` ``, with `baseUrl = (NEXT_PUBLIC_APP_URL \|\| NEXT_PUBLIC_BASE_URL \|\| 'http://localhost:3000')` and trailing slashes trimmed |
| `packages/notifications/src/components/NotificationDetailView.tsx:176` (click handler) | rebuilds `` `/msp/schedule?requestId=${metadata.appointment_request_id}` `` |

The schedule page already reads the link. `SchedulePage.tsx:24` reads `searchParams.get('requestId')`. Lines 89-95 then set `highlightedRequestId` and open `AppointmentRequestsPanel`. The panel (`AppointmentRequestsPanel.tsx:213-226`) loads **all** of the tenant's requests (`getAppointmentRequests()` with no filter). It finds the request by id, switches the status filter to `all` if the request is no longer pending, and selects it. If no request has that id, nothing is selected and no error is raised. A stale or unknown id therefore already degrades gracefully: the requests panel opens over the normal schedule page, nothing is selected, and no toast appears. This plan keeps that behaviour and adds a test to pin it down.

The seed text in `packages/notifications/src/lib/templateVariables/seed.ts:524-530` documents the bare link (example `https://app.algapsa.com/msp/schedule`). `seed.ts` is **generated**: it is built from `docs/plans/2026-07-17-email-template-variables-inventory.json` (entry at lines 584-589) by `packages/notifications/scripts/generate-variable-registry-seed.mjs`. Edit the inventory JSON and regenerate. Do not hand-edit `seed.ts`.

## Decisions

1. **One helper builds the link, and it lives in `@alga-psa/scheduling`.** Scheduling owns `/msp/schedule` and the `?requestId=` contract that `SchedulePage` reads, so the route and the parameter name belong next to the page that consumes them. Every producer can already depend on scheduling: `@alga-psa/client-portal` and `server` already do, and `teamsMeetingContent.ts` is inside it. `@alga-psa/core` was rejected because app route paths do not belong in the engine layer.
2. **The module is pure and isomorphic.** It has no `'use server'`, no Node or DB imports, and no React. That lets `SchedulePage` (a client component) import the parameter-name constant from the same module the producers use. The producer side (building links) and the consumer side (reading `?requestId=`) then share one definition and cannot drift.
3. **One base-URL rule.** Absolute links use `NEXT_PUBLIC_APP_URL || NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'`, with trailing slashes trimmed. This is the rule `teamsMeetingContent.ts` already uses, and the Teams body switches to the helper. For the two email sites this changes one thing: an unset `NEXT_PUBLIC_APP_URL` used to produce `undefined/msp/schedule` and now produces a working fallback. `process.env.NEXT_PUBLIC_APP_URL` is referenced statically inside the function so Next can inline it in client bundles.
4. **The id is URL-encoded.** The helper calls `encodeURIComponent` on the id, as the Teams body already does. Request ids are server-generated UUIDs, so encoding changes nothing for real data. Existing assertions of the form `` `/msp/schedule?requestId=${uuid}` `` stay valid.
5. **An empty id throws.** Both call sites always have a persisted id, so an empty id is a programming error. Throwing a `TypeError` is better than silently sending another link with no id. Both send loops already sit inside try/catch blocks that log the error and keep the request.
6. **Unknown or stale ids keep today's behaviour.** The panel opens with nothing selected and no error, and is no longer pending → the panel shows it under the `all` filter. No product change, only new tests.
7. **Seed drift is caught by a test.** `@alga-psa/notifications` does not depend on scheduling and should not start depending on it just to document a link. A server-side contract test instead asserts that the seed's `approvalLink` example equals the helper's output for the example id. If the route or parameter changes, the seed must be regenerated or that test fails.

## Helper

New file `packages/scheduling/src/lib/appointmentRequestLinks.ts`:

```ts
/** MSP page that reviews appointment requests (SchedulePage). */
export const APPOINTMENT_REQUEST_REVIEW_PATH = '/msp/schedule';

/** Query parameter SchedulePage reads to open and select one request. */
export const APPOINTMENT_REQUEST_ID_PARAM = 'requestId';

/** App-relative deep link, for in-app notification `link` fields. */
export function buildAppointmentRequestReviewPath(appointmentRequestId: string): string;
// -> '/msp/schedule?requestId=<encoded id>'; throws TypeError on empty or blank id

/** Absolute deep link, for email and calendar bodies. */
export function buildAppointmentRequestReviewUrl(
  appointmentRequestId: string,
  baseUrl: string = resolveAppBaseUrl(),
): string;
// -> `${baseUrl with trailing slashes trimmed}${buildAppointmentRequestReviewPath(id)}`

/** NEXT_PUBLIC_APP_URL || NEXT_PUBLIC_BASE_URL || 'http://localhost:3000', trailing slashes trimmed. */
export function resolveAppBaseUrl(): string;
```

Export it from `packages/scheduling/package.json`, next to the existing `./lib/appointmentApprovers` entry:

```json
"./lib/appointmentRequestLinks": {
  "import": "./src/lib/appointmentRequestLinks.ts",
  "types": "./src/lib/appointmentRequestLinks.ts"
}
```

Check that `server`'s and `client-portal`'s TypeScript paths and vitest aliases resolve the new subpath. The existing `@alga-psa/scheduling/lib/appointmentApprovers` import in msp-composition shows the pattern. Add an alias entry wherever a config lists scheduling subpaths explicitly.

## Changes

| File | Change |
|---|---|
| `packages/scheduling/src/lib/appointmentRequestLinks.ts` | New. The helper above. |
| `packages/scheduling/package.json` | Add the `./lib/appointmentRequestLinks` export. |
| `packages/client-portal/.../appointmentRequestActions.ts:715` | `approvalLink: buildAppointmentRequestReviewUrl(appointmentRequest.appointment_request_id)` |
| `packages/client-portal/.../appointmentRequestActions.ts:752` | `link: buildAppointmentRequestReviewPath(appointmentRequest.appointment_request_id)` |
| `packages/client-portal/.../appointmentRequestActions.ts:1478` | `link: buildAppointmentRequestReviewPath(request.appointment_request_id)` |
| `server/src/app/api/public/appointment-request/route.ts:388` | `approvalLink: buildAppointmentRequestReviewUrl(appointmentRequestId)`. `appointmentRequestId` is the `uuidv4()` from line 239, already used for the insert at line 243. |
| `packages/scheduling/src/lib/teamsMeetingContent.ts:90-91` | Replace the local `baseUrl`/`psaLink` with `buildAppointmentRequestReviewUrl(params.appointmentRequestId)`. |
| `packages/scheduling/src/components/schedule/SchedulePage.tsx:24` | `searchParams?.get(APPOINTMENT_REQUEST_ID_PARAM)` |
| `packages/notifications/src/components/NotificationDetailView.tsx:176` | Leave the behaviour as is. Add `// LEVERAGE: pattern appointment-request-review-link — rebuilds /msp/schedule?requestId= because notifications cannot import @alga-psa/scheduling; the stored notification.link is already canonical`. See Out of scope. |
| `docs/plans/2026-07-17-email-template-variables-inventory.json:584-589` | Update the `approvalLink` description, example and notes (below), then regenerate `seed.ts`. |
| `packages/notifications/src/lib/templateVariables/seed.ts` | Regenerated only. |

### Seed entry (`new-appointment-request` → `approvalLink`)

- **description:** "Deep link that opens this request in the schedule page's Appointment Requests panel so MSP staff can review and approve it."
- **example:** `https://app.algapsa.com/msp/schedule?requestId=3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64`
- **notes:** "Optional. 'Review & Approve' button shown only inside {{#if approvalLink}}. Both call sites (portal action and public route) build it with buildAppointmentRequestReviewUrl from @alga-psa/scheduling/lib/appointmentRequestLinks: `<app base URL>/msp/schedule?requestId=<appointment_request_id>`. An unknown or stale id opens the panel with nothing selected."

Regenerate with:

```bash
node packages/notifications/scripts/generate-variable-registry-seed.mjs
git diff --stat packages/notifications/src/lib/templateVariables/seed.ts   # expect only the approvalLink entry to change
```

The email templates need no changes. The DB templates (`server/migrations/utils/templates/email/appointments/newAppointmentRequest.cjs`, plus the earlier migrations) and the fallback in `packages/email/src/system/SystemEmailService.ts:883,916` already render `{{approvalLink}}` or `data.approvalLink` verbatim. The new value contains `?` and `=` but no `&`, so Handlebars HTML escaping leaves the href as it is.

## Tests

| # | Test | Where | Asserts |
|---|---|---|---|
| T1 | Helper unit | `packages/scheduling/src/lib/__tests__/appointmentRequestLinks.test.ts` (new; already covered by the `src/**/*.test.ts` include) | The path is `/msp/schedule?requestId=<id>` and contains the id. The URL with an explicit base trims trailing slashes. The base falls back from `NEXT_PUBLIC_APP_URL` to `NEXT_PUBLIC_BASE_URL` to localhost (`vi.stubEnv`). Ids with reserved characters are encoded. Empty or blank ids throw. `new URL(url).searchParams.get(APPOINTMENT_REQUEST_ID_PARAM)` returns the original id (round trip). |
| T2 | Teams body unchanged | existing `packages/scheduling/src/lib/__tests__/teamsMeetingContent.test.ts` and `server/src/test/unit/scheduling/appointmentRequestMeetingLifecycle.test.ts:364` | Still green after the Teams body moves to the helper. |
| T3 | Portal email path | `server/src/test/integration/appointmentNotifications.integration.test.ts`, test "should send new appointment request email to MSP staff" (around line 325) | Capture `result.data.appointment_request_id`. For every `sendNewAppointmentRequestMock` call, `emailData.approvalLink` equals `buildAppointmentRequestReviewUrl(id)` and ends with `?requestId=${id}`. The existing in-app link assertions (lines 626, 782, 1118) stay as they are and now exercise the helper through lines 752 and 1478. |
| T4 | Public email path | `server/src/test/unit/appointments/publicAppointmentRequestRoute.approvalLink.test.ts` (new; the route has no tests today) | Call `POST` with a `NextRequest`. Mock `@alga-psa/db` (`getTenantIdBySlug`, `tenantDb`, tz helpers), `@/lib/db/db`, `getServicesForPublicBooking`, `@alga-psa/scheduling/actions` (`getTenantSettings`, `formatDate`, `formatTime`), `resolveAppointmentApproverUserIds` (one approver) and `SystemEmailService`. Capture the `appointment_request_id` written to `appointment_requests`. Assert `sendNewAppointmentRequest` received `approvalLink === buildAppointmentRequestReviewUrl(thatId)` and `isAuthenticated: false`. Also assert the response does **not** contain the request id: the public caller only ever gets `reference_number`. |
| T5 | Schedule page opens from the link | `packages/scheduling/tests/SchedulePage.requestDeepLink.test.tsx` (new). **Add it to the explicit `include` list in `packages/scheduling/vitest.config.ts`**, because `.tsx` tests are not globbed. | Use the `SchedulePage.headerStability` harness. Mock `useSearchParams` to return `requestId=<id>` and replace `AppointmentRequestsPanel` with a prop-capturing stub. The panel receives `isOpen: true` and `highlightedRequestId: <id>`. With no parameter, `isOpen` is false and `highlightedRequestId` is null. |
| T6 | Stale or unknown id degrades cleanly | `packages/scheduling/tests/AppointmentRequestsPanel.highlight.test.tsx` (new; add to `include`) | Render the real panel with `getAppointmentRequests` mocked. (a) Unknown id: no request is selected, `toast.error` and `handleError` are not called, and nothing throws. (b) Id of an `approved` request: the filter switches to `all` and that request is selected. (c) Id of a `pending` request: it is selected. |
| T7 | Seed matches the helper | `server/src/test/unit/scheduling/appointmentRequestReviewLink.contract.test.ts` (new) | Find `new-appointment-request` → `approvalLink` in `templateVariableSeed`. Its `example` equals `buildAppointmentRequestReviewUrl('3f2b8c1e-6a4d-4e7b-9c1a-2d5e8f0a7b64', 'https://app.algapsa.com')`. |
| T8 | Seed registry | existing `packages/notifications/src/lib/templateVariables/registry.test.ts` | Still green after regeneration. |

### How to run

```bash
WT=/home/robert/alga-copies/feature-appointment-request-email-review-approve-link-mi

# T1, T2 (scheduling half), T5, T6
cd $WT/packages/scheduling && npx vitest run \
  src/lib/__tests__/appointmentRequestLinks.test.ts \
  src/lib/__tests__/teamsMeetingContent.test.ts \
  tests/SchedulePage.requestDeepLink.test.tsx \
  tests/AppointmentRequestsPanel.highlight.test.tsx

# T8
cd $WT/packages/notifications && npx vitest run src/lib/templateVariables/registry.test.ts

# T2 (server half), T4, T7: unit, no DB
cd $WT/server && npx vitest run \
  src/test/unit/scheduling/appointmentRequestMeetingLifecycle.test.ts \
  src/test/unit/appointments/publicAppointmentRequestRoute.approvalLink.test.ts \
  src/test/unit/scheduling/appointmentRequestReviewLink.contract.test.ts

# T3: integration, needs the test DB (compose project alga-psa-local-test; see the integration-testing skill)
cd $WT/server && npx vitest run src/test/integration/appointmentNotifications.integration.test.ts

# Type checks for every touched package
cd $WT && npx tsc --noEmit -p packages/scheduling && npx tsc --noEmit -p packages/client-portal && npx tsc --noEmit -p server
```

### Manual smoke

The dev server is at `http://feature-appointment-request-email-review-approve-link-mi.localhost:3331`.

1. Submit a request from the client portal. Open the staff email (GreenMail or the email log). "Review & Approve" should go to `/msp/schedule?requestId=<id>`, open the Appointment Requests panel and select that request.
2. Repeat through the public booking form (`/api/public/appointment-request`). The request has no client, and the panel must still list and select it.
3. Open `/msp/schedule?requestId=00000000-0000-0000-0000-000000000000` and `/msp/schedule?requestId=garbage`. The panel opens with nothing selected and no error toast.
4. Approve the request, then follow the same email link again. The panel switches to `all` and selects the request in its approved state.

## Risks

- **Public, unauthenticated route.** The id in the link is a server-generated `uuidv4()` (route.ts:239), not caller input, so the caller cannot inject anything into the URL. The link goes only to internal staff (`user_type: 'internal'`, active, resolved approvers or the preferred technician). It is not returned to the public caller, who still gets only `reference_number`; T4 asserts this. Opening `/msp/schedule` still requires an MSP session, and `getAppointmentRequests` stays tenant-scoped and permission-checked, so the id is a locator and grants no access. The rate limiter and validation are untouched.
- **Recipient visibility.** `getAppointmentRequests` (`appointmentRequestManagementActions.ts:367`) requires `user_schedule` read or update permission. It shows everything to full-access users and company-wide approvers. Other users see requests for themselves, technicians they manage or report over, and technicians they approve for. These scopes cover the recipients the emails resolve to (preferred technician plus approvers), so a recipient's link finds its request. A recipient who lacks `user_schedule` permission gets the panel's existing "Failed to load" toast. That gap is pre-existing, comes from approver configuration, and the link change does not alter it.
- **Stricter base URL.** Emails previously sent `undefined/msp/schedule` when `NEXT_PUBLIC_APP_URL` was unset. They now fall back to `NEXT_PUBLIC_BASE_URL`, then localhost. That is better, but a misconfigured production deployment will now send a localhost link instead of an obviously broken one. Production sets `NEXT_PUBLIC_APP_URL`, so the risk is low.
- **New subpath export.** If a bundler or vitest config lists scheduling subpaths explicitly, it needs the new entry. The type checks and T4/T7 (server-side imports) will catch a miss.
- **Generated seed.** Hand-editing `seed.ts` would be lost on the next regeneration. The plan edits the inventory JSON and regenerates.
- **Emails already sent.** Emails that went out before the deploy keep the bare link. That is acceptable, because the panel's pending list is still reachable from the page.

## Out of scope

- `NotificationDetailView.tsx:176` still rebuilds the link from `metadata.appointment_request_id`. Making it open the stored `notification.link`, which the helper now builds, would remove the copy. That change alters click handling for notifications created before the fix and touches a package that cannot import scheduling, so this plan only adds a LEVERAGE marker.
- The client-portal links (`/client-portal/appointments/<id>` at appointmentRequestActions.ts:733 and 1453, and `portalLink` at 642) could be centralised the same way. They have no reported bug, so they are not changed here.
- Changing what the panel shows for unknown ids, such as a "request not found" notice. The current silent fallback meets the ticket.
- Stale line numbers in the inventory JSON's `uncertainties` and `notes` text (for example "route.ts lines 355-373"). These are pre-existing documentation drift, unrelated to the link.
- Email template copy or styling.

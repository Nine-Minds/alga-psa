# Scratchpad — Client portal service requests: show ticket number, not GUIDs

- Plan slug: `service-request-ticket-number-display`
- Created: `2026-11-10`
- Source: AlgaPSA ticket alga-2026-0002989
- Code facts verified against origin/main at `88c634d5b5`

## Verified code facts

All paths are relative to the repo root. Prefixes:
- `rs/` is `server/src/app/client-portal/request-services/`
- `lib/` is `server/src/lib/service-requests/`

### Banner and redirect

- **Catalog banner:** `rs/page.tsx` lines 68-89.
  - It reads `searchParams.submitted` and `searchParams.ticketId` (lines 37-41) and renders
    both raw.
  - The ticket GUID is both the link text and the `href` (`font-mono`).
  - Nothing validates `ticketId`: the URL value is reflected as is.
- **Duplicate banner:** `rs/[definitionId]/page.tsx` lines 85-106.
  - **Different from the brief:** this banner is unreachable.
    - `rs/[definitionId]/actions.ts` sends successes to the catalog page through
      `buildRequestServiceCatalogRedirectUrl({ submitted, ticketId })` (lines 312-317).
    - The definition page only receives `?error=` (lines 297-302).
    - A repo-wide grep for `submitted=` found no other producer.
  - Decision: delete the banner rather than fix it.
  - Its test `rs/[definitionId]/page.test.tsx` "renders a linked ticket reference in the
    successful confirmation state" (line 57) must be deleted with it.
- **Redirect test:**
  `server/src/test/unit/app/client-portal/request-services/submitRequestServiceDefinitionAction.test.ts`
  lines 142-149 assert `?submitted=submission-1&ticketId=ticket-1`. Update it.

### Detail page and queries

- **Detail page:** `rs/my-requests/[submissionId]/page.tsx`.
  - Lines 71-74: the "Request ID" paragraph shows `submission.submission_id` in `font-mono`.
  - Lines 90-100: the ticket paragraph uses `submission.created_ticket_id` as the link text.
  - Lines 101-105: the workflow line, which belongs to the sibling card. Don't touch it.
  - Lines 166-168: attachment file IDs, also the sibling card's.
- **Detail query:** `lib/submissionHistory.ts` `getClientServiceRequestSubmissionDetail`
  (around lines 329-384).
  - Filters on `submission.client_id` and `submission.submission_id`.
  - Joins only `service_request_definition_versions`. There is no `tickets` join.
- **List query:** `listClientServiceRequestSubmissions` (around lines 301-327).
  - Left `tenantJoin`s `tickets` with `rootTenantColumn: 'submission.tenant'` and selects
    `ticket.ticket_number`.
  - Row type: `ServiceRequestClientSubmissionListRow`, with `ticket_number: string | null`.
- **Access scope is client-level, not requester-level.**
  - Every client-facing query filters on `submission.client_id`.
  - The actions (`rs/my-requests/actions.ts`, `rs/actions.ts`) resolve the client with
    `getAuthenticatedClientId`, and return `[]` or `null` for non-client user types.
  - The brief said "scoped to the requester's access". The existing scope is the client,
    and this plan keeps it.
- `rs/actions.ts` `listMyRecentServiceRequestsAction(limit)` loads every client submission
  and slices in memory. The catalog page calls it with 1000.
  - Resolving the banner from those rows would work, since the newest is first.
  - It was rejected because it couples the banner to a page-level fetch limit. The plan uses
    a dedicated summary lookup that shares the list's query builder.

### Ticket number formatting

- `rs/my-requests/MyRequestsTable.tsx` lines 89-104.
  - The ticket column renders `#${row.ticket_number}`, or `labels.view` ("View") when the
    number is null but an ID exists.
  - The `#` is a hardcoded literal. The client portal ticket detail does the same
    (`packages/client-portal/src/components/tickets/TicketDetails.tsx:610`).
- There is no shared ticket-number link component in `packages/ui` or `packages/client-portal`.
  I searched for `TicketNumberLink`, `TicketLink` and `TicketReference`. The plan adds
  `ServiceRequestTicketLink` locally in `rs/`.

### Providers and email

- **Ticket creation:** `shared/models/ticketModel.ts` `CreateTicketOutput` (lines 308-311)
  includes `ticket_number: string`. `createTicketWithRetry` is at line 946.
- **Ticket-only provider:** `lib/providers/builtins/ticketOnlyExecutionProvider.ts` lines
  253-256 return only `createdTicketId`. Lines 238-251 publish `TICKET_CREATED` with
  `suppressContactNotifications: true`.
- **Result contract:** `lib/providers/contracts.ts` lines 27-34 define
  `ServiceRequestExecutionResult`, which has no ticket number.
- **Consumers of `createdTicketId`:**
  - `lib/submissionService.ts`: persists it as `created_ticket_id` and returns it in
    `SubmitPortalServiceRequestResult`. The replay path (`toReplayedSubmissionResult`)
    returns stored columns only.
  - `ee/server/src/lib/service-requests/providers.ts`: wraps ticket-only, maps
    `createdTicketId` into workflow inputs (line 75), and uses it in a workflow idempotency
    key (line 106).
  - Nobody would consume a ticket number on the result. Decision: don't add it (see the PRD).
- **No email.** Nothing under the service-requests code, the migrations or the email packages
  defines a service request email template. The only `*request*` templates are for
  appointment requests. `suppressContactNotifications` is honored by
  `ticketEmailSubscriber.ts:112`, `internalNotificationSubscriber.ts:73` and
  `surveySubscriber.ts:122`. The client gets no confirmation email, so there is nothing to
  change.

### Locales

- 11 locale folders: de, en, es, fr, it, nl, pl, pt, sv, plus the pseudo-locales xx and yy.
  Every one has `client-portal/service-requests.json`.
- xx and yy are generated (`node scripts/generate-pseudo-locales.cjs`). Never hand-edit them.
- Keys in use today:
  - `detail.requestIdLabel` ("Request ID: ") and `detail.ticketIdLabel` ("Ticket ID: "):
    used only by the two banners.
  - `submissionDetail.requestIdLabel` and `submissionDetail.ticketLabel`: used only by the
    detail page.
  - Grep confirms there are no other references.

## Decisions

- **Redirect.** It carries only `submitted=<submission_id>`. The banner data comes from a
  client-scoped lookup. A URL `ticketId` is ignored, and nothing in the URL is trusted.
- **Unresolved `submitted`.** No banner, rather than a banner with blanks.
- **Data layer.** One shared query builder backs both the client list and the new
  single-row summary. The detail query adds the same `tickets` join.
- **Ticket reference.** One `ServiceRequestTicketLink` component for the banner, the detail
  page and the table. That is three sites of the same shape, so the component is extracted
  instead of copied.
- **No ticket number on the execution result.** See the PRD, Data / API section.
- **No submission number sequence.** The request name and date identify a request.
- **Sibling card merge hygiene.** Detail-page edits are limited to the Request ID paragraph,
  the ticket paragraph and one import (details in the PRD under Rollout).

## Gotchas

- `MyRequestsTable` is a client component. Keep `ServiceRequestTicketLink` hook-free (labels
  passed as props) so both server and client components can use it.
- The banner date must be formatted on the server with the user's locale and country date
  format. Follow the detail page's pattern: `formatDate`, `getServerLocale()`, and
  `getDateFormatPreference().catch(() => SYSTEM_DATE_FORMAT)`.
- The catalog page test mocks `server/src/app/client-portal/request-services/actions`. The new
  summary action lives in `rs/my-requests/actions.ts`, next to the detail action, so the
  catalog test needs a mock for that module too.

## Commands / Runbooks

- Run the unit tests (vitest) from `server/`:

  ```
  npx vitest run src/test/unit/app/client-portal/request-services \
    'src/app/client-portal/request-services'
  ```

- Run the integration test (needs a migrated test DB):

  ```
  npx vitest run src/test/integration/serviceRequestPortalHistory.integration.test.ts
  ```

- Locales, from the repo root:

  ```
  node scripts/generate-pseudo-locales.cjs && node scripts/validate-translations.cjs
  ```

## Links / References

- Source ticket: alga-2026-0002989
- Sibling card: `service-request-portal-internal-data-leak`. It edits the same detail page:
  execution status, workflow ID, file IDs and history.

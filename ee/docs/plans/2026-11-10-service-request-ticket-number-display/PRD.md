# PRD — Client portal service requests: show ticket number, not GUIDs

- Slug: `service-request-ticket-number-display`
- Date: `2026-11-10`
- Status: Ready for implementation
- Source: AlgaPSA ticket alga-2026-0002989
- Type: Bug (no feature flag, no toggle)
- Size: one pull request

## Summary

After a client submits a service request in the client portal, the success banner shows
"Request ID: <submission GUID>" and "Ticket ID: <ticket GUID>". The submission detail page
also shows the submission GUID and uses the ticket GUID as link text. Clients write down
and quote the human-readable ticket number (for example `#100150`), which the portal never
shows in these places. Replace the GUIDs with the ticket number, linked to the ticket, and
identify the request by its name and submitted date instead of its GUID.

## Problem

- The success banner on `/client-portal/request-services` renders the two raw GUIDs from the
  redirect URL (`?submitted=<submission_id>&ticketId=<ticket_id>`).
- The banner reflects whatever `ticketId` is in the URL as both link text and link target.
  Nothing checks that the value belongs to the signed-in client. The ticket page enforces
  its own access, so this does not leak data, but a crafted link can make the portal show an
  arbitrary "Ticket ID".
- The submission detail page (`/client-portal/request-services/my-requests/<id>`) shows
  "Request ID: <submission GUID>" under the title and the ticket GUID as the ticket link
  text.
- The "Your requests" table already shows `#<ticket_number>`. The banner and detail page
  disagree with it.

Clients can't match what the portal shows them to what the MSP's technicians and emails
call the ticket. That leads to support back-and-forth.

## Goals

1. The success banner shows the request name, the submitted date, and "Ticket #<number>"
   linked to the ticket, once a ticket exists. It shows no GUIDs.
2. The submission detail page shows "Ticket #<number>" linked to the ticket. It no longer
   shows the submission GUID.
3. The banner's data comes from a server lookup that is scoped to the signed-in client, not
   from values in the URL. The redirect carries only the submission ID.
4. One client-scoped submission query shape provides `ticket_number` to the list, the banner
   and the detail page. One small component renders the ticket reference in all three
   places.

## Non-goals

- A human-readable submission number or sequence. Submissions stay identified by name and
  date.
- Carrying `ticketNumber` on `ServiceRequestExecutionResult` or `SubmitPortalServiceRequestResult`
  (see Data / API below).
- MSP-side (admin) submission views. They are for internal users and may show IDs.
- The rest of the submission detail page: execution status wording, the workflow ID line,
  attachment file IDs, the history section and the submitted-answers rendering. The sibling
  card `service-request-portal-internal-data-leak` owns those.
- A service request confirmation email. None exists. The ticket-only provider publishes
  `TICKET_CREATED` with `suppressContactNotifications: true`, and there is no service request
  email template. Nothing to change.
- Whether a client user may see a ticket number for a submission they can see but whose
  ticket is restricted from them, for example by board or visibility group. Submission access
  is client-wide today, and the "Your requests" table already shows these numbers. This plan
  does not widen that exposure.
- Pages that reach the submission flow through an execution provider's external redirect, such
  as a payment checkout. They don't use the banner.

## Users and Primary Flows

Persona: a client portal user (a client contact) who submits service requests.

1. **Submit.** The user fills in a request form and submits it. The submit action redirects
   to `/client-portal/request-services?submitted=<submission_id>`. The page looks up that
   submission for the user's client and shows the success banner. The banner has the
   request name, the submitted date and time, and "Ticket #100150" linked to
   `/client-portal/tickets/<ticket_id>`. If the provider has not created a ticket (store-only
   or still pending), the ticket line is left out.
2. **Revisit.** The user opens "Your requests", then a request's details. The page header
   shows the request name. The status section shows the submitted date and
   "Ticket #100150" linked to the ticket. No GUID appears anywhere in this flow.
3. **Unknown or foreign `submitted` value.** The lookup returns nothing: the ID is unknown,
   belongs to another client, or is garbage. The page renders no banner. It does not render
   a banner with blanks.

## UX / UI Notes

- Banner: keep the existing `Alert variant="success"`, the title "Request submitted", and
  the current position at the top of the catalog page. The body has two lines:
  - `<request name>, submitted <date/time>`
  - `Ticket #100150`. The `#100150` part is a link to the ticket. The line is shown only
    when the submission has a ticket.
- Detail page: delete the "Request ID: …" line under the `<h1>`. The title is already the
  request name, and the status section already shows "Submitted: <date>". The status
  section's ticket line becomes `Ticket #100150`, with the number as the link.
- One component, `ServiceRequestTicketLink`, renders the ticket reference. It is used by the
  banner, the detail page and the `MyRequestsTable` ticket column. Its output:
  - `#<ticket_number>` as a link when a number is available.
  - A "View ticket" link when the ticket ID is present but the number did not resolve, for
    example a deleted ticket. This matches the table's current fallback.
  - Nothing when there is no ticket.
- Don't use a monospace font for the ticket number. That style was there because the values
  were GUIDs.
- Format the date on the server. Use `formatDate` with `getServerLocale()` and
  `getDateFormatPreference()`, the same as the detail page.
- Never show raw IDs: no submission ID or ticket ID text anywhere in the client view.

## Requirements

### Functional Requirements

**Submit redirect**

- FR1: After a successful submit, the action redirects to
  `/client-portal/request-services?submitted=<submission_id>` with no `ticketId` parameter.
  The external-redirect path (`outcome.redirectUrl`) and the error path are unchanged.

**Catalog banner**

- FR2: The catalog page ignores any `ticketId` search parameter. It resolves `submitted`
  through a client-scoped server lookup. The lookup returns the submission's name, submitted
  timestamp, `created_ticket_id` and the joined `ticket_number`.
- FR3: The banner renders only when the lookup returns a row.
- FR4: The banner shows the request name and the localized submitted date and time. When the
  submission has a ticket, it also shows "Ticket #<number>" linked to the ticket.

**Definition page**

- FR5: Remove the duplicate success banner and the `submitted`/`ticketId` search params from
  `[definitionId]/page.tsx`. No code path redirects there on success: the submit action
  sends successes to the catalog page and only errors to the definition page. Keep the
  error banner.

**Detail page**

- FR6: Remove the "Request ID: <submission_id>" line from the detail page.
- FR7: The detail page's ticket line renders through `ServiceRequestTicketLink`, using the
  `ticket_number` returned by the detail query.

**Data layer**

- FR8: `getClientServiceRequestSubmissionDetail` left-joins `tickets` (tenant-joined, the same
  as the list) and returns `ticket_number: string | null`.
- FR9: The banner needs no new query. `listClientServiceRequestSubmissions` already returns
  `ticket_number` for every submission of the caller's client.
- FR10: Add no new server action. The catalog page already loads the caller's own submissions
  (newest first) through `listMyRecentServiceRequestsAction`, and it resolves the banner by
  finding the `submitted` id in that list. An id that is not one of the caller's own
  submissions renders no banner. A separate summary action would be a new portal action with
  no permission check, and the permission-coverage contract does not allow new ones.
- FR11: `MyRequestsTable`'s ticket column renders through `ServiceRequestTicketLink`. The
  table's output does not change.

**Locales**

- FR12: Update locale keys in `server/public/locales/*/client-portal/service-requests.json`.
  - Remove `detail.requestIdLabel`, `detail.ticketIdLabel`, `submissionDetail.requestIdLabel`
    and `submissionDetail.ticketLabel`.
  - Add `submittedBanner.summary` ("{{requestName}}, submitted {{date}}"),
    `ticketReference.label` ("Ticket") and `ticketReference.viewTicket` ("View ticket").
  - Translate the new keys for de, es, fr, it, nl, pl, pt and sv.
  - Regenerate the xx and yy pseudo-locales.

### Non-functional Requirements

- Follow the i18n rules in `docs/AI_coding_standards.md`: no hardcoded user-facing text, and
  use interpolation rather than string concatenation.
  - The literal `#` prefix stays in code. That matches the client portal's existing
    `#{ticket_number}` convention in `TicketDetails.tsx` and `MyRequestsTable`.
- No new queries on the catalog page unless `submitted` is present.

## Data / API / Integrations

- No schema change. `ticket_number` comes from a left join on `tickets` using the existing
  `tenantDb().tenantJoin` pattern with `rootTenantColumn: 'submission.tenant'`. The join is
  Citus-safe because it is co-located on `tenant`.
- **Decision: do not add `ticketNumber` to `ServiceRequestExecutionResult`.**
  - The portal reads the number from the persisted submission joined to `tickets`. That is
    the single source of truth. It also covers replayed submissions: the replay path returns
    only stored columns and has no ticket number to carry.
  - Adding the field would force every provider to supply it. That means the built-in
    ticket-only provider, and the EE workflow providers that wrap it and pass
    `createdTicketId` on as workflow input and idempotency key.
  - Today nothing would consume it. The redirect deliberately does not carry it, and the
    workflow providers key on the ticket ID.
  - A future consumer that needs the number can join it in the same way.
- Nothing to change for email (see Non-goals).

## Security / Permissions

- Before this change, the banner trusted a `ticketId` from the URL. After it, the banner
  shows only data returned by a lookup filtered by `submission.client_id = <authenticated
  client>`, inside `withAuth`. MSP users get `null` from the action.
- Access scope is client-level, the same as the existing list and detail actions. It is not
  limited to the requester. That is deliberate and unchanged.

## Observability

None. No new signals are needed.

## Rollout / Migration

- No migration or flag.
- Old bookmarked URLs with `&ticketId=` still work: the parameter is ignored and the banner
  resolves from `submitted`.
- **Merge coordination with sibling card `service-request-portal-internal-data-leak`:**
  - This plan edits only these parts of `my-requests/[submissionId]/page.tsx`:
    - the "Request ID" paragraph under the `<h1>`
    - the `created_ticket_id` ticket paragraph in the status section
    - one import
  - It does not touch the submitted-at, execution status, version and workflow lines, the
    answers, the attachments or the history.
  - In `submissionHistory.ts`, it adds one join and one selected column to
    `getClientServiceRequestSubmissionDetail`, and it refactors the list query. If the
    sibling also edits that select list, expect a trivial textual conflict.
  - In the locale files, it touches only the keys listed in FR12.

## Open Questions

None. The scope was decided upstream.

## Acceptance Criteria (Definition of Done)

1. Submitting a ticket-creating service request lands on the catalog page.
   - The banner shows the request name, the submitted date/time, and "Ticket #<number>"
     linked to `/client-portal/tickets/<id>`.
   - The URL contains only `submitted=<id>`.
   - No GUID text is visible.
2. A store-only submission shows the banner without a ticket line.
3. A `submitted` value that is unknown or belongs to another client renders no banner. A
   `ticketId` value in the URL is never rendered.
4. The submission detail page shows "Ticket #<number>" as a link and no submission or ticket
   GUID text, in the parts this plan owns.
5. The "Your requests" table output is unchanged, and it renders through the shared
   component.
6. `node scripts/validate-translations.cjs` passes, with no references left to the removed
   keys.
7. The tests in `tests.json` pass.

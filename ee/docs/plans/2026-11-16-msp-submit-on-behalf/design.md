# Design — MSP submits a service request on behalf of a client contact

Card `e7b32dbb` · internal PSA `alga-2026-0003313` · branch
`feature/service-requests-let-technicians-submit-a-reques` · app `:3768`.
Step: Design Session (conn — XO desk).

## What exists

- `submitPortalServiceRequest` (`server/src/lib/service-requests/submissionService.ts:254`) is the only
  write path. It takes `{requesterUserId, clientId, contactId}` **as trusted inputs** and derives
  visibility, audience, `contextDefaults`, the persisted submission row, the audit event and the ticket
  from them.
- Its one caller is the client-portal action
  (`server/src/app/client-portal/request-services/[definitionId]/actions.ts:222`), which refuses every
  non-client user and fills those three fields from the **logged-in user** (`:226-228`). That is the whole
  gap: an MSP user can never be the "requester".
- Everything downstream is already identity-parameterised, not session-parameterised:
  `getVisiblePublishedServiceRequestDefinitionDetail` evaluates the visibility provider **and** the
  audience predicate against `loadRequesterRecord(requester)`; `ticketOnlyExecutionProvider` writes
  `client_id`, `contact_id` and `entered_by` from the execution context.
- `service_request_submissions` has `requester_user_id` **nullable**, `client_id`, `contact_id` — and no
  concept of "who did this on the client's behalf".

So the feature is not a new subsystem. It is **a requester substitution plus the one field the model
lacks: the submitter.**

## Design

### 1. A `ServiceRequestRequester` value, carried explicitly

Introduce `server/src/lib/service-requests/requester.ts`:

```ts
export interface ServiceRequestRequester {
  clientId: string;
  contactId: string;
  /** The contact's portal user, when one exists. NEVER the technician. */
  requesterUserId: string | null;
  /** The MSP user who filed it; null when the requester filed it themselves. */
  submittedByUserId: string | null;
}
```

The rule that matters: **the technician never occupies `requester_user_id`.** Visibility providers,
audience predicates, `contextDefaults` placeholders and the ticket's contact must all see the contact; if
the technician leaked into `requester_user_id`, every audience rule keyed on `contact.tags`/`contact.group`
would be evaluated for the wrong party and the record would claim a technician was the client.

A contact with no portal user is the *normal* MSP case, not an error: `requesterUserId` stays `null` and
the contact is still the requester (`client_id`, `contact_id`, audience, defaults and ticket contact are
all contact-derived).

Plumbing changes, all backward compatible:

| Location | Change |
| --- | --- |
| `SubmitPortalServiceRequestInput` (`submissionService.ts:27`) | `requesterUserId: string \| null`; new `submittedByUserId?: string \| null` |
| `ServiceRequestExecutionContext` (`providers/contracts.ts:14`) | same widening; providers that need an actor use `submittedByUserId ?? requesterUserId` |
| `service_request_submissions` | new nullable `submitted_by_user_id`; `NULL` means "the requester filed it themselves" (no backfill — history is not rewritten) |
| `ticketOnlyExecutionProvider.execute` (`:197`) | `entered_by: submittedByUserId ?? requesterUserId`; `client_id`/`contact_id` unchanged; origin below |
| audit `service_request_submission_created` (`submissionService.ts:377`) | `details.submitted_by_user_id`, `userId` = the acting user |
| search events / `publishTicketCreated` actor | the acting user, not the contact |

### 2. Ticket origin: the app recorded a *client request entered by staff*

The provider today hardcodes `source: 'client_portal'`, `ticket_origin: 'client_portal'`
(`ticketOnlyExecutionProvider.ts:308-309`). On-behalf-of submissions are not portal submissions, and an
operator filtering "client portal" tickets must not get tickets a technician typed. Use the existing
`TICKET_ORIGINS.INTERNAL` (`packages/types/src/interfaces/ticket.interfaces.ts:19`) with
`source: 'msp'` for MSP-entered submissions, keeping `client_portal` for the portal path — the context
carries `submittedByUserId`, so the choice is `submittedByUserId ? INTERNAL : CLIENT_PORTAL`. The
implement step confirms `tickets.source` accepts the literal (there is no DB check constraint on it today;
if there is, use the closest documented value rather than adding an enum value).

### 3. One resolver, three thin entry points

New `server/src/lib/service-requests/mspSubmissions.ts`:

- `resolveRequesterForMspSubmission(knex, tenant, {clientId, contactId})`
  — validates the contact belongs to the client (row exists in `contacts` with that `client_id`),
  resolves the contact's **active** `user_type='client'` portal user (if any), returns a
  `ServiceRequestRequester` with `submittedByUserId` filled by the caller. Unknown contact/client ⇒
  `NotFoundError`-shaped failure, never a silent empty form.
- `listDefinitionsForRequester(knex, tenant, requester)`
  — delegates to `listVisibleServiceRequestCatalogItems` (`portalCatalog.ts:47`) with the substituted
  requester. **The technician's picker shows exactly the catalog the contact would see** — the visibility
  provider and audience predicate decide, not a technician-specific rule. This is the general form of the
  requirement "respect visibility provider": there is one visibility engine, two doors.
- `submitOnBehalfOfMsp({knex, tenant, definitionId, requester, payload, attachments, clientSubmissionKey})`
  — calls `submitPortalServiceRequest` with the substituted identity; no second write path.

MSP server actions (`server/src/app/msp/service-requests/onBehalfActions.ts`) wrap these with
`requireServiceRequestPermission(user, 'read' | 'create')` and pass `submittedByUserId = user.user_id`.

**Authorization decision.** Submission requires `service:read` (choose and open forms) and
`service:create` (submit) — the two existing actions on the `service` resource that
`requireServiceRequestPermission` already enforces for the authoring screens
(`server/src/app/msp/service-requests/actions.ts:94-107`). Deliberately **not** inventing a
`service_request:*` permission resource in this card: the RBAC resource set is being reconciled elsewhere,
and a half-provisioned resource is what card `81594969` exists to fix. There is no client-scoped MSP RBAC
anywhere in the app, so imposing one here would be inventing a rule the rest of the app does not have;
the tenant boundary is the boundary. This is the one place I chose an existing gate over a new one, and it
is worth the captain's eye at review.

### 4. The form is shared, not copied

`RequestServiceForm.tsx` is a presentation component with an injected `action` and an optional
`visibility` bundle (`server/src/app/client-portal/request-services/[definitionId]/RequestServiceForm.tsx:62-76`)
— already reusable. Move it (with `clientSubmissionKey.ts` and its test) to
`server/src/components/service-requests/` and import it from both portals. A copy would be the second
implementation of required-field and conditional-visibility behaviour, which is precisely the
`LEVERAGE: pattern service-request-answer-display` trap the ticket provider already documents at
`ticketOnlyExecutionProvider.ts:100`.

The MSP page passes a `visibility.context` built from the **contact's** identity
(`{requesterUserId: contactUser ?? '' , clientId, contactId}`) — `computeVisibleFieldKeys` only reads
those three, and an empty requester id is already handled (the portal path does the same when a contact
has no user).

### 5. UI: one page, thin entry points

New route `/msp/service-requests/submit?clientId=&contactId=&definitionId=`:

1. Client select → Contact select (contacts of the chosen client; the canonical pickers, not new widgets).
2. Definition select, loaded for the chosen contact via `listDefinitionsForRequester`; changing the
   contact re-loads it. Empty state says the contact can see no published requests.
3. Shared `RequestServiceForm`, submitted through the MSP action with a fresh `clientSubmissionKey`.
4. On success: redirect to the created ticket (`/msp/tickets/<id>`), with the submission id in a toast —
   technicians live in the ticket view, not in a portal confirmation page.

Entry points, all deep links into that page:

- **Quick Create**: new `serviceRequest` type → `/msp/service-requests/submit`, with the
  `header.quickCreate.options.serviceRequest.*` i18n keys beside the existing eight
  (`server/src/components/layout/Header.tsx:74-150`, `QuickCreateDialog.tsx:9`).
- **Service Requests area**: a "Submit for a client" action next to "New definition".
- **Client and contact detail pages**: a button carrying `clientId`/`contactId`, so the common case
  ("the client called") is two clicks.
- All of them hidden for users without `service:read` (same `requiredPermission` mechanism already used
  by `menuConfig.ts` entries).

### 6. API

`POST /api/v1/service-requests/[definitionId]/submissions`
— API-key auth, body `{clientId, contactId, answers, clientSubmissionKey?}`, response
`{submissionId, executionStatus, ticketId}`, `404` when the contact cannot see the definition (`403` only
for a key lacking `service:create`).
`GET /api/v1/service-requests?clientId=&contactId=` lists the catalog for that contact — without it the
POST is unusable, since a caller cannot guess definition ids.

Both go through the same `mspSubmissions.ts` service; the controller/service/middleware split follows the
existing v1 pattern (`server/src/lib/api/controllers`, `services`, `middleware`). OpenAPI entry in
`server/src/lib/api/openapi` beside the rest.

### 7. Idempotency — the one real trap

`client_submission_key`'s partial unique index is
`(tenant, requester_user_id, definition_id, client_submission_key)`
(`server/migrations/20260902090000_add_service_request_submission_client_key.cjs:30-34`), and
`findSubmissionByClientKey` filters on `requester_user_id = <scope>`. Postgres treats `NULL`s as distinct
in a unique index, so **a contact with no portal user would not be deduplicated**: a double-click would
create two submissions and two tickets.

Fix inside this card: add a second partial unique index
`(tenant, submitted_by_user_id, definition_id, client_submission_key)
WHERE client_submission_key IS NOT NULL AND requester_user_id IS NULL`, and give
`findSubmissionByClientKey` a scope union (`requesterUserId` **or** `submittedByUserId` for the
null-requester case). Tested by submitting the same key twice through the MSP path and asserting one
submission, one ticket.

## Acceptance trace

> a technician can file any published service request for a client contact from the MSP app, producing
> the same submission/ticket as a portal submission with the technician recorded as submitter

- "any published service request … for a client contact": §3 catalog/visibility resolved as the contact;
  §5 page.
- "same submission/ticket as a portal submission": §3 reuses `submitPortalServiceRequest` unchanged —
  same validation, same visibility recomputation, same ticket body/template.
- "technician recorded as submitter": §1 `submitted_by_user_id` + `entered_by`; §2 origin distinguishes
  the door without losing the client context.
- Multiple doors: Quick Create, Service Requests area, client/contact pages, REST (§5, §6).

## What we are deliberately NOT doing

- **No second submission path.** Everything funnels through `submitPortalServiceRequest`.
- **No new permission resource** (§3) and no client-scoped MSP authorization — flagged for review.
- **No client-facing side effects**: ticket creation is already notification-suppressed
  (`suppressContactNotifications: true`); on-behalf-of must not start emailing the contact, and no
  portal-visible submission-list change is needed — the submission already appears there because
  `client_id`/`contact_id` are the contact's.
- **No workflow/Stripe execution-provider work.** They receive the widened context and behave as before;
  only the ticket provider changes.
- **No bulk submit, no "send this to the client to fill in", no saved draft.**
- **No editor/authoring changes.**

## Order of work

1. Migration (`submitted_by_user_id` + partial index) and the type widening through
   `submissionService` → provider context → ticket provider (portal path must stay green).
2. `requester.ts` + `mspSubmissions.ts` with unit tests.
3. MSP actions + route page + shared-form move (existing portal form tests move with it).
4. Quick Create + entry points + i18n.
5. REST controller/service + OpenAPI.
6. Integration test on real Postgres (below).

## Tests

- **Unit**: resolver rejects a contact outside the client and an inactive portal user (treated as "no
  portal user"); `listDefinitionsForRequester` hides definitions whose audience excludes the contact even
  though the technician can see every definition in the editor; ticket provider picks
  `entered_by = submittedByUserId` and `origin = internal` only when a submitter is set.
- **Integration (real Postgres, the card's own suite)**: submit on behalf of a contact **with** a portal
  user and one **without** → two submissions, `requester_user_id` NULL in the second and
  `submitted_by_user_id` = technician in both; tickets carry `contact_id` = contact, `client_id` = client,
  `entered_by` = technician, origin `internal`; audience-scoped definition is refused for an excluded
  contact; same-key replay yields one submission/one ticket; portal submission still records
  `client_portal` and its own requester.
- **Component**: shared form still satisfies its existing portal tests after the move; the MSP page
  re-loads definitions when the contact changes and renders an empty state when none are visible.
- **Manual (Prepare Human Review)**: sign in as `qa@emeraldcity.oz`, open Quick Create → Service request,
  pick a client and a contact **without** a portal login, submit a published form, land on the ticket,
  confirm the ticket shows the contact as contact and the technician as entered-by.

## Risks

- **The `string → string | null` widening of `requesterUserId`** touches providers, audit and search
  events. Compile errors are the map; the risk is a `?? ''` slipping in where a real id is required —
  review every call site, and keep the portal path's identity unchanged.
- **Authorization breadth** (§3): `service:create` may be granted more widely than "may act for a client".
  Acceptable because the app has no finer MSP gate; name it in the PR so the captain sees it at review.
- **Ticket origin choice** (§2): if operators have saved filters on `client_portal`, staff-entered tickets
  will not appear there. That is the intended correction, but it is a visible behaviour change.
- **Contact without a portal user** must never fall back to the technician's identity in
  `requester_user_id`; the integration test above exists specifically to catch that regression.

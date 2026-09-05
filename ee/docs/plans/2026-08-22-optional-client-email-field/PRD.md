# PRD — Optional Client Email Field

- Slug: `optional-client-email-field`
- Date: `2026-08-22`
- Status: Draft
- Branch: `feature/optional-email-field-for-client`

## Summary

Make the **client (company) email address optional** across client creation and
editing, while continuing to validate email **format** whenever a value is
supplied. Today a client cannot be created/saved without an email in some
representations; MSPs operating in regions where messaging apps (e.g. WhatsApp
in Brazil) are the primary contact channel need to onboard clients that simply
have no email on file.

## Problem

A customer reported (via email) that in Brazil WhatsApp — not email — is the
primary way they reach clients, so requiring an email on the client form blocks
legitimate client records. The email field should be optional rather than
required, without weakening validation for clients that *do* have an email.

Scope note: "client" here is the **company/client entity**, not contacts or the
client-portal user profile.

## Goals

- Client can be **created** with a blank/omitted email.
- Client can be **edited/saved** with a blank/omitted email (including clearing
  an existing email).
- When an email **is** supplied, it is still format-validated and normalized
  (trim + lowercase) exactly as today.
- Behavior is consistent across the three surfaces that touch client email:
  the MSP UI forms, the server actions, and the public REST/OpenAPI layer.

## Non-goals

- Making **contact** email optional (contacts keep their existing rules).
- Changing the **client-portal user profile** email requirement
  (`ProfileSection`), which is a portal-user identity, not the client entity.
- Making `billing_email` behave differently than it does today (it is already
  optional/format-validated).
- Any WhatsApp / alternate-channel contact-method feature — out of scope.

## Users and Primary Flows

- **MSP admin / dispatcher** creating a new client via Quick Add / Create Client:
  leaves email blank → client is created.
- **MSP admin** editing an existing client in Client Details: clears the email
  field → save succeeds.
- **API consumer** POST/PUT `/clients` without an `email` field → 2xx.

## UX / UI Notes

- The client email input must not render a required indicator (`*`) and must not
  block submit when empty.
- Inline format validation still fires when the user types an invalid email.
- Empty string, whitespace-only, and null are all treated as "not supplied".

## Requirements

### Functional Requirements

- FR1: Client create accepts missing/blank email.
- FR2: Client update accepts missing/blank email and can clear a previously set
  email (persisted as NULL).
- FR3: Supplied email is validated (RFC format, max length) and normalized.
- FR4: Read/representation schemas tolerate a null/absent client email so reading
  an email-less client never throws.
- FR5: OpenAPI/REST contract documents client email as optional (already true;
  verify and keep in sync).

### Non-functional Requirements

- No DB migration required — the `email` column on the clients/companies table is
  already nullable.
- No regression to contact validation or billing-email handling.

## Data / API / Integrations

Grounding (as found on this branch — much of the stack already treats client
email as optional; this plan closes the remaining gaps and locks it with tests):

- **DB:** `server/migrations/202410211120_add_email_to_companies.cjs` — `email`
  column is **nullable** (no `.notNullable()`). No later migration constrains it.
- **Canonical validation:** `packages/validation/src/lib/schemas/clientContact.schema.ts`
  — `emailFieldSchema` + `optional(...)`; `clientCoreFieldsSchema` uses
  `email: optional(emailFieldSchema)` (already optional). Shared by both server
  actions and the REST schemas.
- **Server actions:** `packages/clients/src/actions/clientActions.ts` — validates
  via `clientCoreFieldsSchema` (optional email).
- **REST schemas:** `server/src/lib/api/schemas/client.ts` — `email`/`billing_email`
  use `clientEmailField` (optional).
- **UI:** `packages/clients/src/components/clients/QuickAddClient.tsx` (only
  `client_name` required; email = `location_email`, validated when supplied) and
  `ClientDetails.tsx` (`requiredFields` = `client_name` only).
- **Remaining hard-required spot:** `server/src/lib/schemas/client.schema.ts:32`
  — `ClientSchema.email: z.string().email()` (read/entity representation). Relax
  to optional/nullable so an email-less client parses cleanly.
- **OpenAPI:** `sdk/docs/openapi/alga-openapi.*.yaml` — `ClientBody.required` is
  `client_name` + `billing_cycle` only (email already not required); verify no
  drift.

## Security / Permissions

No permission changes. No new data exposure.

## Rollout / Migration

- No schema migration. Pure validation/representation change; ships behind the
  normal branch → PR → deploy flow. Backward compatible (existing clients with
  emails are unaffected).

## Open Questions

- OQ1: Should `server/src/lib/schemas/client.schema.ts` `ClientSchema` be relaxed,
  or is it dead code? No `import { ClientSchema }` sites were found in `server/src`;
  relaxing it is low-risk and defensive. Confirm before deleting vs. relaxing.
- OQ2: Any downstream report/export that assumes a non-null client email string
  and would render "undefined"? Spot-check invoice/notification templates.

## Acceptance Criteria (Definition of Done)

- Creating a client with no email succeeds via UI and REST.
- Editing a client to clear its email succeeds and persists NULL.
- Supplying an invalid email still fails validation with a clear message on all
  three surfaces (UI, actions, REST).
- Reading an email-less client (UI details, API GET) does not error.
- OpenAPI reflects client email as optional; SDK/types build clean.
- Tests in `tests.json` pass, including at least one DB-backed integration case.

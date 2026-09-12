# Design — Fix tenant onboarding skipping support portal access for existing customers

Card 276a5f54 · conn (XO design desk) · 2026-09-11

## Problem (confirmed from code)
Tenant creation Step 5 (`tenant-creation-steps.ts:338`) calls
`createCustomerClientActivity` → `ClientModel.createClient({ client_name: input.tenantName, ... })`
in the Nine Minds management tenant. When a client of that name already exists
(incident: "CloudVBS"), the unique `(tenant, client_name)` constraint throws. The
single enclosing `catch` (`:414`) treats it as "customer tracking non-fatal", so
contact, tag and **portal-user creation are all skipped**. Step 6 (`:422`) then
sends the welcome email unconditionally, and the email body (`email-activities.ts:292`,
`:329`) claims the workspace **and** Nine Minds Support Portal credentials work.
Result: the customer can never sign into the portal.

## Files
- `ee/temporal-workflows/src/activities/customer-tracking-activities.ts`
  - `createCustomerClientActivity` (`:61`) — unconditional insert.
  - `createCustomerContactActivity` (`:114`) — unconditional insert.
- `ee/temporal-workflows/src/workflows/shared/tenant-creation-steps.ts`
  - Step 5 (`:338`–`:420`): one catch swallows everything; portal creation nested and swallowed (`:405`–`:410`).
  - Step 6 (`:422`–`:451`): email sent regardless of portal outcome.
- `ee/temporal-workflows/src/activities/email-activities.ts` — welcome email body claims (`:292`, `:329`).

## Changes, in order

### 1. Idempotent, safe client reuse — `createCustomerClientActivity`
- Before insert, look up an existing client in the **management tenant only** by exact
  `client_name = input.tenantName`.
  - exactly one match → return `{ customerId, reused: true }`; do **not** mutate the
    existing client (preserve its config/tax/email settings).
  - multiple matches → throw a typed `AmbiguousCustomerMatchError` naming the candidate
    ids. Never guess, never link on a colliding name.
  - no match → insert as today.
- Match exact name (and, if present, `properties.tenant_id`) — no fuzzy matching,
  no cross-tenant lookup.
- Handle the concurrent-insert race: catch the unique violation on insert and re-read
  (read-after-conflict), rather than relying solely on a pre-check.

### 2. Idempotent contact reuse — `createCustomerContactActivity`
- Look up an existing contact for `clientId` by exact `email`.
  - found → return it (`reused: true`), preserving password/role/portal linkage.
  - none → create as today.
- Confirm the contact uniqueness scope (per-client vs per-tenant) before choosing the key.

### 3. Separate failure domains in `tenant-creation-steps.ts`
- A `reused` client/contact is **not** an error — continue normally.
- Record outcome in workflow state, e.g.
  `workflowState.customerTracking = { clientReused, contactReused, portalProvisioned, portalError }`.
- Portal user creation stays non-fatal to tenant creation, but its error is captured
  (not silently dropped) and drives the email decision below.
- Only a genuine, unresolvable client-creation failure may skip downstream steps, and it
  must be surfaced (state + log), not swallowed.

### 4. Welcome email reflects reality
- Pass `portalProvisioned: boolean` into `sendWelcomeEmail`; include the Nine Minds
  Support Portal section/claim **only** when the portal user was actually created.
  Otherwise omit it or say access will follow. The workspace credentials claim stays
  (that user is created earlier in the workflow).

## Explicitly NOT doing
- No schema/migration changes — reuse the existing unique constraint as the signal.
- No automatic password/role reset on reused contacts.
- No fuzzy name matching or cross-tenant lookup.
- No change to the appliance path (`skipCustomerTracking`).
- No merge/deploy delegation (the card grants none).

## Behavioral validation (no source-string tests)
1. Existing customer + existing contact, no portal user → reuse both, create portal user, email claims portal access.
2. New-customer happy path → create client/contact/portal; email correct.
3. Retry / concurrent duplicate creation → second run reuses, no duplicate rows, no error.
4. Existing portal account preserved → reuse does not reset password/role.
5. Ambiguous customer match (two same-name clients) → explicit error, no silent linking.
6. Portal provisioning failure → tenant creation succeeds, state records the failure, email does **not** claim portal access.

## Production recovery (separate from the code PR)
Lynda/CloudVBS: Nine Minds contact `d78d1809-ad15-479c-97da-a167329ff6d5` under client
`8785fc7c-5004-4413-902a-aa96c364c051` has no linked portal user. After the fix ships, run
a targeted idempotent recovery to create/link that portal user, then verify sign-in before
marking the incident resolved. Track operationally; do not fold into the code change.

## Risks / open questions
- `ClientModel.createClient` may do more than insert; reuse must bypass it entirely.
- Concurrency: prefer insert-then-handle-conflict over a bare pre-check.
- Confirm exact unique constraint names/indexes and the contact email uniqueness scope.
- Confirm the `ClientModel`/`ContactModel` lookup APIs before implementing.

## Recommendation
Proceed to Draft Implementation. First confirm the model lookup APIs and unique
constraints, then implement changes 1–4 plus the six behavioral tests above.

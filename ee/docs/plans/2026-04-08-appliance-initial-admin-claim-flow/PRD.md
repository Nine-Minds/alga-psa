# PRD — Appliance Initial Admin Claim Flow

- Slug: `appliance-initial-admin-claim-flow`
- Date: `2026-04-08`
- Status: Draft

## Summary

Add a first-run **appliance admin claim flow** for fresh Alga PSA appliance installs. During appliance bootstrap, the system generates a one-time claim token, stores the raw token in a Kubernetes Secret, and prints a claim URL once for the operator. The first person with that token can open a dedicated appliance claim page, create the initial MSP admin account with **local email/password authentication**, and continue into normal MSP onboarding.

The appliance claim flow must be intentionally separate from normal registration and normal client-portal invitation flows. It exists specifically to solve the fresh-appliance state where onboarding seeds intentionally create **zero users** and current appliance bootstrap can also leave the installation with **no tenant-scoped MSP context yet**.

## Problem

Fresh appliance installs now converge more cleanly because appliance bootstrap uses onboarding seeds instead of demo seeds. That is the right direction, but it leaves the installation without any initial user identity to sign in with.

Today this creates a gap:
- the appliance can be technically healthy
- there are no seeded demo users
- there is no secure built-in path to create the first MSP admin
- the product cannot transition from "freshly installed appliance" to "claimed and usable MSP instance" without manual database or cluster intervention

That is especially problematic because:
- public/open registration is not acceptable for an appliance
- install-time hardcoding of a human admin identity is brittle and operationally awkward
- many appliance installs may not have outbound email configured yet, so email-first setup is a poor dependency
- current MSP onboarding expects an authenticated MSP user and tenant-scoped settings to exist

## Goals

- Let appliance bootstrap generate a one-time, operator-controlled claim path for the first MSP admin.
- Make the first admin claim flow work with **local email/password** and no email-delivery dependency.
- Require possession of the one-time claim token; do not allow open registration.
- Let operators retrieve the token again from a Kubernetes Secret if bootstrap output is lost.
- Make the claim flow safe for the current appliance reality where the installation may have zero users and zero tenant rows.
- Create the minimum tenant-scoped MSP context needed for the created admin to sign in and continue onboarding.
- Redirect the newly created admin into the normal MSP onboarding experience after successful claim.
- Keep the feature appliance-specific and edition-neutral enough that it does not disturb normal hosted registration/invitation flows.

## Non-goals

- Building general-purpose public signup for Alga PSA.
- Replacing existing portal invitation or client portal setup flows.
- Supporting SSO-first initial claim in v1.
- Supporting magic-link or emailed claim completion in v1.
- Supporting multi-admin bootstrap, bulk user setup, or team invitation flows as part of the initial claim.
- Building an operator UI to regenerate claim tokens in v1.
- Adding broad observability, analytics, or operational dashboards beyond what is minimally required for the claim flow to function safely.

## Users and Primary Flows

### 1. Operator bootstraps a fresh appliance

- Operator runs the appliance bootstrap flow.
- Bootstrap generates a one-time appliance claim token.
- Bootstrap stores the raw token in a Kubernetes Secret.
- Bootstrap prints the claim URL once, along with the Secret name or retrieval command.
- Operator hands the claim URL to the person who will become the first MSP admin.

### 2. First MSP admin claims the appliance

- User opens `/auth/appliance-claim?token=...`.
- App validates that:
  - appliance claim mode is enabled
  - the token is valid, unexpired, and unused
  - the appliance is still unclaimed
- User submits the claim form with:
  - full name
  - work email
  - organization / company name
  - password
  - password confirmation
- System creates the first MSP admin and the minimum tenant context needed for onboarding.
- System consumes the token, signs the user in, and redirects them to `/msp/onboarding`.

### 3. Invalid or stale claim attempt

- User opens a claim URL with a bad, expired, or already-used token.
- App shows a terminal error state that explains the token is invalid or expired.
- App tells the operator to retrieve or regenerate the token through appliance operator procedures rather than exposing open signup.

### 4. Already-claimed appliance

- Once a valid initial MSP admin exists, the appliance claim route no longer allows first-user creation.
- Any later visit to the token URL shows that the appliance has already been claimed.
- Standard MSP sign-in becomes the only supported entry path.

## UX / UI Notes

### Claim page

- Add a dedicated route: `/auth/appliance-claim`.
- The page should be visually closer to MSP auth than client portal setup.
- It should clearly communicate that this creates the **first MSP admin** for the appliance.
- It should avoid language that implies public registration.

### Form fields

Recommended v1 fields:
- full name
- work email
- organization / company name
- password
- confirm password

Rationale:
- full name, email, and password are needed for the first internal user
- organization/company name is needed because fresh appliance installs may not yet have tenant-scoped MSP records for onboarding to load against

### Success path

- On successful claim, auto-sign the user in.
- Redirect to `/msp/onboarding`.
- Do not leave the user on a dead-end success page.

### Error states

The claim page should distinguish these cases:
- token missing
- token invalid or expired
- token already used
- appliance already claimed
- claim cannot proceed because bootstrap state is inconsistent

## Requirements

### Functional Requirements

#### Bootstrap and token issuance

- Fresh appliance bootstrap must generate a cryptographically strong one-time claim token.
- Bootstrap must print the claim URL once in terminal output.
- Bootstrap must persist the raw token in a Kubernetes Secret for later operator retrieval.
- Bootstrap must persist a durable validation record for the claim token in application state using a **hashed** token, not plaintext.
- Recover-mode bootstrap must not silently mint a new token for an already-claimed appliance.

#### Appliance claim state model

- The system must track claim-token lifecycle independently of tenant-scoped MSP data.
- The claim record must support at least:
  - token hash
  - created timestamp
  - expiry timestamp
  - claimed timestamp
  - created user id (nullable until claim)
  - created tenant id (nullable until claim)
- The record must be representable before any tenant exists.
- Only one active claim token should exist for a fresh appliance at a time.

#### Claim availability guards

- The appliance claim route must only function when appliance mode is enabled.
- The route must only allow completion while the appliance is still unclaimed.
- The route must reject claims when the token is invalid, expired, or already consumed.
- The route must reject claims when a first MSP admin already exists, even if a stale token is presented.

#### First admin creation

- Claim completion must create the first MSP user with local email/password credentials.
- The created user must be an **internal MSP user**, not a client portal user.
- The created user must receive the MSP `Admin` role or the equivalent highest-privilege default admin role already expected by the product.
- Password creation must reuse existing password hashing and auth-user creation logic rather than hand-rolled credential writes.

#### Minimum tenant/bootstrap context

- Claim completion must establish the minimum tenant-scoped MSP context required for normal app operation.
- If no tenant row exists yet, claim completion must create one.
- Claim completion must also create the tenant-scoped settings/state required for `/msp` layout and onboarding checks to load successfully.
- If a minimal default client/company record is required for onboarding or tenant naming, claim completion must create it.
- The system must prefer reusing existing tenant/bootstrap helpers where possible instead of inventing parallel setup logic.

#### Atomic claim consumption

- Claim completion must atomically:
  - validate the token
  - verify the appliance is still unclaimed
  - create the required tenant/user records
  - mark the token as claimed
- A second concurrent redemption attempt for the same token must fail without creating another admin.

#### Post-claim behavior

- Successful claim must establish a normal authenticated MSP session.
- Successful claim must redirect the user into the existing onboarding flow.
- After claim, the appliance claim route must no longer create users.
- Normal MSP sign-in must work immediately with the claimed email/password credentials.

#### Operator retrieval flow

- The printed bootstrap output must identify where the claim token is stored.
- Operators must be able to retrieve the raw token again from a Kubernetes Secret without database access.
- The retrieval mechanism must be documented in appliance docs/runbooks.

### Non-functional Requirements

- The claim flow must survive pod restarts and Helm reconciles.
- The app must never require the raw token to be stored in the database.
- Token verification must be deterministic and cheap enough for a normal auth route.
- The design must not weaken or alter existing hosted signup/invitation/security behavior.
- The claim system must work on a fresh appliance before optional integrations such as email or SSO are configured.

## Data / API / Integrations

### Proposed bootstrap-state record

Introduce a small non-tenant-scoped bootstrap-state record, e.g. `appliance_claim_tokens` or equivalent, containing:
- `id`
- `token_hash`
- `expires_at`
- `claimed_at`
- `claimed_user_id`
- `claimed_tenant_id`
- `created_at`
- optional metadata such as issuance source/version

This should be intentionally distinct from client-portal invitation tables because appliance claim exists **before** normal tenant/user context may exist.

### Proposed Kubernetes Secret

Store the raw token in a Secret such as:
- `msp/appliance-claim-token`

Secret data should include at least:
- raw token
- claim URL or base app URL + token
- issuance timestamp

The Secret is for operator retrieval only; the app should validate against the hashed record.

### App surfaces to add

- new auth route/page: `/auth/appliance-claim`
- server action or route handler to:
  - verify claim token
  - submit claim form
  - consume token and create first admin

### Existing systems to reuse

- local credentials / NextAuth sign-in flow for standard MSP auth
- existing user creation/password hashing paths
- existing role assignment patterns for MSP Admin
- existing onboarding route `/msp/onboarding`
- existing tenant bootstrap helpers where possible for tenant row + tenant settings creation

### Existing systems not to overload

- `portal_invitations` should not become the appliance claim table because it assumes contact/client-portal semantics and currently stores raw tokens.
- client portal setup UI should not be repurposed directly for MSP appliance claim without explicit MSP-specific behavior.
- public registration pages should not be widened to serve appliance claim.

## Security / Permissions

- The claim token must be high-entropy and single-use.
- The raw token must not be stored in DB/application state.
- The claim route must never function as open registration.
- The route must stop working after initial claim.
- Claim completion must create only one initial MSP admin and must not silently create extra users.
- If implementation adds audit events naturally through existing infrastructure, that is acceptable, but dedicated audit-scope expansion is not required for v1.

## Rollout / Migration

- This feature should be enabled only for appliance bootstrap / appliance mode.
- Existing hosted and dev flows should remain unchanged.
- Fresh appliance bootstrap should create a claim token automatically.
- Existing already-claimed appliances should remain unaffected and should not be forced back into claim mode.
- If a fresh appliance is reset/wiped intentionally, bootstrap may mint a new token as part of that fresh install.

## Risks / Constraints

- Fresh appliance installs currently may have no tenant rows, so first-user creation likely cannot be solved by user creation alone; it must establish minimum tenant context too.
- Reusing too much of client portal invitation code could accidentally inherit wrong assumptions (`client` user type, contact-based identity, raw token storage).
- If bootstrap and app disagree on app URL or claim mode state, the operator may receive a dead claim link even though the cluster is healthy.

## Open Questions

- Should the claim token expiry default to 24 hours, 72 hours, or no expiry until first claim?
- Should the initial claim create only the tenant row and tenant settings, or also a default client/company row immediately?
- Should recover-mode operator tooling support explicit token regeneration later, or leave that for a follow-up plan?
- Should the claim URL live under `/auth/appliance-claim` or a more appliance-specific path such as `/auth/appliance/setup`?

## Acceptance Criteria (Definition of Done)

- Fresh appliance bootstrap generates a one-time claim token and stores the raw token in a Kubernetes Secret.
- Bootstrap prints a usable claim URL for the operator.
- Visiting the claim URL with a valid token shows an MSP-first claim form.
- Claiming the appliance with full name, work email, organization name, and password creates the first MSP admin using local credentials.
- Claim completion establishes the minimum tenant context required for `/msp/onboarding` to load.
- The created user can sign in normally with the chosen email/password.
- Claim success redirects into MSP onboarding.
- Invalid, expired, missing, or already-consumed tokens do not allow user creation.
- Once the appliance is claimed, the token can no longer be used and the claim route no longer creates admins.
- Hosted/public registration and client portal invitation flows remain unchanged.

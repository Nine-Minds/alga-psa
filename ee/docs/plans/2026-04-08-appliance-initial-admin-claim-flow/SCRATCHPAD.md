# Scratchpad — Appliance Initial Admin Claim Flow

- Plan slug: `appliance-initial-admin-claim-flow`
- Created: `2026-04-08`

## What This Is

Keep a lightweight, continuously-updated log of discoveries and decisions made while implementing this plan.

## Decisions

- (2026-04-08) The recommended v1 model is a **one-time appliance claim token** rather than install-time admin config, open registration, or SSO-first setup.
- (2026-04-08) The first admin should authenticate with **local email/password** in v1 so the appliance can be claimed before email or SSO integrations are configured.
- (2026-04-08) The raw token should be stored in a Kubernetes Secret and printed once during bootstrap; the app should validate against a hashed durable record.
- (2026-04-08) The claim flow should be appliance-specific and should not widen existing public registration or client portal invitation behavior.
- (2026-04-08) The successful claim path should land the new MSP admin in the normal `/msp/onboarding` flow.
- (2026-04-08) Because fresh appliance installs may have zero tenant rows, the claim flow likely needs to establish minimum tenant context in addition to creating the first admin user.

## Discoveries / Constraints

- (2026-04-08) Fresh appliance bootstrap now intentionally uses onboarding seeds rather than demo seeds, which leaves the system with zero seeded users.
- (2026-04-08) Existing MSP layout at `server/src/app/msp/layout.tsx` requires a valid authenticated non-client session and calls `getTenantSettings()` to decide whether onboarding is needed.
- (2026-04-08) Existing onboarding page at `server/src/app/msp/onboarding/page.tsx` and `packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts#getOnboardingInitialData` assume tenant-scoped data exists.
- (2026-04-08) Existing client portal setup flow already has a token + setup page pattern via `packages/portal-shared/src/services/PortalInvitationService.ts`, `packages/portal-shared/src/actions/portalInvitationActions.ts`, and `server/src/app/auth/portal/setup/page.tsx`, but it is contact/client oriented and currently stores raw tokens.
- (2026-04-08) Reusing client portal invitation storage directly would import the wrong assumptions: client users, contact binding, and token storage semantics that are not ideal for appliance first-admin claim.
- (2026-04-08) Onboarding seeds create MSP/Admin roles in `ee/server/seeds/onboarding/01_roles.cjs`, which is the likely source of the first-admin role assignment target.

## Commands / Runbooks

- (2026-04-08) Inventory existing auth/setup routes:
  - `find server/src/app/auth -maxdepth 4 -type f | sort`
- (2026-04-08) Inspect existing token-based setup/invitation flows:
  - `rg -n "portal/setup|invitation token|verify.*token|completePortalSetup|verifyPortalToken" packages server/src ee/server/src`
- (2026-04-08) Inspect onboarding assumptions about authenticated tenant context:
  - `rg -n "getTenantSettings|getOnboardingInitialData|onboarding_completed" server/src packages/onboarding/src`
- (2026-04-08) Inspect bootstrap/app URL and appliance bootstrap integration points:
  - `rg -n "APP_URL|app-url|bootstrap-appliance" ee/appliance/scripts ee/appliance/flux helm`

## Links / References

- Appliance bootstrap script: `ee/appliance/scripts/bootstrap-appliance.sh`
- MSP layout gating and onboarding redirect logic: `server/src/app/msp/layout.tsx`
- MSP onboarding page: `server/src/app/msp/onboarding/page.tsx`
- Onboarding initial data action: `packages/onboarding/src/actions/onboarding-actions/onboardingActions.ts`
- Existing client portal token setup page: `server/src/app/auth/portal/setup/page.tsx`
- Existing portal invitation service: `packages/portal-shared/src/services/PortalInvitationService.ts`
- Existing portal invitation actions: `packages/portal-shared/src/actions/portalInvitationActions.ts`
- Onboarding role seed: `ee/server/seeds/onboarding/01_roles.cjs`

## Open Questions

- Should the claim form create a minimal default client/company immediately, or only the tenant row + tenant settings?
- Should token expiry be strict (24h/72h) or effectively indefinite until first claim for appliance installs?
- Should token regeneration be explicitly deferred to a follow-up operator feature, or included in the initial implementation scope?

## Implementation Log

- (2026-04-08) Completed `F001` by adding migration `server/migrations/20260408130000_create_appliance_claim_tokens.cjs` with hashed token storage fields, claim metadata, and a single-active-token partial index.
- (2026-04-08) Completed `F002`, `F003`, `F004`, `F005`, `F006` in `ee/appliance/scripts/bootstrap-appliance.sh`:
  - fresh/recover bootstrap now evaluates claim state from DB,
  - generates high-entropy one-time claim token,
  - stores raw token in `msp/appliance-claim-token`,
  - prints one-time claim URL using configured `APP_URL`,
  - persists only SHA-256 token hash in DB,
  - suppresses minting when appliance is already claimed in recover mode.
- (2026-04-08) Completed `F007`–`F012` by adding dedicated route `server/src/app/auth/appliance-claim/page.tsx` and server actions/services:
  - `packages/auth/src/actions/applianceClaimActions.ts`
  - `packages/auth/src/lib/applianceClaim.ts`
  - route and completion now gate on appliance mode + unclaimed state and enforce token validity (missing/invalid/expired/used/already-claimed/inconsistent).
- (2026-04-08) Completed `F013`, `F014`, `F015`, `F016`, `F017` in `packages/auth/src/lib/applianceClaim.ts` claim transaction:
  - create tenant if absent,
  - create tenant settings row,
  - create default client/company row,
  - seed onboarding roles/permissions for new tenant,
  - create first internal user with hashed password,
  - assign MSP `Admin` role,
  - atomically mark token claimed with row lock + conditional update.
- (2026-04-08) Completed `F018`, `F019`, `F020` in appliance claim page:
  - post-claim credentials sign-in,
  - redirect to `/msp/onboarding`,
  - subsequent claims blocked by existing internal-user guard.
- (2026-04-08) Completed `F021` by documenting token retrieval in:
  - `ee/docs/appliance/quick-start.md`
  - `ee/docs/appliance/operators-manual.md`

## Test Work

- (2026-04-08) Implemented `T001` coverage in appliance plan checks via `ee/appliance/tests/run-plan-tests.sh` dry-run assertions for:
  - claim URL emission,
  - claim token secret reference.
- (2026-04-08) Implemented `T007` and `T008` route-level tests in `server/src/app/auth/appliance-claim/page.test.tsx`:
  - valid token renders claim form,
  - invalid token renders terminal state,
  - successful claim signs in and redirects to `/msp/onboarding`.
- (2026-04-08) Implemented `T002`–`T006` integration coverage in `server/src/test/integration/applianceClaim.integration.test.ts`:
  - valid token hash verification,
  - expired/unknown/already-used guard behavior with no token mutation,
  - claim completion blocked when appliance mode disabled or internal MSP user already exists,
  - happy-path redemption creates tenant + tenant settings + default client + internal user + Admin role assignment,
  - concurrent redemption only succeeds once.
- (2026-04-08) Moved/ran appliance claim route tests from discoverable path `server/src/test/unit/app/auth/appliance-claim/page.test.tsx` so `T007` and `T008` execute in the server vitest include globs.
- (2026-04-08) Fixed claim service onboarding seed resolution in `packages/auth/src/lib/applianceClaim.ts` by resolving `ee/server/seeds/onboarding/*.cjs` via deterministic candidate roots instead of `process.cwd()` assumptions.

## Additional Notes

- Added `APPLIANCE_MODE` env propagation in `helm/templates/deployment.yaml` from `setup.applianceBootstrap.enabled` so runtime claim endpoints stay appliance-scoped.
- Claim token TTL currently defaults to 72 hours via `APPLIANCE_CLAIM_TOKEN_TTL_HOURS` fallback.

## Manual Smoke (T009)

- Preconditions:
  - appliance bootstrap has completed in namespace `msp`,
  - no existing internal MSP admin user is present,
  - claim output can be assumed lost.
- Flow 1 (operator retrieval):
  - Run: `kubectl -n msp get secret appliance-claim-token -o jsonpath='{.data.token}' | base64 --decode && echo`.
  - Expected: non-empty token value is printed.
- Flow 2 (construct/retrieve claim URL):
  - Run: `kubectl -n msp get secret appliance-claim-token -o jsonpath='{.data.claim_url}' | base64 --decode && echo`.
  - Expected: URL contains `/auth/appliance-claim?token=`.
- Flow 3 (first-admin claim):
  - Open the retrieved claim URL in browser.
  - Fill `Full name`, `Work email`, `Organization / company name`, `Password`, `Confirm password`.
  - Submit `Claim appliance`.
  - Expected: browser redirects to `/msp/onboarding` with authenticated MSP session.
- Flow 4 (single-use guard):
  - Re-open the same claim URL.
  - Expected: terminal already-claimed/invalid UI state; no second admin creation path.
- Pass criteria:
  - token is recoverable from Secret after bootstrap output is lost,
  - initial claim completes and lands in onboarding,
  - same token cannot be used to create another admin.

# Password recovery email-provider plan

- Date: 2026-08-14
- Workflow card: `39158668-f24a-478a-afae-e9ff8c97cbb6`
- Status: implementation design only

## Outcome

MSP and client-portal password recovery will use one enumeration-safe request path. Once that path finds an active user of the requested portal type, it will always attempt the provider-aware password-reset sender. An enabled tenant SMTP, Resend, or Microsoft provider will therefore work when `EMAIL_ENABLE` is `false` or unset. System SMTP/Resend remains a fallback and remains controlled by `SystemEmailProviderFactory`, including its existing `EMAIL_ENABLE === 'true'` requirement.

The public caller will receive the same success-shaped result for an invalid address, an unknown address, an inactive user, a portal-type mismatch, a provider failure, and a successful send. Internally, a real provider attempt will retain application-log diagnostics, and provider-level sends will continue to create `email_sending_logs` rows that appear in System Monitoring -> Email Log.

## Problem and current code findings

### The live request path is gated before provider selection

- `server/src/app/auth/msp/forgot-password/page.tsx` calls `recoverPassword(email, 'msp')`.
- `server/src/app/auth/client-portal/forgot-password/ClientPortalForgotPassword.tsx` calls `recoverPassword(email, 'client', portalDomain)`.
- `server/src/app/auth/check-email/CheckEmailClient.tsx` calls the same action for resend.
- `ee/server/src/app/api/billing/reactivation-password-reset/route.ts` also calls the MSP form of `recoverPassword`; its existing contract test explicitly requires the real `/auth/password-reset/set-new-password` link.
- `packages/auth/src/actions/useRegister.tsx` maps `msp` to `users.user_type='internal'` and `client` to `users.user_type='client'`, then checks a module-level `EMAIL_ENABLE` constant before token creation or any email service call. When the flag is false or absent, the tenant provider is never consulted and no send log can exist.
- The same lookup currently does not reject `users.is_inactive=true`, contrary to the card acceptance criteria.

### There are two divergent request implementations, but only one is usable

- `packages/auth/src/actions/useRegister.tsx::recoverPassword` creates the JWT consumed by the deployed `set-new-password` page. `packages/auth/src/lib/portalDomain.ts::buildPasswordResetLink` targets `/auth/password-reset/set-new-password`, preserves `portal=msp|client`, and carries `portalDomain` for client branding.
- `packages/auth/src/actions/auth-actions/passwordResetActions.ts::requestPasswordReset` has no runtime caller in the repository. It creates a row in `password_reset_tokens` through `PasswordResetService` but builds `/auth/reset-password`, a route that does not exist.
- `server/src/app/auth/password-reset/set-new-password/SetNewPasswordClient.tsx` verifies the JWT through `getAccountInfoFromToken` and completes it through `setNewPassword`; it does not use `verifyPasswordResetToken` or `completePasswordReset`.
- Replacing the live action with the unused implementation without also migrating the completion screen would send unusable links. A database-token migration is a separate security/UX change and is not required to correct provider routing.

### Provider selection and logging already exist below the bad gate

- `server/src/lib/initializeApp.ts` registers `packages/email/src/sendPasswordResetEmail.ts` in `packages/auth/src/lib/emailRegistry.ts`, keeping the auth package independent of the email package.
- `packages/email/src/sendPasswordResetEmail.ts` resolves recipient locale, uses the `password-reset` database template, and calls `TenantEmailService.getInstance(tenant).sendEmail(...)` with `tenantId` and `userId`.
- `packages/email/src/TenantEmailService.ts` refreshes `tenant_email_settings` before every actual send, selects the first enabled tenant provider, and retains existing system-provider fallback behavior. A configured tenant provider does not consult `EMAIL_ENABLE`.
- `packages/email/src/providers/EmailProviderManager.ts` initializes enabled tenant SMTP/Resend/Microsoft settings first. Its fallback calls `SystemEmailProviderFactory` when no enabled tenant provider is available.
- `packages/email/src/system/SystemEmailProviderFactory.ts` intentionally returns no system provider unless `process.env.EMAIL_ENABLE === 'true'`. It then selects environment-backed SMTP or Resend. This is the correct boundary for the global flag and is not to be weakened.
- `packages/email/src/BaseEmailService.ts` awaits insertion into `email_sending_logs` after a provider returns or throws. Successful sends are `status='sent'`; provider-level failures are `status='failed'` with `error_message`, provider id/type, recipient, subject, and provider metadata. `packages/email/src/actions/emailLogActions.ts` is the tenant-scoped source for the Email Log UI.
- If provider initialization produces no provider, `BaseEmailService` returns the preserved `providerInitError` but cannot create a provider-level send row because no wire message/provider exists. That cause must remain in structured application logs; this plan does not invent a fake send record.
- `sendPasswordResetEmail` currently makes an additional `SystemEmailService` attempt when the tenant service returns failure. If that fallback is unavailable, its generic result can obscure the more useful tenant initialization/send error in the final thrown error. The fallback itself must remain, but both attempt results must be retained diagnostically and the same system provider must not be retried redundantly.

## Design decisions

1. **`recoverPassword` remains the canonical request action.** It is the only request path wired to a usable completion flow and is already consumed by MSP, client portal, resend, and enterprise reactivation callers.
2. **`requestPasswordReset` becomes a thin compatibility adapter.** Preserve its exported signature and generic `RequestResetResult`, map `internal` to `msp` and `client` to `client`, and delegate to `recoverPassword`. Remove its independent user lookup, provider preflight, token creation, branding lookup, and incorrect URL construction. Mark it deprecated in code so new callers use `recoverPassword`.
3. **Keep the current JWT contract.** Continue using `createToken`, `buildPasswordResetLink`, `getAccountInfoFromToken`, and `setNewPassword`. Existing and newly issued links keep the current route, one-hour/default configured JWT lifetime, portal marker, and client `portalDomain` behavior.
4. **Provider readiness is determined by the send path, not an action-level flag or preflight.** Do not read `EMAIL_ENABLE` inside password recovery and do not call `isConfigured()` before sending. A preflight would duplicate provider initialization, race settings changes, and risks reintroducing a gate before `TenantEmailService.sendEmail` can select the tenant provider.
5. **All public request outcomes are enumeration-safe.** Normalize with `trim().toLowerCase()`. Invalid format, missing user, inactive user, wrong `user_type`, token/send failure, and success all resolve through the same public success contract. Never return provider or lookup details to the form. The UI copy and redirect remain unchanged.
6. **Only a matched active user produces a token or send attempt.** The lookup remains keyed by normalized email plus the portal-derived user type; explicitly treat `is_inactive` as no match. Do not mint a token, call the email registry, or write an email log for non-matches.
7. **Tenant provider first; system fallback remains intentional.** Keep the current password-reset helper's system fallback for a genuine tenant-path failure, but do not call it a second time when `TenantEmailService` already attempted the `system-email-provider`. `SystemEmailProviderFactory` continues to decide whether system SMTP/Resend is available.
8. **Preserve the first useful failure.** Record structured diagnostics for both tenant and system attempts (tenant id, portal/user type, provider id/type when returned, and sanitized error; never the token or reset URL). If both paths fail, throw an internal error that retains both causes. `recoverPassword` logs that internal failure and returns the public success value.
9. **Use the repository SMTP emulator for repeatable integration coverage.** `packages/emulators/smtp-sink` accepts real SMTP, exposes captured messages, and can deterministically reject mail. GreenMail remains the live/manual parity check through `docker-compose.imap-test.yaml`.

## Canonical behavior

The request sequence is:

1. Accept `email`, `portal`, and optional `portalDomain` in `recoverPassword`.
2. Normalize the address and derive `userType` (`msp -> internal`, `client -> client`).
3. If the email is invalid, finish with the generic success result without a lookup or send.
4. Look up that email and user type. If there is no row or the row is inactive, finish with the same generic success result without creating a token.
5. Create the existing JWT with the normalized email and matched `user_type`.
6. Build the existing `/auth/password-reset/set-new-password` link with `portal` and, for client requests, `portalDomain`.
7. Invoke the registered `sendPasswordResetEmail` implementation with the matched tenant and user display/branding fields.
8. The email helper attempts `TenantEmailService`, which reads current tenant settings and selects the enabled tenant provider without regard to `EMAIL_ENABLE`.
9. On tenant-path failure, retain that result and use the existing system fallback only if it is a distinct attempt. The factory may permit system SMTP/Resend only when `EMAIL_ENABLE=true`.
10. Log all internal failures with sanitized structured context. Return the same public success value in every case.

This preserves the current UI contract (`Promise<boolean>` with `true` as the public success-shaped value). The compatibility `requestPasswordReset` adapter converts that completion into its existing generic message object and never exposes whether a send happened.

## Ordered implementation changes

### 1. Make the live action provider-aware and fully enumeration-safe

File: `packages/auth/src/actions/useRegister.tsx`

- Leave the module-level `EMAIL_ENABLE` constant in place for the separate registration/verification behavior at the bottom of the file; remove only its use around password recovery.
- Normalize the incoming address once and use the normalized value for validation, lookup, token payload, recipient, and logging context.
- Keep the portal-to-user-type mapping and current `User.findUserByEmailAndType` lookup, but return the generic success result when `userInfo.is_inactive` is true as well as when no row exists.
- Move token generation, link building, and registry send directly after the active-match guard, with no environment or provider-configuration precheck.
- Wrap lookup/token/send failures at the public action boundary. Log a stable event such as `password_recovery_send_failed` with portal/user type, matched tenant when known, and the sanitized error. Do not log the JWT or full reset URL.
- Always return `true` to the public caller. A provider failure is observable to operators through logs and Email Log, not to an unauthenticated requester.
- Retain `portalDomain` only as a link/branding parameter. Do not trust it as authorization or use it to override the tenant discovered from the user.

### 2. Eliminate the divergent request implementation

File: `packages/auth/src/actions/auth-actions/passwordResetActions.ts`

- Import the canonical `recoverPassword` action.
- Replace only `requestPasswordReset` with a deprecated adapter that maps its `userType` parameter to the canonical portal parameter and returns the existing generic `RequestResetResult` shape.
- Remove request-only imports, constants, console output, admin discovery query, provider `isConfigured()` checks, `PasswordResetService.createResetTokenWithTransaction` call, default-client branding lookup, transaction-scoped send, and the nonexistent `/auth/reset-password` URL.
- Keep `verifyPasswordResetToken`, `completePasswordReset`, `getPasswordResetHistory`, and `PasswordResetService` intact for compatibility. They are not adopted by the live JWT completion flow in this change.
- Do not alter the action barrel exports. Existing imports of either request name continue to compile, but all requests enter one implementation.

### 3. Preserve fallback and failure diagnostics in the password-reset sender

File: `packages/email/src/sendPasswordResetEmail.ts`

- Keep locale resolution, `DatabaseTemplateProcessor('password-reset')`, template data, tenant id, user id, and reply-to behavior unchanged.
- Capture the complete `TenantEmailService.sendEmail` result. On failure, log its provider id/type and sanitized error before considering fallback.
- Preserve the existing `SystemEmailService` fallback, subject to `SystemEmailProviderFactory` and therefore `EMAIL_ENABLE`. Skip a second system call if the tenant service result identifies `providerId='system-email-provider'`.
- If fallback succeeds, return success. If it fails or is unavailable, log its separate provider/error details and throw an internal error containing both tenant and fallback causes. Do not replace an actionable tenant SMTP initialization/auth/TLS error with only `Email service is disabled or not configured`.
- Rely on `BaseEmailService` for `email_sending_logs`: a tenant or system provider attempt that reaches the provider records `sent` or `failed`; an initialization failure remains an application-log diagnostic. Do not write a parallel password-reset-specific log row, which would duplicate Email Log entries.

### 4. Add real DB + real SMTP behavioral coverage

New file: `server/src/test/integration/email/passwordRecoveryEmailProvider.integration.test.ts`

Use the established integration-test database helpers (`server/test-utils/dbConfig.ts`, `server/test-utils/testDataFactory.ts`) and the in-process emulator pattern used by payment integration tests:

- Start `EmulatorHost` with `@alga-psa/emulator-smtp-sink` on ephemeral control/SMTP ports.
- Register the real email implementation into `registerAuthEmailProvider` exactly as application startup does: real `sendPasswordResetEmail`, `getSystemEmailService`, and `TenantEmailService.getInstance`.
- Create a disposable tenant, active internal user, active client user, inactive internal user, and tenant email settings whose enabled SMTP provider points to the emulator. Use unique addresses and tenant-scoped cleanup.
- Set a deterministic `NEXT_PUBLIC_BASE_URL` and token secret for link verification. Restore every environment variable and reset the auth email registry/provider singleton state after the suite. Invalidate `TenantEmailService` state after settings changes so test cases cannot share a cached provider.
- Clear captured mail and relevant `email_sending_logs` rows between cases. Assertions must be based on SMTP state and database rows, never source strings.

Required cases:

1. **MSP, global email disabled:** with `EMAIL_ENABLE='false'`, call the real `recoverPassword(internalEmail, 'msp')`; assert the public result is `true`, SMTP captured exactly one message to that user, and its subject/body come from the password-reset template.
2. **Client portal, global flag absent:** delete `EMAIL_ENABLE`, call `recoverPassword(clientEmail, 'client', 'portal.example.test')`; assert exactly one message, the same public result, and a reset link containing the existing set-new-password route, `portal=client`, and encoded `portalDomain`.
3. **Usable links:** extract the token query parameter from each captured message, verify it with the existing tokenizer (`getInfoFromToken`), and assert the normalized email plus expected `internal|client` type. This proves the message contains a token accepted by the deployed completion flow without mutating the test user's password.
4. **Email Log visibility:** for each happy path, query tenant-scoped `email_sending_logs` and assert exactly one `status='sent'` row with the emulator-backed tenant SMTP provider id/type and the expected recipient. This is the row consumed by System Monitoring -> Email Log.
5. **Enumeration guards:** table-drive an invalid address, unknown address, inactive internal user, internal user requested through `client`, and client user requested through `msp`. Each returns the same `true` value and creates zero captured messages and zero new send-log rows.
6. **Provider failure diagnostics:** arm the emulator's `reject-mail` fault, request recovery for an active matched user, and assert the public result remains `true`, SMTP captures no delivered message, and `email_sending_logs` contains a `status='failed'` row for the tenant SMTP provider whose `error_message` preserves the SMTP rejection. Also spy on the application logger to verify the diagnostic event is emitted without a token/reset URL.

If Vitest package resolution requires explicit workspace dependencies, add `@alga-psa/emulator-host` and `@alga-psa/emulator-smtp-sink` as server test/dev dependencies and update the lockfile deliberately. Do not substitute a mocked `sendPasswordResetEmail`, mocked provider, or source-string assertion; those would miss the original action-to-provider regression.

### 5. Protect provider-boundary behavior with focused unit coverage

Files:

- New or existing test beside `packages/email/src/sendPasswordResetEmail.ts` (or under `server/src/test/unit/email/` if that is the active runner boundary).
- Existing `server/src/test/unit/emailProviderManagerFallback.unit.test.ts`.

Cover the small cases that are awkward to force through SMTP integration:

- Tenant success does not call the explicit system fallback.
- Tenant failure calls a distinct system fallback once; system success is accepted.
- A failure already returned by `system-email-provider` is not retried through `SystemEmailService`.
- When tenant and system both fail, the thrown/logged diagnostic retains both errors, with the tenant provider cause not masked by the global system-disabled message.
- Preserve the existing manager assertions that an enabled tenant provider wins and no-enabled-provider can use the system provider. Add a factory-focused assertion only if none exists by implementation time: `SystemEmailProviderFactory.createProvider()` returns `null` for false/unset `EMAIL_ENABLE` and may initialize from environment only for exact `'true'`.

### 6. Update compatibility contracts and comments

Files:

- `ee/server/src/app/api/billing/reactivation-password-reset/route.ts`
- `server/src/test/unit/billing/reactivationCore.contract.test.ts`

Keep the route calling `recoverPassword(email, 'msp')` and keep its existing usable-link contract. Update only stale comments that contrast it with the now-delegating `requestPasswordReset`. Do not change the signed endpoint response or workflow behavior in this card.

## Verification commands and gates

Run from the repository root unless noted:

1. Focused SMTP/DB integration:
   `cd server && npx vitest run src/test/integration/email/passwordRecoveryEmailProvider.integration.test.ts --coverage.enabled=false`
2. Focused sender/provider unit tests:
   `cd server && npx vitest run src/test/unit/email src/test/unit/emailProviderManagerFallback.unit.test.ts --coverage.enabled=false`
   (Use the final concrete sender-test filename rather than the directory if the suite is placed elsewhere.)
3. Existing reactivation contract:
   `cd server && npx vitest run src/test/unit/billing/reactivationCore.contract.test.ts --coverage.enabled=false`
4. Auth/email package and server typechecks/build-dependency gate:
   `npx nx build-deps server`
   followed by `cd server && npm run typecheck`.
5. Re-run the relevant server integration tier if focused tests touched shared email behavior. Confirm the executed-test count is nonzero and no suite was silently skipped for lack of a database.

### GreenMail/manual parity check

The automated emulator suite is the required regression gate. Before handoff, also exercise the same behavior against the existing GreenMail rig when available:

1. Start `docker-compose.imap-test.yaml` with GreenMail SMTP (default host port `3025`), IMAP (`3143`), and HTTP API (`8080`), or use the already-wired equivalent ports.
2. Configure the test tenant's enabled SMTP provider for GreenMail (`secure=false`, test credentials if used) while setting the application process `EMAIL_ENABLE=false` and then with it unset.
3. Submit one MSP and one client-portal forgot-password request through the live pages.
4. Assert one message per request in GreenMail, follow each received link to the existing set-new-password screen, and confirm the portal/branding context is correct.
5. In System Monitoring -> Email Log, verify the corresponding tenant SMTP rows are visible as sent. For a deliberately rejected/unreachable tenant SMTP setting, verify the public page still shows generic success while server logs retain the provider failure and any provider-level attempt is visible as failed.

This manual check is evidence of deployment parity, not a substitute for the deterministic integration test.

## Acceptance criteria / definition of done

- No password-recovery request code checks `EMAIL_ENABLE` before calling the provider-aware sender.
- Enabled tenant SMTP works for active MSP and client users when `EMAIL_ENABLE` is false and when it is unset.
- The client message keeps the vanity-domain/branding parameters and both portal types receive a token accepted by the existing completion path.
- Invalid, unknown, inactive, and portal-mismatched requests have the same public success result and produce neither tokens intended for delivery nor email attempts.
- A successful tenant or system provider send creates a tenant-scoped `email_sending_logs` row visible in Email Log.
- Provider send failures create the existing failed log row; initialization/fallback failures retain actionable structured application diagnostics. No provider error, account-existence signal, token, or reset URL reaches the public response/log payload.
- Existing system SMTP/Resend fallback remains controlled by `SystemEmailProviderFactory` and exact `EMAIL_ENABLE=true`.
- `requestPasswordReset` no longer implements a second lookup/token/provider flow or emits a link to a nonexistent route.
- Behavioral tests use a real database, the real server action, real registry wiring, real template processing, real `TenantEmailService`, and real SMTP transport into the repository emulator (plus GreenMail parity where available).

## Migration and compatibility

- **Database:** no schema or data migration. Existing `tenant_email_settings`, email templates, and `email_sending_logs` are reused.
- **Environment:** no new variable. Appliance installations may keep `EMAIL_ENABLE=false` or omit it; that disables only the environment-backed system provider, not an enabled tenant provider.
- **Issued links:** existing JWT reset links remain valid because token format, secret lookup, route, and completion actions do not change.
- **Action callers:** `recoverPassword` keeps its name, arguments, and boolean return. `requestPasswordReset` keeps its exported name, arguments, and result object but delegates to the canonical action.
- **Provider order:** enabled tenant provider remains first. Existing system fallback is retained rather than promoted ahead of tenant configuration.
- **Email Log:** no new status/provider identifiers or UI changes. Operators continue using the existing sent/failed rows.
- **Edition behavior:** do not broaden CE/EE fallback policy. The implementation must preserve the current `TenantEmailService`/`EmailProviderManager` edition behavior and the factory gate exactly.

## Risks and mitigations

- **Accidental oracle through return values or thrown server actions:** make the public action catch all lookup/token/send errors and return the same value; prove this with the failure and non-match cases.
- **Inactive user mail:** explicitly check `is_inactive` in the canonical path; the current model helper does not filter it.
- **Duplicate fallback delivery:** never fallback after tenant success and do not retry a result already produced by `system-email-provider`. Preserve current behavior for ambiguous provider-level failures rather than inventing a new retry policy.
- **Masked SMTP diagnostics:** retain the tenant result before fallback and report both sanitized causes internally. Assert the failed provider row/error in the emulator rejection case.
- **Singleton/cache test leakage:** invalidate `TenantEmailService` per tenant and reset the auth registry and environment after tests.
- **False-positive integration tests:** assert SMTP capture, token verification, and database log state together. A mock-only or source-string test cannot satisfy the acceptance gate.
- **Global email identity ambiguity:** current user-management actions enforce global email uniqueness per `user_type`, but the database key itself is tenant-scoped. This change preserves existing discovery semantics; resolving historical cross-tenant duplicates requires a separate identity-policy decision.
- **JWT security debt:** the live JWT is not the hashed, single-use database token implemented by `PasswordResetService`. This plan avoids silently combining incompatible token formats; a later migration should address the completion route, concurrency/one-time-use semantics, and already-issued-link compatibility together.

## Explicitly out of scope

- Changing the registration/email-verification use of `VERIFY_EMAIL_ENABLED` or `EMAIL_ENABLE` in `useRegister.tsx`.
- Removing or weakening `EMAIL_ENABLE` in `SystemEmailProviderFactory`, changing system SMTP/Resend credentials, or redesigning CE/EE fallback policy.
- Migrating the reset UI from JWTs to `password_reset_tokens`, deleting `PasswordResetService`, changing token lifetime, or adding new rate-limit behavior.
- Changing forgot-password page copy, routes, check-email navigation, client portal branding UX, or the signed enterprise reactivation endpoint contract.
- Adding an email-log table/status, a password-reset-specific audit table, monitoring UI, alerts, metrics, or provider-health changes.
- Repairing historical duplicate identities across tenants or changing global user uniqueness policy.
- Configuring tenant SMTP for operators, changing appliance Helm defaults, deploying, or modifying inbound email behavior.

# Scratchpad — Outlook Calendar on the supplied Microsoft app

PSA ticket: alga-2026-0003151.

## Decision (2026-11-16)

Outlook Calendar on the AlgaPSA-supplied Microsoft app is supported. This supersedes the 2026-10-20 position (alga-2026-0002658) that calendar is bring-your-own-app only. Bring-your-own-app stays available.

## Research (2026-11-16)

- Platform credentials: app secrets `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`; `resolvePlatformMicrosoftCredentials()` in `packages/integrations/src/actions/integrations/microsoftEmailSetupActions.ts` (about line 101).
- Setup: `configureMicrosoftEmailPlatformApplication` (same file, about line 328) refuses on self-host licensing, creates the profile through `createMicrosoftEmailProfilePendingConsentInternal` (`microsoftActions.ts` about lines 1137-1165, which calls `createMicrosoftProfileInternal` with `capabilities: ['email']`, `requiresEmailAdminConsent: true`), default display name "Alga platform Microsoft Email", and returns the admin consent URL. `getMicrosoftEmailAdminConsentUrl` builds a re-consent link for a profile.
- Consent write: `packages/integrations/src/lib/microsoftEmailAdminConsent.ts`, `writeMicrosoftEmailAdminConsent`, binds `consumer_type: 'email'` only (about lines 77-87).
- Consent URL: `packages/integrations/src/lib/microsoftEmailSetup.ts`, `MICROSOFT_EMAIL_ADMIN_CONSENT_SCOPE = 'https://graph.microsoft.com/.default'`, `/{tenant}/v2.0/adminconsent`. Admin consent therefore grants whatever is statically configured on the app registration.
- Binding rules: `setMicrosoftConsumerBinding` (`microsoftActions.ts` about line 1548) requires `profileHasCapability` and `isVisibleMicrosoftConsumerType`; only Email is blocked on pending consent. `ensureLegacyMicrosoftProfileBackfill` is the reconcile-on-use precedent.
- Email readiness: `packages/integrations/src/actions/integrations/providerReadiness.ts` about lines 60-102; `source === 'platform'` when the bound email profile's client id equals the platform client id; `platformOffered: hosted && platform.ready`.
- Resolvers: `packages/integrations/src/lib/microsoftConsumerProfileResolution.ts` about lines 615-700 (`resolveMicrosoftConsumerProfileConfig`, read-only variant, `credentialPreference: 'platform'` for email only). `ee/packages/calendar/src/lib/microsoftConsumerProfileResolution.ts` is a forked copy (own constants, no consent fields; only `credentialSource: 'binding'`).
- Calendar readiness: `ee/packages/calendar/src/lib/actions/integrations/calendarSetupActions.ts` (`getMicrosoftCalendarSetupStatus` returns `ready, state, redirectUri, profileId, message, reasonCode`; reason codes `unsupported_consumer`, `binding_not_configured`, `profile_missing`, `profile_capability_missing`, `profile_credentials_missing`).
- UI: `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx` about lines 730-790 (platform description, "Microsoft email is ready to connect" banner, "Connect a mailbox" -> `MAILBOX_SETUP_ENTRY_PATH`). `ee/packages/calendar/src/components/calendar/MicrosoftCalendarProviderForm.tsx` about lines 385-425 (not-configured message, `setupReason.<reasonCode>` copy, "Open Providers Settings", "Before you connect"). Strings in `server/public/locales/en/msp/calendar.json` about lines 233-262.
- Calendar callback: `ee/packages/calendar/src/app/api/auth/microsoft/calendar/callback/route.ts`; redirects to `/msp/profile?...`; no consent-specific error handling today.
- Calendar scopes: the connect flow asks for `Calendars.ReadWrite`, `MailboxSettings.ReadWrite` (used for Outlook categories; `MicrosoftCalendarAdapter` warns when it is missing), `offline_access`. Confirm the exact list in the authorize URL builder when implementing.
- Entry paths: `CALENDAR_SETUP_ENTRY_PATH`, `MAILBOX_SETUP_ENTRY_PATH`, `PROVIDER_SETUP_ENTRY_PATH` in `packages/types/src/constants/productRoutes.ts`. These go through `/msp/go`, which is broken on hosted until `2026-11-16-app-relative-redirects` ships.

## Production evidence (identifiers stripped)

- 14 tenants had Calendar bound to a profile carrying the supplied app's client id, all set up by hand through the advanced screen; 13 had connected a calendar; 8 had synced events with no errors.
- So the shared registration's calendar redirect URI is in place and user consent for calendar succeeds in at least those Microsoft tenants.

## Outside the codebase

- Whether the shared Entra app registration statically lists the calendar delegated permissions is unknown. Needs the app owner to check and add them.

## Dependencies

- `2026-11-16-app-relative-redirects`: the Providers banner actions use go links.
- `2026-11-16-microsoft-calendar-subscription-renewal`: without it a calendar connected through this flow stops receiving Outlook changes after about three days.

## Implementation notes (2026-11-16)

- **CE/EE "calendar served" detection.** No new seam: `getMicrosoftPlatformAppServedConsumers()` (`packages/integrations/src/lib/microsoftPlatformAppServed.ts`, pure so the Providers client component reads it too) returns `['email','calendar']` when `getVisibleMicrosoftConsumerTypes()` includes `calendar`, i.e. the same `EDITION`/`NEXT_PUBLIC_EDITION` gate that already hides Calendar bindings in CE. Setup, consent binding, reconcile and the Providers banner all read it.
- **Shared core.** `applyMicrosoftPlatformAppServedConsumers` (`lib/microsoftPlatformApp.ts`) is the one routine that adds missing served capabilities/bindings; consent-time binding and reconcile-on-use both call it, so they cannot drift.
- **Email at consent keeps its old behaviour.** `writeMicrosoftEmailAdminConsent` still (re)binds `email` to the consented profile unconditionally (an explicit approval of this app for email). The no-override rule is applied to the *additional* served consumers (calendar). Tenant-owned profiles: unchanged, email only.
- **Reconcile rule per served consumer:** no binding -> add capability if missing and insert binding; binding to this profile -> add capability if missing; binding to another profile -> skip that consumer entirely (capability too). Candidate = non-archived, consent recorded, client id equals platform client id (NFKC/zero-width/case-insensitive compare); if several, the one already serving a consumer, else the oldest.
- **Concurrency.** One transaction; candidate profile rows locked `FOR UPDATE`; bindings inserted `ON CONFLICT (tenant, consumer_type) DO NOTHING` (the table's primary key is `(tenant, consumer_type)`). T003 runs six concurrent reconciles: exactly one reports a change.
- **Providers status path is no longer strictly read-only.** `getMicrosoftIntegrationStatus` now calls the reconcile (bounded to consented supplied-app profiles; never legacy/unmigrated state). The existing legacy purity integration test still passes. The Providers `load()` now reads status first and bindings second (was parallel) so the Calendar binding shown includes the reconcile result.
- **Resolver fork.** Not merged: the calendar copy returns `reasonCode` (drives the `setupReason.*` copy) which the shared one lacks. Calendar -> integrations imports are allowed by the path aliases, so the reconcile and platform-client-id helpers are imported from `@alga-psa/integrations/lib/...`; the resolver itself stays forked with `LEVERAGE: pattern microsoft-consumer-resolver-fork` at all three copies (integrations, calendar, auth). Source is derived outside the resolver (profile client id vs platform client id), as `providerReadiness.ts` does.
- **Renames.** `configureMicrosoftEmailPlatformApplication` and `createMicrosoftEmailProfilePendingConsentInternal` are shared with the manual (tenant-owned, email-only) path and imported by UI/tests, so not mechanically renamable: `LEVERAGE: friction microsoft-email-named-setup`. The creator gained an optional `capabilities` input (default email). New supplied-app profiles are named "Alga platform Microsoft app".
- **Consent errors.** The callback already mapped `consent_required`, AADSTS65001 and AADSTS90094 to `pending_admin_consent`. Added: `interaction_required` whose description mentions admin/consent, an info log per classification (stage + OAuth error only), and for the form a distinct supplied-app message. The form only offers the consent link when `getMicrosoftCalendarSetupStatus` reports `canManageProviderSettings` (same `system_settings:update` check the Microsoft settings use); the link is `getMicrosoftEmailAdminConsentUrl` for a supplied-app profile, and "Open Microsoft Provider Settings" for tenant-owned ones.
- **Scopes actually requested by the authorize URL** (`MICROSOFT_CALENDAR_OAUTH_SCOPES`): `Calendars.ReadWrite`, `MailboxSettings.ReadWrite`, `offline_access`. `User.Read` is not requested explicitly (the PRD lists it for the app registration; sign-in works without it today). Admin consent uses `.default`, so the registration must list the first two.
- **Not-configured link** now goes to `PROVIDER_SETUP_ENTRY_PATH` (product-aware, via `/msp/go`, which depends on `2026-11-16-app-relative-redirects` on hosted). The tenant-owned "Open Microsoft provider settings" link in "Before you connect" keeps the direct deep link.
- **Locales.** `validate-translations` enforces key parity, so the 11 new keys exist in en, de, es, fr, it, nl, pl, pt, sv and the generated xx/yy pseudo-locales. Non-English strings are machine-quality and should get a translator pass.
- **Test commands that work** (Postgres of compose project `alga-psa-local-test` on 127.0.0.1:5474; own DB so other worktrees are not disturbed): `cd server && TEST_DB_PORT=5474 TEST_DB_NAME=test_db_supplied_cal npx vitest run src/test/integration/microsoftSuppliedAppCalendar.integration.test.ts --coverage.enabled=false`; unit/component: `cd packages/integrations && npx vitest run src/lib/microsoftPlatformApp.test.ts ...`, `cd server && npx vitest run src/test/unit/components/MicrosoftCalendarProviderForm.test.tsx src/test/unit/api/calendarCallbackRoutes.errorState.test.ts`.

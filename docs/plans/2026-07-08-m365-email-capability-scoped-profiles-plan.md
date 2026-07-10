# M365 inbound email — capability-scoped Microsoft profiles

**Branch:** `fix/m365-endless-consent-loop`
**Date:** 2026-07-08
**Status:** Design approved — ready for implementation (do not implement from this doc; the Draft Implementation step executes it)

## Problem

An MSP admin configuring **Microsoft 365 inbound email** (Settings → General → Email → Add Email Provider → Microsoft 365) clicks "Connect Microsoft 365", completes the OAuth popup, an admin approves the Entra enterprise-app consent — and the app never recognises it. The setup loops forever.

### Root cause (proven in production)

The consent popup fails with:

```
AADSTS50011: The redirect URI 'https://algapsa.com/api/auth/microsoft/callback'
specified in the request does not match the redirect URIs configured for the
application '02c1ecbc-10db-4439-b002-1187acf7b268'
```

`02c1ecbc-…` is the tenant's **Teams** Azure app. The inbound-email OAuth flow handed Microsoft the **Teams** app id instead of the hosted email app, and that app has neither the `…/api/auth/microsoft/callback` redirect URI nor `Mail.Read`, so Microsoft rejects the request on its own page (before any redirect back to Alga) → the user can never complete → loop.

**Why the wrong app was chosen.** The email client id is resolved by `resolveMicrosoftConsumerProfileConfig(tenant, 'email')` (`packages/integrations/src/lib/microsoftConsumerProfileResolution.ts`). When a tenant has a Microsoft **profile** (`microsoft_profiles` row = one Azure app registration), the resolver can bind the `email` consumer to it with no check that the app is appropriate for email:

- `resolveMicrosoftBindingCandidateProfile` returns the **sole** active profile whenever `activeProfiles.length === 1`, with no consumer awareness (`microsoftConsumerProfileResolution.ts:196-247`).
- The per-consumer binding picker in the settings UI offers **every** profile for every consumer, unfiltered (`packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx` `consumerDescriptors` map).

So a profile created for Teams gets used for email. The correct hosted email app (`f879c391-04fe-4e49-b303-e8e6977a6447`, env `MICROSOFT_CLIENT_ID` on `sebastian-blue`/`green`, which *does* have the redirect + `Mail.Read`) is only consulted as a fallback when **no** email binding resolves, and the Teams-profile pickup bypasses it.

### Ruled out during investigation

- **Env/secret misconfiguration.** `MICROSOFT_CLIENT_ID` is correctly the email app `f879c391`. Vault holds only `MICROSOFT_CLIENT_SECRET` (no client id); `CompositeSecretProvider.getAppSecret` is first-wins over `env → filesystem → vault` (`packages/core/src/lib/secrets/CompositeSecretProvider.ts:31-44`), so vault cannot override the id. The platform config is correct — the bug is in per-tenant profile resolution.

## Design: capability flags on Microsoft profiles

Each Microsoft profile declares **which features it is allowed to serve**, drawn from the existing consumer set (`email`, `teams`, `calendar`, `msp_sso` — `packages/integrations/src/actions/integrations/microsoftShared.ts`). Email resolution only considers profiles that carry the `email` capability; a Teams-only app becomes invisible to email and the flow falls through to the hosted email app.

### Approved decisions

1. **Bring-your-own app is intended.** A tenant may point email at its own Azure app on purpose; the hosted app is the default when they haven't. We do not remove BYO — we scope it.
2. **Capability lives on the profile**, multi-select (one app may legitimately serve several features).
3. **Auto-bind stays, but capability-gated.** The single-profile convenience pick only fires for a profile that carries the target capability.
4. **Migration grants ALL capabilities to existing profiles** (backward compatible, no inference). Consequence, explicitly accepted: the reported tenant's loop does **not** self-heal — an admin must uncheck `email` on the Teams profile. The now-surfaced error is their cue. (See "Manual remediation" below.)
5. **Surface the swallowed OAuth error** on the callbacks that *do* reach Alga, as the safety net.

## Implementation

### 1. Schema — add `capabilities` to `microsoft_profiles`

New migration `server/migrations/<timestamp>_add_microsoft_profiles_capabilities.cjs`, following the existing `20260307120000_create_microsoft_profiles.cjs` conventions (`exports.config = { transaction: false }`, Citus-aware — but an `ADD COLUMN` needs no `create_distributed_table` handling):

- Add `capabilities jsonb NOT NULL DEFAULT '["msp_sso","email","calendar","teams"]'::jsonb` (array of consumer keys).
- Backfill any pre-existing rows to all four capabilities (decision #4). With the column default this is automatic, but set it explicitly for clarity/idempotency.
- `down`: drop the column.

Rationale for `jsonb` array over boolean columns: extends with the consumer enum without repeated schema churn, and matches how the resolver already thinks in `consumer_type` values.

### 2. Resolver — `packages/integrations/src/lib/microsoftConsumerProfileResolution.ts`

- Add `capabilities: string[]` to `MicrosoftProfileRow` and `MicrosoftBindingCandidateProfile`; select/parse it in `getTenantMicrosoftProfiles` / `getMicrosoftProfileRow` (jsonb → array; default to all four if null for safety).
- `resolveMicrosoftBindingCandidateProfile(db, tenant, secretProvider, consumerType)` — **add the `consumerType` param** and filter `activeProfiles` to those whose `capabilities` include it *before* the `length === 1` shortcut and the legacy-match loop. Update its one caller.
- `resolveMicrosoftConsumerProfileConfig` — after loading the bound profile, **verify the profile carries the requested capability**. If it does not, treat the binding as inapplicable: for `email`, fall through to `resolveHostedMicrosoftEmailConfig`; otherwise return `not_configured`/`invalid_profile` with a message naming the missing capability. This is the enforcement point that makes an admin un-checking `email` on the Teams profile take effect (binding row may still exist).
- `ensureMicrosoftConsumerBindingMigration` — pass `consumerType` into the candidate resolver so auto-backfill can only bind capability-matching profiles.

### 3. Actions — `packages/integrations/src/actions/integrations/microsoftActions.ts`

This file has a parallel copy of the candidate/backfill logic and owns profile CRUD and the binding setter. Keep it consistent with the resolver:

- `resolveMicrosoftBindingCandidateProfile` / `ensureMicrosoftConsumerBindingMigration` (the multi-consumer copy) — same capability filtering as §2.
- `createMicrosoftProfileInternal` / `saveMicrosoftIntegrationSettings` — accept and persist `capabilities`; default to all four when unspecified (decision #4). Include `capabilities` in the profile row insert/update.
- `setMicrosoftConsumerBinding` — **reject** binding a consumer to a profile that lacks that capability (return a validation error), so the UI can't create a Teams→email binding going forward.
- The profile read/serialization that feeds the settings UI must include `capabilities`.

### 4. Settings UI — `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx`

- **Profile create/edit dialog** (`ProfileFormState` at line ~55; dialog fields `displayName`/`clientId`/`clientSecret`/`tenantId`): add a **capabilities multi-select** (checkbox group for Email / Teams / Calendar / MSP SSO). Default all checked on create (decision #4). Persist through the profile save actions in §3.
- **Per-consumer binding picker** (`consumerDescriptors` map, options currently the full `activeProfiles` list): filter each consumer's options to profiles whose `capabilities` include that consumer. Show a helper/empty state when no capable profile exists ("No Microsoft app is enabled for Email — edit a profile to enable it, or leave email on the hosted app").

### 5. Error surfacing — `server/src/app/api/auth/microsoft/callback/route.ts`

For callbacks that reach Alga (Microsoft redirected back with an `error`, or the token exchange threw — e.g. `AADSTS7000215 invalid_client`), when `stateData.providerId` is present:

- Persist the Microsoft error to `email_providers.error_message` and set `status = 'error'` (currently the error paths only `postMessage` + `console`; the success path swallows persistence failures at `route.ts:337-339`).
- Do not report success to the popup when token persistence failed.

Note the `AADSTS50011` in the report happens on Microsoft's page **before** any redirect, so Alga's callback never runs for it — the §2 capability filter is its remedy, not this step. This step covers the token-exchange-stage failures and makes future misconfigurations visible on the provider row instead of silently looping. (`MicrosoftProviderForm.tsx` already surfaces `event.data.errorDescription` in the popup; no change needed there beyond what the callback sends.)

### 6. Tests

- **Migration test** (mirror `server/src/test/unit/migrations/microsoftConsumerBindingsMigration.test.ts`): column exists, default is all-four, existing rows backfilled to all-four.
- **Resolver contract** (`server/src/test/unit/microsoft/microsoftConsumerRuntimeResolution.contract.test.ts`, `packages/integrations/src/lib/microsoftConsumerProfileResolution.test.ts`): a single Teams-only-capable profile does **not** resolve for `email` and falls through to the hosted email app; a profile with `email` capability resolves; un-checking `email` on a bound profile makes resolution fall through.
- **Binding setter**: `setMicrosoftConsumerBinding` rejects binding `email` to a non-email-capable profile.
- **Schema contract** (`server/src/test/unit/microsoft/microsoftConsumerSchema.contract.test.ts`): include `capabilities`.
- **Callback**: token-exchange failure writes `email_providers.error_message` / `status='error'` and does not report success.

## Manual remediation for the reported tenant

Because migration grants all capabilities (decision #4), the affected tenant stays broken until acted on. After deploy, the admin edits the Teams profile and **unchecks Email** (and/or re-binds Email to the hosted app / a correctly-configured app). Resolution (§2) then drops the Teams profile for email and falls through to the hosted app `f879c391`, which has the redirect URI and `Mail.Read`. Alternatively an operator clears the tenant's `email` row in `microsoft_profile_consumer_bindings`. Document this in the release notes / hand it to support for the reporting customer.

## Out of scope (noted, not addressed here)

- `generateMicrosoftAuthUrl` hardcodes the `/common/` authority and ignores the profile `tenant_id` (`packages/integrations/src/utils/email/oauthHelpers.ts:28`); token exchange likewise hardcodes `/common/` (`callback/route.ts:209`). Not implicated in this bug.
- The legacy `server/src/app/api/email/oauth/initiate/route.ts` reads `microsoft_client_id` directly, bypassing the resolver. Not on the live path for this flow; leave unless it surfaces.
- `prompt=consent` is hardcoded (forces the consent screen every attempt). Working as intended for refresh-token capture; unrelated to the loop.

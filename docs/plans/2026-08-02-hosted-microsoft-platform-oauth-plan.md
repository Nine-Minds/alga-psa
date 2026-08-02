# Hosted Microsoft platform OAuth setup plan

Ticket: alga0002217 — Hosted email setup UX: steer hosted tenants to platform credentials, not manual M365 app config

## Problem

Hosted tenants already have access to platform Microsoft credentials through the app-secret/environment fallback used by the Microsoft consumer resolver, but the settings UI leads with tenant-owned app profiles and the email provider wizard does not explain that hosted users can connect without registering an Entra application. The current provider-readiness helper also checks only tenant secrets, so it cannot reliably tell the UI that platform credentials are available.

The desired experience is:

- When platform Microsoft credentials are available, lead with a simple Microsoft sign-in/connect path.
- Keep tenant-owned Microsoft app registration available as an explicit advanced “bring your own app” choice.
- Explain that BYO credentials are normally unnecessary on hosted Alga PSA.
- Preserve the existing self-hosted/manual configuration path when platform credentials are absent.

## Implementation plan

### 1. Model Microsoft credential availability and source on the server

- Extend `packages/integrations/src/actions/integrations/providerReadiness.ts` (or a focused sibling shared by the two setup surfaces) to resolve Microsoft readiness from the same precedence rules as `packages/integrations/src/lib/microsoftConsumerProfileResolution.ts`: tenant/profile credentials first where explicitly selected, then application secrets, then environment credentials.
- Return a UI-safe capability result such as `ready`, `source: 'tenant' | 'platform' | 'none'`, and booleans needed to explain missing configuration. Never return client secrets or secret values.
- Avoid detecting “hosted” from URLs or edition alone. Platform-credential availability is the meaningful capability and also makes local/self-hosted deployments with centrally supplied credentials behave correctly.
- Reuse the resolver’s normalization and fallback behavior rather than creating a second precedence definition. If direct reuse would cross server/client boundaries, extract a small server-only credential-availability helper beside the resolver and consume it from both paths.

### 2. Make Microsoft integration settings progressive

- Update `packages/integrations/src/components/settings/integrations/MicrosoftIntegrationSettings.tsx` to load the credential capability with the existing status/bindings request.
- For `source === 'platform'`, render a primary platform-managed state explaining that Alga PSA supplies the Microsoft application and that the user can proceed to connect/sign in without creating an Entra app. Keep the existing consumer/profile status visible where it helps diagnose active bindings.
- Move “Create Microsoft app” and tenant-owned profile management behind an explicit collapsed advanced/BYO-app disclosure. The disclosure copy should warn that this is intended for organizations that deliberately require their own Entra application and is normally unnecessary on hosted Alga PSA.
- For `source === 'tenant'`, keep the tenant-owned profile selected and show the advanced section expanded when editing it.
- For `source === 'none'`, retain the current manual setup as the available path, with neutral self-hosted guidance rather than promising platform credentials.
- Add translation keys in the existing `msp/integrations` locale files for the platform-managed state, primary action, advanced disclosure, warning, and no-platform fallback; keep `defaultValue` strings aligned with those keys.

### 3. Carry the same choice into email-provider setup

- Update `packages/integrations/src/components/email/ProviderSetupWizardDialog.tsx` and the Microsoft provider form exported through `packages/integrations/src/components/email/providers/entry` so the wizard receives the server-derived Microsoft credential capability.
- When platform credentials are ready, make “Connect with Microsoft” the default Microsoft 365 path and omit app-ID, tenant-ID, and client-secret fields from the primary flow. The existing OAuth initiation should continue to create/configure the provider after consent.
- Add an explicit advanced/BYO-app choice that routes to the current manual credential/profile workflow and repeats the hosted warning before showing credential fields.
- When platform credentials are unavailable, default to the existing manual path and explain which server/application configuration is missing; do not strand self-hosted users behind a hosted-only CTA.
- Ensure reopening/editing an existing provider follows its stored credential/profile choice rather than silently changing it to the platform default.

### 4. Keep OAuth actions authoritative

- Review `packages/integrations/src/actions/email-actions/emailProviderActions.ts` and Microsoft OAuth initiation/callback actions to ensure the no-BYO path resolves credentials through the shared consumer/profile resolver and never requires tenant secrets merely because the UI omitted manual fields.
- Preserve explicit tenant-profile bindings for BYO configurations. Do not overwrite or delete existing tenant secrets when a user chooses the platform path.
- Return actionable, source-aware errors: platform credentials unavailable, tenant profile incomplete, or consent failed. Avoid exposing secret names/values beyond administrator-safe configuration guidance.

### 5. Behavioral coverage

- Extend `providerReadiness`/consumer-resolution tests to cover platform app secrets, environment fallback, tenant override, partial credentials, and no credentials, asserting the safe `source` result and precedence.
- Extend `MicrosoftIntegrationSettings.contract.test.tsx` with behavioral render/interactions: platform-ready shows the simple path and collapsed advanced controls; opening advanced reveals BYO fields/warning; no-platform shows manual setup; an existing tenant profile remains editable.
- Add wizard/form tests that select Microsoft 365 and verify platform-ready setup reaches OAuth without requiring IDs/secrets, while the advanced and no-platform cases require the existing manual fields.
- Add an action-level test proving platform credentials can initiate Microsoft email OAuth and that an explicit tenant profile still wins when selected.

## Manual verification

1. In an EE/hosted-style environment with `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and optional tenant fallback supplied as app/env secrets, open Integrations → Microsoft and confirm the platform-managed connect path is primary and no app-registration fields are initially visible.
2. Open Advanced / bring your own app, confirm the warning appears, create a tenant app profile, and verify it can be selected without altering platform secrets.
3. Add a Microsoft 365 email provider through the wizard, complete consent, and confirm the provider connects without entering app credentials.
4. Repeat with platform credentials absent and confirm the manual flow remains usable and clearly explains the requirement.
5. Edit/reconnect existing platform-backed and tenant-profile-backed providers and confirm each retains its credential source.

## Key decisions

- Use credential capability/source, not hostname or edition, to choose the default experience.
- Keep platform and BYO credentials as parallel supported sources; this is a UX/defaulting change, not a migration that removes tenant profiles.
- Centralize precedence with the existing Microsoft consumer resolver so readiness, setup UI, and OAuth execution cannot disagree.
- Never expose secret material to client components; only return readiness and source metadata.

# PRD — Outlook Calendar on the AlgaPSA-supplied Microsoft app

- Slug: `supplied-microsoft-app-calendar`
- Date: `2026-11-16`
- Status: Draft
- PSA ticket: alga-2026-0003151

## Summary

On hosted, an MSP can set up Microsoft with the application AlgaPSA supplies ("No Entra app registration is required"). That setup serves Outlook email only. A tenant that then tries to connect an Outlook calendar is told "Microsoft provider settings are not configured" and is sent to a screen that says Microsoft is ready, with nothing about calendar. Decision (2026-11-16): Outlook Calendar on the supplied app is a supported configuration. This plan makes the supplied app serve calendar as part of the same setup, brings existing supplied-app tenants along, and makes the calendar and provider screens tell one consistent story.

This replaces the earlier position (alga-2026-0002658, 2026-10-20) that calendar is bring-your-own-app only. Bring-your-own-app remains available.

## Problem

- Supplied-app setup (`configureMicrosoftEmailPlatformApplication` in `packages/integrations/src/actions/integrations/microsoftEmailSetupActions.ts`, through `createMicrosoftEmailProfilePendingConsentInternal` in `microsoftActions.ts`) creates an ordinary tenant Microsoft profile holding the platform client id and secret with `capabilities: ['email']`. When admin consent returns, `writeMicrosoftEmailAdminConsent` (`packages/integrations/src/lib/microsoftEmailAdminConsent.ts`) binds only the `email` consumer.
- Calendar readiness (`getMicrosoftCalendarSetupStatus` in `ee/packages/calendar/src/lib/actions/integrations/calendarSetupActions.ts`, via `resolveMicrosoftConsumerProfileConfig(tenant, 'calendar')`) needs a `calendar` binding to a profile with the calendar capability. A supplied-app tenant has neither, so it gets `binding_not_configured`.
- The calendar form (`ee/packages/calendar/src/components/calendar/MicrosoftCalendarProviderForm.tsx`) shows "Microsoft provider settings are not configured" and links to Providers. Providers (`MicrosoftIntegrationSettings.tsx`) shows "Microsoft email is ready to connect" and a "Connect a mailbox" action. The user has no next step.
- The calendar form's "Before you connect" section tells the user to add a redirect URI and permissions "in your Microsoft Entra app registration", which a supplied-app tenant does not have.
- The supplied app does work for calendar. Production on 2026-11-16 had 14 tenants that reached it by hand (editing the profile under "Manual Microsoft apps (advanced)", turning on Outlook Calendar and selecting it for Outlook Calendar); 13 had connected a calendar and 8 had synced events with no errors. The capability exists; only the setup path and the copy are missing.

## Goals

1. A hosted tenant that sets up Microsoft with the supplied app can connect an Outlook calendar with no visit to the advanced screen and no Entra work.
2. Tenants that already set up the supplied app for email get calendar without repeating setup.
3. The calendar "not configured" state, the Providers status and the "Before you connect" copy agree with each other and with the tenant's actual configuration.
4. A tenant's own choice is never overridden: an existing Calendar binding to another profile stays.

## Non-goals

- Removing or discouraging bring-your-own-app for calendar.
- Offering the supplied app on self-hosted or appliance deployments (the existing licensing refusal in `configureMicrosoftEmailPlatformApplication` stays).
- Teams, SSO or other Microsoft consumers on the supplied app.
- Subscription renewal (`2026-11-16-microsoft-calendar-subscription-renewal`) and the localhost redirect (`2026-11-16-app-relative-redirects`). Both affect this flow and should ship first or together.

## Users and Primary Flows

**New hosted tenant**

1. Admin opens Providers > Microsoft, chooses the supplied app and grants admin consent.
2. Providers shows that Microsoft is ready for email and calendar, with "Connect a mailbox" and "Connect a calendar".
3. A user opens Integrations > Calendar > Add Outlook Calendar, signs in with Microsoft and the calendar connects.

**Existing supplied-app tenant (email only today)**

1. A user opens Add Outlook Calendar. The form is ready; there is no "not configured" state.
2. They sign in and connect. If their Microsoft tenant requires admin approval for the calendar permissions, they see a specific message saying so, with the action an admin takes.

**Tenant with its own app bound to Calendar**

Nothing changes. Their binding and the Entra instructions stay as they are.

**Hosted tenant with nothing set up**

The calendar form's "not configured" state says Microsoft has not been set up and leads to Providers, where the supplied app is the offered path.

## UX / UI Notes

- Providers > Microsoft, supplied-app ready state: one banner covering what the app serves. Title along the lines of "Microsoft is ready to connect" and body naming email and calendar, with two actions: "Connect a mailbox" (`MAILBOX_SETUP_ENTRY_PATH`) and "Connect a calendar" (`CALENDAR_SETUP_ENTRY_PATH`). Calendar appears only where calendar sync exists (EE). Use the existing banner and button components.
- "Which Microsoft app each service uses" shows the supplied app for Outlook Calendar after setup.
- Calendar form:
  - Ready on the supplied app: the "Before you connect" section does not show Entra app registration instructions. It says the calendar connects with the Microsoft application supplied by AlgaPSA and that the user will be asked to sign in.
  - Ready on a tenant-owned app: unchanged.
  - Not configured: reason-specific copy stays, and the link goes to the provider setup entry.
- Consent failure at connect: a clear message that a Microsoft administrator needs to approve calendar access for the organisation, with a link to the admin consent URL for admins (`getMicrosoftEmailAdminConsentUrl` already builds it for the profile).
- All new strings go through the existing locale files (`server/public/locales/*/msp/calendar.json` and the integrations namespace).

## Requirements

### Functional Requirements

**The platform app declares what it serves**

- Introduce a single definition of the consumers the supplied app serves on this build: `email` always, `calendar` when the calendar package is present (EE). Setup, consent-time binding, reconciliation and the status surfaces all read it. No call site hard-codes `['email']` for the platform app after this.
- `configureMicrosoftEmailPlatformApplication` creates the profile with those capabilities.
- `writeMicrosoftEmailAdminConsent`, when the consented profile is the platform profile (client id equals the platform client id from `resolvePlatformMicrosoftCredentials`), binds each served consumer that currently has no binding. It never replaces an existing binding to a different profile. For tenant-owned profiles its behaviour is unchanged (email only).
- The email-specific naming of the setup action, the pending-consent creator and the default profile display name ("Alga platform Microsoft Email") no longer describes what they do. Rename where the rename is mechanical; otherwise mark with a `LEVERAGE: friction` comment. New profiles get a name that does not say "Email".

**Existing platform profiles are reconciled**

- A reconcile-on-use step, following the `ensureLegacyMicrosoftProfileBackfill` precedent, finds the tenant's platform profile (client id equals the platform client id, not archived, admin consent recorded) and adds any served capability it lacks and any served-consumer binding that is missing. Same no-override rule. It runs from the paths that read calendar readiness and Microsoft profile status, is idempotent and is safe under concurrent calls.
- Profiles that tenants already extended by hand (calendar capability and binding present) are left exactly as they are.
- A profile still pending admin consent is not bound to calendar until consent is recorded.

**Calendar readiness knows the credential source**

- `getMicrosoftCalendarSetupStatus` returns whether the bound profile is the supplied app or a tenant-owned app, so the form can choose its copy. Derive it the way `getMicrosoftEmailSetupReadiness` (`packages/integrations/src/actions/integrations/providerReadiness.ts`) derives `source === 'platform'`.
- It also returns whether the supplied app is offered on this deployment (`platformOffered`), so the not-configured state can describe the right next step.
- `ee/packages/calendar/src/lib/microsoftConsumerProfileResolution.ts` is a forked copy of `packages/integrations/src/lib/microsoftConsumerProfileResolution.ts` without the consent fields. Use the shared resolver if the package dependency direction allows it; otherwise add what is needed to the fork and leave a `LEVERAGE: pattern` marker at both.

**Consent errors at calendar connect**

- The calendar OAuth callback (`ee/packages/calendar/src/app/api/auth/microsoft/calendar/callback/route.ts`) recognises Microsoft's consent-required and admin-approval-required errors and returns a distinct error code to the UI instead of a generic failure.
- The form renders the message described under UX. The re-consent link is offered only to users allowed to manage Microsoft provider settings.

**Calendar permissions on the shared app registration (outside the codebase)**

- The supplied app's Entra registration must carry the delegated calendar permissions the connect flow requests (`Calendars.ReadWrite`, `MailboxSettings.ReadWrite`, `offline_access`, `User.Read`) so that tenant admin consent, which uses the `.default` scope, covers calendar. Without that, each user consents at connect, and tenants that disable user consent are blocked.
- The calendar redirect URI is already registered on it (tenants connect today).
- Tenants that consented before the permissions were added keep their old grant until an admin consents again. The consent-error path above is what they see; the Providers screen offers "Approve calendar access" (the same admin consent URL) for a platform profile.

### Non-functional Requirements

- No change for CE or for self-hosted deployments where the supplied app is not offered.
- Reconciliation adds at most one profile update and one binding insert per tenant, once.
- No secret is copied or exposed: the platform profile already stores the platform secret; this plan does not add another copy.

## Data / API / Integrations

- Tables: `microsoft_profiles` (`capabilities`), `microsoft_profile_consumer_bindings` (`consumer_type = 'calendar'`). No schema change expected.
- Admin consent: `buildMicrosoftEmailAdminConsentUrl` in `packages/integrations/src/lib/microsoftEmailSetup.ts` (`/{tenant}/v2.0/adminconsent`, scope `https://graph.microsoft.com/.default`).
- Binding rules to respect: `setMicrosoftConsumerBinding` in `microsoftActions.ts` (profile must have the capability; consumer must be visible).

## Security / Permissions

- Reconciliation and consent-time binding are tenant-scoped and only ever touch the tenant's own platform profile.
- Binding changes made by a user still go through `setMicrosoftConsumerBinding` and its permission checks. The automatic binding happens only as part of supplied-app setup and reconciliation, and only when no binding exists.
- The re-consent link is shown only to users who can manage provider settings.

## Observability

Log when reconciliation adds a capability or binding (tenant and profile id, no secrets), and when the calendar callback classifies a consent error.

## Rollout / Migration

1. Add the calendar delegated permissions to the shared Entra app registration (owner action, before or with the release).
2. Ship the code. Existing supplied-app tenants are reconciled the first time someone opens the calendar or Microsoft provider screens.
3. Verify on production with read-only queries: count of platform profiles with and without the calendar capability and binding before and after.
4. Update `docs/integrations/` setup guidance and any customer-facing help that says calendar needs a customer Entra app.

## Open Questions

- Does the shared Entra app registration already list the calendar delegated permissions statically? Not visible from code. Determines whether step 1 of rollout is needed and how many existing tenants will hit the consent-error path.
- Should Providers show "Approve calendar access" proactively for platform profiles consented before the permissions were added, or only after a failed connect? There is no stored record of which scopes a tenant's consent covered; the plan assumes reactive, plus the always-available action on the Providers screen.

## Acceptance Criteria (Definition of Done)

- A hosted tenant with no Microsoft setup completes supplied-app setup and connects an Outlook calendar without opening the advanced screen.
- A hosted tenant with an email-only supplied-app profile opens Add Outlook Calendar, finds it ready, and connects.
- A tenant whose Calendar binding points at its own app is unchanged after reconciliation and still sees the Entra instructions.
- Providers > Microsoft shows a ready state that covers email and calendar with an action for each, and the calendar form shows no Entra app registration instructions when the supplied app is in use.
- A connect attempt blocked by Microsoft for lack of consent shows the admin-approval message.
- CE and self-hosted behaviour is unchanged.

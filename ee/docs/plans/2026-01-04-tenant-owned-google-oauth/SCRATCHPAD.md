# Scratchpad — Tenant-Owned Google OAuth

## Context / Ask
- Switch Google integrations to tenant-owned OAuth apps (client id/secret per tenant), remove Alga-owned app dependency.
- Add a setup area with guidance.
- Update setup screens for Google Calendar + Gmail inbound email to use tenant-supplied credentials and select the appropriate tenant Google configuration.
- Store secrets via Secrets Provider as tenant secrets.
- No migrations; fresh cutover is acceptable.

## Code Pointers (current-state)
### Settings / UI entrypoints
- Integrations settings hub: `server/src/components/settings/integrations/IntegrationsSettingsPage.tsx`
- Calendar settings page: `server/src/components/calendar/CalendarIntegrationsSettings.tsx`
- Google calendar provider form: `server/src/components/calendar/GoogleCalendarProviderForm.tsx`
- Email settings / providers: `server/src/components/EmailProviderConfiguration.tsx`
- Gmail provider form: `server/src/components/GmailProviderForm.tsx`

### Email (Gmail) OAuth + persistence
- OAuth init action: `server/src/lib/actions/email-actions/oauthActions.ts`
- OAuth init API route (also exists): `server/src/app/api/email/oauth/initiate/route.ts`
- OAuth callback route: `server/src/app/api/auth/google/callback/route.ts`
- Provider + config persistence: `server/src/lib/actions/email-actions/emailProviderActions.ts`
- Pub/Sub provisioning: `server/src/lib/actions/email-actions/setupPubSub.ts` (currently reads `google_service_account_key` as an app secret)
- Pub/Sub + watch orchestration: `server/src/lib/actions/email-actions/configureGmailProvider.ts`
- Gmail token refresh reads tenant secrets fallback: `server/src/services/email/providers/GmailAdapter.ts`

### Calendar OAuth + persistence
- OAuth init action: `server/src/lib/actions/calendarActions.ts`
- Redirect URI resolver: `server/src/utils/calendar/redirectUri.ts`
- OAuth callback route: `server/src/app/api/auth/google/calendar/callback/route.ts`
- Token refresh reads tenant secrets fallback: `server/src/services/calendar/providers/GoogleCalendarAdapter.ts`
- Pub/Sub verification job: `server/src/lib/jobs/handlers/calendarWebhookMaintenanceHandler.ts` (calls `GoogleCalendarAdapter.registerWebhookSubscription()` which is currently a no-op placeholder)

## Observations
- Multiple “hosted detection” branches select app-level Google credentials (based on `NEXTAUTH_URL` containing `https://algapsa.com`).
- Email provider persistence already writes user-provided client id/secret into tenant secrets in some paths, but also persists them into DB config columns and may override with hosted secrets if present.
- Docs for Gmail setup already describe tenant secrets for `google_service_account_key`: `docs/inbound-email/setup/gmail.md`, but implementation currently uses app secret.
- Calendar runbook already assumes tenant-provided OAuth apps: `docs/integrations/calendar-sync-operations.md`.

## Decisions (proposed)
- Add a dedicated “Google” integration settings panel under Integrations → Communication.
- Default to one shared OAuth app for Gmail + Calendar (still allow separate credentials if needed).
- Prefer reusing existing secret key names to avoid larger refactors.
- `${BASE_URL}` redirect URIs are canonical; no tenant-specific redirect URI overrides.
- Remove/disable Google “hosted uses app secrets” paths and require tenant secrets instead.
- Do not migrate; tenants reconfigure.
- Reset existing Google providers back to an initial/disconnected state for the fresh cutover.
- Implement Google Calendar change callbacks (current code expects Pub/Sub push to `/api/calendar/webhooks/google`).
- Add scheduled Google maintenance jobs (token preflight refresh + Gmail watch renewal + Calendar notification verification) using the job runner abstraction (PG Boss/Temporal).

## Open Questions
- Whether to build a “connected Google accounts” abstraction vs continue per-integration OAuth token storage.
- Calendar notifications feasibility: confirm Pub/Sub vs native Calendar push channels based on what Google supports for Calendar updates with our stack.

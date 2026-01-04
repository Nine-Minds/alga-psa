# Tenant-Owned Google OAuth (Calendar + Inbound Gmail)

## Summary
Switch Google integrations from Alga’s shared, multi-tenant Google OAuth app to **tenant-owned Google Cloud OAuth credentials**. Each tenant supplies their own OAuth Client ID/Secret (and required GCP configuration) to automate their own Google accounts. This removes Alga’s dependency on Google’s intensive verification/review for a single shared app.

Scope includes:
- Google Calendar integration
- Google inbound email (Gmail) integration

We will **not migrate** existing configurations. Tenants must reconfigure under the new model.

## Problem Statement
Today Google integrations rely on Alga-managed OAuth credentials in some environments/flows (notably “hosted” logic), creating:
- Vendor compliance/review burden and delays for Alga.
- Higher operational and legal risk for a centralized multi-tenant app.
- Tenant friction when Alga’s app must be re-verified, rotated, or constrained.

## Goals
- Tenants can configure Google integrations using **their own** Google Cloud OAuth app credentials.
- OAuth client credentials are stored using the **Secrets Provider** as **tenant-level secrets** (never stored in plain DB columns).
- Provide a dedicated **Google setup area** in UI with in-context guidance to complete required Google Cloud Console steps.
- Update Google Calendar and Gmail setup screens to use the tenant’s stored credentials and to **select the appropriate tenant Google configuration**.
- Use the same tenant-provided configuration model in both hosted and on-prem (CE vs EE): tenant secrets are the source of truth in all deployments.
- Remove/ignore existing Alga Google app infrastructure paths (fresh cutover).

## Non-Goals
- Migrating existing Google provider configs, tokens, or Pub/Sub resources.
- Supporting Alga-owned Google OAuth credentials as a fallback for production/hosted environments.
- Redesigning OAuth scopes beyond what’s already required by current integrations.
- Consolidating the integrations into a single OAuth callback URL (we will keep existing callback routes unless decided otherwise).

## Users / Personas
- **Tenant Admin**: configures integrations for their organization (OAuth app creation, secrets, service accounts).
- **Technician / Scheduler**: connects their Google Calendar (per-user calendar provider).
- **Helpdesk Operator**: relies on inbound email providers to create tickets from a mailbox.

## Current-State Notes (as observed in repo)
### Inbound Gmail
- UI: `server/src/components/GmailProviderForm.tsx` collects `projectId`, `clientId`, `clientSecret`, `redirectUri` and persists these via `server/src/lib/actions/email-actions/emailProviderActions.ts`.
- Tokens saved on callback: `server/src/app/api/auth/google/callback/route.ts` updates `google_email_provider_config` with `access_token`, `refresh_token`, `token_expires_at`.
- “Hosted” credential selection exists: `server/src/lib/actions/email-actions/oauthActions.ts` + callback route choose app-level secrets when `NEXTAUTH_URL` indicates hosted.
- Pub/Sub setup: `server/src/lib/actions/email-actions/setupPubSub.ts` currently reads service account JSON from an **app secret** (`google_service_account_key`), while docs suggest tenant-level (`docs/inbound-email/setup/gmail.md`).

### Google Calendar
- UI: `server/src/components/calendar/GoogleCalendarProviderForm.tsx` creates a provider and runs OAuth via `server/src/lib/actions/calendarActions.ts` and callback `server/src/app/api/auth/google/calendar/callback/route.ts`.
- “Hosted” credential selection exists for calendar OAuth (similar detection via `NEXTAUTH_URL`).
- Calendar adapter token refresh can use tenant secrets (`server/src/services/calendar/providers/GoogleCalendarAdapter.ts`) if credentials not stored in provider config.
- Pub/Sub verification job exists (`verify-google-calendar-pubsub`) but Google calendar Pub/Sub setup appears incomplete/no-op in `GoogleCalendarAdapter.registerWebhookSubscription()`.

## Proposed Solution
### 1) Add a dedicated “Google” setup area
Add a new Settings area under **Settings → Integrations → Communication**:
- “Google” panel (or “Google Cloud”) that lets tenant admins:
  - Enter Google Cloud project ID (used for Gmail Pub/Sub; also used by calendar if/when calendar Pub/Sub is implemented).
  - Enter OAuth Client ID and OAuth Client Secret for:
    - Gmail inbound email (scopes include Gmail readonly + Pub/Sub) **or**
    - Calendar (scope includes Calendar)
  - Default to “Use the same OAuth app for Gmail + Calendar” and apply the same client credentials to both (while still allowing separate credentials if desired).
  - Upload/enter service account key JSON used for Pub/Sub provisioning (Gmail). Store via tenant secrets.
  - See the required redirect URIs and scopes directly in the UI:
    - Redirect URIs:
      - `${BASE_URL}/api/auth/google/callback`
      - `${BASE_URL}/api/auth/google/calendar/callback`
    - Scopes (current):
      - Gmail: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/pubsub`
      - Calendar: `https://www.googleapis.com/auth/calendar`
  - Validate and show a status summary (configured / missing fields), and show masked client ID.

Redirect URIs:
- `${BASE_URL}` is canonical across deployments; we do not need tenant-configurable redirect URI overrides.

### 2) Store configuration in tenant secrets (Secrets Provider)
Store all sensitive values as **tenant secrets**, not app secrets:
- `google_client_id`, `google_client_secret` (Gmail OAuth)
- `google_calendar_client_id`, `google_calendar_client_secret` (Calendar OAuth)
- `google_project_id` and/or `google_calendar_project_id` (if still needed by codepaths)
- `google_service_account_key` (JSON string for Pub/Sub provisioning)

Exact secret keys should align with existing code expectations where possible to minimize change surface.

### 3) Update integration setup screens
#### Gmail provider setup (Inbound Email)
Update `GmailProviderForm` to:
- Stop asking for OAuth Client ID/Secret in the provider form (those come from tenant Google setup).
- Stop persisting OAuth Client ID/Secret into `google_email_provider_config` DB columns (keep schema, but do not rely on it).
- Continue to ask for mailbox, provider name, label filters, defaults, etc.
- Surface a “Google not configured” state with a CTA link to the Google setup panel if required secrets are missing.
- OAuth initiation must use tenant secrets (even in hosted environments).

#### Google Calendar provider setup
Update `GoogleCalendarProviderForm` to:
- Surface which tenant Google configuration it will use (and show missing-config CTA if not configured).
- Ensure OAuth initiation + callback use tenant secrets consistently.
- If the tenant chooses separate credentials for Calendar vs Gmail, the form should use the calendar ones.
- Ensure Google Calendar update callbacks are configured so Alga receives calendar change notifications.

### 4) Remove/disable hosted-app credential paths for Google
For Google (only), eliminate “hosted uses app secrets” branching so hosted environments do not depend on Alga-owned Google OAuth credentials.

### 5) Fresh cutover, no migration
Existing Google provider records may remain in DB, but:
- Existing provider records should be reset back to an initial/disconnected state to avoid confusing “connected” UI on legacy credentials/tokens.
- We won’t attempt to migrate tokens/config; tenants re-authorize after configuring tenant secrets.

## Google Calendar callbacks
We should configure Google Calendar change notifications so Alga receives callbacks and triggers a delta sync.

Current implementation expectation in code:
- Google Calendar notifications arrive as **Pub/Sub push** to `POST /api/calendar/webhooks/google` (`server/src/app/api/calendar/webhooks/google/route.ts`).
- `CalendarWebhookProcessor.processGoogleWebhook()` locates the provider using the Pub/Sub subscription name and then performs a delta sync using the provider’s sync token.

Required work:
- Provision the Google-side notification pipeline end-to-end so calendar updates publish into the tenant’s Pub/Sub topic/subscription (or, if Pub/Sub is not feasible for Calendar notifications, pivot to native Calendar push channels and refactor the webhook processor accordingly).

## Background maintenance (Google)
Microsoft mail/calendar already have scheduled renewal via the job runner abstraction (PG Boss in CE, Temporal in EE). We should add similar maintenance for Google:
- Gmail: refresh/renew Gmail watch subscriptions before `watch_expiration` and surface failures as provider errors.
- Calendar: verify/repair the calendar notification pipeline so callbacks continue to arrive; surface failures as provider errors.
- Tokens: proactively refresh access tokens nearing expiry (best-effort) to detect broken refresh tokens early and reduce webhook processing failures.

## UX / UI Notes
- The Google setup panel must include concise, step-by-step instructions:
  - Create/choose a Google Cloud project.
  - Enable required APIs (Gmail API, Google Calendar API, Pub/Sub API).
  - Configure OAuth consent screen (Internal/External depending on tenant).
  - Create OAuth Client ID (Web application) and add redirect URIs.
  - Create a service account and grant Pub/Sub admin (or specific permissions) for provisioning.
  - Provide the Gmail push service account publisher role guidance (as done in setup code) and/or link to docs.
- Show “copy” buttons for redirect URIs and scopes.
- Show validation errors inline (invalid client ID format, malformed JSON service account key, missing project ID).

## Technical Design Notes
### Configuration read-path
Create a small server action/service:
- `getGoogleIntegrationConfigStatus(tenant)` returns which secrets are present and any derived base URLs / redirect URIs.
- Ensure values are masked (never return raw secret).

### OAuth flows
Email OAuth:
- Initiation: `server/src/lib/actions/email-actions/oauthActions.ts`
- Callback: `server/src/app/api/auth/google/callback/route.ts`

Calendar OAuth:
- Initiation: `server/src/lib/actions/calendarActions.ts`
- Callback: `server/src/app/api/auth/google/calendar/callback/route.ts`

Both should:
- Use tenant secrets for client ID/secret.
- Avoid app-secret fallback for Google.

### Pub/Sub provisioning
Update Gmail Pub/Sub provisioning (`server/src/lib/actions/email-actions/setupPubSub.ts`) to read `google_service_account_key` from **tenant secrets**. (This aligns with `docs/inbound-email/setup/gmail.md`.)

Calendar Pub/Sub:
- Current implementation appears incomplete/no-op; not required to satisfy the tenant-owned OAuth change, but should be assessed as a risk.

## Security / Permissions
- Only users with appropriate RBAC (currently `system_settings` create/update) can view the Google setup panel and write secrets.
- Never return secrets to the client; only return masked/boolean status.
- Ensure secrets provider write path uses tenant scoping.

## Risks / Open Questions
1. Google Calendar notifications: confirm the chosen mechanism (Pub/Sub vs native Calendar push channels) based on feasibility and the existing webhook processor expectations.
2. Provider reset: implement as explicit admin action vs automatic reset-on-first-load; decide which is safer operationally.

## Rollout / Migration
- Breaking change for Google integrations.
- No migration of existing providers/tokens.
- Update documentation and in-app guidance to clearly explain reconfiguration steps.

## Acceptance Criteria
- Tenant admin can configure Google OAuth credentials via a dedicated settings area and secrets are stored as tenant secrets.
- Gmail and Google Calendar integrations successfully initiate OAuth using tenant credentials (including in hosted environments) with the same tenant-secret configuration model for CE and EE.
- Provider setup UIs no longer require manual entry of client id/secret per-provider and guide users to the Google setup area if missing.
- No Google integration codepath depends on app-level Google OAuth credentials.
- Google Calendar notifications are configured so Alga receives callbacks and can trigger delta sync.
- Google integrations have scheduled maintenance (PG Boss / Temporal) to keep callbacks and tokens healthy, analogous to Microsoft.
- Secrets are never returned unmasked to the browser.

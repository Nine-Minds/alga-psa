# IMAP Inbound Email Scratchpad

Last updated: 2026-01-11
Owner: Email Platform

Use this scratchpad to capture key findings, decisions, TODOs, and file references while implementing the IMAP inbound email service.

---

## Scope Notes
- IMAP provider must feed existing `INBOUND_EMAIL_RECEIVED` workflow event pipeline (same as Gmail/Microsoft).
- IMAP v1 must include OAuth2 (XOAUTH2) support.
- IMAP service should be resilient: IDLE, reconnect, backoff, dedupe, and per-folder monitoring.
- `auto_process_emails` is not exposed in the UI (processing is gated by provider Active flag).

---

## Current Event Flow (Research)
- Gmail webhook: `server/src/app/api/email/webhooks/google/route.ts`
  - Decodes Pub/Sub notification, loads provider config, fetches message details via `GmailAdapter`, publishes `INBOUND_EMAIL_RECEIVED` via `shared/events/publisher.ts`.
- Microsoft webhook: `server/src/app/api/email/webhooks/microsoft/route.ts`
  - Validates Graph notification, fetches message details via `MicrosoftGraphAdapter`, publishes `INBOUND_EMAIL_RECEIVED` (fallback minimal payload on fetch failure).
- Workflow worker: `services/workflow-worker/src/WorkflowWorker.ts`
  - Consumes workflow events (Redis stream) and starts `shared/workflow/workflows/system-email-processing-workflow.ts`.
- Event schema: `shared/workflow/streams/eventBusSchema.ts`
  - `INBOUND_EMAIL_RECEIVED` payload expects `{ providerId, emailData{...} }`.

---

## Important Files / Entry Points
- Provider types + interfaces
  - `shared/interfaces/inbound-email.interfaces.ts`
  - `server/src/interfaces/email.interfaces.ts`
- Email provider CRUD + orchestration
  - `server/src/services/email/EmailProviderService.ts`
  - `server/src/lib/actions/email-actions/emailProviderActions.ts`
- Gmail integration (baseline)
  - `server/src/services/email/providers/GmailAdapter.ts`
  - `server/src/services/email/GmailWebhookService.ts`
- Microsoft integration (baseline)
  - `shared/services/email/providers/MicrosoftGraphAdapter.ts`
- Event publishing
  - `shared/events/publisher.ts`
- Inbound email docs
  - `docs/inbound-email/README.md`
  - `docs/inbound-email/architecture/workflow.md`
  - `docs/inbound-email/development/adapters.md`

---

## Data Model Notes
- Existing tables:
  - `email_providers` (provider_type: google|microsoft)
  - `google_email_provider_config`
  - `microsoft_email_provider_config`
- IMAP will need `imap_email_provider_config` (new migration + Citus distribution).
  - Implemented migration: `server/migrations/20251226121000_create_imap_email_provider_config.cjs`
  - Includes host/port/TLS/auth_type/username/folder_filters + OAuth fields + state tracking.
  - Added folder state jsonb for per-folder UID tracking: `server/migrations/20251226124500_add_imap_folder_state.cjs`.
  - Added runtime metadata columns (leases, capabilities, timeouts): `server/migrations/20251226140000_add_imap_runtime_columns.cjs`.

---

## UI/UX Touchpoints
- Provider selection: `server/src/components/EmailProviderSelector.tsx`
- Provider configuration shell: `server/src/components/EmailProviderConfiguration.tsx`
- Provider forms: `server/src/components/GmailProviderForm.tsx`, `server/src/components/MicrosoftProviderForm.tsx`
- Provider bundle entry: `packages/product-email-providers/{oss,ee}/entry.tsx`
  - Added IMAP forms: `server/src/components/ImapProviderForm.tsx` and `ee/server/src/components/ImapProviderForm.tsx`

---

## OAuth2 for IMAP (v1)
- Need IMAP OAuth2 flow (likely XOAUTH2, provider-specific endpoints).
- Determine if we must support generic OAuth2 endpoints per provider config (authorize/token URLs).
- Decide how to store IMAP OAuth client secrets + refresh tokens (tenant secrets provider preferred).
  - Secret keys used by actions: `imap_password_<providerId>`, `imap_oauth_client_secret_<providerId>`, `imap_refresh_token_<providerId>`
  - OAuth endpoints:
    - `POST /api/email/oauth/imap/initiate`
    - `GET /api/email/oauth/imap/callback`

---

## Implementation Notes (Initial)
- Service location proposal: `services/imap-service` (standalone worker like `services/workflow-worker`).
- IMAP service should publish `INBOUND_EMAIL_RECEIVED` via `shared/events/publisher.ts`.
- Read-only IMAP fetch should use `BODY.PEEK[]` to avoid marking as read.
  - IMAP service uses `imapflow` + `mailparser` to fetch/parse messages and publish events.
  - Per-folder listeners are created for each configured folder (fallback to INBOX).
  - Folder state (UIDVALIDITY/last UID) persisted in `imap_email_provider_config.folder_state`.
  - IMAP service acquires DB leases per provider (`lease_owner`, `lease_expires_at`) to avoid double-processing.
  - IMAP OAuth re-connect flow is available in the IMAP provider form + card action.
  - Local test IMAP server: GreenMail (`greenmail/standalone:latest`) added to dev compose.
    - SMTP: host port `${EXPOSE_IMAP_TEST_SMTP_PORT:-3025}` → container 3025
    - IMAP: host port `${EXPOSE_IMAP_TEST_IMAP_PORT:-3143}` → container 3143
    - IMAPS: host port `${EXPOSE_IMAP_TEST_IMAPS_PORT:-3993}` → container 3993
    - For SMTP injection, use recipient local-part `imap_user` (GreenMail stores `To: imap_user` in headers).
  - IMAP runtime tuning is intentionally not exposed in the provider UI:
    - `IMAP_CONNECTION_TIMEOUT_MS` (default: `10000`)
    - `IMAP_MAX_EMAILS_PER_SYNC` (default: `5`)
    - `IMAP_SOCKET_KEEPALIVE` (default: `true`, set to `false` to disable)
  - To avoid thundering herd across instances/providers, IMAP service uses jittered timers:
    - `IMAP_TIMER_JITTER_PCT` (default: `0.1`) applies to provider refresh, heartbeat, poll sleep, and IDLE NOOP interval.
    - `IMAP_STARTUP_STAGGER_MS` (default: `2000`) staggers folder listener startup per provider/folder.
    - `IMAP_RECONNECT_JITTER_PCT` (default: `0.5`) randomizes reconnect delay within `[baseDelay*(1-jitterPct), baseDelay]`.
  - Initial connect and manual resync behavior:
    - When cursor state is empty, IMAP listener starts from the most recent `IMAP_MAX_EMAILS_PER_SYNC` window (based on mailbox `uidNext`) instead of replaying the whole mailbox from UID 1.
    - `last_uid` advances to the highest UID observed even when a message is skipped/deduped, to avoid repeatedly re-scanning the same window.
  - Kubernetes deployment assets:
    - Helm chart: `ee/helm/imap-service` (includes liveness/readiness probes via `/health`).
    - Argo CI/CD (nm-kube-config): `argo-workflow/alga-psa-dev/templates/build/imap-service-ci-cd-sebastian.yaml`.
    - Helm values (nm-kube-config): `imap-service/{hosted,sebastian,prod}.values.yaml`.

---

## Open Questions
- Which IMAP client library should we standardize on (imapflow vs node-imap)?
- OAuth2 endpoints: per-provider config vs pre-baked defaults?
- UID tracking per folder: store as map in JSONB or separate table?
- Do we want a lease/lock (Redis/DB) to prevent multi-instance double processing?

---

## TODO Log
- [ ] Add IMAP provider type to shared/server interfaces and UI enums.
- [ ] Create `imap_email_provider_config` migration.
- [ ] Add IMAP provider form (OSS + EE).
- [ ] Implement IMAP OAuth2 flow (init + callback + token refresh).
- [ ] Stand up `services/imap-service` with IDLE + reconnect + publish.

---

## Decisions
- 2025-12-26: IMAP v1 must include OAuth2 support (XOAUTH2).

# IMAP Inbound Email Service Plan

Status: Draft
Owner: Email Platform
Last updated: 2025-12-26

## Goals
- Add an IMAP inbound email provider that feeds the same `INBOUND_EMAIL_RECEIVED` event flow as Gmail and Microsoft.
- Provide a resilient, long-running IMAP service that uses IDLE, reconnects automatically, and handles multiple folders per mailbox.
- Expose IMAP as a first-class inbound email provider in the settings UI alongside Google and Microsoft.

## Current State (Research Summary)
- Gmail inbound flow: `server/src/app/api/email/webhooks/google/route.ts` decodes Pub/Sub, loads provider config, fetches full message details via `GmailAdapter`, and publishes `INBOUND_EMAIL_RECEIVED` via `shared/events/publisher.ts`.
- Microsoft inbound flow: `server/src/app/api/email/webhooks/microsoft/route.ts` validates Graph notifications, fetches message details via `MicrosoftGraphAdapter`, then publishes `INBOUND_EMAIL_RECEIVED` (with fallback minimal payload on fetch failure).
- Test flow: `server/src/services/email/MailHogPollingService.ts` emits `INBOUND_EMAIL_RECEIVED` directly via the server EventBus.
- Workflow trigger: `services/workflow-worker/src/WorkflowWorker.ts` consumes workflow events (Redis stream) and starts `shared/workflow/workflows/system-email-processing-workflow.ts`, which waits for the `INBOUND_EMAIL_RECEIVED` payload defined in `shared/workflow/streams/eventBusSchema.ts`.

## Proposed Architecture
### High-level flow
1) IMAP service connects to configured mailboxes and folders.
2) IDLE receives new mail notifications (or polling fallback if IDLE unsupported).
3) IMAP service fetches the full RFC822/body + headers for new messages.
4) Parse MIME into `EmailMessageDetails` and publish `INBOUND_EMAIL_RECEIVED` using `shared/events/publisher.ts`.
5) Workflow worker consumes and runs the existing system email processing workflow (no change).

### Service placement
- New service in `services/imap-service` (Node + TS, similar to `services/workflow-worker`).
- Uses shared DB access and shared event publisher to avoid duplicating queue/event logic.
- Deploy as a long-running worker alongside existing services (server, workflow-worker, temporal-worker).

## Data Model & Configuration
### Provider types
- Extend all inbound email unions to include `imap`:
  - `shared/interfaces/inbound-email.interfaces.ts`
  - `server/src/interfaces/email.interfaces.ts`
  - `server/src/components/EmailProviderConfiguration.tsx` (`providerType` union)
  - Any API/action payloads that validate provider type

### New vendor config table
Create `imap_email_provider_config` with fields (initial draft):
- `email_provider_id`, `tenant`
- Connection: `host`, `port`, `secure` (TLS), `allow_starttls`, `auth_type` (password | oauth2)
- Auth: `username`, `password` (store encrypted or via tenant secret provider), `oauth_access_token`, `oauth_refresh_token`, `oauth_expires_at`
- Processing: `auto_process_emails`, `max_emails_per_sync`, `folder_filters` (jsonb array)
- State: `last_uid`, `uid_validity`, `last_seen_at`, `last_error`, `last_sync_at`

### Provider CRUD + validation
- Update `server/src/services/email/EmailProviderService.ts` and `server/src/lib/actions/email-actions/emailProviderActions.ts` to support IMAP configs.
- Add validation in `server/src/services/email/EmailProviderValidator.ts` for IMAP host/port/auth requirements.
- Add secret storage integration via `getSecretProviderInstance()` for IMAP passwords (and optional OAuth tokens) instead of plain DB storage.

## IMAP Service Design
### Connection lifecycle
- Maintain one IMAP connection per provider + folder (or multiplex folders on a single connection if library allows).
- On startup, load active IMAP providers and connect to all configured folders.
- Use IDLE to listen for `EXISTS`/`RECENT` events; on disconnect or IDLE timeout, re-enter IDLE.
- Implement exponential backoff with jitter on reconnect.

### Message tracking + dedupe
- Track `uidvalidity` and `last_uid` per provider/folder; on mismatch, resync (search unseen from scratch).
- Persist state to `imap_email_provider_config` to survive restarts.
- Use `Message-ID` header plus providerId as a secondary dedupe key (insert into `email_processed_messages` or a new `imap_processed_messages` table) to avoid double-publishing.

### MIME parsing
- Fetch full RFC822 or `BODY.PEEK[]` and parse with a MIME parser (e.g., `mailparser`).
- Map into the existing `EmailMessageDetails` structure:
  - `subject`, `from`, `to`, `cc`, `receivedAt`
  - `body.text` and `body.html`
  - `attachments` metadata (id, name, contentType, size)
  - `threadId`, `references`, `inReplyTo`, and `headers`

### Event publishing
- Publish `INBOUND_EMAIL_RECEIVED` using `shared/events/publisher.ts` with payload:
  - `tenantId`, `tenant`, `providerId`, and the full `emailData` object
- Reuse existing workflow pipeline and ticket creation logic without changes.

## UI/UX Updates (Inbound Email Settings)
- Add an IMAP card to `server/src/components/EmailProviderSelector.tsx` and `ee/server/src/components/EmailProviderSelector.tsx`.
- Add an IMAP provider form in both OSS and EE components:
  - Fields: mailbox, host, port, TLS/starttls, username, password/app-password, folder filters, auto-process, max emails per sync, inbound ticket defaults.
- Update provider list cards to show IMAP status and connection errors.

## API + Service Integration
- New IMAP service reads configs via DB (not via server API) to avoid API coupling.
- Optional admin endpoints (future): manual reconnect, force resync, or pause provider.
- Add Docker Compose entry for `imap-service` (dev + prod) with required env vars.

## Observability
- Log structured events per provider: connect, disconnect, idle start, new message count, publish success/failure.
- Update `email_providers.status`, `error_message`, `last_sync_at` from the IMAP service on state changes.
- Add a lightweight health check endpoint or readiness log for monitoring.

## Testing Strategy
- Unit tests for IMAP MIME parsing into `EmailMessageDetails`.
- Integration tests with a local IMAP server (e.g., dockerized test server) validating:
  - IDLE + reconnect
  - Folder filters
  - Deduplication by UID + Message-ID
  - Published `INBOUND_EMAIL_RECEIVED` payload
- E2E: simulate incoming email and verify ticket creation via workflow.

## Implementation Plan (Tasks)
- [ ] Add `imap` provider type across shared/server interfaces and validation.
- [ ] Create `imap_email_provider_config` migration + indices + Citus distribution.
- [ ] Extend provider CRUD/actions to read/write IMAP config and secrets.
- [ ] Build IMAP adapter/parser (message fetch + MIME parsing) and map to `EmailMessageDetails`.
- [ ] Build `services/imap-service` with connection manager, IDLE loop, reconnect strategy, and publisher.
- [ ] Add UI forms and selector card for IMAP in both OSS and EE bundles.
- [ ] Wire Docker Compose for the new service (dev + prod) and document env vars.
- [ ] Add tests (unit + integration) and update inbound email docs to include IMAP.

## Risks & Mitigations
- **IMAP server variance**: IDLE support and folder semantics differ. Mitigate with polling fallback and robust folder selection logic.
- **Duplicate events**: IMAP can replay on reconnect. Mitigate with UID + Message-ID dedupe and persisted state.
- **Credential handling**: Storing passwords requires secure storage; use tenant secret provider and avoid logging secrets.
- **Large attachments**: IMAP fetch size can be heavy; fetch metadata first and defer content where possible.

## Open Questions
- Do we want OAuth2 for IMAP (XOAUTH2) in v1 or password-only?
- Should IMAP providers share the same inbound defaults schema as Google/Microsoft (yes), or add IMAP-specific defaults?
- Preferred IMAP test server for CI (e.g., Dovecot, GreenMail, or MailHog alternative)?

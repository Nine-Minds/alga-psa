# Microsoft Graph Inbound Email Parity Plan

Status: In Progress
Owner: Email Platform
Last updated: 2025-08-16

## Goals
- Achieve functional parity between Microsoft (Graph) and Gmail inbound email providers.
- Use consistent token storage, webhook setup/renewal, and message retrieval flows.
- Ensure webhook routes can publish enriched INBOUND_EMAIL_RECEIVED events reliably.

## Current State (Summary)
- Gmail: Production-ready with OAuth lifecycle, Pub/Sub watch, DB persistence, webhook handler publishing enriched events.
- Microsoft: Basic OAuth refresh and webhook subscription exist; tokens stored in tenant secrets; limited DB persistence; webhook route publishes minimal events only; header/body fetch and connection checks are lighter than Gmail.

## Scope of Work

1) Credentials: Load + Persist in DB (not tenant secrets)
- Update `MicrosoftGraphAdapter.loadCredentials()` to read `access_token`, `refresh_token`, `token_expires_at` from `microsoft_email_provider_config` via `config.provider_config` (matches Gmail pattern).
- Update `MicrosoftGraphAdapter.refreshAccessToken()` to persist refreshed tokens and expiry back to `microsoft_email_provider_config` (use admin/tenant DB access akin to Gmail adapter) instead of `email_provider_credentials` secret.
- Keep `client_id`/`client_secret` lookup via env first, then tenant secrets as fallback.

2) Webhook Subscription: Persist + Validate
- On subscription create/renew in `MicrosoftGraphAdapter`:
  - Set `email_providers.webhook_id = subscription.id` (route uses this for lookup).
  - Persist `webhook_subscription_id` and `webhook_expires_at` into `microsoft_email_provider_config`.
- Use `clientState` for validation:
  - Source: `config.webhook_verification_token` (reuse main provider field) to avoid schema changes.
  - Ensure the Microsoft webhook route validates `notification.clientState` against `email_providers.webhook_verification_token`; keep backward compatibility by also accepting `provider.provider_config.clientState` if present.

3) Webhook Route Behavior: Enriched events (parity with Gmail)
- In `app/api/email/webhooks/microsoft/route.ts`, after provider lookup and validation:
  - Instantiate `MicrosoftGraphAdapter` with the resolved provider config.
  - Fetch full message details (`getMessageDetails(id)`).
  - Publish `INBOUND_EMAIL_RECEIVED` with `emailData` payload, mirroring Gmail flow.
- Keep minimal event publish as fallback if fetch fails (warn and continue to ack webhook).

4) Message Retrieval Parity
- Enhance `getMessageDetails` to request/select the needed fields:
  - Use `$select=internetMessageHeaders,receivedDateTime,subject,body,bodyPreview,from,toRecipients,ccRecipients,conversationId` and `$expand=attachments`.
  - Map `headers`, `references`, `inReplyTo`, `threadId`, attachments metadata the same way Gmail does.
  - Consider `Prefer: outlook.body-content-type="text"` for consistent `body.text` extraction.

5) Connection Test Parity
- Update `testConnection()` to verify the mailbox:
  - Compare `/me` (use `mail` or `userPrincipalName`) to `config.mailbox`, returning a mismatch error like Gmail.

6) Processed Semantics (Optional but recommended)
- Current: `isRead=true`. Improve by adding a category (e.g., `PSA/Processed`) or moving to a folder, mirroring Gmail’s label approach.

## Acceptance Criteria
- Tokens for Microsoft are loaded from and persisted to `microsoft_email_provider_config` (DB), not tenant secrets.
- Webhook subscription creation/renewal writes:
  - `email_providers.webhook_id` set to Graph subscription ID.
  - `microsoft_email_provider_config.webhook_subscription_id` and `webhook_expires_at` updated.
- Webhook route validates `clientState` against `email_providers.webhook_verification_token` (and optionally against historical `provider_config.clientState`).
- Microsoft webhook route publishes enriched `INBOUND_EMAIL_RECEIVED` events containing `emailData` (subject, body, headers, attachments, participants).
- `testConnection()` reports mailbox mismatch explicitly.
- Gmail inbound flow remains unaffected.

## Implementation Plan (Tasks)
- [x] Adapter: Credentials
  - [x] Refactor credential load/refresh to use DB; add DB update helper mirroring Gmail’s `updateStoredCredentials()`.
- [x] Adapter: Webhooks
  - [x] Create/renew watch writes to `email_providers` and `microsoft_email_provider_config`; use `config.webhook_verification_token` as `clientState`.
- [x] Adapter: Message Retrieval
  - [x] Expand `getMessageDetails()` to include headers, correct body handling, and attachments using `$select`/`$expand` and Prefer text body.
- [x] Adapter: Connection Test
  - [x] Compare `/me` mailbox vs `config.mailbox` and report mismatch, using `mail` or `userPrincipalName`.
- [x] Route: Microsoft Webhook
  - [x] Lookup provider by `webhook_id`, validate `clientState`, fetch details via adapter, publish enriched event.
  - [x] Log + continue on per-message fetch failures (fallback minimal publish).
- [x] Route: Validation
  - [x] Update validation to prioritize `webhook_verification_token`; maintain backward compatibility (warn if absent).

## Data/Schema Considerations
- No new columns required if we reuse `email_providers.webhook_id` and `email_providers.webhook_verification_token`.
- Assumes `microsoft_email_provider_config` has `webhook_subscription_id` and `webhook_expires_at` (EmailProviderService mapping already supports these fields).

## Testing Strategy
- Unit: Adapter methods for credential load/refresh (mock axios), message fetch with `$select/$expand` mapping.
- Integration: Webhook route end-to-end using mocked Graph API responses.
- E2E: Simulate Microsoft webhook payload and verify enriched `INBOUND_EMAIL_RECEIVED` published; verify DB persistence of subscription and tokens.

## Rollout & Migration
- For existing Microsoft providers:
  - Backfill `email_providers.webhook_id` on next renewal or during a one-time maintenance script that reads current subscription and stores it.
  - First refresh post-deploy moves tokens into `microsoft_email_provider_config`.
- Monitor webhook processing logs for clientState mismatches.

## Risks & Mitigations
- Risk: Token source switch (secrets → DB) can desync.
  - Mitigation: Keep a temporary fallback to secrets for reads; write always to DB.
- Risk: Graph throttling.
  - Mitigation: Guard retries and log; backoff on message fetch.
- Risk: Different mailbox principal vs SMTP address.
  - Mitigation: Use both `mail` and `userPrincipalName` for match.

## Timeline (Rough)
- Day 1–2: Adapter refactor (credentials, webhooks persistence, connection test).
- Day 2–3: Message retrieval enhancements; webhook route enrichment.
- Day 4: Tests and verification; rollout plan preparation.

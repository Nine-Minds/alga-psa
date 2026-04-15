# PRD — NinjaOne Proactive Token Refresh

- Slug: `ninjaone-proactive-token-refresh`
- Date: `2026-03-26`
- Status: Draft

## Summary

Add per-integration proactive NinjaOne OAuth token refresh scheduling through Temporal so connected NinjaOne integrations refresh access and refresh tokens before expiry instead of waiting for a user-triggered sync or webhook processing path to hit the expired token.

## Problem

NinjaOne credentials are currently refreshed lazily inside the API client when a request notices the token is near expiry or when a request receives a `401`. This means:

- the first user-visible action after expiry pays the refresh cost;
- refresh-token failures surface during organization/device syncs instead of being handled as background maintenance;
- there is no dedicated lifecycle owner for NinjaOne token refreshes in Temporal;
- failures are hard to distinguish from sync failures until worker logs are inspected.

Recent production evidence showed a Temporal organization sync reaching the worker successfully, then failing while refreshing the NinjaOne token at `https://ca.ninjarmm.com/oauth/token` with `400 Bad Request` and `error: invalid_token`. That proves the current path does attempt refresh, but only on demand and too late for a good operator or user experience.

## Goals

- Refresh NinjaOne OAuth credentials proactively before `expires_at` using Temporal worker-owned execution.
- Schedule refreshes per integration, not via a global polling scanner.
- Persist newly rotated access tokens and refresh tokens after each successful refresh.
- Reschedule the next refresh automatically after each successful refresh.
- Keep current lazy refresh logic as a fallback path if a scheduled run is missed.
- Make refresh failure state explicit enough that operators and future code can distinguish reconnect-required credentials from ordinary sync failures.

## Non-goals

- Replacing the existing lazy refresh logic in the NinjaOne client.
- Building a generic cross-provider token lifecycle framework in this scope.
- Adding a full user-facing token-health dashboard.
- Introducing a broad periodic scanner over all integrations.
- Auto-reconnecting or auto-reauthorizing NinjaOne after a terminal refresh-token failure.

## Users and Primary Flows

1. Connected tenant with active NinjaOne integration
- OAuth callback stores credentials and marks the integration active.
- The system schedules one delayed Temporal refresh workflow for that integration before token expiry.

2. Background refresh lifecycle
- The delayed workflow wakes up before expiry.
- The worker loads current NinjaOne credentials, refreshes them through the NinjaOne OAuth token endpoint, persists the rotated tokens, and computes the next refresh time.
- The worker schedules the next one-off refresh workflow for the same integration.

3. Failure and reconnect flow
- If refresh fails with a retryable infrastructure error, the workflow retries according to Temporal activity/workflow policy.
- If refresh fails with a non-retryable token/provider error such as `invalid_token`, the integration is marked as requiring reconnect and no further future refresh is scheduled until a reconnect or manual recovery path resets the lifecycle.
- User-triggered syncs still use lazy refresh fallback, but should usually find a fresh token already present.

4. Disconnect / reconnect flow
- Disconnecting NinjaOne cancels or invalidates future scheduled refreshes for that integration.
- Reconnecting NinjaOne creates a new valid credential set and seeds a new proactive refresh schedule.

## UX / UI Notes

- No new user-facing page is required in this scope.
- Existing sync flows should fail less often for expired tokens because refresh should already have happened in the background.
- When a refresh token is invalid and the integration needs reconnect, server actions should continue to return a clear reconnect-style error rather than a generic sync failure where practical, but a broader UI redesign is not part of this scope.

## Requirements

### Functional Requirements

- Introduce a dedicated NinjaOne token refresh workflow/activity in Temporal.
- Schedule one delayed refresh workflow per active NinjaOne integration using the credential `expires_at` value and a configurable safety buffer.
- Seed or reschedule that delayed workflow when:
  - OAuth callback stores fresh credentials,
  - a proactive refresh succeeds,
  - a lazy refresh succeeds in the client.
- Ensure only one future proactive refresh is considered active for a given integration at a time.
- Refresh logic must reload the latest stored credential set at execution time rather than trusting stale workflow input.
- On successful refresh, persist:
  - new access token,
  - new refresh token,
  - new expiry timestamp,
  - unchanged instance URL unless the provider response or current stored credentials require otherwise.
- On terminal provider/token failure, record reconnect-required state in integration-owned metadata and stop automatic rescheduling until the integration is reconnected or explicitly reset.
- Disconnecting NinjaOne must cancel, invalidate, or safely no-op any in-flight future refresh workflow for that integration.
- Reconnecting NinjaOne must replace stale lifecycle state and create a fresh future refresh schedule.
- Existing organization/device sync and webhook-triggered client calls must keep the current lazy refresh fallback path.
- Refresh scheduling and execution must emit structured logs with tenant, integration, workflow identity, schedule target time, attempt outcome, and provider error payload details where safe.

### Non-functional Requirements

- Scheduling must be precise enough that refresh normally occurs before expiry with reasonable clock skew tolerance.
- The design must avoid a global high-frequency poller over all NinjaOne integrations.
- The implementation must be idempotent under duplicate workflow starts, repeated reconnects, or retries.
- Workflow ownership and cleanup semantics must survive worker restarts and deploys without orphaning endless refresh loops.

## Data / API / Integrations

- Current NinjaOne credentials live in the tenant secret `ninjaone_credentials` and contain:
  - `access_token`
  - `refresh_token`
  - `expires_at`
  - `instance_url`
- Current `rmm_integrations` rows do not store OAuth expiry directly. This plan should store schedule/lifecycle metadata in provider settings or another integration-owned persistence field that is available without reading secrets for every UI/status read.
- The proactive refresh workflow should use the same NinjaOne OAuth refresh contract already used by the client:
  - `POST {instanceUrl}/oauth/token`
  - `grant_type=refresh_token`
  - `refresh_token`
  - `client_id`
  - `client_secret`
- The workflow should run on the existing app Temporal worker/task queue used for NinjaOne sync workflows unless a more specific queue is already required by runtime conventions.

## Security / Permissions

- Do not duplicate raw tokens into `rmm_integrations` or other broadly-readable tables.
- Any status or lifecycle metadata persisted outside secrets must exclude access tokens and refresh tokens.
- Failure logs should capture provider error codes and safe response body fragments, but must not log secret values or full request bodies containing credentials.

## Observability

- Log schedule creation/reschedule/cancel decisions with tenant and integration IDs.
- Log workflow execution start with tenant, integration, scheduled refresh target, and current token expiry.
- Log successful refresh completion with old/new expiry timestamps and next scheduled refresh time.
- Log terminal failure with provider status, provider error body, and whether the integration was marked reconnect-required.
- Reuse existing integration token lifecycle events where they fit, and add a NinjaOne-specific refresh-scheduled/refreshed signal only if needed for implementation clarity.

## Rollout / Migration

- Implement the workflow and scheduling path without removing lazy refresh.
- Backfill existing active NinjaOne integrations by seeding a future refresh workflow from their currently stored secret expiry.
- Treat integrations missing credentials or missing expiry as unschedulable and surface that as reconnect-required or configuration error rather than silently looping forever.
- Deploy with conservative scheduling buffer and validate on one integration before broad production reliance.

## Open Questions

- Whether schedule/lifecycle metadata should live in `rmm_integrations.settings` or in a dedicated table for token lifecycle state.
- Whether a terminal `invalid_token` refresh error should update `sync_error`, a new reconnect-required field in settings, or both.
- Whether disconnected integrations should actively cancel existing Temporal handles or rely on workflow/activity guards plus idempotent no-op behavior.

## Acceptance Criteria (Definition of Done)

- A newly connected NinjaOne integration automatically gets a future proactive refresh workflow scheduled before token expiry.
- A successful proactive refresh rotates and persists credentials, then schedules the next future refresh without user action.
- Existing active integrations can be seeded into the proactive schedule lifecycle after rollout.
- Lazy refresh remains available and continues to work as a fallback for missed schedules.
- A terminal refresh-token failure is recorded as reconnect-required state and no longer appears as an opaque sync-only failure.
- Disconnect and reconnect flows do not leave duplicate or stale future refresh executions for the integration.

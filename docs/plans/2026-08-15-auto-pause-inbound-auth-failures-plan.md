# Auto-pause inbound email providers on repeated auth failures

## Goal

Stop retrying credentials that cannot recover by themselves, without turning a noisy mailbox into a silently dead mailbox. After a small number of consecutive, explicitly classified auth failures, pause inbound ingestion through the existing lifecycle service, notify active tenant admins, show a persistent reconnect banner, and make a successful reconnect resume ingestion only with a reconciliation of the paused interval.

## Grounded constraints

- `shared/services/email/EmailProviderLifecycleService.ts` already owns the authoritative pause transition, tears down Graph/Gmail notification sources, and exposes resume behavior. Extend it instead of adding another pause gate.
- `shared/services/email/unifiedInboundEmailQueueJobProcessor.ts` is the common point where Microsoft, Google, and IMAP source access either succeeds or throws. Count/reset auth outcomes here; downstream ticket-processing errors are not credential failures.
- The queue processor and maintenance queries already honor `email_providers.inbound_paused_at`. A retry after the pause transition will therefore become `provider_paused` instead of another DLQ attempt.
- Adapter errors retain structured metadata (`status`, `code`, `responseBody`, IMAP auth flags). Classification must use those fields and a narrow allowlist, not a broad message substring such as `401` or `auth`.
- `packages/integrations/src/components/email/EmailProviderCard.tsx` already renders paused state and exposes pause/resume actions. The automatic case needs stronger copy and a reconnect action, not another settings surface.
- `EmailWebhookMaintenanceService.reconcileMissedMessages` already supplies the Microsoft missed-message algorithm and durable dedupe behavior, but it is private and renewal-oriented. Extract a callable resume reconciliation entry point rather than duplicating it.
- `package-lock.json` is already modified by Wire Up. Do not include it in any implementation or plan commit.

## Design decisions

### 1. One strict classifier and one provider-level counter

Add a provider-neutral auth policy module under `shared/services/email/`, for example `InboundEmailAuthFailurePolicy.ts`.

It should return either `unrecoverable_auth` with a safe reason code or `not_unrecoverable` from the provider type plus the structured error:

- Microsoft: token-refresh context with OAuth `invalid_client`, or `invalid_grant` including the known revoked/expired grant cases such as `AADSTS50173`.
- Google: OAuth `invalid_grant`; preserve `error_subtype` such as `invalid_rapt` as a safe reason code.
- IMAP password/OAuth: `authenticationFailed`, `AUTHENTICATIONFAILED`, or the existing explicit invalid-credentials response; OAuth token endpoint `invalid_client`/`invalid_grant` is also unrecoverable.
- Never classify 429, 5xx, timeouts, DNS/socket failures, webhook validation failures, Graph 403/404, or downstream ticket-processing exceptions as unrecoverable auth.

Use a fixed threshold of three consecutive unrecoverable source-access failures. Keep the threshold exported and testable; do not make it an environment variable in this first version.

Add nullable/defaulted columns to `email_providers` in a new `server/migrations/*.cjs` migration:

- `inbound_auth_failure_count integer not null default 0`
- `inbound_auth_failure_last_at timestamptz null`
- `inbound_auth_failure_code text null`

This is an additive alter on a tenant-distributed table, with no uniqueness or constraint build. It must remain valid on plain Postgres and Citus; no Citus-only call or parent-heap cleanup is needed.

### 2. Make the pause transition atomic and idempotent

Extend `EmailProviderLifecycleService` with two outcome methods:

- `recordSourceAccessSuccess(providerId, tenant)` resets the three auth-failure fields, even when the fetched pointer contains no new messages.
- `recordUnrecoverableAuthFailure(providerId, tenant, safeCode)` locks the provider row in a tenant-scoped transaction, increments the counter, and on the threshold atomically sets `inbound_paused_at`, `inbound_pause_reason = 'auth_failure'`, status/error metadata, and returns a one-time `autoPaused` result.

Only the transaction that changes an unpaused row to paused may run subscription teardown and send notifications. Concurrent failing jobs must observe the already-paused row and must not tear down twice or notify twice. Keep manual `pauseProvider` behavior unchanged.

Widen `InboundPauseReason` and every public/interface copy from `'manual' | 'tenant_cancelled'` to include `'auth_failure'` in:

- `shared/services/email/EmailProviderLifecycleService.ts`
- `shared/interfaces/inbound-email.interfaces.ts`
- `server/src/interfaces/email.interfaces.ts`
- `packages/types/src/interfaces/email.interfaces.ts`
- `packages/integrations/src/components/email/types.ts`
- any mapped service/interface duplicate found by TypeScript.

### 3. Record outcomes only around source access

In `processUnifiedInboundEmailQueueJob`:

1. Keep the existing paused/inactive gate first.
2. Wrap `fetchEmailPayloadsForJob(job)` with the classifier.
3. On classified unrecoverable auth, record the failure and rethrow the original error. The current queue retry policy remains authoritative; if the threshold was crossed, the next attempt is stopped by the pause gate.
4. On every successful return from `fetchEmailPayloadsForJob`—including an empty result—reset the consecutive counter before downstream ticket processing.
5. Do not change the counter for source-message-not-found, transient provider errors, parsing errors, or application/ticket failures.

Also route Microsoft polling/renewal auth failures in `EmailWebhookMaintenanceService` through the same classifier/outcome service. Successful token health checks reset the counter. This covers providers whose subscription has gone quiet and therefore no longer receives pointer jobs.

### 4. Persist one admin notification per automatic pause

Add a small notification helper in the email integration/service layer. Reuse the established pattern from `packages/billing/src/services/accountingSync/syncNotificationService.ts`:

- enumerate active internal users whose role name is `admin` (and `owner` if that role is present in the tenant model);
- create one `system-announcement` internal notification per recipient with `createNotificationFromTemplateInternal`;
- include the mailbox/provider name, a safe auth reason, the instruction that reconnection is required, and link to `/msp/settings?tab=email`;
- never include tokens, client secrets, raw OAuth responses, or tenant/provider credentials in notification data.

Notification delivery happens only after the atomic pause commit. Treat per-recipient delivery failure as observable/best-effort and log tenant/provider/user identifiers plus the safe code; never roll back the pause or expose secrets. The persistent settings banner is the durable fallback.

### 5. Make the automatic-pause banner actionable

Update `EmailProviderCard` and its English locale strings:

- Manual/tenant-cancelled pauses keep the current neutral help text and Resume menu action.
- `auth_failure` renders a destructive, persistent alert that says inbound mail is paused, names the mailbox, explains that credentials no longer work, and tells the user mail remains in the source mailbox.
- Put a visible `Reconnect` button inside the alert. Dispatch to the existing provider-specific reconnect/edit flow: Microsoft/Google setup flow, IMAP OAuth reconnect when applicable, otherwise edit credentials.
- Do not offer a bare Resume action for `auth_failure`; resuming dead credentials would recreate the alert loop.
- Preserve stable element ids for behavioral UI tests and accessibility.

Thread the reconnect callback through `EmailProviderList` / `EmailProviderConfiguration` rather than placing provider-specific OAuth logic in the card.

### 6. Reconnect, then resume, then reconcile

Refactor resume into an explicit recovery path for `auth_failure` while keeping manual resume compatible:

1. Preserve the original `inbound_paused_at` and old vendor cursor before any subscription/watch registration overwrites it.
2. Validate the new credentials while the ingestion pause is still active.
3. Re-establish the provider notification source.
4. Reconcile from the saved pause boundary with the existing durable dedupe path.
5. Only report success after the reconciliation handoff is durable; then clear the pause and auth-failure fields. If credential validation or reconciliation setup fails, leave/reinstate the pause and return a reconnect-required error.

Provider-specific reuse:

- Microsoft: expose a public, bounded `reconcileProviderMessages` wrapper around the existing `EmailWebhookMaintenanceService` algorithm, accepting an explicit `since` boundary. Preserve its safety margin, cursor lock, overflow handling, and durable ingress behavior.
- Google: retain the pre-watch `history_id`, list changes from that cursor before replacing it with the new watch cursor, and enqueue the resulting message ids through the unified durable path. If Gmail rejects the old cursor, fall back to a mailbox query bounded by `inbound_paused_at` rather than silently accepting a gap.
- IMAP: reuse the existing resync contract by clearing UID/folder cursors only after credentials validate, so the poller scans the mailbox again and normal dedupe suppresses already-processed mail.

Update every successful reconnect path (Microsoft/Google setup automation, IMAP OAuth/credential update, and successful connection test) to invoke this recovery path when `inbound_pause_reason === 'auth_failure'`. Do not double-register a webhook by running both ordinary setup automation and resume registration.

The return value should distinguish `resumed`, `webhookRegistered`, and `reconciliationStarted`/`reconciliationCompleted` so the settings UI cannot toast success when the mailbox is still paused.

## Implementation sequence

1. Add the additive migration and widen pause-reason types.
2. Implement and unit-test strict error classification.
3. Add transactional counter/reset/auto-pause methods to `EmailProviderLifecycleService`, including one-shot teardown and admin notification.
4. Integrate the source-fetch and Microsoft-maintenance outcome hooks.
5. Extract provider-specific resume reconciliation and wire successful reconnect paths to it.
6. Add the automatic-pause banner/reconnect behavior and locale copy.
7. Run focused tests, typecheck/build, then perform the local behavioral smoke.

## Behavioral tests

- Classifier table tests cover each allowed terminal auth shape and prove that 429, 5xx, timeout, Graph permission/not-found, webhook validation, parsing, and downstream processing errors do not count.
- Lifecycle integration test: two classified failures keep the provider active; the third atomically pauses it, stores `auth_failure`, tears down once, and creates exactly one notification per active admin even with concurrent failures.
- Processor integration test: a successful source fetch resets a prior count even when it returns no messages; a later downstream ticket failure does not increment the auth counter.
- Maintenance test: repeated Microsoft token-health `invalid_client` failures use the same counter; a successful token-health check resets it.
- Resume tests for Microsoft, Google, and IMAP prove the pause remains on failed credential validation, the saved pause cursor is used, successful reconciliation clears the pause, and repeated reconciliation is deduped.
- UI tests render an `auth_failure` provider, assert the destructive reconnect banner and provider-specific callback, and assert that a bare Resume action is unavailable. Manual pause behavior remains unchanged.
- Migration coverage should apply the migration to a test database and inspect runtime column/default behavior. Do not add source-string/import-presence tests.

## Smoke test

In the running worktree stack, use a disposable provider and tenant admin:

1. Make the provider return a known terminal auth failure and enqueue distinct inbound pointers until the threshold is crossed.
2. Verify `inbound_paused_at`, reason, count/code, subscription/watch teardown, queue-gate skip, one notification, and the reconnect banner.
3. Confirm a simulated 429/timeout never increments or pauses.
4. Repair credentials and reconnect through the settings UI.
5. Deliver mail during the paused interval, then verify resume clears the banner, recreates delivery, and the reconciliation sweep imports that mail exactly once.
6. Repeat for one OAuth provider and IMAP; record screenshots and database/queue evidence without secrets.

## Non-goals

- Manually pausing the production EQUIT provider.
- Draining the existing DLQ backlog.
- Changing Grafana alert labels or alert routing.
- Building a second ingestion gate or a new notification framework.

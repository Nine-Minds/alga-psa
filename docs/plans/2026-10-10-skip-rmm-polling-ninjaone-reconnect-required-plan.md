# Skip RMM polling for integrations in `reconnect_required` (alga0002047)

## Problem

When a NinjaOne integration's `settings.tokenLifecycle.status` is `reconnect_required`, two recurring jobs keep running for it:

- `rmm-alert-reconciliation`
- `rmm-device-sync`

Each run ends up in `NinjaOneClient.refreshAccessToken()`. That method short-circuits on purpose and throws `NinjaOneReconnectRequiredError` (`ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`, around line 355). No caller handles it:

1. The alert fetcher (`ee/.../ninjaone/alerts/reconciliationFetcher.ts`) calls the client directly.
2. `runRmmAlertReconciliation` (`shared/rmm/alerts/reconciliation.ts`) wraps per-alert processing in try/catch, but not the fetch.
3. `rmmAlertReconciliationHandler` and `rmmDeviceSyncHandler` (`packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts`) only gate on `is_active` and the enabled flag.
4. The maintenance subscriber re-throws the error, and the EventBus doesn't ack the message. It is redelivered every 30s until `maxDeliveries` (10) and then dead-lettered.

In production that adds up to about 800 EventBus errors per hour. The dead-letter stream fills with them, which hides real dead letters.

The reconciler (`reconcileRmmPollingSchedules`) has the same blind spot. It also ignores the token lifecycle, so it keeps the schedules for these integrations alive indefinitely.

## What the current code already gives us

- `reconcileRmmPollingSchedules` runs every 5 minutes from `initializeApp`. It also runs right after a successful NinjaOne OAuth callback (`ee/server/src/app/api/integrations/ninjaone/callback/route.ts`, about line 394), and that call comes after `clearNinjaOneReconnectRequiredState` (about line 359).
- `clearNinjaOneReconnectRequiredState` sets `tokenLifecycle.status = 'healthy'`. `markReconnectRequired` sets `status = 'reconnect_required'` (and also `reconnectRequired: true`).
- The client's own check (`isReconnectRequired`) uses `status === 'reconnect_required'` only.
- The scheduled device sync for NinjaOne goes through `ninjaOneDeviceSyncStrategy` → `getNinjaOneSyncStrategy().syncDevicesIncremental`. On the Temporal strategy this is a workflow whose result is an `RmmSyncResult`. The adapter turns `success: false` into a generic `Error`, so the `NinjaOneReconnectRequiredError` **type is lost** before the device-sync handler sees it. The alert path, by contrast, propagates the original error object.

## Design

### 1. Treat `reconnect_required` as part of the shared polling state

In `rmmAlertPollingHandlers.ts`:

- Add `reconnectRequired: boolean` to `IntegrationPollState`.
- Add one small helper, `parseIntegrationSettings(row.settings)`. It replaces the `typeof === 'string' ? safeParse : ?? {}` line that is currently repeated in all three parsers.
- Add one exported predicate:
  `isIntegrationReconnectRequired(settings) => settings.tokenLifecycle?.status === 'reconnect_required'`.
  - It deliberately uses the same condition as `NinjaOneClient.isReconnectRequired`. The gate then fires exactly when the client would throw, and it can never skip a run the client would have allowed.
  - It is provider-agnostic. Any RMM provider that adopts the same `tokenLifecycle` shape is honoured without further changes. Providers that don't use it (Tactical, Level.io, Tanium, Huntress) always get `false`.
- `parseRmmPollState`, `parseRmmDeviceSyncState` and `parseHuntressPollState` all populate `reconnectRequired` through the predicate. Also export `parseRmmPollState` so it can be tested the same way as `parseRmmDeviceSyncState`.

### 2. Handler gate (the primary fix)

In both `rmmAlertReconciliationHandler` and `rmmDeviceSyncHandler`, after the existing active/enabled check and **before** a fetcher, strategy or client is touched:

```ts
if (state.reconnectRequired) {
  logger.info('[RmmAlertReconciliationJob] Skipping: integration requires reconnect', data); // tenantId, integrationId, provider
  return;
}
```

- Each run produces one info line and then returns normally. The job succeeds, the EventBus acks the message, and nothing is redelivered or dead-lettered.
- For device sync, the skip does **not** touch `sync_status`, `sync_error` or the cursor. The integration's last real outcome stays visible, and the window is re-read after reconnect.
- The message differs from the existing "inactive or polling disabled" skip, so Loki can tell the two cases apart.

### 3. Reconciler eligibility (stop scheduling at all)

In `reconcileAlertScheduleForIntegration` and `reconcileDeviceSyncForIntegration`, add `&& !state.reconnectRequired` to `eligible`.

This makes the desired state honest: an integration that can't authenticate has no polling schedule. The convergence loop handles both directions with no new code:

- **Entering `reconnect_required`:** the next 5-minute reconciler tick cancels the schedules. Runs that land in that window are caught by the handler gate (§2).
- **Reconnecting:** the OAuth callback calls `clearNinjaOneReconnectRequiredState` and then `reconcileRmmPollingSchedules`, so the schedules are recreated straight away. If that best-effort call fails, the 5-minute tick recreates them. The user doesn't need to do anything extra, as the card requires.

Without §3 we would still run roughly 4 no-op jobs per hour per broken integration, indefinitely. With it, the steady state is zero runs.

Huntress uses `parseHuntressPollState`, which always returns `reconnectRequired: false`, so its behaviour doesn't change.

### 4. Backstop for the race between the gate and the flag

There is a window where the handler reads `healthy` and the lifecycle flips to `reconnect_required` mid-run. The client then throws. The design handles this without importing EE types into `packages/jobs`:

- Add `isReconnectRequiredFailure(error, recheck)`. It returns true when either:
  - (a) `error.name === 'NinjaOneReconnectRequiredError'`. This is the fast path for the alert route, where the error object comes through unchanged.
  - (b) A re-read of the integration row shows `isIntegrationReconnectRequired(settings)`. This is the provider-agnostic, type-agnostic check, and it is the one that works for device sync, where the type is lost through the Temporal sync workflow and the adapter's `new Error(...)`.

  The client only throws when the DB says `reconnect_required`, so (b) is the authoritative check and (a) only saves a DB read.
- **Alert handler:** wrap the `runRmmAlertReconciliation` call. If the failure matches, log the same info "Skipping: integration requires reconnect" line (with `detectedDuring: 'run'`) and return. Any other error is re-thrown unchanged.
- **Device-sync handler:** the existing catch still writes `sync_status: 'failed'` and `sync_error`, and still leaves the cursor alone; that record is truthful. After that, if the failure matches, log at info and return instead of `throw error`. Any other error is re-thrown unchanged.

Constraints that stay in place, as the card requires:

- `NinjaOneClient.refreshAccessToken()` still throws.
- The proactive-refresh short-circuit is unchanged.
- `clearNinjaOneReconnectRequiredState` is unchanged. Clearing the flag is enough for the next run (gate) and the next reconcile (eligibility) to work again.

## Files to change

| File | Change |
|---|---|
| `packages/jobs/src/lib/handlers/rmmAlertPollingHandlers.ts` | `parseIntegrationSettings`, `isIntegrationReconnectRequired`, `reconnectRequired` on `IntegrationPollState` (all three parsers), export `parseRmmPollState`, gate in both handlers, `!reconnectRequired` in both reconciler eligibility expressions, `isReconnectRequiredFailure` backstop in both handlers |
| `packages/jobs/src/lib/handlers/rmmAlertReconciliationHandler.test.ts` (new) | handler tests for the alert path (below) |
| `packages/jobs/src/lib/handlers/rmmDeviceSyncHandler.test.ts` | add reconnect cases |
| `packages/jobs/src/lib/handlers/rmmDeviceSyncState.test.ts` | add `reconnectRequired` parsing cases (and for `parseRmmPollState`) |

No changes to `ee/`, `shared/`, the event bus, or the NinjaOne client.

## Tests

The new alert-handler test reuses the mocking pattern from `rmmDeviceSyncHandler.test.ts` (`tenantDb` stub branching on table name, mocked `@alga-psa/shared/rmm/alerts`).

**Parsing**

1. `status: 'reconnect_required'` sets `reconnectRequired: true`.
2. `status: 'healthy'`, no `tokenLifecycle`, and string-encoded settings all give `false`.

**Alert handler**

3. With reconnect required, `runRmmAlertReconciliation` is not called, the handler resolves, and the info skip is logged.
4. With a healthy or missing lifecycle, `runRmmAlertReconciliation` is called.
5. When `runRmmAlertReconciliation` rejects with an error named `NinjaOneReconnectRequiredError`, the handler resolves.
6. When it rejects with a generic error and the re-read row is now `reconnect_required`, the handler resolves.
7. When it rejects with a generic error and the row is still healthy, the handler rejects with the same error. This proves we don't swallow real failures.

**Device-sync handler**

8. With reconnect required, the strategy is not called, there is no `update`, and the handler resolves.
9. With a healthy or missing lifecycle, the strategy runs and the cursor advances (the existing test still holds).
10. When the strategy rejects and the re-read shows `reconnect_required`, the handler resolves, the failure is recorded, and the cursor is not advanced.
11. When the strategy rejects and the row is healthy, the handler still rejects (existing behaviour).

**Reconciler**, in `rmmScheduleConvergence.test.ts` / `rmmDeviceSyncEligibility.test.ts`, or at the eligibility-expression level:

12. A `reconnect_required` integration with an existing schedule leads to a cancel. The same integration once `healthy` gets a new schedule.

Run with `npx vitest run packages/jobs/src/lib/handlers` (the package's vitest config).

## Verification after deploy

- In Loki, `[EventBus] Error in event handler` for `rmm-alert-reconciliation` and `rmm-device-sync` should drop to about zero.
- `Skipping: integration requires reconnect` should appear only until the next reconciler tick for each affected integration (the schedules are then cancelled).
- Reconnecting one affected tenant should bring its `rmm-alert-reconciliation` schedule back within the callback, and the next run should log `cycle complete`.

## Out of scope

- Event-bus redelivery and dead-letter policy for handlers that throw.
- Reconnecting the affected tenants.
- Surfacing `INTEGRATION_TOKEN_EXPIRING` to tenants.

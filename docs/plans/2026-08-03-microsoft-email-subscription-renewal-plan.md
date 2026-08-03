# Microsoft Graph inbound subscription renewal plan

## Problem

Microsoft Graph caps Outlook message-subscription lifetimes at 4,230 minutes. Creation currently requests a safe 60-hour lifetime, while renewal requests 72 hours, so every renewal PATCH can be rejected. The maintenance sweep only recreates on 404, leaving an invalid-parameter renewal failure unhealthy until the customer re-authenticates.

## Design decisions

1. Define one named message-subscription lifetime constant in `shared/services/email/providers/MicrosoftGraphAdapter.ts` and use it for both creation and renewal. Keep the value at 60 hours, below the Graph cap, so the two paths cannot drift.
2. Keep Graph-specific error interpretation narrow. Add a maintenance-service predicate for a renewal response that Graph rejected as an invalid parameter: HTTP 400 with Graph code `ErrorInvalidParameter`. Treat that alongside 404 ResourceNotFound as a signal to recreate the subscription through the existing `recreateSubscription` path.
3. Do not recreate on arbitrary 400s or unrelated failures. They must retain the existing error/health behavior so configuration and authentication faults are not hidden.
4. Preserve the existing polling fallback and webhook URL validation. The repair path must reuse `initializeWebhook`, health updates, and persistence already owned by `recreateSubscription`.
5. Do not add production-data access or change the reported customer's provider row in this change.

## Implementation sequence

1. In `MicrosoftGraphAdapter.ts`, introduce an exported or module-local constant such as `MICROSOFT_MESSAGE_SUBSCRIPTION_EXPIRATION_MS` equal to 60 hours.
2. Replace the separate creation and renewal duration expressions with that constant.
3. In `EmailWebhookMaintenanceService.ts`, add a focused helper that recognizes the Graph invalid-expiration response from its status/code shape, without matching every HTTP 400.
4. In the renewal catch block, recreate when either the existing 404 predicate or the new invalid-parameter predicate matches; log which recoverable condition triggered the replacement.
5. Keep all other exceptions flowing to the existing outer failure handling.

## Behavioral tests

1. Extend `server/src/test/unit/email/MicrosoftGraphAdapter.subscription.test.ts` to capture both POST and PATCH payloads and assert their requested expirations are no more than 4,230 minutes ahead and use the same safe lifetime.
2. Extend `server/src/test/unit/email/EmailWebhookMaintenanceService.test.ts` with a renewal rejection shaped as HTTP 400 plus `ErrorInvalidParameter`; assert `initializeWebhook` is called and the result is `{ success: true, action: 'recreated' }`.
3. Add a negative case for an unrelated HTTP 400/code and assert it is not recreated and follows the existing failed-health path.
4. Run the two focused Vitest files, then the repository's relevant typecheck/build command used by the draft lane.

## Risks and boundaries

- Graph error objects may expose the code at more than one nested location; match the shapes already produced by `MicrosoftGraphAdapter.handleError` and covered by tests.
- Expiration assertions need a small clock tolerance or a fixed fake clock to avoid timing flakes.
- Recreating on every 400 would mask real configuration defects, so the predicate must remain code-specific.
- No migration, UI, OAuth-consent, calendar-subscription, or polling-cadence changes are in scope.

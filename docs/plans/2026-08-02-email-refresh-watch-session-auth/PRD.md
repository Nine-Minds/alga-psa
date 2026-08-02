# PRD — Email Refresh Watch Session Authentication

- Slug: `email-refresh-watch-session-auth`
- Date: `2026-08-02`
- Status: Implemented; authenticated UI smoke pending

## Summary

Allow the Google email provider's **Refresh Pub/Sub & Watch** browser action to reach its session-authenticated route without requiring an API key.

## Problem

The email provider configuration UI sends a cookie-authenticated `POST` request to `/api/email/refresh-watch`. The route authenticates the current user in the handler, but edge middleware applies the API-key gate first. Because the route is absent from the middleware skip list, browser requests without `x-api-key` are rejected with `401 Unauthorized: API key missing` before the route handler can evaluate the session.

## Goals

- Permit `/api/email/refresh-watch` to use its existing in-route session authentication.
- Preserve the route handler's existing authorization and tenant-scoped provider lookup.
- Add focused regression coverage for the middleware allowlist entry.
- Audit direct browser calls under `/api/email/*` for the same middleware mismatch.

## Non-goals

- Change the refresh route's business logic, response contract, or Google integration behavior.
- Add API-key authentication to the browser request.
- Change authentication behavior for unrelated email API routes.
- Address inbound email service availability or webhook delivery issues.

## Users and Primary Flows

An authenticated MSP user opens a configured Google email provider and selects **Refresh Pub/Sub & Watch**. The browser posts the provider identifier with the user's session cookie. Middleware allows the request through, and the route handler authenticates the session before refreshing the provider.

Unauthenticated requests must still be rejected by the route handler.

## UX / UI Notes

No UI changes are required. The existing action and error display remain in place. Successful behavior is that the action no longer reports the middleware-specific `API key missing` error.

## Requirements

### Functional Requirements

1. `POST /api/email/refresh-watch` without an `x-api-key` header must pass the middleware API-key presence gate.
2. The route handler must remain responsible for session authentication through `getCurrentUser`.
3. An unauthenticated request may return `401 Unauthorized` from the route handler, but must not return `401 Unauthorized: API key missing` from middleware.
4. Existing browser calls to `/api/email/oauth/imap/initiate` must remain covered by the `/api/email/oauth/` prefix.

### Non-functional Requirements

- Keep the change limited to the middleware allowlist and focused unit coverage.
- Preserve existing middleware and route code style.
- Pass the focused middleware test, server typecheck, and production build.

## Data / API / Integrations

No data model or API payload changes are required. The existing route accepts `{ "providerId": string }` and performs tenant-scoped Google provider lookup before invoking the existing Gmail configuration workflow.

## Security / Permissions

The allowlist bypasses only middleware's API-key-header presence check. It does not make the route public: `getCurrentUser` continues to reject requests without a valid session, and tenant scoping remains in the handler.

## Observability

No new telemetry is required. Existing middleware development logging and route logging remain unchanged.

## Rollout / Migration

No migration or feature flag is required. The middleware change takes effect with the normal application deployment.

## Open Questions

- Complete an authenticated UI smoke against a configured Google provider to confirm the full Pub/Sub and Gmail watch refresh path in an environment with valid Google credentials.

## Acceptance Criteria (Definition of Done)

- `/api/email/refresh-watch` is included in `apiKeySkipPaths`.
- Unit coverage verifies `shouldSkipApiKeyAuth('/api/email/refresh-watch')` is `true`.
- Direct browser `/api/email/*` calls are audited and no other uncovered session-authenticated routes are found.
- A no-API-key request reaches the route handler and returns the handler's `Unauthorized` response when no session is present.
- The focused unit test, server typecheck, and production build pass.
- An authenticated Google provider UI smoke no longer displays `API key missing`.

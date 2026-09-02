# NinjaOne Organization Device Pagination

## Problem

The organization devices endpoint can return a full page without a `Link` header. `NinjaOneClient.getDevicesByOrganization` currently treats the missing header as completion, so an organization with more than the requested page size is silently truncated while the overall sync reports success.

## Goal

Fetch every device exposed by `/organization/{orgId}/devices`, using NinjaOne's documented `after` contract even when the response omits a continuation header, and fail safely when the server cannot provide a usable forward cursor.

## Non-goals

- No changes to device mapping, reconciliation, retention, or account matching.
- No redesign of the generic `/devices` pagination path unless a shared helper is a small, behavior-preserving extraction.
- No customer communication or production sync from this implementation step.

## Design

1. Keep the existing `Link`-header cursor as the preferred continuation when present and usable.
2. For a full page with no usable header cursor, derive `after` from the final device's `id`, matching NinjaOne's endpoint contract.
3. Treat a short or empty page as normal completion.
4. Track cursors already requested. Before another request, reject a missing/empty final id, a cursor equal to the cursor just used, or any cursor already seen. The method must throw a descriptive integration error rather than return a list known to be incomplete.
5. Log page/cursor decisions without credentials or raw provider bodies. Completion logging remains truthful only after normal short-page termination.

## Primary code

- `ee/server/src/lib/integrations/ninjaone/ninjaOneClient.ts`
- Existing NinjaOne client test area, extended with mocked Axios runtime responses rather than source-string assertions.

## Acceptance criteria

- Two full 100-device pages without `Link` headers are followed by a final short page and returned as one complete list.
- The second request uses the last device id from the first page as `after`; subsequent requests advance likewise.
- A usable `Link` continuation remains supported.
- Empty, missing, duplicate, or non-advancing fallback ids fail before an infinite request loop or a silently truncated success.
- Focused behavioral tests pass and existing organization sync behavior remains compatible.

## Rollout and verification

This is a client-only compatibility fix with no data migration. Run focused unit/integration tests with mocked HTTP responses, then validate through the normal local or emulated NinjaOne sync path. Post-deploy verification of the Shift Left/Camco sync and any customer update remain captain-approved outward actions.

## Risks

- Device ids may be numeric; normalize only for cursor comparison/query serialization, without changing returned device objects.
- A malformed provider page may repeat data with a different header cursor; seen-cursor protection must still bound looping.
- Do not infer completion from a full page solely because headers are absent.

# MSP Email Notification Preferences

## Problem

The MSP profile Email notification switches currently mutate React state only. Saved per-user preferences are not loaded, so selections disappear after refresh and the displayed state can disagree with email delivery. Existing email preference actions also accept tenant and user identifiers from the caller without binding them to the authenticated session.

## User value

MSP users can reliably control their own email notifications, see the effective saved state after reload, and receive clear feedback when persistence fails. Personal preferences remain subordinate to tenant-wide notification controls.

## Goals

- Hydrate the MSP profile from saved per-user email preferences.
- Persist subtype changes through authenticated, self-only, tenant-scoped actions.
- Persist a category change for all eligible subtypes atomically in one transaction.
- Define category state as checked when all eligible subtypes are enabled, unchecked when none are enabled, and mixed otherwise.
- Prevent personal preferences from enabling a tenant-disabled category or subtype.
- Make rapid and overlapping changes deterministic, with visible pending and failure behavior.
- Preserve Internal notification preferences and client-portal Email behavior.

## Non-goals

- Changing tenant-wide notification administration.
- Changing email templates, routing, or delivery semantics beyond consuming the same effective preference rules.
- Diagnosing or resizing database connection pools.
- Broadly rewriting the client-portal preference UI unless a narrowly shared server primitive reduces divergence.

## Primary flow

1. An authenticated MSP user opens Profile → Notifications → Email.
2. The page loads tenant-effective categories/subtypes and the user's saved overrides.
3. Missing user rows inherit true, matching delivery; tenant-wide, category, and subtype enablement still gate delivery. `is_default_enabled` does not suppress delivery in the current email service. Tenant-disabled items cannot be overridden.
4. A subtype toggle saves the user's own override and shows a pending state until accepted.
5. A category toggle atomically writes all eligible subtype overrides.
6. On success, the accepted state remains after refresh and a fresh session. On failure, the UI restores or reloads authoritative state and shows a useful error.

## UX notes

- Tenant-disabled controls are visibly disabled; personal settings never imply they can override administrators.
- Category switches expose mixed state when eligible children differ.
- Disable or serialize conflicting controls while their mutation is pending. The latest accepted user intent wins deterministically.
- A save error is visible and leaves the UI matching persisted state.

## Data and API design

- Keep `user_notification_preferences` and its `(tenant, user_id, subtype_id)` upsert key.
- Replace caller-trusting profile actions with authenticated self-service actions patterned after internal-notification preference actions: derive tenant and user from the session, ignore/reject caller identity, and validate subtype/category membership in the session tenant.
- Provide a read model containing categories, eligible subtypes, tenant-effective enablement, saved overrides, and resolved effective values.
- Add a bulk category mutation that validates the complete eligible subtype set and upserts it inside one `withTransaction` callback, using the transaction object for every query.
- Individual writes use the same validation and resolution service.
- Revalidate the MSP profile route after successful writes.

## Risks and mitigations

- Partial category saves: prevent with one transaction and rollback coverage.
- Stale/out-of-order responses: serialize mutations per category or use request generations and authoritative reload.
- Tenant/user spoofing: derive both from authenticated context and test cross-identity inputs.
- Default mismatch with delivery: centralize effective-state resolution around tenant category/subtype enablement plus the user override rule already enforced during send.
- Connection pressure: category changes use one request and one transaction instead of per-subtype `Promise.all` calls.

## Rollout

No schema migration is expected. Existing rows remain valid; users without rows inherit defaults. Validate in the running MSP UI and with DB-backed action tests before normal reviewed delivery.

## Acceptance criteria

- Individual and category choices survive refresh, re-entry, and a fresh session.
- Category changes are atomic and mixed state is rendered correctly.
- Missing preferences use intended defaults; tenant-disabled settings cannot be personally enabled.
- Authenticated actions can only read/write the current user's preferences in the current tenant and reject invalid subtypes.
- Simulated transaction/connection failure leaves no partial category changes, shows an error, and permits a later retry.
- Rapid category/subtype changes resolve deterministically to the latest accepted intent.
- Focused MSP UI smoke passes, Internal and client-portal preference regressions pass, and representative delivery enforcement observes the saved preference.
- Public artifacts use only generic or synthetic examples.

## Open questions

- Resolved in the draft: both profiles compose the shared Email preference panel and authenticated actions. Internal preferences remain unchanged.
- Pending behavior: all Email controls are disabled until the accepted save and any reconciliation finish. Pending clicks are ignored; the latest accepted operation wins. A serial queue survives panel re-entry, and component generations discard stale responses.

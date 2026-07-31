# PRD - SCIM User Lifecycle Provisioning

- Slug: `scim-user-lifecycle`
- Date: `2026-07-23`
- Status: Design approved
- Edition: EE
- Minimum tier: Pro

## Summary

Provide a tenant-scoped SCIM 2.0 service provider that lets Microsoft Entra automatically deactivate and reactivate existing internal Alga users. The feature closes the lifecycle gap left by SSO alone: disabled Entra users cannot start new SSO sessions, but Alga currently does not immediately revoke existing sessions or mark the user inactive.

## Problem

SSO authenticates users but does not manage their application lifecycle. Disabling or unassigning a user in Entra blocks future Microsoft authentication, yet the corresponding Alga user can remain active in administration and may retain an existing Alga session until revocation checks catch up.

Customers need directory-driven offboarding without deleting Alga users or historical PSA data. Identity matching must be conservative because email aliases and domain changes can otherwise link the wrong person.

## Goals

- Accept standards-based inbound SCIM 2.0 user provisioning requests.
- Support Microsoft Entra as the tested provisioning client.
- Link only existing internal MSP users.
- Use exact primary-email equality for automatic initial linking.
- Use stable external identity after linking.
- Apply reversible directory-driven deactivation and reactivation.
- Revoke all existing Alga sessions immediately on deactivation.
- Preserve Alga-controlled identity, authorization, licensing, and history.
- Provide tenant self-service setup, health, token lifecycle, drift, and reconciliation.
- Provide deterministic integration coverage through a first-party SCIM emulator.

## Non-goals

- Creating Alga users.
- Managing client-portal users, contacts, service accounts, or MCP agents.
- Updating Alga email, name, title, username, or notification fields.
- Assigning licenses, roles, teams, or permissions.
- Supporting SCIM Groups, Bulk, passwords, or sorting.
- Polling Microsoft Graph or CIPP for lifecycle state.
- Hard-deleting users or historical data.
- Certifying SCIM clients other than Entra.
- Automatically migrating current SSO associations into SCIM links.

## Users and Primary Flows

### Security administrator setup

An internal user with security-administration permission opens Settings > Security > User provisioning, enables SCIM, copies the tenant URL and one-time token, configures an Entra enterprise application, tests the connection, assigns users, and starts provisioning.

### Initial exact-email link

Entra searches for a user and then sends POST when no linked SCIM resource exists. Alga finds exactly one eligible existing internal user by normalized primary email, creates a stable SCIM link, and returns the SCIM resource without creating an Alga user.

### Unresolved identity

Alga rejects a missing, duplicate, unsupported, or conflicting match and records an unresolved identity. An administrator reviews the directory and Alga identities and may explicitly link an eligible user after confirmation.

### Deactivation

Entra sends `active=false` or DELETE. Alga marks the user inactive with SCIM provenance, revokes all sessions, preserves history, and rejects the next request made with any prior session.

### Reactivation

Entra sends `active=true` or reprovisions a tombstoned identity. Alga reactivates the existing user only when SCIM caused the current inactivity.

### Token rotation

An administrator generates a replacement token, updates Entra during a bounded overlap window, confirms traffic on the replacement, and revokes the old token.

## UX / UI Notes

- Add Settings > Security > User provisioning adjacent to SSO.
- Show an upgrade state below Pro and a functioning setup surface on Pro or higher.
- Display the token once and state clearly that it cannot be recovered.
- Provide Entra-specific mappings and limitations.
- Show connection enabled state, last authenticated request, last success, last sanitized error, and token age.
- Show linked users, observed attributes, upstream state, effective state, lifecycle source, drift, and last operation.
- Show unresolved identities in a dedicated review queue.
- Warn before mismatched-email manual linking.
- Mark linked users Managed by SCIM in User Management.
- Block manual activation while upstream state is inactive.
- Warn that disabling or unlinking never changes effective user state automatically.

## Requirements

### Functional Requirements

- EE-only implementation with Pro-or-higher entitlement enforcement.
- One SCIM connection per Alga tenant in the first release.
- Tenant-specific opaque base URL and bearer authentication.
- Secure hashed token storage, one-time display, rotation overlap, and revocation.
- SCIM discovery endpoints and Users resource operations required by Entra.
- Exact case-insensitive normalized primary-email auto-linking.
- Existing active unlinked internal Alga user eligibility requirement.
- No implicit Alga user creation.
- Stable resource and upstream external identity correlation after linking.
- Observed directory metadata storage without Alga profile mutation.
- Source-aware active, inactive, deprovisioned, and unlinked states.
- Immediate all-session revocation for `active=false` and DELETE.
- Reactivation only when SCIM applied current inactivity.
- State-preserving connection disablement and entitlement loss.
- Explicit unlinking without automatic activation.
- Idempotent retries and concurrency-safe lifecycle operations.
- Sanitized operation history and unresolved-identity records.
- First-party SCIM client emulator and live-Entra acceptance smoke test.

### Non-functional Requirements

- Strict tenant isolation before any user lookup or mutation.
- No credential or raw authorization-header logging.
- Timing-safe token verification.
- Rate limiting per connection and source.
- Standard SCIM response media types and error documents.
- No cross-tenant existence leakage.
- Fail-closed session enforcement on the next authenticated request.
- Database constraints for identity and active-link uniqueness.
- Safe retry behavior under Entra timeouts and duplicate delivery.

## Data / API / Integrations

### Data

- `scim_connections`: tenant, opaque connection ID, enabled state, entitlement/health state, token hash metadata, rotation timestamps, request timestamps, and sanitized last error.
- `scim_user_links`: tenant, connection, SCIM resource ID, upstream external ID, Alga user ID, observed attributes, upstream active state, link state, SCIM inactivity provenance, and timestamps.
- `scim_unresolved_identities`: tenant, connection, upstream identity, observed fields, failure reason, attempt count, resolution state, and timestamps.
- `scim_operations`: tenant, connection, operation, target link/identity, outcome, sanitized detail, and timestamps with bounded retention.

### API

- `/api/scim/v2/{connectionId}/ServiceProviderConfig`
- `/api/scim/v2/{connectionId}/Schemas`
- `/api/scim/v2/{connectionId}/ResourceTypes`
- `/api/scim/v2/{connectionId}/Users`
- `/api/scim/v2/{connectionId}/Users/{id}`

### Integration

- Microsoft Entra automatic provisioning is the supported client.
- The existing CIPP/direct Graph contact integration is not part of the runtime path.
- Existing session tracking and revocation are extended for all-sessions-for-user revocation.
- Existing Security settings permission and tier-feature systems gate administration.

## Security / Permissions

- Security-settings read permission controls visibility.
- Security-settings update permission controls enablement, tokens, manual linking, unlinking, and disablement.
- SCIM bearer credentials authenticate runtime requests independently from user sessions and API keys.
- Security-sensitive administration and lifecycle operations enter the audit trail.
- Token values, raw headers, and full payloads are excluded from logs and history.

## Observability

- Connection health shows last authenticated request, last successful operation, last sanitized error, and token usage generation.
- Operation history distinguishes lookup, link, update, deactivate, reactivate, delete, retry, and rejection.
- Unresolved identities aggregate repeated attempts rather than creating unbounded duplicates.
- Emulator request history supports deterministic test diagnosis.

## Rollout / Migration

- Add EE tables and indexes without backfilling connections or links.
- Deploy disabled by default.
- Validate emulator suite, live Entra test app, and an internal Pro tenant.
- Publish setup, mapping, lifecycle, troubleshooting, rotation, and recovery documentation.
- Preserve configuration and user states through connection disablement or tier loss.

## Open Questions

- Confirm the authoritative repository location and shared infrastructure convention for external-provider emulators during implementation.
- Confirm bounded retention duration for sanitized SCIM operation history.
- Confirm whether the 24-hour token-overlap default should be tenant-configurable or fixed in the first release.

## Acceptance Criteria (Definition of Done)

- A Pro EE tenant can self-configure Entra provisioning.
- Entra Test Connection succeeds.
- Exact-email POST links one existing internal user and creates no user.
- Rejected identities appear for review without user mutation.
- Email and profile drift never changes the Alga user.
- Disablement and unassignment immediately deactivate the user and invalidate prior sessions.
- Reactivation reverses only SCIM-applied inactivity.
- DELETE preserves the user, authorization assignments, and PSA history.
- Manual inactivity remains authoritative.
- Connection disablement and entitlement loss preserve state.
- Token rotation avoids provisioning downtime.
- CE and sub-Pro tenants cannot use SCIM.
- Emulator lifecycle tests pass.
- Live Entra acceptance tests pass.

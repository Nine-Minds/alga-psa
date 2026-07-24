# SCIM User Lifecycle Provisioning Design

- Date: 2026-07-23
- Status: Approved
- Edition: Enterprise Edition
- Entitlement: Pro tier or higher

## Summary

Alga will provide a tenant-scoped SCIM 2.0 service provider for lifecycle management of existing internal MSP users. Microsoft Entra automatic provisioning is the supported client for the first release. The protocol surface remains standards-based, but other SCIM clients are not certified.

SCIM will link directory identities to existing Alga users, deactivate and reactivate linked users, revoke sessions immediately, and preserve account history. It will not create Alga users or manage their email, profile, license, roles, teams, or permissions.

## Architecture

The feature is a dedicated inbound SCIM module in EE. It is separate from the existing CIPP/direct Graph integration, which imports managed-customer directory users as Alga contacts.

Each tenant receives an opaque connection-specific base URL:

```text
https://algapsa.com/api/scim/v2/{connectionId}
```

The connection ID selects configuration; a bearer token authenticates the provisioning client. The connection ID is not a secret.

Supported endpoints:

```text
GET    /ServiceProviderConfig
GET    /Schemas
GET    /ResourceTypes
GET    /Users
GET    /Users/{id}
POST   /Users
PUT    /Users/{id}
PATCH  /Users/{id}
DELETE /Users/{id}
```

Groups, Bulk, password synchronization, sorting, role provisioning, and team provisioning are unsupported and reported accurately through SCIM metadata.

## EE and Entitlement Boundary

Functional routes, services, migrations, UI, and emulator integration live in EE. CE has no functioning SCIM provider. Shared registration points may expose CE-safe stubs where required by the monorepo.

A new tier capability requires Pro or higher. Entitlement checks protect the Security UI, administration actions, and every SCIM runtime endpoint. Loss of entitlement stops new provisioning requests while preserving configuration, links, history, and effective user states.

## Persistence

The module introduces tenant-scoped persistence for:

- SCIM connections, enabled state, token hashes, rotation overlap, and health timestamps.
- SCIM user links between one external identity and one existing internal Alga user.
- Unresolved identities requiring administrator review.
- Sanitized SCIM operation history.

Each user link records the SCIM resource ID, upstream external ID, observed directory attributes, upstream active state, link state, timestamps, and whether SCIM applied the current Alga inactivity.

Database constraints prevent one external identity from linking to multiple users and prevent one internal user from having multiple active SCIM links in the first release.

## Connection Security

Authorized tenant administrators configure SCIM under Settings > Security > User provisioning. Alga generates a high-entropy bearer token, displays plaintext once, and stores only a secure hash. Verification is timing-safe.

Rotation creates a replacement token with a default 24-hour overlap. Administrators may revoke either token immediately. Authorization headers and token values are never logged. Requests are rate-limited per connection and source.

Disabling SCIM preserves all user and link states. It does not reactivate, deactivate, or unlink users.

## Initial Linking

Entra normally searches by `userName` and sends `POST /Users` when it finds no linked resource. In Alga, POST creates a SCIM link, not an Alga user.

Automatic linking requires exactly one eligible active, unlinked internal user whose normalized email exactly equals the SCIM primary email. Matching is case-insensitive after conservative email normalization.

Alga does not auto-link using UPN fallback, aliases, display name, fuzzy matching, or inferred domains. Zero matches, duplicate matches, unsupported user types, and already-linked accounts fail safely and enter the unresolved-identity queue.

An administrator may explicitly resolve an unresolved identity to an eligible user. Mismatched emails require an explicit warning and confirmation. Once linked, the SCIM resource ID and upstream external ID become authoritative correlation keys.

## Attribute Authority

SCIM manages lifecycle state only. Incoming email, UPN, display name, given name, surname, and title are retained as observed metadata and may produce drift indicators. They do not modify the Alga user.

Alga remains authoritative for email, username, profile fields, licenses, roles, teams, permissions, notification settings, and authentication-method configuration.

## Lifecycle Semantics

`active=false` marks the link upstream-inactive, sets the Alga user inactive with SCIM provenance, and revokes every Alga session.

`DELETE /Users/{id}` performs the same reversible access revocation and tombstones the link. It never deletes the Alga user or historical PSA records.

`active=true` reactivates the user only when SCIM applied the current inactivity. It cannot override manual or other-policy inactivity.

While upstream SCIM state remains inactive, ordinary User Management blocks manual reactivation. Administrators must restore the user upstream or explicitly unlink SCIM management. Unlinking does not change effective active state.

Repeated PUT, PATCH, POST, and DELETE operations are idempotent. Concurrency controls prevent stale operations from reassigning identities or overriding a newer authoritative state.

## Immediate Session Enforcement

Alga already tracks JWT-backed sessions in a shared sessions table and supports session revocation. SCIM adds an all-sessions-for-user revocation operation with a SCIM reason.

The current throttled revoked-session check is insufficient. Protected-request authorization must observe the revocation on the next authenticated request across all application pods. The implementation may use shared persistence with distributed cache invalidation, but it must fail closed and may not wait for the existing throttle interval.

A deactivation is successful only after inactive state and a durable session-revocation instruction are committed. Physical cleanup may retry, but access must already be denied.

## Administrator Experience

The User provisioning page provides:

- Pro entitlement state.
- Enablement and disablement controls.
- Copyable tenant SCIM URL.
- One-time token display.
- Token rotation and revocation.
- Entra setup and attribute-mapping instructions.
- Connection health and sanitized recent errors.
- Linked-user lifecycle and drift status.
- Unresolved-identity review.
- Explicit link and unlink actions.
- Operation history.

Ordinary User Management shows a Managed by SCIM indicator. Upstream-inactive users show the authoritative source and a disabled activation control.

## SCIM Protocol Behavior

The first release supports user lookup by `userName`, `externalId`, and resource ID, pagination, POST, PUT, PATCH, DELETE, discovery metadata, standard media types, and stable resource metadata.

Malformed payloads return standard SCIM errors. Unsupported filters return `invalidFilter`. Unknown resources return 404. Existing-user-policy conflicts and uniqueness conflicts return 409 with sanitized details. Temporary failures return 500 so Entra can retry.

Responses never reveal another tenant, user, connection, or token.

## Emulator

A first-party TypeScript SCIM provisioning-client emulator is the primary integration harness. It is self-contained, Docker-capable, usable in CI, and excluded from production bundles.

The emulator models stable directory identities, assignment, active state, profile drift, and provisioning history. It can drive initial lookup and POST, enable, disable, unassign, delete, reassign, rotate credentials, retry, send concurrent operations, and replay stale operations.

Failure injection covers invalid tokens, malformed schemas and PATCH payloads, unsupported filters, timeouts, duplicate identities, interrupted responses, and out-of-order changes.

A smaller live-Entra acceptance suite remains required to detect interoperability differences between the emulator and Entra.

## Rollout

Deployment is inert by default. No tenant receives a connection or link automatically.

Rollout order:

1. Deploy EE schema, runtime, entitlement, and UI.
2. Pass emulator protocol and lifecycle suites.
3. Pass a dedicated live-Entra enterprise-application test.
4. Enable an internal Pro-tier dogfood tenant.
5. Publish setup and troubleshooting documentation.
6. Make self-service setup available to Pro customers.

## Risks

Exact-email matching intentionally rejects aliases and renamed identities. Clear provisioning errors and reconciliation mitigate the operational cost.

Immediate session enforcement may require central-auth changes with performance implications. It must be load-tested.

Entra behavior can diverge from generic SCIM expectations. Live acceptance coverage mitigates emulator drift.

Manual and upstream changes can race. Link provenance, row locking, idempotency, and uniqueness constraints resolve conflicts.

A compromised token can deactivate users. Hashing, rotation, revocation, rate limits, permissions, and audit history reduce the risk.

## Non-goals

- Creating Alga users.
- Client-portal user or contact lifecycle.
- Profile or email mutation.
- License, role, team, or permission assignment.
- SCIM Groups.
- Password synchronization.
- Graph or CIPP lifecycle polling.
- Hard deletion.
- Non-Entra client certification.
- Automatic conversion of SSO links into SCIM links.
